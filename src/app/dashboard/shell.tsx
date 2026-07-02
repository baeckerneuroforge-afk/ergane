'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
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

const NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Übersicht',
    icon: <Icon d="M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z" />,
  },
  {
    href: '/dashboard/knowledge',
    label: 'Wissensbasis',
    icon: <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />,
  },
  {
    href: '/dashboard/chat',
    label: 'Chat',
    icon: <Icon d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z" />,
  },
  {
    href: '/dashboard/skills',
    label: 'Skills',
    icon: <Icon d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />,
  },
  {
    href: '/dashboard/runs',
    label: 'Ausführungen',
    icon: <Icon d="M12 22a10 10 0 1 0-10-10M2 22l5-5M2 17v5h5" />,
  },
  {
    href: '/dashboard/approvals',
    label: 'Freigaben',
    icon: <Icon d="M9 12l2 2 4-4M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z" />,
  },
  {
    href: '/dashboard/audit',
    label: 'Audit',
    icon: <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  },
];

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/dashboard/runs/')) return 'Ausführung';
  const item = [...NAV].sort((a, b) => b.href.length - a.href.length).find((n) =>
    pathname === n.href || pathname.startsWith(`${n.href}/`),
  );
  return item?.label ?? 'Übersicht';
}

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
  const pathname = usePathname() ?? '/dashboard';

  return (
    <div className="dash">
      <aside className="sidebar">
        <Link className="wordmark" href="/dashboard">
          <span className="text">ergane</span>
          <span className="dot">.</span>
        </Link>
        <nav className="nav">
          {NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? ' active' : ''}`}
                title={item.label}
              >
                {item.icon}
                <span className="nav-label">{item.label}</span>
                {item.href === '/dashboard/approvals' && pendingApprovals > 0 ? (
                  <span className="nav-badge">{pendingApprovals}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="dash-main">
        <header className="topbar">
          <h1 className="topbar-title">{pageTitle(pathname)}</h1>
          <div className="topbar-meta">
            <span className="chip chip--gray">{tenantName}</span>
            <span className="chip chip--indigo">{role}</span>
            <UserButton />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
