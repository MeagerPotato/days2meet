import type { Metadata } from 'next';

import CreateEventForm from '@/components/CreateEventForm';
import StarBanner from '@/components/StarBanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The home page is the one indexable page, and both hosts serve it; this names
// the canonical one. Event pages are noindex (next.config.ts), so they get none.
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function CreatePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Centres rather than baselines: the banner is a filled box, and a box
          sat on the title's baseline hangs below it. Below sm: the title claims
          the whole line so its text has the full column to centre in, and the
          banner steps out of the header entirely — it renders at the foot of
          the form instead, above the submit button. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="w-full text-center text-2xl font-bold tracking-tight sm:w-auto sm:text-left sm:text-[1.75rem]">
          days2meet
        </h1>
        <div className="hidden min-w-0 grow sm:block sm:grow-0">
          <StarBanner />
        </div>
      </div>
      <CreateEventForm />
    </main>
  );
}
