import './globals.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';

// display: 'swap' — text renders immediately in the fallback font instead of
// blocking on the webfont download (no invisible-text phase).
const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ergane',
  description: 'Tenant-first foundation — isolation enforced by Postgres RLS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="de">
        <body className={`${inter.variable} ${jetbrainsMono.variable}`}>{children}</body>
      </html>
    </ClerkProvider>
  );
}
