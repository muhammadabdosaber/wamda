/**
 * POST /functions/v1/push
 *
 * Service-triggered (pg_cron), not user-facing -- same shape as `sweep` and
 * `digest`, and gated the same way. SB-051.
 *
 * Two modes:
 *
 *   - default (hourly, `push-due-tasks`): one summary per user per local day
 *     at 08:00 -- the most urgent task's title, and how many more of their
 *     open tasks are overdue or due today. The badge SB-050 added only reaches
 *     someone who opens the app; this is the half that reaches a locked phone.
 *   - `{"mode":"due-now"}` (every minute, `push-task-due`, added 2026-10-21):
 *     one reminder per task at its own due time.
 *
 * Constraints on the summary, all of them product decisions rather than
 * technical ones:
 *
 *   - ONE notification, not one per task. This app is built for someone with
 *     ADHD. Five buzzes in a row is not five reminders, it is noise, and
 *     noise is what the product exists to remove.
 *   - In the user's OWN morning, not at a fixed UTC hour. `profiles.timezone`
 *     already exists; a reminder that lands at 04:00 gets notifications
 *     turned off for good.
 *   - Once per local day, enforced by a row in `push_deliveries` rather than
 *     by a timestamp comparison. The schedule ticks hourly; "did we already
 *     tell them today" has to survive a retry, a redeploy and a clock change.
 *
 * The due-time reminder is the owner's own exception to "one notification":
 * a task the note says is due at 10:00 should buzz at 10:00. It is still once
 * per task per due time (`push_task_reminders`).
 *
 * What decides WHO gets told lives in SQL (`push_due_candidates()`,
 * `push_task_due_candidates()`), not here -- the same rule the Tasks screen and
 * the badge already use. A second definition in TypeScript would drift, and
 * the user would meet the drift as a notification about a task the app does
 * not list.
 */

import { errorResponse, HttpError, json, preflight, requireEnv, requireCronSecret } from "../_shared/http.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { sendWebPush, type DeviceSubscription, type VapidKeys } from "../_shared/webpush.ts";

/**
 * The hour, in the user's own timezone, a due-task summary is sent.
 *
 * 08:00: after waking, before the day is committed. Not configurable per user
 * yet -- there is one user, and a preference nobody has asked for is a column
 * to migrate later for no gain. When that changes it belongs in `profiles`,
 * beside `timezone`, not in an env var.
 */
const SEND_HOUR = 8;

/** Consecutive failed sends before a subscription is treated as dead. */
const MAX_FAILURES = 5;

interface Candidate {
  user_id: string;
  timezone: string;
  local_hour: number;
  local_date: string;
  overdue_count: number;
  due_today_count: number;
  sample_note_id: string | null;
  sample_title: string | null;
}

interface TaskCandidate {
  note_id: string;
  user_id: string;
  title: string | null;
  action_due_at: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  failure_count: number;
}

/**
 * The notification payloads. Mirrored in `web/src/core/pushMessage.ts`.
 *
 * No LABELS -- every word the app itself says is built by the service worker
 * from `web/src/i18n/`, the only place display text may exist (rule 2). The
 * task title is different in kind: it is the user's own content (the note's
 * title), and the payload is end-to-end encrypted (RFC 8291), so the push
 * service never reads it.
 */
interface DuePayload {
  kind: "due-tasks";
  overdue: number;
  dueToday: number;
  noteId: string | null;
  title: string | null;
  language: string;
}

interface TaskDuePayload {
  kind: "task-due";
  noteId: string;
  title: string | null;
  language: string;
}

type Admin = ReturnType<typeof serviceClient>;

interface Tally {
  sent: number;
  disabled: number;
  results: Array<Record<string, unknown>>;
}

function vapidKeys(): VapidKeys {
  return {
    publicKey: requireEnv("VAPID_PUBLIC_KEY"),
    privateKey: requireEnv("VAPID_PRIVATE_KEY"),
    subject: requireEnv("VAPID_SUBJECT"),
  };
}

async function languageOf(admin: Admin, userId: string): Promise<string> {
  // The user's own language, not a server default: the service worker
  // needs to know which catalogue to render with.
  const { data: profile } = await admin
    .from("profiles")
    .select("ui_locale")
    .eq("id", userId)
    .maybeSingle();
  return profile?.ui_locale ?? "ar";
}

/**
 * Send one payload to every live device a user has, and record what each
 * push service said. True when at least one device accepted it.
 *
 * Shared by both modes so the dead-subscription rule cannot differ between
 * them.
 */
