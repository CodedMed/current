import { BadgeCheck, LogOut, Lock, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { FlowStep } from '../../../../shared/flow.ts';
import { cn } from '../../lib/cn.ts';
import { initials } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';
import { Logo } from '../ui/Logo.tsx';
import { Stepper } from './Stepper.tsx';

interface OnboardingShellProps {
  step: FlowStep;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'md' | 'lg';
}

const RAIL_COPY: Record<FlowStep, { heading: string; body: string }> = {
  signup: {
    heading: 'Know where every dollar stands.',
    body: 'Keel brings income, bills, invoices, and forecasts into one calm view, so decisions are made with the numbers in front of you.',
  },
  verify: {
    heading: 'Trusted by banks, built for you.',
    body: 'A quick identity check keeps your account, and every business we serve, safe from fraud. It is the same standard your bank uses.',
  },
  'business-type': {
    heading: 'Every business runs on a different rhythm.',
    body: 'Restaurants live day to day. Contractors wait on draws. Tell us what you run and we will shape everything around it.',
  },
  features: {
    heading: 'Start with what keeps you up at night.',
    body: 'Pick the areas you want a firm grip on first. You can switch on the rest whenever you are ready.',
  },
  setup: {
    heading: 'Your books, assembled.',
    body: 'We are connecting accounts, importing activity, and building your first forecast. This usually takes under a minute.',
  },
  dashboard: {
    heading: 'Control, confidence, visibility.',
    body: 'Everything about your cash in one place.',
  },
};

export function OnboardingShell({ step, eyebrow, title, description, children, footer, width = 'md' }: OnboardingShellProps) {
  const { session, signOut } = useSession();
  const navigate = useNavigate();
  const copy = RAIL_COPY[step];
  const user = session?.user ?? null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
      {/* Brand rail */}
      <aside className="relative hidden overflow-hidden bg-navy-900 text-white lg:flex lg:flex-col lg:px-10 lg:py-9 xl:px-12">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-32 -left-24 size-[420px] rounded-full bg-brand-600/30 blur-3xl" />
          <div className="absolute -right-32 bottom-0 size-[360px] rounded-full bg-brand-400/10 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />
        </div>

        <div className="relative flex h-full flex-col">
          <Logo tone="light" />

          <div className="mt-14 xl:mt-20">
            <p className="text-xs font-semibold tracking-[0.18em] text-brand-300 uppercase">Small-business cash flow</p>
            <h2 className="mt-3 text-[28px] leading-[1.15] font-bold tracking-tight xl:text-[32px]">{copy.heading}</h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/65">{copy.body}</p>
          </div>

          <div className="mt-12">
            <Stepper current={step} orientation="vertical" />
          </div>

          <ul className="mt-auto space-y-2.5 pt-10 text-[13px] text-white/55">
            <li className="flex items-center gap-2.5">
              <ShieldCheck className="size-4 text-brand-300" aria-hidden="true" /> 256-bit encryption in transit and at rest
            </li>
            <li className="flex items-center gap-2.5">
              <BadgeCheck className="size-4 text-brand-300" aria-hidden="true" /> Identity verification by Persona
            </li>
            <li className="flex items-center gap-2.5">
              <Lock className="size-4 text-brand-300" aria-hidden="true" /> Read-only access to your financial data
            </li>
          </ul>
        </div>
      </aside>

      {/* Content */}
      <main className="flex min-h-dvh flex-col">
        <header className="flex items-center justify-between border-b border-line bg-panel px-5 py-3.5 sm:px-8 lg:border-0 lg:bg-transparent lg:py-6">
          <span className="lg:hidden">
            <Logo />
          </span>
          <span className="hidden lg:block" />
          {user ? (
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-2 sm:flex">
                {user.picture ? (
                  <img src={user.picture} alt="" className="size-8 rounded-full ring-1 ring-ink/10" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{initials(user.name)}</span>
                )}
                <span className="text-sm">
                  <span className="block leading-tight font-semibold text-ink">{user.name}</span>
                  <span className="block text-xs leading-tight text-ink-muted">{user.email}</span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-ink/5 hover:text-ink"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </button>
            </div>
          ) : (
            <span className="hidden text-sm text-ink-muted sm:inline">Cash-flow management for small business</span>
          )}
        </header>

        <div className="border-b border-line bg-panel lg:hidden">
          <Stepper current={step} orientation="horizontal" />
        </div>

        <div className="flex flex-1 justify-center px-5 py-8 sm:px-8 sm:py-12 lg:py-10 xl:py-14">
          <div key={step} className={cn('animate-fade-up w-full', width === 'lg' ? 'max-w-3xl' : 'max-w-xl')}>
            <div className="mb-8">
              {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[0.16em] text-brand-600 uppercase">{eyebrow}</p>}
              <h1 className="text-[28px] leading-tight font-bold tracking-tight text-ink sm:text-[32px]">{title}</h1>
              {description && <div className="mt-3 text-[15px] leading-relaxed text-ink-secondary">{description}</div>}
            </div>
            {children}
            {footer && <div className="mt-8">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  );
}
