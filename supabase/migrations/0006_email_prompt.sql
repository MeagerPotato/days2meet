-- When the event planner requires an email, they can say what it is for. The
-- text is shown to respondents above the email box. Null means "use the app's
-- default wording", so existing events need no backfill.
alter table public.w2m_events
  add column if not exists email_prompt text;

alter table public.w2m_events
  drop constraint if exists w2m_events_email_prompt_length;
alter table public.w2m_events
  add constraint w2m_events_email_prompt_length
  check (email_prompt is null or char_length(email_prompt) between 1 and 200);
