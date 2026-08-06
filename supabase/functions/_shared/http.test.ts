// SB-010: a request with a foreign Origin must be rejected at the preflight
// path when ALLOWED_ORIGIN is configured -- proven here, not just read from
// the code. Run with: deno test --allow-env supabase/functions/_shared/http.test.ts
//
// No test framework import on purpose: pulling one over the network here
// would be the one dependency-fetch-at-test-time exception in a codebase
// that otherwise refuses to depend on anything not vendored or self-hosted.

import { preflight } from "./http.ts";

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
