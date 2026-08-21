// SB-051. The encryption in `webpush.ts` is hand-written, so it is asserted
// against the specification's own published example rather than against
// itself: RFC 8291 section 5 gives both parties' keys, the auth secret, the
// plaintext, and the exact body a correct implementation produces. If a
// single derivation step here is wrong -- an info string, the order of the
// two public keys, the record delimiter -- these bytes do not match.
//
// Run with: deno test --allow-env supabase/functions/_shared/webpush.test.ts
//
// No test framework import, matching `http.test.ts`.

import {
  b64urlToBytes,
  bytesToB64url,
  encryptPayload,
  sendWebPush,
  vapidAuthorization,
} from "./webpush.ts";

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// --- RFC 8291, section 5 -----------------------------------------------------
// "Push Message Encryption Example". Values copied verbatim from
// https://www.rfc-editor.org/rfc/rfc8291.txt (line wrapping removed).
const RFC_PLAINTEXT = "When I grow up, I want to be a watermelon";
const RFC_AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const RFC_RECEIVER_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const RFC_SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const RFC_SENDER_PUBLIC =
  "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const RFC_EXPECTED_BODY =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

Deno.test("encryptPayload reproduces RFC 8291's own worked example, byte for byte", async () => {
  const expected = b64urlToBytes(RFC_EXPECTED_BODY);

  // The salt and record size are part of the example's output, not inputs the
  // RFC lists separately -- they live in the first 20 bytes of the body it
  // publishes. Reading them back out is what makes a byte comparison of the
  // whole message possible.
  const salt = expected.subarray(0, 16);
  const recordSize = new DataView(expected.buffer, expected.byteOffset).getUint32(16, false);

  const actual = await encryptPayload(
    RFC_PLAINTEXT,
    { p256dh: RFC_RECEIVER_PUBLIC, auth: RFC_AUTH_SECRET },
    {
      salt,
      recordSize,
      senderPrivateKey: RFC_SENDER_PRIVATE,
      senderPublicKey: RFC_SENDER_PUBLIC,
    },
  );

  assertEquals(bytesToB64url(actual), RFC_EXPECTED_BODY, "encrypted body does not match RFC 8291");
});

Deno.test("encryptPayload emits a well-formed aes128gcm header and a fresh salt per message", async () => {
  const device = { p256dh: RFC_RECEIVER_PUBLIC, auth: RFC_AUTH_SECRET };
  const plaintext = "task due";

  const first = await encryptPayload(plaintext, device);
  const second = await encryptPayload(plaintext, device);

  assertEquals(first[20], 65, "key id length byte should be 65 (uncompressed P-256 point)");
  assertEquals(
    new DataView(first.buffer, first.byteOffset).getUint32(16, false),
    4096,
    "default record size",
  );
  // 21-byte header + 65-byte key + plaintext + 1 delimiter + 16-byte GCM tag.
  assertEquals(
    first.length,
    21 + 65 + new TextEncoder().encode(plaintext).length + 1 + 16,
    "ciphertext length",
  );

  assert(
    bytesToB64url(first) !== bytesToB64url(second),
    "two sends of the same text produced identical bytes -- salt or key pair is not per-message",
  );
});

Deno.test("vapidAuthorization signs a JWT the push service can verify against the public key", async () => {
  // A throwaway pair, generated here: no VAPID key of this project's is ever
  // committed, including in a test.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const rawPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));

  const keys = {
    publicKey: bytesToB64url(rawPublic),
    privateKey: jwk.d!,
    subject: "mailto:owner@example.test",
  };

  const now = 1_700_000_000;
  const header = await vapidAuthorization(
    "https://push.example.net/push/abc123?x=1",
    keys,
    now,
  );

  assert(header.startsWith("vapid t="), "scheme must be `vapid`");
  const [, token, keyPart] = header.match(/^vapid t=([^,]+), k=(.+)$/) ?? [];
  assert(Boolean(token), "no token in the Authorization header");
  assertEquals(keyPart, keys.publicKey, "k= must carry the VAPID public key");

  const [encodedHeader, encodedClaims, encodedSignature] = token.split(".");
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(encodedClaims)));
  assertEquals(claims.aud, "https://push.example.net", "aud must be the endpoint's ORIGIN, not its full URL");
  assertEquals(claims.exp, now + 12 * 60 * 60, "exp must be 12 hours out");
  assertEquals(claims.sub, "mailto:owner@example.test", "sub must be carried through");

  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    b64urlToBytes(encodedSignature),
    new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`),
  );
  assert(verified, "signature does not verify -- a push service would reject this");
});

Deno.test("sendWebPush reports a dead subscription instead of throwing", async () => {
  const device = {
    endpoint: "https://push.example.net/push/gone",
    p256dh: RFC_RECEIVER_PUBLIC,
    auth: RFC_AUTH_SECRET,
  };
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const vapid = {
    publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateKey: jwk.d!,
    subject: "mailto:owner@example.test",
  };

  const seen: { url: string; headers: Headers; bodyLength: number }[] = [];
  const stubFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({
      url: String(input),
      headers: new Headers(init?.headers),
      bodyLength: (init?.body as Uint8Array).length,
    });
    return Promise.resolve(new Response("subscription expired", { status: 410 }));
  };

  const result = await sendWebPush(device, "task due", vapid, {
    fetchImpl: stubFetch as unknown as typeof fetch,
  });

  assertEquals(result.status, 410, "status passed through");
  assertEquals(result.gone, true, "410 must be reported as gone, so the caller disables the row");
  assertEquals(seen.length, 1, "exactly one request");
  assertEquals(seen[0].url, device.endpoint, "posted to the subscription's own endpoint");
  assertEquals(
    seen[0].headers.get("Content-Encoding"),
    "aes128gcm",
    "Content-Encoding is what tells the device how to read the body",
  );
  assert(seen[0].headers.get("TTL") !== null, "RFC 8030 requires a TTL header");
  assert(seen[0].bodyLength > 86, "body must carry the header, the key and a ciphertext");
});

Deno.test("sendWebPush does not mark a transient failure as gone", async () => {
  const device = {
    endpoint: "https://push.example.net/push/busy",
    p256dh: RFC_RECEIVER_PUBLIC,
    auth: RFC_AUTH_SECRET,
  };
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const vapid = {
    publicKey: bytesToB64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
    privateKey: jwk.d!,
    subject: "mailto:owner@example.test",
  };

  const result = await sendWebPush(device, "task due", vapid, {
    fetchImpl: (() => Promise.resolve(new Response("slow down", { status: 429 }))) as unknown as typeof fetch,
  });

  assertEquals(result.status, 429, "status passed through");
  assertEquals(result.gone, false, "429 is a retry, not a dead device");
});