async function deliver(
  admin: Admin,
  userId: string,
  payload: DuePayload | TaskDuePayload,
  keys: VapidKeys,
  tally: Tally,
): Promise<boolean> {
  const { data: subscriptions, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth_secret, failure_count")
    .eq("user_id", userId)
    .is("disabled_at", null);
  // Not swallowed: a missing grant here once looked exactly like "this user
  // has no devices" -- a silent no-op instead of an error.
  if (error) throw new HttpError(500, "push_subscriptions_read_failed");

  let delivered = false;

  for (const row of (subscriptions ?? []) as SubscriptionRow[]) {
    const device: DeviceSubscription = {
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth_secret,
    };

    // One dead device must not stop the others: a user with a stale
    // laptop subscription and a live phone still needs the phone told.
    let result;
    try {
      result = await sendWebPush(device, JSON.stringify(payload), keys);
    } catch (err) {
      result = { status: 0, gone: false, body: String(err).slice(0, 200) };
    }

    if (result.status >= 200 && result.status < 300) {
      delivered = true;
      tally.sent += 1;
      await admin
        .from("push_subscriptions")
        .update({ last_sent_at: new Date().toISOString(), failure_count: 0 })
        .eq("id", row.id);
    } else if (result.gone) {
      // 404/410 is the push service saying this subscription will never
      // work again. Disabled, not deleted: the row is the record of why
      // a device went quiet.
      tally.disabled += 1;
      await admin
        .from("push_subscriptions")
        .update({ disabled_at: new Date().toISOString() })
        .eq("id", row.id);
    } else {
      const failures = (row.failure_count ?? 0) + 1;
      if (failures >= MAX_FAILURES) tally.disabled += 1;
      await admin
        .from("push_subscriptions")
        .update({
          failure_count: failures,
          disabled_at: failures >= MAX_FAILURES ? new Date().toISOString() : null,
        })
        .eq("id", row.id);
    }

    tally.results.push({
      user_id: userId,
      kind: payload.kind,
      endpoint_host: new URL(row.endpoint).host,
      status: result.status,
      gone: result.gone,
    });
  }

  return delivered;
}

/**
 * The 08:00 summary. `force` bypasses the send window and the once-a-day
 * mark, not the subscription list or the due rule.
 */
async function sendSummary(admin: Admin, keys: VapidKeys, force: boolean): Promise<Response> {
  const { data: candidates, error } = await admin.rpc("push_due_candidates");
  if (error) throw new HttpError(500, "push_candidates_failed");

  const tally: Tally = { sent: 0, disabled: 0, results: [] };
  let notified = 0;

  for (const candidate of (candidates ?? []) as Candidate[]) {
    if (!force && candidate.local_hour !== SEND_HOUR) continue;

    if (!force) {
      const { data: already } = await admin
        .from("push_deliveries")
        .select("user_id")
        .eq("user_id", candidate.user_id)
        .eq("notified_on", candidate.local_date)
        .maybeSingle();
      if (already) continue;
    }

    const payload: DuePayload = {
      kind: "due-tasks",
      overdue: candidate.overdue_count,
      dueToday: candidate.due_today_count,
      noteId: candidate.sample_note_id,
      title: candidate.sample_title,
      language: await languageOf(admin, candidate.user_id),
    };

    if (await deliver(admin, candidate.user_id, payload, keys, tally)) {
      notified += 1;
      // `on conflict do nothing` semantics: a second run in the same local
      // day must not overwrite the first record, and must not fail either.
      await admin
        .from("push_deliveries")
        .upsert(
          {
            user_id: candidate.user_id,
            notified_on: candidate.local_date,
            overdue_count: candidate.overdue_count,
            due_today_count: candidate.due_today_count,
          },
          { onConflict: "user_id,notified_on", ignoreDuplicates: true },
        );
    }
  }

  return json({ candidates: candidates?.length ?? 0, notified, ...tally });
}

/**
 * Due-time reminders: claim, send, and release the claim if nothing landed.
 *
 * The claim is an insert that does nothing on conflict; only the run whose
 * insert actually wrote the row sends. That is what makes overlapping
 * every-minute runs safe without a lock. A send that reached no device gives
 * the claim back, so the next minute retries -- inside the 10-minute window
 * `push_task_due_candidates()` allows, and not after it.
 */
async function sendDueNow(admin: Admin, keys: VapidKeys): Promise<Response> {
  const { data: candidates, error } = await admin.rpc("push_task_due_candidates");
  if (error) throw new HttpError(500, "push_candidates_failed");

  const tally: Tally = { sent: 0, disabled: 0, results: [] };
  let notified = 0;

  for (const c of (candidates ?? []) as TaskCandidate[]) {
    const { data: claimed } = await admin
      .from("push_task_reminders")
      .upsert(
        { note_id: c.note_id, due_at: c.action_due_at, user_id: c.user_id },
        { onConflict: "note_id,due_at", ignoreDuplicates: true },
      )
      .select("note_id");
    if (!claimed?.length) continue; // another run already has it

    const payload: TaskDuePayload = {
      kind: "task-due",
      noteId: c.note_id,
      title: c.title,
      language: await languageOf(admin, c.user_id),
    };

    if (await deliver(admin, c.user_id, payload, keys, tally)) {
      notified += 1;
    } else {
      await admin
        .from("push_task_reminders")
        .delete()
        .eq("note_id", c.note_id)
        .eq("due_at", c.action_due_at);
    }
  }

  return json({ mode: "due-now", candidates: candidates?.length ?? 0, notified, ...tally });
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    // Service-triggered only. The anon key ships in every browser bundle and
    // must not be enough to make someone else's phone buzz (rule 6, SB-052's
    // lesson about which caller this gate has to keep working for).
    requireCronSecret(req);

    const body = await req.json().catch(() => ({}));
    const keys = vapidKeys();
    const admin = serviceClient();

    if (body.mode === "due-now") return await sendDueNow(admin, keys);

    // `force`: how the owner proves delivery on a real device without
    // waiting for 08:00 local -- the same role `forceEmbedBackfill` plays in
    // `sweep`, and reachable only with the cron secret.
    return await sendSummary(admin, keys, body.force === true);
  } catch (err) {
    return errorResponse(err);
  }
});
