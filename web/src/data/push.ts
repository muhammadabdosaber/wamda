import { isConfigured, supabase } from "./api";

/**
 * SB-051. Turning notifications on and off, from the client's side.
 *
 * The device does the hard part: the browser mints a subscription (an
 * endpoint on its own push service, plus a key pair), and all this code does
 * is hand that subscription to the database so `functions/push` can encrypt
 * to it later. No key of this project's is involved on this side except the
 * VAPID PUBLIC key, which is public by design -- it is the value the push
 * service checks the sender's signature against.
 */

/** Public by design: the browser needs it to subscribe, and it verifies nothing on its own. */
const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState =
  /** No VAPID key in this build, or no Supabase config. An operator's problem, not the user's -- the UI says nothing at all. */
  | "unconfigured"
  /** No push API at all. On iOS this is what a Safari TAB reports -- the app must be installed to the Home Screen first. */
  | "unsupported"
  /** The user said no. No second prompt is possible; only browser settings can undo it. */
  | "blocked"
  /** Supported and permitted, with a live subscription stored. */
  | "on"
  /** Supported, not yet subscribed. */
  | "off";

/**
 * Whether the BUILD can do push at all -- deliberately separate from whether
 * the browser can.
 *
 * Without this split, a deploy that simply has no `VITE_VAPID_PUBLIC_KEY` set
 * shows every visitor the iOS "add it to your Home Screen" hint, which is a
 * confident, specific, and completely wrong explanation. That failure mode is
 * this project's own history (SB-046: production ran for a day with empty
 * VITE_ variables and looked normal), so the unconfigured case renders
 * nothing instead of guessing.
 */
export function pushConfigured(): boolean {
  return Boolean(vapidPublicKey) && isConfigured;
}

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * "On" means the SERVER holds this device's subscription -- not merely the
 * browser. Reading only the browser said "on" on the owner's iPhone for a
 * subscription that had never been stored (the first save hit the `auth`
 * column bug, the browser kept its half). So a browser subscription the
 * server lacks is stored here, silently, and only a successful store counts.
 */
export async function pushState(): Promise<PushState> {
  if (!pushConfigured()) return "unconfigured";
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return "off";
  try {
    return (await storeSubscription(subscription)) ? "on" : "off";
  } catch {
    return "off";
  }
}

/**
 * Upsert this device's subscription. False when nobody is signed in.
 *
 * No `user_id` in the payload: the column defaults to `auth.uid()`, and an
 * upsert's ON CONFLICT DO UPDATE sets every column it was sent -- the grant
 * allows UPDATE on four columns only, so sending `user_id` is a 403.
 */
async function storeSubscription(subscription: PushSubscription): Promise<boolean> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return false;
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint: subscription.endpoint,
      ...keysOf(subscription),
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw error;
  return true;
}

/**
 * The VAPID public key travels as base64url text and `pushManager.subscribe`
 * wants raw bytes. Exported because it is the one piece of this module that
 * is pure and therefore testable without a browser -- and getting it wrong
 * produces an `InvalidAccessError` at subscribe time with no hint as to why.
 */
// The explicit `Uint8Array<ArrayBuffer>` is not decoration: since TypeScript
// 5.7 a plain `Uint8Array` may be backed by a SharedArrayBuffer, which
// `applicationServerKey` does not accept. Allocating the buffer here is what
// makes the type honest, rather than casting at the call site.
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * The two keys a subscription carries, as base64url, keyed by the DATABASE
 * column names. The browser calls the second one `auth`; the column is
 * `auth_secret`. Sending `auth` made PostgREST reject every upsert, so no
 * subscription was ever stored -- found on the owner's iPhone, 2026-10-21.
 * Exported so a test pins the column names.
 */
export function keysOf(
  subscription: Pick<PushSubscription, "getKey">,
): { p256dh: string; auth_secret: string } {
  const read = (name: "p256dh" | "auth") => {
    const key = subscription.getKey(name);
    if (!key) throw new Error(`subscription is missing its ${name} key`);
    let binary = "";
    for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  return { p256dh: read("p256dh"), auth_secret: read("auth") };
}

/**
 * Ask for permission, subscribe, and store the subscription.
 *
 * Must be called from a real user gesture: browsers reject a permission
 * prompt that no tap asked for, and Safari does so silently.
 *
 * Re-subscribing is normal -- browsers rotate endpoints -- so the row is
 * upserted on `(user_id, endpoint)` rather than inserted, which is what keeps
 * the table from collecting one dead row per app launch.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushConfigured()) return "unconfigured";
  if (!pushSupported()) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  // `ready` rather than `register`: the PWA plugin already registers the
  // worker at load. Registering a second time here would race it.
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    // Required by every browser today: a push that cannot show a
    // notification is not allowed to wake a service worker at all.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
  });

  return (await storeSubscription(subscription)) ? "on" : "off";
}

/**
 * Turn them off, and mean it.
 *
 * The row is DELETED, not flagged: if the only way to stop the notifications
 * were to uninstall the app, that is what the user would do. The browser-side
 * `unsubscribe()` matters too -- without it the endpoint stays alive and a
 * stale sender could still reach the device.
 */
export async function disablePush(): Promise<PushState> {
  if (!pushConfigured()) return "unconfigured";
  if (!pushSupported()) return "unsupported";

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();

  if (subscription) {
    const { data: auth } = await supabase.auth.getUser();
    if (auth?.user) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("user_id", auth.user.id)
        .eq("endpoint", subscription.endpoint);
    }
    await subscription.unsubscribe();
  }

  return Notification.permission === "denied" ? "blocked" : "off";
}
