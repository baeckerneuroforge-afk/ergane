import './globals.css';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

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
