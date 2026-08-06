-- ============================================================================
-- 14. Weekly digest schedule (SB-017)
-- ============================================================================
-- Same gap, same mechanism as `20260801000800_sweep_schedule.sql`: `digest`
-- (supabase/functions/digest) is written and never had a schedule attached.
-- Two jobs, since enqueue and collect are genuinely different cadences --
-- the Batch API can take up to 24h to finish, so collect has to keep polling
-- long after the one weekly enqueue call:
--
--   digest-enqueue  Saturdays 03:00 UTC  -- submits the week's batch once
--   digest-collect  every 6 hours        -- writes back whatever finished;
--                                           a no-op cron.job_run_details
--                                           entry on every tick with nothing
--                                           to collect, by the function's
--                                           own design (loops over
--                                           status='submitted' rows)
--
-- Same reasoning as the sweep schedule for why this is conditional: the
-- function URL and service role key must never be literals in a migration.
-- Until both Vault secrets exist, this raises a NOTICE and leaves both jobs
-- unscheduled instead of failing the deploy.
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/digest', 'digest_function_url');
--   select vault.create_secret(
--     '<service role key, from Project Settings > API>', 'digest_service_role_key');
--
-- cron.schedule replaces a job of the same name rather than duplicating it,
-- so this file is safe to re-run.
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
  from vault.decrypted_secrets where name = 'digest_function_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'digest_service_role_key';

  if v_url is null or v_key is null then
    raise notice
      'digest schedule NOT scheduled: set the "digest_function_url" and '
      '"digest_service_role_key" Vault secrets, then re-run this migration. '
      'See docs/09-status-handoff.md.';
    return;
  end if;

  -- Deliberately NOT `format(..., v_url, v_key)`: baking the secret's actual
  -- value into the stored job text would put it in cleartext in `cron.job`,
  -- readable by anyone who can `select command from cron.job`, and would
  -- need this migration re-run on every key rotation. Both job bodies below
  -- instead carry a live lookup subquery -- identical in shape to
  -- `sweep-worker`'s -- so the secret is never stored anywhere but Vault,
  -- and rotating it needs nothing beyond `vault.update_secret`.
  perform cron.schedule(
    'digest-enqueue',
    '0 3 * * 6',
    $sql$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'digest_function_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || (
                     select decrypted_secret from vault.decrypted_secrets
                     where name = 'digest_service_role_key'
                   )
                 ),
      body    := '{"action":"enqueue"}'::jsonb
    );
    $sql$
  );

  perform cron.schedule(
    'digest-collect',
    '0 */6 * * *',
    $sql$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'digest_function_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || (
                     select decrypted_secret from vault.decrypted_secrets
                     where name = 'digest_service_role_key'
                   )
                 ),
      body    := '{"action":"collect"}'::jsonb
    );
    $sql$
  );
end
$$;
