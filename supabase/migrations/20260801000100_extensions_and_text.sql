-- ============================================================================
-- 01. Extensions + language-aware text normalization
-- ============================================================================
-- Everything here is language-parameterized from day one. Phase 2 (English)
-- registers a new branch in the dispatch functions below; no table, index, or
-- data migration is required.
--
-- NOTE ON LITERALS: this file contains NO inline Arabic characters. Every
-- Arabic code point is built with chr(). That is deliberate, not fussiness:
-- an Arabic range inside a regex character class -- [X-Y] -- gets visually
-- reordered by editors, diff viewers, and terminals that apply the Unicode
-- bidirectional algorithm. The reordered text still parses, so a corrupted
-- range fails silently at runtime instead of erroring at deploy time.
-- ASCII source removes the failure mode.
-- ============================================================================

create extension if not exists "vector"    with schema extensions;
create extension if not exists "unaccent"  with schema extensions;
create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "pg_trgm"   with schema extensions;

-- Fail loudly at deploy time if the Arabic snowball config is unavailable,
-- rather than silently degrading every Arabic search to `simple`.
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'arabic') then
    raise exception
      'Text search configuration "arabic" is missing. Arabic lexical search requires PostgreSQL 12+ with the snowball Arabic stemmer.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Arabic character sets (built from code points, never typed inline)
-- ---------------------------------------------------------------------------
-- Marks to delete outright:
--   U+0610..U+061A (1552..1562)  Quranic annotation signs
--   U+0640         (1600)        tatweel / kashida (cosmetic elongation)
--   U+064B..U+065F (1611..1631)  harakat (short vowels, shadda, sukun)
--   U+0670         (1648)        superscript alef
--   U+06D6..U+06ED (1750..1773)  Quranic recitation marks
-- ---------------------------------------------------------------------------
create or replace function public.ar_marks()
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select string_agg(chr(c), '' order by c)
  from (
    select generate_series(1552, 1562) as c
    union all select 1600
    union all select generate_series(1611, 1631)
    union all select 1648
    union all select generate_series(1750, 1773)
  ) s
$$;

-- Letter folding, one-to-one and positionally aligned:
--   U+0623 alef-hamza-above   1571 -> 1575 alef
--   U+0625 alef-hamza-below   1573 -> 1575 alef
--   U+0622 alef-madda         1570 -> 1575 alef
--   U+0671 alef-wasla         1649 -> 1575 alef
--   U+0629 taa marbuta        1577 -> 1607 haa
--   U+0649 alef maqsura       1609 -> 1610 yaa
--   U+0624 waw-hamza          1572 -> 1608 waw
--   U+0626 yaa-hamza          1574 -> 1610 yaa
create or replace function public.ar_fold_from()
returns text language sql immutable parallel safe set search_path = '' as $$
  select chr(1571) || chr(1573) || chr(1570) || chr(1649)
      || chr(1577) || chr(1609) || chr(1572) || chr(1574)
$$;

create or replace function public.ar_fold_to()
returns text language sql immutable parallel safe set search_path = '' as $$
  select chr(1575) || chr(1575) || chr(1575) || chr(1575)
      || chr(1607) || chr(1610) || chr(1608) || chr(1610)
$$;

-- ---------------------------------------------------------------------------
-- Arabic normalization
-- ---------------------------------------------------------------------------
-- Two users typing the same Arabic word routinely produce different byte
-- sequences. Fold before indexing AND before querying, or lexical search
-- misses obvious matches.
--
-- IMMUTABLE is required -- a generated column depends on this function.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_ar(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      translate(
        translate(coalesce(t, ''), public.ar_marks(), ''),
        public.ar_fold_from(),
        public.ar_fold_to()
      ),
      '\s+', ' ', 'g'
    )
  )
$$;

comment on function public.normalize_ar(text) is
  'Folds Arabic orthographic variants (alef/hamza/taa-marbuta forms, tatweel, harakat) so lexical search matches regardless of how the user typed it.';

-- ---------------------------------------------------------------------------
-- Latin normalization (phase 2, wired now so nothing changes later)
-- ---------------------------------------------------------------------------
create or replace function public.normalize_latin(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Language dispatch
-- ---------------------------------------------------------------------------
-- These two functions are the ONLY places in the database that know about
-- specific languages. Adding 'en' in phase 2 means adding a `when` branch;
-- the generated columns, indexes, and search RPC pick it up automatically.
-- ---------------------------------------------------------------------------
create or replace function public.normalize_for(t text, lang text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case split_part(coalesce(lang, 'ar'), '-', 1)
    when 'ar' then public.normalize_ar(t)
    else public.normalize_latin(t)
  end
$$;

create or replace function public.ts_config_for(lang text)
returns regconfig
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case split_part(coalesce(lang, 'ar'), '-', 1)
    when 'ar' then 'pg_catalog.arabic'::regconfig
    when 'en' then 'pg_catalog.english'::regconfig
    else 'pg_catalog.simple'::regconfig
  end
$$;

-- ---------------------------------------------------------------------------
-- Tag slugs are language-neutral identity, not display text.
-- Two spellings of the same Arabic tag must collapse to one slug, otherwise
-- the tag graph fragments into near-duplicates the user has to clean up.
-- The keep-set is [A-Za-z0-9_] plus the Arabic block U+0600..U+06FF, built
-- by concatenation so no Arabic literal appears in the pattern.
-- ---------------------------------------------------------------------------
create or replace function public.slugify(t text, lang text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        public.normalize_for(t, lang),
        '[^\w' || chr(1536) || '-' || chr(1791) || ']+', '-', 'g'
      ),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  )
$$;
