import './globals.css';
import type { Metadata } from 'next';
import {
  ClerkProvider,
  OrganizationSwitcher,
  SignedIn,
  SignedOut,
  UserButton,
} from '@clerk/nextjs';

export const metadata: Metadata = {
  title: 'ergane',
  description: 'Tenant-first foundation — isolation enforced by Postgres RLS.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header>
            <span className="brand">ergane</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <SignedIn>
                <OrganizationSwitcher hidePersonal afterSelectOrganizationUrl="/dashboard" />
                <UserButton />
              </SignedIn>
              <SignedOut>
                <span className="muted">not signed in</span>
              </SignedOut>
            </span>
          </header>
          <main>{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
