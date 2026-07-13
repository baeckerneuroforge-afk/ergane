'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { HelixMark } from '@/app/brand';
import type { Dictionary } from '@/lib/i18n';
import { useDict } from '@/lib/i18n/client';

interface NavItem {
  href: string;
  key: keyof Dictionary['nav']['subtitles'];
  icon: React.ReactNode;
  adminOnly?: boolean;
  /** Visually dim the item and show a "coming soon" hint. */
  soon?: boolean;
}

interface NavSection {
  titleKey: keyof Dictionary['nav']['sections'] | null;
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

const SECTIONS: NavSection[] = [
  {
    titleKey: null,
    items: [
      {
        href: '/dashboard',
        key: 'cockpit',
        icon: <Icon d="M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z" />,
      },
    ],
  },
  {
    titleKey: 'work',
    items: [
      {
        href: '/dashboard/clients',
        key: 'clients',
        icon: <Icon d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
      },
      {
        href: '/dashboard/deliverables',
        key: 'deliverables',
        icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8" />,
      },
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
    ],
  },
  {
    titleKey: 'knowledge',
    items: [
      {
        href: '/dashboard/knowledge',
        key: 'knowledge',
        icon: <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
      },
      {
        href: '/dashboard/chat',
        key: 'chat',
        icon: <Icon d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />,
      },
      {
        href: '/dashboard/connectors',
        key: 'connectors',
        // Live: Linear / GitHub / Drive read connectors (P0–P2) — not "coming soon".
        icon: <Icon d="M8 12h8M12 3v3M6.3 6.3l2.15 2.15M3 12h3M6.3 17.7l2.15-2.15M12 18v3M17.7 17.7l-2.15-2.15M18 12h3M17.7 6.3l-2.15 2.15" />,
      },
    ],
  },
  {
    titleKey: 'control',
    items: [
      {
        href: '/dashboard/flags',
        key: 'flags',
        icon: <Icon d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />,
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
      {
        href: '/dashboard/security',
        key: 'security',
        adminOnly: true,
        icon: <Icon d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4zM9 12l2 2 4-4" />,
      },
      {
        href: '/dashboard/audit',
        key: 'audit',
        icon: <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
      },
    ],
  },
];

const ALL_ITEMS = SECTIONS.flatMap((s) => s.items);

function pageHeader(pathname: string, nav: Dictionary['nav']): { title: string; subtitle: string } {
  if (pathname.startsWith('/dashboard/runs/')) {
    return { title: nav.runDetail, subtitle: nav.subtitles.runDetail };
  }
  if (/^\/dashboard\/clients\/[^/]+$/.test(pathname)) {
    return { title: nav.clientDetail, subtitle: nav.subtitles.clientDetail };
  }
  const item = [...ALL_ITEMS].sort((a, b) => b.href.length - a.href.length).find((n) =>
    pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
  if (item) {
    const key = item.key as keyof typeof nav;
    return { title: nav[key] as string, subtitle: nav.subtitles[item.key] };
  }
  return { title: nav.cockpit, subtitle: nav.subtitles.cockpit };
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
  openFlags,
  children,
}: {
  tenantName: string;
  role: string;
  pendingApprovals: number;
  openFlags: number;
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
          {SECTIONS.map((section, si) => {
            const items = section.items.filter((item) => !item.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={section.titleKey ?? si} style={{ display: 'contents' }}>
                {section.titleKey ? (
                  <div className="nav-section">
                    <span className="nav-section-label">{t.nav.sections[section.titleKey]}</span>
                  </div>
                ) : null}
                {items.map((item) => {
                  const active =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const key = item.key as keyof typeof t.nav;
                  const label = t.nav[key] as string;
                  // Live count badge: approvals waiting, or flags raised in the
                  // last 7 days (mirrors the cockpit panel + layout window).
                  const badge =
                    item.href === '/dashboard/approvals'
                      ? pendingApprovals
                      : item.href === '/dashboard/flags'
                        ? openFlags
                        : 0;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`nav-item${active ? ' active' : ''}${item.soon ? ' nav-item--soon' : ''}`}
                      title={label}
                    >
                      {item.icon}
                      <span className="nav-label">{label}</span>
                      {badge > 0 ? <span className="nav-badge">{badge}</span> : null}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <Link
            href="/dashboard/settings"
            className={`nav-item${pathname.startsWith('/dashboard/settings') ? ' active' : ''}`}
            title={t.nav.settings}
          >
            <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            <span className="nav-label">{t.nav.settings}</span>
          </Link>
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
