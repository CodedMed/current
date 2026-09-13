import { CheckSquare, Files, LayoutDashboard, Sparkles } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '../../lib/cn.ts';

const pages = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/documents', label: 'Documents & invoices', icon: Files },
  { to: '/advisor', label: 'Advisor', icon: Sparkles },
  { to: '/tasks', label: 'Tasks', icon: CheckSquare },
];

export function WorkspaceNav({ className }: { className?: string }) {
  return (
    <nav aria-label="Workspace" className={cn('mx-auto max-w-[1400px] overflow-x-auto px-5 sm:px-8', className)}>
      <ul className="flex gap-1">
        {pages.map(({ to, label, icon: Icon }) => (
          <li key={to} className="shrink-0">
            <NavLink to={to} className={({ isActive }) => cn('inline-flex h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold whitespace-nowrap transition-colors', isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-secondary hover:border-line-strong hover:text-ink')}>
              <Icon className="size-4" aria-hidden="true" />{label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
