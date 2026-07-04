'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { HelixMark } from '@/app/brand';
import type { Dictionary } from '@/lib/i18n';
import { useDict } from '@/lib/i18n/client';

interface NavItem {
  href: string;
  /** Dictionary key for the label AND the one-line topbar subtitle. */
  key: keyof Dictionary['nav']['subtitles'];
  icon: React.ReactNode;
  /** Only rendered for admin/owner — the server-side gates stay the truth. */
  adminOnly?: boolean;
}

interface NavSection {
  titleKey: keyof Dictionary['nav']['sections'];
  items: NavItem[];
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

// Gruppierung nach Tätigkeit: Arbeiten (Wissen nutzen) · Automatisierung
// (Skills laufen lassen, Mensch entscheidet) · Governance (nachvollziehen,
// steuern). Spiegelt die Produkt-Semantik: liest → handelt → verantwortet.
const SECTIONS: NavSection[] = [
  {
    titleKey: 'workspace',
    items: [
      {
        href: '/dashboard',
        key: 'overview',
        icon: <Icon d="M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z" />,
      },
      {
        href: '/dashboard/chat',
        key: 'chat',
        icon: <Icon d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />,
      },
      {
        href: '/dashboard/knowledge',
        key: 'knowledge',
        icon: <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
      },
    ],
  },
  {
    titleKey: 'automation',
    items: [
      {
        href: '/dashboard/skills',
        key: 'skills',
        icon: <Icon d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
      },
      {
        href: '/dashboard/runs',
        key: 'runs',
        icon: <Icon d="M12 22a10 10 0 1 0-10-10M2 22l5-5M2 17v5h5" />,
      },
      {
        href: '/dashboard/approvals',
        key: 'approvals',
        icon: <Icon d="M9 12l2 2 4-4M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />,
      },
      {
        href: '/dashboard/value',
        key: 'value',
        icon: <Icon d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
      },
    ],
  },
  {
    titleKey: 'governance',
    items: [
      {
        href: '/dashboard/audit',
        key: 'audit',
        icon: <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
      },
      {
        href: '/dashboard/security',
        key: 'security',
        adminOnly: true,
        icon: <Icon d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4zM9 12l2 2 4-4" />,
      },
      {
        href: '/dashboard/settings',
        key: 'settings',
        adminOnly: true,
        icon: <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />,
      },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

function pageHeader(pathname: string, nav: Dictionary['nav']): { title: string; subtitle: string } {
  if (pathname.startsWith('/dashboard/runs/')) {
    return { title: nav.runDetail, subtitle: nav.subtitles.runDetail };
  }
  const item = [...ALL_ITEMS].sort((a, b) => b.href.length - a.href.length).find((n) =>
    pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
  return item
    ? { title: nav[item.key], subtitle: nav.subtitles[item.key] }
    : { title: nav.overview, subtitle: '' };
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  lead: 'Lead',
  member: 'Member',
};

export function DashboardShell({
  tenantName,
  role,
  pendingApprovals,
  children,
}: {
  tenantName: string;
  role: string;
  pendingApprovals: number;
  children: React.ReactNode;
}) {
  const t = useDict();
  const pathname = usePathname() ?? '/dashboard';
  const isAdmin = role === 'admin' || role === 'owner';
  const { title, subtitle } = pageHeader(pathname, t.nav);

  return (
    <div className="dash">
      <aside className="sidebar">
        <Link className="wordmark" href="/dashboard">
          <HelixMark size={24} variant="dark" />
          <span className="text">
            helix<span className="dot">.ai</span>
          </span>
        </Link>
        <nav className="nav">
          {SECTIONS.map((section) => {
            const items = section.items.filter((item) => !item.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={section.titleKey} style={{ display: 'contents' }}>
                <div className="nav-section">
                  <span className="nav-section-label">{t.nav.sections[section.titleKey]}</span>
                </div>
                {items.map((item) => {
                  const active =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const label = t.nav[item.key];
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-item${active ? ' active' : ''}`}
                      title={label}
                    >
                      {item.icon}
                      <span className="nav-label">{label}</span>
                      {item.href === '/dashboard/approvals' && pendingApprovals > 0 ? (
                        <span className="nav-badge">{pendingApprovals}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="tenant-card" title={`${tenantName} · ${ROLE_LABEL[role] ?? role}`}>
            <span className="tenant-name">{tenantName}</span>
            <span className="tenant-role">{ROLE_LABEL[role] ?? role}</span>
          </div>
        </div>
      </aside>

      <div className="dash-main">
        <header className="topbar">
          <div>
            <h1 className="topbar-title">{title}</h1>
            {subtitle ? <p className="topbar-sub">{subtitle}</p> : null}
          </div>
          <div className="topbar-meta">
            <UserButton />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
