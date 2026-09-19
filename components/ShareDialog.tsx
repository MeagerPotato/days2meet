'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useScrollLock } from './useScrollLock';

const FOCUSABLE =
  'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface Props {
  /** Absolute and ready to paste, not a path. */
  url: string;
  eventTitle: string;
  /** Dismissing and continuing are the same act — the event already exists. */
  onContinue: () => void;
}

/**
 * The one beat between creating an event and living in it, where the link is
 * the only thing that matters. Every exit leads to the event: there is nothing
 * here to cancel, and a stuck organiser would be stranded on a form for an
 * event that has already been made.
 */
export default function ShareDialog({ url, eventTitle, onContinue }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useScrollLock(!leaving);

  useEffect(() => {
    copyRef.current?.focus();
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Dropping the lock is what puts this page's scroll offset back, and that has
  // to happen before the router scrolls the next page to the top — the other
  // order lands the event mid-page.
  const leave = useCallback(() => {
    setLeaving(true);
    onContinue();
  }, [onContinue]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        leave();
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (stops.length === 0) return;

      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;

      if (!root.contains(active)) {
        // Clicking dead space inside the dialog parks focus on the body, where
        // neither edge matches and the next Tab would land on the page behind.
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [leave]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard API needs a secure context; fall back to a scratch textarea.
      const scratch = document.createElement('textarea');
      scratch.value = url;
      scratch.setAttribute('readonly', '');
      scratch.style.position = 'fixed';
      scratch.style.opacity = '0';
      document.body.appendChild(scratch);
      scratch.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(scratch);
      }
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      // A bottom sheet on a phone, with the padding clearing the home
      // indicator. The panel scrolls inside itself if it outgrows a short
      // landscape screen, since the page behind it is locked.
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      // Pointerdown rather than click: a selection that starts on the link and
      // ends past the edge still fires a click here, and would navigate away
      // mid-drag.
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) leave();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="panel max-h-full w-full max-w-md overflow-y-auto overscroll-contain p-4 shadow-lg sm:p-5"
      >
        <h2 id="share-dialog-title" className="section-title">
          Event created
        </h2>
        <p className="hint mt-1">
          <span className="font-semibold text-ink">{eventTitle}</span> is live. Anyone with this
          link can fill in when they are free.
        </p>

        <label className="label mt-4" htmlFor="share-url">
          Share link
        </label>
        <input
          id="share-url"
          className="field font-mono text-[0.8125rem]"
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            ref={copyRef}
            type="button"
            className="btn btn-primary min-h-11 flex-1"
            onClick={copy}
          >
            <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
          </button>
          <button type="button" className="btn min-h-11 flex-1" onClick={leave}>
            Go to the event
          </button>
        </div>
      </div>
    </div>
  );
}
