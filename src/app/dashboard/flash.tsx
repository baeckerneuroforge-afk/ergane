// Minimal success/error flash for pilot UX — no toast library.
// Driven by ?flash=ok|error|custom message query params after mutations.
'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function FlashBanner({
  successLabel,
  errorLabel,
}: {
  successLabel: string;
  errorLabel: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get('flash');
  const [visible, setVisible] = useState(Boolean(raw));

  useEffect(() => {
    setVisible(Boolean(raw));
    if (!raw) return;
    const t = setTimeout(() => {
      setVisible(false);
      const next = new URLSearchParams(params.toString());
      next.delete('flash');
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    }, 4000);
    return () => clearTimeout(t);
  }, [raw, params, pathname, router]);

  if (!visible || !raw) return null;

  const isError = raw === 'error' || raw.startsWith('err:');
  const text =
    raw === 'ok'
      ? successLabel
      : raw === 'error'
        ? errorLabel
        : raw.startsWith('err:')
          ? raw.slice(4)
          : decodeURIComponent(raw);

  return (
    <div
      role="status"
      className="card"
      style={{
        marginBottom: '1rem',
        borderColor: isError ? 'var(--red, #b42318)' : 'var(--green, #1a7f37)',
        background: isError ? 'var(--red-bg, #fef3f2)' : 'var(--green-bg, #eefbf1)',
      }}
    >
      <p style={{ margin: '0.75rem 1.1rem' }}>{text}</p>
    </div>
  );
}
