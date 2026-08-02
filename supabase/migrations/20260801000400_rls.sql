-- ============================================================================
-- 04. Row Level Security
-- ============================================================================
-- The Flutter client ships the Supabase anon key. That is safe ONLY because
-- these policies are correct -- RLS is not defense-in-depth here, it IS the
-- authorization layer. A table without a policy is a public table.
--
-- Join tables get policies too. Locking down `notes` while leaving
-- `note_tags` open still leaks the shape of every user's tag graph, and
-- `note_embeddings.content` leaks note text outright.
-- ============================================================================

alter table public.profiles         enable row level security;
alter table public.notes            enable row level security;
alter table public.note_enrichments enable row level security;
alter table public.tags             enable row level security;
alter table public.tag_labels       enable row level security;
alter table public.note_tags        enable row level security;
alter table public.note_embeddings  enable row level security;
alter table public.note_relations   enable row level security;
alter table public.weekly_digests   enable row level security;
alter table public.ai_jobs          enable row level security;

-- ---------------------------------------------------------------------------
-- Table-level privileges
-- ---------------------------------------------------------------------------
-- RLS and GRANTs are two independent gates, and it is easy to conflate them.
-- A policy says WHICH ROWS a role may touch; a grant says whether the role may
-- touch the table at all. Without the grant, a correct policy still yields
-- "permission denied for table notes".
--
-- These are written out explicitly rather than left to Supabase's default
-- privileges: the default depends on which role ran the migration, which
-- makes it environment-dependent and invisible in review. Spelled out here,
-- the client's exact capability surface is one readable list -- and the
-- read-only tables below are read-only by grant, not just by convention.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;

grant usage on schema public to authenticated, service_role;

-- Client-writable
grant select, update                 on public.profiles   to authenticated;
grant select, insert, update, delete on public.notes      to authenticated;
grant select, insert, delete         on public.tags       to authenticated;
grant select, insert, update, delete on public.tag_labels to authenticated;
grant select, insert, update, delete on public.note_tags  to authenticated;

-- Read-only to the client. These are pipeline outputs: letting the client
-- write them would let it forge AI results, fabricate embeddings, or rewrite
-- its own telemetry.
grant select on public.note_enrichments to authenticated;
grant select on public.note_embeddings  to authenticated;
grant select on public.note_relations   to authenticated;
grant select on public.weekly_digests   to authenticated;
grant select on public.ai_jobs          to authenticated;

-- The pipeline writes everything. service_role also carries BYPASSRLS, so
-- every service-role query must filter by user_id by hand -- the database
-- will not do it for you there.
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using ((select auth.uid()) = id);

create policy profiles_update on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No INSERT policy: rows are created by the on_auth_user_created trigger.
-- No DELETE policy: profile lifetime is tied to auth.users via cascade.

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
-- `(select auth.uid())` rather than a bare `auth.uid()` is deliberate: the
-- subselect form is evaluated once per query instead of once per row, which
-- is the difference between an index scan and a sequential scan on a large
-- timeline.
-- ---------------------------------------------------------------------------
create policy notes_select on public.notes
  for select to authenticated using ((select auth.uid()) = user_id);

create policy notes_insert on public.notes
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy notes_update on public.notes
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notes_delete on public.notes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- note_enrichments
-- ---------------------------------------------------------------------------
-- Read-only to the client. Enrichments are written by the pipeline under the
-- service role; letting the client write them would let it forge AI output.
-- ---------------------------------------------------------------------------
create policy note_enrichments_select on public.note_enrichments
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- tags / tag_labels / note_tags
-- ---------------------------------------------------------------------------
create policy tags_select on public.tags
  for select to authenticated using ((select auth.uid()) = user_id);

create policy tags_insert on public.tags
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy tags_delete on public.tags
  for delete to authenticated using ((select auth.uid()) = user_id);

-- tag_labels has no user_id of its own; ownership is inherited through tags.
create policy tag_labels_select on public.tag_labels
  for select to authenticated
  using (exists (
    select 1 from public.tags t
    where t.id = tag_labels.tag_id and t.user_id = (select auth.uid())
  ));

create policy tag_labels_write on public.tag_labels
  for all to authenticated
  using (exists (
    select 1 from public.tags t
    where t.id = tag_labels.tag_id and t.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.tags t
    where t.id = tag_labels.tag_id and t.user_id = (select auth.uid())
  ));

create policy note_tags_select on public.note_tags
  for select to authenticated using ((select auth.uid()) = user_id);

create policy note_tags_write on public.note_tags
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- note_embeddings
-- ---------------------------------------------------------------------------
-- SELECT only, and only so the client can debug/inspect. `content` mirrors
-- note text, so this policy is as sensitive as notes_select.
-- ---------------------------------------------------------------------------
create policy note_embeddings_select on public.note_embeddings
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- note_relations / weekly_digests / ai_jobs
-- ---------------------------------------------------------------------------
create policy note_relations_select on public.note_relations
  for select to authenticated using ((select auth.uid()) = user_id);

create policy weekly_digests_select on public.weekly_digests
  for select to authenticated using ((select auth.uid()) = user_id);

create policy ai_jobs_select on public.ai_jobs
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Private audio bucket
-- ---------------------------------------------------------------------------
-- Objects are stored at `<user_id>/<note_id>.<ext>`, so the first path
-- segment is the ownership check. The bucket is private; the client only ever
-- receives short-lived signed URLs.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'audio', 'audio', false, 26214400,  -- 25 MB
  array['audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/ogg', 'audio/opus', 'audio/webm', 'audio/wav']
)
on conflict (id) do nothing;

create policy audio_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy audio_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy audio_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
