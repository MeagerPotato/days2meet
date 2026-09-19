'use client';

import { DEFAULT_EMAIL_PROMPT, MAX_EMAIL_PROMPT_LENGTH } from '@/lib/identity';

interface Props {
  required: boolean;
  onRequiredChange: (required: boolean) => void;
  /** The planner's message, as typed. Normalised by the caller before it is sent. */
  prompt: string;
  onPromptChange: (prompt: string) => void;
}

/**
 * The "Require an email address" box and, once it is ticked, the message the
 * event planner gives respondents for it. Shared by the create form and the
 * edit page so the two never drift apart.
 *
 * The message field is unmounted rather than hidden while the box is off, but
 * its text lives in the parent, so unticking and ticking again brings back what
 * was typed. Cleared, it falls back to the default wording, which the
 * placeholder shows.
 */
export default function EmailRequirementField({
  required,
  onRequiredChange,
  prompt,
  onPromptChange,
}: Props) {
  return (
    <fieldset>
      <legend className="label">Email addresses</legend>
      <div className="rounded-lg border border-line bg-surface px-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem]">
          <input
            type="checkbox"
            className="size-4 shrink-0 cursor-pointer accent-ink"
            checked={required}
            onChange={(field) => onRequiredChange(field.target.checked)}
          />
          Require an email address
        </label>
        {required ? (
          <div className="border-t border-line pb-3 pt-2.5">
            <label className="hint mb-1 block" htmlFor="email-prompt">
              Message to respondents
            </label>
            <input
              id="email-prompt"
              className="field min-h-11"
              value={prompt}
              onChange={(field) => onPromptChange(field.target.value)}
              placeholder={DEFAULT_EMAIL_PROMPT}
              maxLength={MAX_EMAIL_PROMPT_LENGTH}
              autoComplete="off"
            />
          </div>
        ) : null}
      </div>
      <p className="hint mt-1">
        {required
          ? 'Respondents see your message as the label on the email box, and cannot sign in without an address. You never need one yourself.'
          : 'Respondents always get an email box on the sign-in card. Leave this off and they can skip it.'}
      </p>
    </fieldset>
  );
}
