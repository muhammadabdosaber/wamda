/**
 * POST /functions/v1/delete-account
 * Body: { confirm_email: string }
 *
 * SB-015: irreversible, so this endpoint IS the confirmation step, not a
 * placeholder for one a UI will add later. It refuses to act unless the
 * caller types back their own email exactly -- a client cannot satisfy that
 * by echoing a field it didn't have to think about, the same reason GitHub
 * makes you type a repo's name to delete it.
 *
 * The deletion itself is one call: `auth.admin.deleteUser()` cascades
 * through every table with a `references auth.users (id) on delete cascade`
 * FK -- notes, note_enrichments, note_tags, tags (and tag_labels through
 * it), note_embeddings, note_relations, weekly_digests, ai_jobs, profiles.
 * That cascade already existed (docs/08-security.md); this function's own
 * job is the audio objects, which a Postgres FK cannot reach, and the
 * confirmation gate.
 */

import { errorResponse, HttpError, json, preflight } from "../_shared/http.ts";
import { authenticate, serviceClient, userClient } from "../_shared/supabase.ts";
import { resolveLanguage, SUPPORTED } from "../_shared/language.ts";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  let language = "ar";

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");

    const supabase = userClient(req);
    const user = await authenticate(supabase);
    const body = await req.json().catch(() => ({}));

    const resolved = resolveLanguage({
      explicit: body.lang,
      profile: user.uiLocale,
      acceptLanguage: req.headers.get("accept-language"),
    });
    language = resolved.language;
    const direction = SUPPORTED[language]?.direction ?? "rtl";

    // The caller's real email, fetched from the authenticated session --
    // never trust a client-supplied "this is my email" value for the thing
    // that IS the confirmation check.
    const { data: authUser } = await supabase.auth.getUser();
    const email = authUser?.user?.email;
    if (!email) throw new HttpError(500, "internal_error");

    const confirmEmail = typeof body.confirm_email === "string" ? body.confirm_email : "";
    if (confirmEmail !== email) {
      throw new HttpError(400, "confirmation_mismatch");
    }

    const admin = serviceClient();

    // Storage objects are not reachable by the Postgres cascade below --
    // deleted first, so a failure here leaves the account (and the ability
    // to retry) intact rather than deleting the account with orphaned audio
    // left behind with no owner to clean it up later.
    const { data: files, error: listErr } = await admin.storage.from("audio").list(user.id);
    if (listErr) throw new HttpError(500, "account_deletion_failed");
    if (files?.length) {
      const paths = files.map((f) => `${user.id}/${f.name}`);
      const { error: removeErr } = await admin.storage.from("audio").remove(paths);
      if (removeErr) throw new HttpError(500, "account_deletion_failed");
    }

    // Cascades through every FK'd table -- see the file comment.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
    if (deleteErr) throw new HttpError(500, "account_deletion_failed");

    return json({ deleted: true }, { language, direction });
  } catch (err) {
    return errorResponse(err, language);
  }
});
