import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="text-xl font-bold">That event link does not exist</h1>
      <p className="hint mt-2">
        Check the URL, or ask whoever shared it to send the link again.
      </p>
      <Link href="/" className="btn btn-primary mt-5 inline-flex min-h-11">
        Create an event
      </Link>
    </main>
  );
}
