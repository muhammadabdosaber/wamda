-- ============================================================================
-- 08. Sweep worker schedule
-- ============================================================================
-- `sweep` (supabase/functions/sweep) is written and verified but nothing
-- calls it. This wires a pg_cron job that POSTs to it every 5 minutes, the
-- same way `digest` is meant to be triggered on Saturdays -- neither has ever
-- had a schedule attached before this file.
--
-- WHY THE JOB IS CONDITIONAL, NOT UNCONDITIONAL:
--
-- The call needs two things a migration file must never contain: the
-- project's Edge Functions URL (differs per environment -- local vs. this
-- project vs. any future project) and the service role key (a secret;
-- migrations are committed to git and readable by anyone with repo access).
-- Both are read from Supabase Vault at CALL TIME instead of being literals
-- here, via two secrets set ONCE per environment, outside of any migration:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/sweep', 'sweep_function_url');
--   select vault.create_secret(
--     '<service role key, from Project Settings > API>', 'sweep_service_role_key');
--
-- Until both exist, this migration raises a NOTICE and leaves the job
-- unscheduled rather than failing the deploy -- the same "written, not yet
-- turned on" state the codebase already tolerates for the vendor keys and
-- for `digest`. Re-running this migration (or just re-running the `do`
-- block below by hand) picks the job up as soon as the secrets exist.
--
-- `cron.schedule` with a name that already exists REPLACES that job rather
-- than duplicating it, so this file is safe to re-run.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

-- pg_cron jobs are owned by the role that calls cron.schedule; migrations
-- run as `postgres`, which is what the job will authenticate to Postgres as
-- when it later fires. Nothing here runs as an end user.
grant usage on schema cron to postgres;

do $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'sweep_function_url';

  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'sweep_service_role_key';

  if v_url is null or v_key is null then
    raise notice
      'sweep-worker cron job NOT scheduled: set the "sweep_function_url" and '
      '"sweep_service_role_key" Vault secrets, then re-run this migration. '
      'See docs/09-status-handoff.md.';
    return;
  end if;

  perform cron.schedule(
    'sweep-worker',
    '*/5 * * * *',
    $sql$
    select net.http_post(
      url     := (select decrypted_secret from vault.decrypted_secrets where name = 'sweep_function_url'),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || (
                     select decrypted_secret from vault.decrypted_secrets
                     where name = 'sweep_service_role_key'
                   )
                 ),
      body    := '{}'::jsonb
    );
    $sql$
  );
end
$$;
