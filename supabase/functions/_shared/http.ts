/** CORS, JSON responses, and error shaping shared by every Edge Function. */

/**
 * Read at call time, not cached at module load -- lets tests toggle it with
 * `Deno.env.set`/`.delete` around each case (SB-010). No behaviour
 * difference in production: an Edge Function's env does not change during
 * its own lifetime.
 */
function allowedOrigin(): string | undefined {
  return Deno.env.get("ALLOWED_ORIGIN") || undefined;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin() ?? "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, accept-language",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/**
 * SB-010: `ALLOWED_ORIGIN` used to only decorate the CORS header -- every
 * preflight got a 204 regardless of who asked, leaving the actual gate to
 * whether the CALLING BROWSER honoured a mismatched
 * `Access-Control-Allow-Origin`. Real protection for a well-behaved browser,
 * but not a server-side gate. Now: when `ALLOWED_ORIGIN` is configured, a
 * preflight from any other `Origin` (including none) is rejected here,
 * before any CORS header naming the real origin is ever sent back.
 *
 * Unset (every local environment today) stays permissive -- matching the
 * existing `*` default and docs/09-status-handoff.md's own framing that `*`
 * is fine locally and wrong in production.
 */
export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;

  const allowed = allowedOrigin();
  if (allowed && req.headers.get("Origin") !== allowed) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Every response echoes the language it was served in. The client must never
 * have to infer which language it got back -- that inference is exactly where
 * a mixed-language UI comes from.
 */
export function json(
  body: unknown,
  init: { status?: number; language?: string; direction?: "rtl" | "ltr" } = {},
): Response {
  const headers: Record<string, string> = {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
  };
  if (init.language) headers["Content-Language"] = init.language;

  const payload =
    init.language && typeof body === "object" && body !== null && !Array.isArray(body)
      ? { ...(body as Record<string, unknown>), language: init.language, direction: init.direction }
      : body;

  return new Response(JSON.stringify(payload), { status: init.status ?? 200, headers });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** Stable machine-readable code. The client maps this to a localized string. */
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * Error bodies carry a CODE, never a human sentence.
 *
 * A server-generated Arabic error message would be a second, invisible
 * translation surface that drifts from the app's ARB files. The client owns
 * all user-facing text; the server owns the code.
 */
export function errorResponse(err: unknown, language?: string): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code } }, { status: err.status, language });
  }
  // Never leak an internal message to the client -- stack traces and driver
  // errors routinely contain table names, IDs, and occasionally row data.
  console.error("unhandled_error", err instanceof Error ? err.message : String(err));
  return json({ error: { code: "internal_error" } }, { status: 500, language });
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new HttpError(500, "missing_configuration", `${name} is not set`);
  return v;
}

/**
 * Gate for service-only functions (`sweep`, `digest`) -- callable by pg_cron,
 * never by a user or an anonymous visitor.
 *
 * The platform's own `verify_jwt` is not enough here: it accepts ANY JWT
 * signed with the project secret, and the anon key -- shipped in every
 * browser bundle by design -- is exactly such a JWT. So without this check,
 * anyone could trigger a real Anthropic Batch submission (`digest enqueue`)
 * or an uncapped vendor-retry pass (`sweep` with `forceEmbedBackfill`).
 *
 * **Why a dedicated `CRON_SECRET` and not `SUPABASE_SERVICE_ROLE_KEY`
 * (SB-052).** This used to compare against the service-role key, which the
 * pg_cron jobs read from Vault. That coupled our authorization to a
 * credential *the platform owns and rotates on its own schedule* -- and on
 * 2026-08-16 Supabase's new-API-key migration silently replaced the value
 * injected into every deployed function (a 219-char legacy JWT became a
 * 41-char `sb_secret_...`). The Vault copy could not follow, because nothing
 * told it to. Result: five days of `403` on every cron tick, one missed
 * weekly digest, and the sweep safety net down the whole time -- while
 * `cron.job_run_details` cheerfully reported `succeeded`, because pg_net had
 * queued the request just fine.
 *
 * `CRON_SECRET` is ours. Supabase can rotate its keys whenever it likes and
 * this gate is unaffected. The trade is that it must be set in two places
 * (Edge Function secret + the Vault secret each schedule reads); a missing
 * env var fails loud with `missing_configuration` rather than silently
 * accepting anything.
 *
 * **Deployment requirement, found the hard way finishing SB-052:** `sweep`
 * and `digest` must be deployed with `--no-verify-jwt`
 * (`supabase functions deploy sweep digest --no-verify-jwt`). Supabase's
 * platform gateway validates the `Authorization` bearer as a real signed JWT
 * *before* a request ever reaches this code -- a JWT happened to pass that
 * check by coincidence (it decoded, even though its value then failed the
 * application check), but `CRON_SECRET` is a plain random string and gets
 * rejected at the gateway with `401 UNAUTHORIZED_INVALID_JWT_FORMAT`,
 * `requireCronSecret` never even running. A default `supabase functions
 * deploy sweep digest` (no flag) silently reintroduces exactly this class of
 * outage -- the whole reason `CRON_SECRET` exists.
 */
export function requireCronSecret(req: Request): void {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== requireEnv("CRON_SECRET")) {
    throw new HttpError(403, "forbidden");
  }
}
