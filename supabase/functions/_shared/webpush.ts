/**
 * Web Push: VAPID authorization (RFC 8292) and aes128gcm payload encryption
 * (RFC 8291 over RFC 8188). SB-051.
 *
 * WHY THIS IS HAND-WRITTEN rather than a library call. The plan for SB-051
 * said to spike a library first, because the open question was whether
 * `npm:web-push` -- which reaches for Node's `https` and `crypto` through the
 * compat layer -- survives Supabase's Edge Runtime. That spike could not be
 * run (no local Docker or Deno on the build machine at the time), and a
 * dependency whose failure mode only appears on hosted is the worst kind
 * here: `sweep`/`digest` already showed how long a broken scheduled call can
 * sit unnoticed. Everything below is WebCrypto, which the runtime is
 * guaranteed to have.
 *
 * The trade that buys is correctness risk: an encryption you wrote yourself
 * is one you have to prove. RFC 8291 section 5 publishes a complete worked
 * example -- keys, salt, plaintext, and the exact bytes a correct
 * implementation emits -- and `webpush.test.ts` asserts this code reproduces
 * that body byte for byte. That is interop evidence against the spec itself,
 * not a round trip against my own assumptions.
 *
 * What it still does not prove: that a real push service accepts a real
 * subscription's message. Only a real device can show that (SB-051's
 * acceptance line).
 */

/** RFC 8188 record size. One notification is far smaller than one record. */
const DEFAULT_RECORD_SIZE = 4096;

/** Uncompressed P-256 point: 0x04 || X(32) || Y(32). */
const P256_PUBLIC_KEY_BYTES = 65;

/** How long a VAPID JWT stays valid. RFC 8292 caps this at 24 hours. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;

export interface DeviceSubscription {
  endpoint: string;
  /** The device's public key, base64url, uncompressed P-256 point. */
  p256dh: string;
  /** The device's auth secret, base64url, 16 bytes. */
  auth: string;
}

export interface VapidKeys {
  /** base64url, uncompressed P-256 point (65 bytes). Public by design -- it ships to the browser. */
  publicKey: string;
  /** base64url, the 32-byte private scalar. Edge Function secret, never in the client. */
  privateKey: string;
  /** `mailto:` or `https:` contact, per RFC 8292. Push services reject a JWT without one. */
  subject: string;
}

/** Test seam. Production passes nothing: a fresh key pair and random salt per message is the requirement, not an option. */
export interface EncryptOverrides {
  salt?: Uint8Array<ArrayBuffer>;
  senderPrivateKey?: string;
  senderPublicKey?: string;
  recordSize?: number;
}

// ---------------------------------------------------------------------------
// base64url
// ---------------------------------------------------------------------------
// Every key in this protocol travels as unpadded base64url, including the
// ones the browser hands the client. `atob`/`btoa` speak standard base64, so
// the translation happens here once rather than at each call site.

// The `<ArrayBuffer>` on every byte-producing helper here is load-bearing,
// not decoration. Since TypeScript 5.7 a bare `Uint8Array` may be backed by a
// SharedArrayBuffer, and Deno's lib types reject that everywhere this file
// needs to hand bytes to WebCrypto or `fetch`. Allocating the buffer
// explicitly makes the type true instead of casting it away at each call.
export function b64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key import
// ---------------------------------------------------------------------------
// WebCrypto will not import a raw private scalar, only a JWK -- and a P-256
// JWK needs x and y as well as d. Both tools that generate VAPID keys emit
// the pair as (raw private scalar, raw public point), so the public point is
// split back into its coordinates here rather than asking the operator for a
// third value they were never given.

function jwkFromRawKeyPair(privateKey: string, publicKey: string): JsonWebKey {
  const pub = b64urlToBytes(publicKey);
  if (pub.length !== P256_PUBLIC_KEY_BYTES || pub[0] !== 0x04) {
    throw new Error(`public key must be a ${P256_PUBLIC_KEY_BYTES}-byte uncompressed P-256 point`);
  }
  return {
    kty: "EC",
    crv: "P-256",
    d: privateKey,
    x: bytesToB64url(pub.subarray(1, 33)),
    y: bytesToB64url(pub.subarray(33, 65)),
    ext: true,
  };
}

async function importPrivateKey(
  privateKey: string,
  publicKey: string,
  algorithm: "ECDH" | "ECDSA",
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "jwk",
    jwkFromRawKeyPair(privateKey, publicKey),
    { name: algorithm, namedCurve: "P-256" },
    false,
    usages,
  );
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  lengthBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** `label || 0x00`, the info-string shape both RFCs use. */
function infoString(label: string, ...extra: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  return concat(new TextEncoder().encode(label), new Uint8Array(new ArrayBuffer(1)), ...extra);
}

// ---------------------------------------------------------------------------
// Payload encryption -- RFC 8291
// ---------------------------------------------------------------------------

/**
 * Encrypt one push message for one device.
 *
 * The device's public key and auth secret come from its own subscription;
 * this end contributes an ephemeral key pair and a random salt per message,
 * which is what keeps two identical notifications from producing identical
 * bytes on the wire.
 */
