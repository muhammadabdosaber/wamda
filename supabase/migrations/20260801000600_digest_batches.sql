-- ============================================================================
-- 06. Weekly digest batching
-- ============================================================================
-- Weekly digests are generated with the Message Batches API: 50% cheaper, and
-- nobody is waiting on them. That makes the job asynchronous in a way a
-- request/response Edge Function is not -- submission and collection are
-- separate invocations, minutes to an hour apart, so the batch handle has to
-- outlive the process that created it.
-- ============================================================================

create type public.batch_status as enum ('submitted', 'collected', 'failed');

create table public.digest_batches (
  id             uuid primary key default gen_random_uuid(),
  provider_batch_id text not null unique,
  language       text not null,
  period_start   date not null,
  period_end     date not null,
  status         public.batch_status not null default 'submitted',
  request_count  integer not null default 0,
  collected_count integer not null default 0,
  created_at     timestamptz not null default now(),
  collected_at   timestamptz
);

-- Deliberately no RLS policy for `authenticated`: this table is operational,
-- spans all users, and the client has no reason to see it. RLS is still
-- enabled so an accidental future grant cannot expose it wholesale.
alter table public.digest_batches enable row level security;
grant all on public.digest_batches to service_role;

create index digest_batches_open_idx
  on public.digest_batches (status, created_at)
  where status = 'submitted';
