-- `priority` was NOT NULL, so every note was forced to carry an urgency
-- ranking whether or not the user expressed one. The model had no way to
-- decline: it had to pick a value, so it inferred urgency from subject matter
-- instead -- a note reading "مشكلة في صفحة التسجيل" (a test recording) came
-- back `high` purely because it mentioned a problem. A flag the user never
-- asked for is a claim about their life they then have to correct, which is
-- the opposite of what this app is for.
--
-- Null now means "the note said nothing about urgency", which is the common
-- case. The enum keeps its four levels for notes that genuinely state one.
alter table public.note_enrichments
  alter column priority drop not null;

comment on column public.note_enrichments.priority is
  'Null when the note carries no urgency signal of its own -- the default and '
  'most common case. Set only from an explicit signal in the note text.';
