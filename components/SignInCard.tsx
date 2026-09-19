'use client';

import { useState } from 'react';

import { DEFAULT_EMAIL_PROMPT, normalizeName } from '@/lib/identity';

interface Props {
  onSignIn: (name: string, password: string, email: string) => Promise<string | null>;
  /** The event planner asked for email addresses when they made this event. */
  collectEmail: boolean;
  emailRequired: boolean;
  /** The planner's wording for the email box; null means the default. */
  emailPrompt: string | null;
  /**
   * The event planner's name, if they are on the roster. A required address is
   * asked of respondents only, so typing this name lifts the requirement here
   * just as the server lifts it for the planner's row.
   */
  plannerName: string | null;
  /** Names already on this event, for anyone who cannot remember theirs. */
  names: string[];
}

/** Compared the way the server's name lookup compares, so both agree on who this is. */
function sameName(a: string, b: string): boolean {
  return normalizeName(a).toLowerCase() === normalizeName(b).toLowerCase();
}

export default function SignInCard({
  onSignIn,
  collectEmail,
  emailRequired,
  emailPrompt,
  plannerName,
  names,
}: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showNames, setShowNames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asksForEmail = collectEmail && emailRequired;
  const isPlanner = plannerName !== null && name.trim() !== '' && sameName(name, plannerName);
  const emailNeeded = asksForEmail && !isPlanner;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Either identifier will do. The server resolves an address to whoever
    // already used it, so a forgotten name is not a dead end.
    if (!name.trim() && !email.trim()) {
      setError('Enter your name, or the email you answered with.');
      return;
    }
    if (emailNeeded && !email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    setError(await onSignIn(name.trim(), password, email.trim()));
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="panel space-y-4 p-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label className="label mb-0" htmlFor="participant-name">
            Your name
          </label>
          {names.length > 0 ? (
            <button
              type="button"
              // The link sits on the label's baseline; the negative margin lets
              // its tap area grow to finger size without pushing the field down.
              className="btn-link -my-3 shrink-0 py-3 sm:my-0 sm:py-0"
              aria-expanded={showNames}
              onClick={() => setShowNames((value) => !value)}
            >
              {showNames ? 'Hide names' : 'Forgot your name?'}
            </button>
          ) : null}
        </div>
        <input
          id="participant-name"
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={60}
        />

        {showNames ? (
          <div className="mt-2 rounded-lg border border-line bg-surface p-1.5">
            <p className="hint mb-1 px-1">Pick the name you answered with.</p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {names.map((known) => (
                <li key={known}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full cursor-pointer items-center rounded px-2 text-left text-[0.875rem] transition-colors hover:bg-ramp-1 sm:min-h-9"
                    onClick={() => {
                      setName(known);
                      setShowNames(false);
                    }}
                  >
                    {known}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {collectEmail ? (
        <div>
          {/*
            When the planner requires an address, their message is the label,
            so respondents read why it is asked right where they type it. The
            marker spells out the required state for sighted readers; the
            `required` attribute carries it to assistive tech, and the hint
            below names the field as an email for any message that does not.
          */}
          <label className="label [overflow-wrap:anywhere]" htmlFor="participant-email">
            {asksForEmail ? emailPrompt ?? DEFAULT_EMAIL_PROMPT : 'Email'}{' '}
            <span className="font-normal text-muted">
              {emailNeeded ? '(required)' : '(optional)'}
            </span>
          </label>
          <input
            id="participant-email"
            className="field"
            // type=email brings up the @ keyboard on phones and lets the browser
            // offer a saved address.
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required={emailNeeded}
            aria-describedby="participant-email-hint"
          />
          <p id="participant-email-hint" className="hint mt-1">
            {asksForEmail && isPlanner
              ? 'The event planner can leave this empty and sign in with their password.'
              : 'If you already answered, your email signs you back in on its own.'}
          </p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="participant-password">
          Password{' '}
          <span className="font-normal text-muted">{isPlanner ? '(required)' : '(optional)'}</span>
        </label>
        <input
          id="participant-password"
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
          maxLength={200}
        />
        <p className="hint mt-1">
          {isPlanner
            ? 'The password you set when you created this days2meet.'
            : 'Set a password if you want to be the only one who can edit your answer.'}
        </p>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.875rem] text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary min-h-11 w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
