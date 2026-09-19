'use client';

import { useEffect, useRef } from 'react';

import { useScrollLock } from './useScrollLock';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The modal for a decision that cannot be undone.
 *
 * Cancel takes the initial focus, so the reflex of hitting Enter on a dialog
 * backs out instead of destroying other people's marks.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useScrollLock(true);

  useEffect(() => {
    // Remember what opened the dialog and hand focus back to it on close, so a
    // keyboard user who cancels lands on the Save button they came from rather
    // than at the top of the document.
    const trigger = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      // Without this, Tab walks out of the dialog and onto the form behind it,
      // which is still fully operable while the question is unanswered.
      const stops = panelRef.current?.querySelectorAll<HTMLElement>('button');
      if (!stops || stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      // A bottom sheet on a phone, with the padding clearing the home
      // indicator. The panel scrolls inside itself if it outgrows a short
      // landscape screen, since the page behind it is locked.
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="panel max-h-full w-full max-w-sm overflow-y-auto overscroll-contain p-4 shadow-lg"
      >
        <h2 id="confirm-title" className="section-title">
          {title}
        </h2>
        <p id="confirm-body" className="hint mt-1.5">
          {body}
        </p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            className="btn min-h-11 sm:min-w-24"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary min-h-11 sm:min-w-24"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
