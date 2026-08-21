-- ============================================================================
-- 15. Web push subscriptions and delivery marks (SB-051)
-- ============================================================================
-- SB-050 put a due count on the Tasks tab. It only works while the app is
-- open, which is exactly when the user does not need reminding. This is the
-- storage half of the other reach: a subscription per device, and a record of
-- what was already sent so a task cannot buzz the same phone all day.
--
-- Nothing here is a display label (rule 2): the notification's Arabic text is
-- built by the client's own catalogue from counts, never stored.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_subscriptions -- ONE ROW PER (user, device endpoint)
-- ---------------------------------------------------------------------------
-- `endpoint` is the URL the browser's own push service handed out; `p256dh`
-- and `auth_secret` are that subscription's public key and shared secret,
-- both required to encrypt a payload it will accept (RFC 8291). They are the
-- device's, not ours -- there is no key material of the project's own here.
--
-- The column is `auth_secret`, not `auth`: `auth` is the name of Supabase's
-- own schema, and a bare `auth` column reads like a mistake in every query it
-- appears in.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,

  endpoint      text not null,
  p256dh        text not null,
  auth_secret   text not null,

  -- Which device this is, for the day the user asks why their phone is quiet.
  user_agent    text,

  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,

  -- A push service answers 404/410 when a subscription is gone for good
  -- (app uninstalled, permission revoked). That is a fact about the device,
  -- not an error to retry, so the row is disabled rather than deleted: the
  -- user may re-subscribe from the same device, and a deleted row loses the
  -- history of why it stopped.
  failure_count smallint not null default 0,
  disabled_at   timestamptz,

  -- Re-subscribing is normal -- browsers rotate endpoints. Without this the
  -- table quietly accumulates one dead row per app launch.
  constraint push_subscriptions_endpoint_uq unique (user_id, endpoint)
);

create index push_subscriptions_live_idx
  on public.push_subscriptions (user_id)
  where disabled_at is null;

comment on table public.push_subscriptions is
  'One web push subscription per user device (SB-051). p256dh/auth_secret belong to the device, not to this project.';

-- ---------------------------------------------------------------------------
-- push_deliveries -- ONE ROW PER (user, local day)
-- ---------------------------------------------------------------------------
-- The whole point of a summary notification is that it arrives once. This is
-- the record that makes "once" true across restarts, retries and a schedule
-- that ticks hourly -- a queryable fact rather than a heuristic on
-- last_sent_at, which cannot distinguish "sent today" from "sent 20 minutes
-- ago in a run that then failed".
--
-- `notified_on` is the user's OWN local date, so someone in Asia/Dubai does
-- not get a second notification when UTC rolls over mid-evening.
-- ---------------------------------------------------------------------------
create table public.push_deliveries (
  user_id         uuid not null references auth.users (id) on delete cascade,
  notified_on     date not null,
  overdue_count   integer not null,
  due_today_count integer not null,
  sent_at         timestamptz not null default now(),

  primary key (user_id, notified_on)
);

comment on table public.push_deliveries is
  'One row per user per local day a due-task notification was sent (SB-051). Exists so an hourly schedule cannot notify twice.';

-- ---------------------------------------------------------------------------
-- RLS + grants -- both, in the same change (CLAUDE.md)
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries    enable row level security;

-- The client manages its own subscriptions: it creates one when the user
-- grants permission, refreshes it when the browser rotates the endpoint, and
-- deletes it when the user turns notifications off. Turning them off has to
-- actually remove the row -- otherwise the only way to stop the buzzing is
-- uninstalling the app.
grant select, insert, delete on public.push_subscriptions to authenticated;

-- Column-scoped update, following SB-023's precedent on `notes`. A client
-- re-subscribing rewrites its own keys; it has no business clearing
-- `disabled_at` or resetting `failure_count`, which are the sender's record
-- of what the push service said.
grant update (endpoint, p256dh, auth_secret, user_agent)
  on public.push_subscriptions to authenticated;

-- push_deliveries is written by the sender and read by nobody else. No grant
-- to `authenticated` at all: RLS with no grant is denial twice over, which is
-- what an ops table should be.

create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- No policy on push_deliveries: `authenticated` has no grant on it and
-- service_role bypasses RLS. Enabling RLS without a policy is the deny-all
-- default, stated on purpose rather than left implicit.

-- ---------------------------------------------------------------------------
-- push_due_candidates() -- who should be told what, right now
-- ---------------------------------------------------------------------------
-- The sender must not re-derive "what counts as a due task" in TypeScript.
-- The client already has one definition (`web/src/core/due.ts`: category
-- 'task', not completed, due at or before the end of today, overdue folded
-- in) and a second one that drifts is a bug that shows up as a notification
-- for a task the app does not list.
--
-- The one thing this adds is the timezone. The badge uses the browser's
-- clock; a server has none, so "today" is computed per user from
-- `profiles.timezone` -- which is why a note due 23:30 Dubai time is not
-- counted as tomorrow's problem by a UTC job.
--
-- SECURITY DEFINER because it reads every user's rows by design; it is not
-- reachable by `authenticated` (grant below), and it takes no arguments that
-- could be used to scope it at anyone else.
-- ---------------------------------------------------------------------------
create or replace function public.push_due_candidates()
returns table (
  user_id         uuid,
  timezone        text,
  local_hour      integer,
  local_date      date,
  overdue_count   integer,
  due_today_count integer,
  sample_note_id  uuid,
  sample_title    text
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
  -- One enrichment per note (the newest), mirroring the client's
  -- `note_enrichments[0]`.
  latest_enrichment as (
    select distinct on (e.note_id)
      e.note_id, e.category, e.action_due_at, e.title
    from public.note_enrichments e
    order by e.note_id, e.created_at desc
  ),
  due_tasks as (
    select
      n.user_id,
      n.id as note_id,
      p.timezone,
      (now() at time zone p.timezone)::date            as local_date,
      (le.action_due_at at time zone p.timezone)::date as due_local_date,
      le.action_due_at,
      le.title
    from public.notes n
    join live_users lu           on lu.user_id = n.user_id
    join public.profiles p       on p.id       = n.user_id
    join latest_enrichment le    on le.note_id = n.id
    where n.archived_at is null
      and n.completed_at is null
      and le.category = 'task'
      and le.action_due_at is not null
  )
  select
    d.user_id,
    min(d.timezone)                                                    as timezone,
    min(extract(hour from now() at time zone d.timezone))::integer     as local_hour,
    min(d.local_date)                                                  as local_date,
    count(*) filter (where d.action_due_at < now())::integer           as overdue_count,
    count(*) filter (where d.action_due_at >= now()
                       and d.due_local_date <= d.local_date)::integer  as due_today_count,
    (array_agg(d.note_id order by d.action_due_at))[1]                 as sample_note_id,
    (array_agg(d.title   order by d.action_due_at))[1]                 as sample_title
  from due_tasks d
  where d.due_local_date <= d.local_date
  group by d.user_id
  having count(*) > 0;
$$;

revoke all on function public.push_due_candidates() from public;
revoke all on function public.push_due_candidates() from anon, authenticated;
grant execute on function public.push_due_candidates() to service_role;

comment on function public.push_due_candidates() is
  'Per-user counts of open tasks overdue or due today, in the user''s own timezone (SB-051). Service-role only; mirrors web/src/core/due.ts.';
