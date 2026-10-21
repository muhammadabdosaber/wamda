// SB-010: a request with a foreign Origin must be rejected at the preflight
// path when ALLOWED_ORIGIN is configured -- proven here, not just read from
// the code. Run with: deno test --allow-env supabase/functions/_shared/http.test.ts
//
// No test framework import on purpose: pulling one over the network here
// would be the one dependency-fetch-at-test-time exception in a codebase
// that otherwise refuses to depend on anything not vendored or self-hosted.

import { HttpError, preflight, requireCronSecret } from "./http.ts";

function assertEquals<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function optionsRequest(origin?: string): Request {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  return new Request("http://localhost/functions/v1/enrich", { method: "OPTIONS", headers });
}

Deno.test("preflight: non-OPTIONS requests are untouched, regardless of ALLOWED_ORIGIN", () => {
  Deno.env.set("ALLOWED_ORIGIN", "https://app.example.com");
  try {
    const req = new Request("http://localhost/functions/v1/enrich", { method: "POST" });
    assertEquals(preflight(req), null, "non-OPTIONS should pass through");
  } finally {
    Deno.env.delete("ALLOWED_ORIGIN");
  }
});

Deno.test("preflight: ALLOWED_ORIGIN unset stays permissive (local dev default)", async () => {
  Deno.env.delete("ALLOWED_ORIGIN");
  const res = preflight(optionsRequest("https://anything.example"));
  if (!res) throw new Error("expected a Response, got null");
  assertEquals(res.status, 204, "status");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*", "CORS header");
  await res.body?.cancel();
});

Deno.test("preflight: matching Origin is accepted with the pinned CORS header", async () => {
  Deno.env.set("ALLOWED_ORIGIN", "https://app.example.com");
  try {
    const res = preflight(optionsRequest("https://app.example.com"));
    if (!res) throw new Error("expected a Response, got null");
    assertEquals(res.status, 204, "status");
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.example.com", "CORS header");
    await res.body?.cancel();
  } finally {
    Deno.env.delete("ALLOWED_ORIGIN");
  }
});

Deno.test("preflight: a foreign Origin is rejected, not answered with CORS headers", async () => {
  Deno.env.set("ALLOWED_ORIGIN", "https://app.example.com");
  try {
    const res = preflight(optionsRequest("https://evil.example"));
    if (!res) throw new Error("expected a Response, got null");
    assertEquals(res.status, 403, "status");
    // The whole point: no header naming the real origin goes back to a
    // caller that didn't send it.
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), null, "CORS header must be absent");
    await res.body?.cancel();
  } finally {
    Deno.env.delete("ALLOWED_ORIGIN");
  }
});

Deno.test("preflight: a missing Origin is rejected the same as a foreign one", async () => {
  Deno.env.set("ALLOWED_ORIGIN", "https://app.example.com");
  try {
    const res = preflight(optionsRequest());
    if (!res) throw new Error("expected a Response, got null");
    assertEquals(res.status, 403, "status");
    await res.body?.cancel();
  } finally {
    Deno.env.delete("ALLOWED_ORIGIN");
  }
});

// SECURITY_REVIEW.md F1: sweep/digest are service-only, and the platform's
// verify_jwt accepts the PUBLIC anon key -- so the gate that actually keeps
// an anonymous visitor from triggering vendor spend is requireCronSecret.
// The rejection cases are the point; the happy path exists so a refactor
// cannot silently lock pg_cron out -- which is exactly what SB-052 was: the
// gate kept working as written while the credential underneath it moved.

const CRON_SECRET = "test-cron-secret-abcdefghijklmnop";

function postRequest(bearer?: string): Request {
  const headers = new Headers();
  if (bearer !== undefined) headers.set("Authorization", `Bearer ${bearer}`);
  return new Request("http://localhost/functions/v1/sweep", { method: "POST", headers });
}

function expectForbidden(req: Request, msg: string) {
  try {
    requireCronSecret(req);
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) return;
    throw new Error(`${msg}: expected HttpError 403, got ${String(e)}`);
  }
  throw new Error(`${msg}: expected a throw, got none`);
}

Deno.test("requireCronSecret: the cron secret passes", () => {
  Deno.env.set("CRON_SECRET", CRON_SECRET);
  try {
    requireCronSecret(postRequest(CRON_SECRET)); // must not throw
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});

Deno.test("requireCronSecret: the anon key (any other bearer) is rejected", () => {
  Deno.env.set("CRON_SECRET", CRON_SECRET);
  try {
    expectForbidden(postRequest("the-public-anon-key"), "anon bearer");
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});

Deno.test("requireCronSecret: a missing Authorization header is rejected", () => {
  Deno.env.set("CRON_SECRET", CRON_SECRET);
  try {
    expectForbidden(postRequest(), "no header");
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});

Deno.test("requireCronSecret: an empty bearer is rejected", () => {
  Deno.env.set("CRON_SECRET", CRON_SECRET);
  try {
    expectForbidden(postRequest(""), "empty bearer");
  } finally {
    Deno.env.delete("CRON_SECRET");
  }
});
