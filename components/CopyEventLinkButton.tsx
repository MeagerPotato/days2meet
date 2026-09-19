'use client';

import { useEffect, useRef, useState } from 'react';

import { shareOrigin } from '@/lib/site';

interface Props {
  slug: string;
}

/**
 * The shared `CopyLinkButton` copies `window.location.href`, which on the edit
 * page is the editor's own URL — a link nobody but the leader can open. This
 * one is told which link to hand out instead.
 */
export default function CopyEventLinkButton({ slug }: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    const url = `${shareOrigin()}/e/${slug}`;
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
    <button type="button" className="btn min-h-11 shrink-0" onClick={copy}>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy link'}</span>
    </button>
  );
}
