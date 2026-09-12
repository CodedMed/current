const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export function money(n: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  if (opts.compact && Math.abs(n) >= 10_000) return compact.format(n);
  return opts.cents ? usdCents.format(n) : usd.format(n);
}

export function signedMoney(n: number, opts: { cents?: boolean; compact?: boolean } = {}): string {
  const s = money(Math.abs(n), opts);
  return n < 0 ? `−${s}` : `+${s}`;
}

/** "$428.6K" for any magnitude, matching the axis labels used in charts. */
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** "3 min ago", "2 hours ago", "4 days ago". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** "Sep 12, 2026" */
export function mediumDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "September 12, 2026" */
export function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ACH: 'ACH',
  WIRE: 'Wire',
  CHECK: 'Check',
  DEBIT_CARD: 'Debit card',
  CREDIT_CARD: 'Credit card',
  ZELLE: 'Zelle',
  STRIPE: 'Stripe',
  PAYPAL: 'PayPal',
  CASH: 'Cash',
  OTHER: 'Other',
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? titleCase(method);
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit',
  MONEY_MARKET: 'Money market',
  PAYMENT_PROCESSOR: 'Payment processor',
};

export function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPE_LABELS[type] ?? titleCase(type);
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function pct(n: number | null, digits = 0): string {
  if (n === null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)}%`;
}

export function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function dueLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days}d`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
