import type { ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export const inputClass =
  'h-10 w-full rounded-lg bg-panel px-3 text-sm text-ink ring-1 ring-inset ring-line-strong placeholder:text-ink-muted transition-shadow focus:ring-2 focus:ring-brand-500 focus:outline-hidden disabled:opacity-60';

export const selectClass = cn(inputClass, 'appearance-none bg-[url("data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%237d8696%27 stroke-width=%272%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27><path d=%27m6 9 6 6 6-6%27/></svg>")] bg-[length:16px_16px] bg-[position:right_0.6rem_center] bg-no-repeat pr-9');

export const textareaClass = cn(inputClass, 'h-auto min-h-20 resize-y py-2 leading-relaxed');

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs font-medium text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