export async function encryptPayload(
  plaintext: string | Uint8Array<ArrayBuffer>,
  device: Pick<DeviceSubscription, "p256dh" | "auth">,
  overrides: EncryptOverrides = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const recordSize = overrides.recordSize ?? DEFAULT_RECORD_SIZE;
  const salt: Uint8Array<ArrayBuffer> = overrides.salt ?? crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));

  const uaPublicRaw = b64urlToBytes(device.p256dh);
  const authSecret = b64urlToBytes(device.auth);

  // The sender ("application server") key pair: ephemeral in production,
  // fixed only so the RFC's own example can be reproduced in a test.
  let senderPrivate: CryptoKey;
  let senderPublicRaw: Uint8Array<ArrayBuffer>;
  if (overrides.senderPrivateKey && overrides.senderPublicKey) {
    senderPrivate = await importPrivateKey(
      overrides.senderPrivateKey,
      overrides.senderPublicKey,
      "ECDH",
      ["deriveBits"],
    );
    senderPublicRaw = b64urlToBytes(overrides.senderPublicKey);
  } else {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"],
    ) as CryptoKeyPair;
    senderPrivate = pair.privateKey;
    senderPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey) as ArrayBuffer);
  }

  const uaPublic = await crypto.subtle.importKey(
    "raw",
    uaPublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublic }, senderPrivate, 256),
  ) as Uint8Array<ArrayBuffer>;

  // RFC 8291 section 3.4. The auth secret is the salt at this step, and the
  // info string binds the key material to BOTH public keys -- receiver
  // first, sender second. Swapping that order yields a key that decrypts to
  // nothing on the device and reports no error here.
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    infoString("WebPush: info", uaPublicRaw, senderPublicRaw),
    32,
  );

  // RFC 8188 section 2.2, with the per-message salt.
  const contentKey = await hkdf(salt, ikm, infoString("Content-Encoding: aes128gcm"), 16);
  const nonce = await hkdf(salt, ikm, infoString("Content-Encoding: nonce"), 12);

  const body: Uint8Array<ArrayBuffer> = typeof plaintext === "string"
    ? new TextEncoder().encode(plaintext)
    : plaintext;
  // 0x02 is the last-record delimiter. A single-record message that uses
  // 0x01 is rejected by the receiver as a truncated stream.
  const record = concat(body, new Uint8Array(new ArrayBuffer(1)).fill(2));

  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, record),
  );

  // RFC 8188 header: salt(16) || record size(4, big-endian) || key id length(1) || key id.
  // For web push the key id IS the sender's public key, which is how the
  // device knows which key to run its own ECDH against.
  const header = new Uint8Array(new ArrayBuffer(21));
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize, false);
  header[20] = senderPublicRaw.length;

  return concat(header, senderPublicRaw, ciphertext);
}

// ---------------------------------------------------------------------------
// VAPID -- RFC 8292
// ---------------------------------------------------------------------------

/** `https://host` of the endpoint: the audience a push service checks the JWT against. */
function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * The `Authorization` header for one push request.
 *
 * `nowSeconds` is a parameter for the same reason `due.ts` takes `now`: a
 * function that reads the clock internally cannot be asserted against a
 * fixed expiry.
 */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const encoder = new TextEncoder();
  const header = bytesToB64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToB64url(
    encoder.encode(JSON.stringify({
      aud: audienceOf(endpoint),
      exp: nowSeconds + VAPID_TTL_SECONDS,
      sub: keys.subject,
    })),
  );

  const signingInput = `${header}.${claims}`;
  const signingKey = await importPrivateKey(keys.privateKey, keys.publicKey, "ECDSA", ["sign"]);
  // WebCrypto emits the raw r||s pair ES256 wants. A DER-wrapped signature --
  // what most non-browser crypto libraries produce by default -- is rejected
  // by every push service.
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(signingInput)),
  );

  return `vapid t=${signingInput}.${bytesToB64url(signature)}, k=${keys.publicKey}`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface PushResult {
  status: number;
  /** True when the push service says this subscription is gone for good (RFC 8030). */
  gone: boolean;
  body?: string;
}

/**
 * Deliver one encrypted message to one subscription.
 *
 * Never throws on a rejected send: the caller is a scheduled batch, and one
 * dead endpoint must not stop the other devices from being told. A `404` or
 * `410` is reported as `gone` because it is a fact about the device, not a
 * failure to retry.
 */
export async function sendWebPush(
  subscription: DeviceSubscription,
  payload: string,
  vapid: VapidKeys,
  options: { ttlSeconds?: number; fetchImpl?: typeof fetch } = {},
): Promise<PushResult> {
  const doFetch = options.fetchImpl ?? fetch;
  const encrypted = await encryptPayload(payload, subscription);
  const authorization = await vapidAuthorization(subscription.endpoint, vapid);

  const response = await doFetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // RFC 8030: how long the push service may hold the message for a
      // device that is offline. A due-task reminder is worthless tomorrow.
      TTL: String(options.ttlSeconds ?? 4 * 60 * 60),
      Urgency: "normal",
    },
    body: encrypted,
  });

  const gone = response.status === 404 || response.status === 410;
  let body: string | undefined;
  if (!response.ok) {
    body = (await response.text().catch(() => "")).slice(0, 200);
  } else {
    await response.body?.cancel().catch(() => {});
  }
  return { status: response.status, gone, body };
}
