/**
 * POST /functions/v1/push
 *
 * Service-triggered (pg_cron), not user-facing -- same shape as `sweep` and
 * `digest`, and gated the same way. SB-051.
 *
 * Sends one summary notification per user per local day: how many of their
 * open tasks are overdue or due today. The badge SB-050 added only reaches
 * someone who opens the app; this is the half that reaches a locked phone.
 *
 * Three deliberate constraints, all of them product decisions rather than
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
 * What decides WHO gets told lives in `push_due_candidates()`
 * (migration 20260822000100), not here -- the same rule the Tasks screen and
 * the badge already use. A second definition in TypeScript would drift, and
 * the user would meet the drift as a notification about a task the app does
 * not list.
 */

import { errorResponse, HttpError, json, preflight, requireEnv, requireServiceRole } from "../_shared/http.ts";
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

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  failure_count: number;
}

/**
 * The notification's payload.
 *
 * Counts and ids only -- no display text. The service worker builds the
 * Arabic sentence from `web/src/i18n/ar.ts`, which is the only place display
 * text is allowed to exist (rule 2). A server that sent "مهمتان متأخرتان"
 * would be storing a label in a message, and the day the wording changes,
 * every queued notification would carry the old one.
 */
interface DuePayload {
  kind: "due-tasks";
  overdue: number;
  dueToday: number;
  noteId: string | null;
  language: string;
}

function vapidKeys(): VapidKeys {
  return {
    publicKey: requireEnv("VAPID_PUBLIC_KEY"),
    privateKey: requireEnv("VAPID_PRIVATE_KEY"),
    subject: requireEnv("VAPID_SUBJECT"),
  };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    // Service-triggered only. The anon key ships in every browser bundle and
    // must not be enough to make someone else's phone buzz (rule 6, SB-052's
    // lesson about which caller this gate has to keep working for).
    requireServiceRole(req);

    const body = await req.json().catch(() => ({}));
    // Bypasses the send-window and the once-a-day mark, not the subscription
    // list or the due rule. This is how the owner proves delivery on a real
    // device without waiting for 08:00 local -- the same role
    // `forceEmbedBackfill` plays in `sweep`, and reachable only with the
    // service role.
    const force = body.force === true;

    const keys = vapidKeys();
    const admin = serviceClient();

    const { data: candidates, error } = await admin.rpc("push_due_candidates");
    if (error) throw new HttpError(500, "push_candidates_failed");

    const results: Array<Record<string, unknown>> = [];
    let notified = 0;
    let sent = 0;
    let disabled = 0;

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

      const { data: subscriptions } = await admin
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth_secret, failure_count")
        .eq("user_id", candidate.user_id)
        .is("disabled_at", null);

      if (!subscriptions?.length) continue;

      // The user's own language, not a server default: the service worker
      // needs to know which catalogue to render the counts with.
      const { data: profile } = await admin
        .from("profiles")
        .select("ui_locale")
        .eq("id", candidate.user_id)
        .maybeSingle();

      const payload: DuePayload = {
        kind: "due-tasks",
        overdue: candidate.overdue_count,
        dueToday: candidate.due_today_count,
        noteId: candidate.sample_note_id,
        language: profile?.ui_locale ?? "ar",
      };

      let deliveredToAnyDevice = false;

      for (const row of subscriptions as SubscriptionRow[]) {
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
          deliveredToAnyDevice = true;
          sent += 1;
          await admin
            .from("push_subscriptions")
            .update({ last_sent_at: new Date().toISOString(), failure_count: 0 })
            .eq("id", row.id);
        } else if (result.gone) {
          // 404/410 is the push service saying this subscription will never
          // work again. Disabled, not deleted: the row is the record of why
          // a device went quiet.
          disabled += 1;
          await admin
            .from("push_subscriptions")
            .update({ disabled_at: new Date().toISOString() })
            .eq("id", row.id);
        } else {
          const failures = (row.failure_count ?? 0) + 1;
          if (failures >= MAX_FAILURES) disabled += 1;
          await admin
            .from("push_subscriptions")
            .update({
              failure_count: failures,
              disabled_at: failures >= MAX_FAILURES ? new Date().toISOString() : null,
            })
            .eq("id", row.id);
        }

        results.push({
          user_id: candidate.user_id,
          endpoint_host: new URL(row.endpoint).host,
          status: result.status,
          gone: result.gone,
        });
      }

      if (deliveredToAnyDevice) {
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

    return json({
      candidates: candidates?.length ?? 0,
      notified,
      sent,
      disabled,
      results,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
