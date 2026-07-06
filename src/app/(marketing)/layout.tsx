import './marketing.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s — helix.ai',
    default: 'helix.ai — the operating DNA of your company.',
  },
  description:
    'helix.ai is the operating DNA of your company. Two strands: what your company knows, and what it does with it — cited answers, human-gated actions, append-only audit. GDPR-native, EU-hosted.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://helix.ai'),
  openGraph: {
    type: 'website',
    siteName: 'helix.ai',
  },
  twitter: {
    card: 'summary_large_image',
  },
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="marketing">{children}</div>;
}
