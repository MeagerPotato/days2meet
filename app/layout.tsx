import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist, Inter } from 'next/font/google';

import SiteAnalytics from '@/components/SiteAnalytics';
import { CANONICAL_ORIGIN } from '@/lib/site';

import './globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display-face',
  display: 'swap',
});

const ui = Geist({
  subsets: ['latin'],
  variable: '--font-ui-face',
  display: 'swap',
});

/* Every figure in the app (`.num` in globals.css): grid labels, counts, dates.
   Inter with tabular figures, so digits keep one width and columns line up. */
const numerals = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-num-face',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_ORIGIN),
  title: 'days2meet',
  description: 'Find a time, or just find a week. Group availability without the time grid when you do not need one.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#fcfcfd',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${numerals.variable}`}>
      <body>
        {children}
        <SiteAnalytics />
      </body>
    </html>
  );
}
