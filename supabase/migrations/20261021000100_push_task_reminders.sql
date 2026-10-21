-- ============================================================================
-- 18. A reminder at a task's own due time
-- ============================================================================
-- SB-051 sends one summary a day at 08:00 local. The owner asked for the
-- other half: a task the note says is due at 10:00 should buzz at 10:00, not
-- only in a summary two hours before it -- which, with ADHD, is long enough
-- to be forgotten by 10:00.
--
-- Same sender (`functions/push`, body {"mode":"due-now"}), same Vault
-- secrets, its own `pg_cron` job, every minute: a reminder five minutes late
-- is a reminder for a meeting already started.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_task_reminders -- ONE ROW PER (note, due time) ever reminded
-- ---------------------------------------------------------------------------
-- The "once" record, like push_deliveries is for the summary. Keyed on the
-- due time as well as the note: if a note is re-enriched and its due time
-- moves, the new time is a new reminder.
--
-- Written BEFORE the send, as a claim: a run that takes longer than a minute
-- overlaps the next one, and the claim is what stops both from sending. A
-- send that reaches no device deletes its claim so the next minute retries.
-- ---------------------------------------------------------------------------
create table public.push_task_reminders (
  note_id  uuid not null references public.notes (id) on delete cascade,
  due_at   timestamptz not null,
  user_id  uuid not null references auth.users (id) on delete cascade,
  sent_at  timestamptz not null default now(),

  primary key (note_id, due_at)
);

comment on table public.push_task_reminders is
  'One row per task due time a reminder was sent for (2026-10-21). Claimed before sending so overlapping runs cannot double-send.';

-- An ops table, written by the sender only. RLS with no policy is deny-all
-- for every client role, and the explicit revoke is there because hosted
-- Supabase's default privileges grant anon/authenticated everything on a new
-- public table (found 2026-10-21 on push_subscriptions).
alter table public.push_task_reminders enable row level security;
revoke all on public.push_task_reminders from anon, authenticated;

-- What the sender itself needs, stated rather than inherited. The SB-051
-- migration relied on hosted Supabase's default privileges for service_role;
-- a local stack does not grant them, and there `functions/push` silently
-- found no subscriptions at all (2026-10-21: `permission denied`, swallowed
-- because the query result was read without its error).
grant select, insert, delete on public.push_task_reminders to service_role;
grant select, update         on public.push_subscriptions  to service_role;
grant select, insert         on public.push_deliveries     to service_role;

-- ---------------------------------------------------------------------------
-- push_task_due_candidates() -- tasks whose own time has just come
-- ---------------------------------------------------------------------------
-- Same task rule as push_due_candidates() and web/src/core/due.ts: newest
-- enrichment, category 'task', not completed, not archived, a subscribed user.
--
-- The window is the last 10 minutes, not "everything overdue": a deploy, an
-- outage or a missed tick must not end in a burst of stale reminders. A task
-- past the window is covered by the 08:00 summary instead.
--
-- 00:00 and 23:59 local are skipped. They are what the model writes when a
-- note gives a date and no time ("the deadline is today" -> 23:59); a
-- reminder at midnight for those is noise, and the morning summary already
-- names them.
-- ---------------------------------------------------------------------------
create or replace function public.push_task_due_candidates()
returns table (
  note_id       uuid,
  user_id       uuid,
  title         text,
  action_due_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with live_users as (
    select distinct s.user_id
    from public.push_subscriptions s
    where s.disabled_at is null
  ),
  latest_enrichment as (
    select distinct on (e.note_id)
      e.note_id, e.category, e.action_due_at, e.title
    from public.note_enrichments e
    order by e.note_id, e.created_at desc
  )
  select n.id, n.user_id, le.title, le.action_due_at
  from public.notes n
  join live_users lu        on lu.user_id = n.user_id
  join public.profiles p    on p.id       = n.user_id
  join latest_enrichment le on le.note_id = n.id
  where n.archived_at is null
    and n.completed_at is null
    and le.category = 'task'
    and le.action_due_at >  now() - interval '10 minutes'
    and le.action_due_at <= now()
    and to_char(le.action_due_at at time zone p.timezone, 'HH24:MI') not in ('00:00', '23:59')
    and not exists (
      select 1 from public.push_task_reminders r
      where r.note_id = n.id and r.due_at = le.action_due_at
    )
  order by le.action_due_at;
$$;

revoke all on function public.push_task_due_candidates() from public;
revoke all on function public.push_task_due_candidates() from anon, authenticated;
grant execute on function public.push_task_due_candidates() to service_role;

comment on function public.push_task_due_candidates() is
  'Open tasks whose own due time fell in the last 10 minutes and were not yet reminded; skips date-only 00:00/23:59 (2026-10-21). Service-role only.';

-- ---------------------------------------------------------------------------
-- Schedule: every minute. Same Vault secrets as push-due-tasks; a NOTICE and
-- no job when they are absent, never a failed deploy.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

do $$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_function_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'push_service_role_key') then
    raise notice
      'push-task-due NOT scheduled: set the "push_function_url" and '
      '"push_service_role_key" Vault secrets, then re-run this block. '
      'See docs/15-runbook.md.';
    return;
  end if;

  -- 10 s rather than pg_net's 5 s default: the first call after a deploy
  -- boots the function, measured at ~2.5 s before any work.
  perform cron.schedule(
    'push-task-due',
    '* * * * *',
    $sql$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'push_function_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || (
                     select decrypted_secret from vault.decrypted_secrets
                     where name = 'push_service_role_key'
                   )
                 ),
      body    := '{"mode":"due-now"}'::jsonb,
      timeout_milliseconds := 10000
    );
    $sql$
  );
end
$$;
