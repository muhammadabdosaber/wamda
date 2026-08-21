-- ============================================================================
-- 16. Due-task notification schedule (SB-051)
-- ============================================================================
-- Same mechanism as `20260807000300_digest_schedule.sql`, third instance of
-- it: the function URL and the service role key are read from Vault at call
-- time, never written into this file. A migration is a committed file, and a
-- key in one is a key in the repository forever.
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/push', 'push_function_url');
--   select vault.create_secret(
--     '<service role key, from Project Settings > API>', 'push_service_role_key');
--
-- Until both exist this raises a NOTICE and leaves the job unscheduled rather
-- than failing the deploy. `cron.schedule` replaces a job of the same name,
-- so the file is safe to re-run.
--
-- HOURLY, not once a day, because "morning" is per user: the function sends
-- to whoever is currently at 08:00 in their own timezone
-- (`push_due_candidates()` returns each user's local hour). One user today,
-- but a fixed UTC time would be wrong the moment there are two in different
-- places -- and wrong for this user the moment he travels.
--
-- At :05 rather than :00 so it does not queue behind `digest-collect`
-- (0 */6 * * *) and the retention purge (0 3 * * *) on the ticks where they
-- coincide.
--
-- NOTE (2026-08-22): SB-052 is open -- the hosted `sweep`/`digest` jobs are
-- being rejected with 403 because their stored Vault secret no longer matches
-- the project's real service role key. This job reads its OWN secret, so
-- setting it correctly here is enough for push to work; but if it returns 403
-- too, that is the same fault, not a new one. Check `net._http_response`, not
-- `cron.job_run_details`, which reports success as soon as pg_net queues the
-- call.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;
grant usage on schema cron to postgres;

do $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'push_function_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'push_service_role_key';

  if v_url is null or v_key is null then
    raise notice
      'push schedule NOT scheduled: set the "push_function_url" and '
      '"push_service_role_key" Vault secrets, then re-run this migration. '
      'See docs/15-runbook.md.';
    return;
  end if;

  -- The secret is looked up inside the job body, not interpolated into it:
  -- `select command from cron.job` is readable by anyone with database
  -- access, and rotating the key must not require re-running a migration.
  perform cron.schedule(
    'push-due-tasks',
    '5 * * * *',
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
      body    := '{}'::jsonb
    );
    $sql$
  );
end
$$;
