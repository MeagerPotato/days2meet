/**
 * What counts as a name, an address, and a password — for the two doors that let
 * someone into an event.
 *
 * Creation and sign-in both mint participant rows, and the leader created at
 * creation is the same kind of row a respondent signs in as. When the two doors
 * disagree about which addresses exist, one of them writes a row the other can
 * never match, and somebody is locked out of their own answer. So the rules live
 * here once.
 *
 * Pure on purpose: the create form is a client component, so nothing in this
 * file may reach lib/supabase.ts.
 */

export const MAX_NAME_LENGTH = 60;
export const MAX_EMAIL_LENGTH = 254; // the RFC ceiling for a whole address
export const MAX_PASSWORD_LENGTH = 200;
export const MIN_PASSWORD_LENGTH = 6;

/**
 * The leader's password, checked by the create form and again by the create
 * route. Unlike a respondent's, it is required: the leader's name is visible in
 * the roster and the "Forgot your name?" list, so a leader row with no password
 * lets anyone who reads it sign in as them and collect every respondent's
 * address.
 *
 * The value is never trimmed. Sign-in compares what was typed byte for byte, so
 * trimming here would silently store a different secret from the one someone
 * believes they chose.
 *
 * Returns the message to show, or null when the password is acceptable.
 */
export function leaderPasswordProblem(value: unknown): string | null {
  // An absent field is a missing password, not a type error — the person on the
  // form needs telling what to do, not what JSON is.
  if (value === undefined || value === null || value === '') {
    return 'Choose a password so only you can sign in as the event planner.';
  }
  if (typeof value !== 'string') return 'The password has to be text.';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Passwords are limited to ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Deliberately permissive: enough shape to catch a typo, never enough to reject
 * a real address. Full RFC 5322 would turn away valid mailboxes and still not
 * prove one exists.
 */
export function looksLikeEmail(value: string): boolean {
  if (/\s/.test(value)) return false;

  const parts = value.split('@');
  if (parts.length !== 2) return false;

  const [local, domain] = parts;
  if (!local || !domain.includes('.')) return false;

  return !domain.startsWith('.') && !domain.endsWith('.');
}

/**
 * What respondents read over the email box when the event planner requires an
 * address and has not written anything of their own. Stored as null, never as
 * this text, so rewording it later reaches every event that kept the default.
 */
export const DEFAULT_EMAIL_PROMPT = 'Your email for the contact list';
/** Matches the CHECK constraint on w2m_events.email_prompt. */
export const MAX_EMAIL_PROMPT_LENGTH = 200;

/**
 * The planner's message to respondents, as it should be stored. Whitespace runs
 * collapse to one space because the text is a single-line label. Empty, absent
 * or the untouched default all come back as null, meaning "use the default".
 */
export function normalizeEmailPrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text === DEFAULT_EMAIL_PROMPT) return null;
  return text;
}

/**
 * Checked by the create and edit routes. Returns the message to show, or null
 * when the value is acceptable (including absent). The length is measured after
 * normalising, which is what gets stored; UTF-16 length is never shorter than
 * the database's character count, so passing here means passing the CHECK.
 */
export function emailPromptProblem(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'The message to respondents has to be text.';
  const normalized = normalizeEmailPrompt(value);
  if (normalized && normalized.length > MAX_EMAIL_PROMPT_LENGTH) {
    return `The message to respondents is limited to ${MAX_EMAIL_PROMPT_LENGTH} characters.`;
  }
  return null;
}

/**
 * "Sam  H" typed on the create form and "Sam H" typed on the sign-in card are
 * one person, not two rows — the unique index on (event_id, lower(name)) only
 * agrees if both doors collapse runs of whitespace the same way first.
 */
export function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
