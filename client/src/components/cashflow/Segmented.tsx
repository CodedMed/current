import { useId, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn.ts';

export interface SegmentOption<T extends string | number> {
  id: T;
  label: string;
  title?: string;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'xs';
  className?: string;
}

/** Radio group styled as connected segments; arrow keys move the selection. */
export function Segmented<T extends string | number>({ label, options, value, onChange, size = 'sm', className }: SegmentedProps<T>) {
  const id = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((o) => o.id === value);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange((options[(index + 1) % options.length] as SegmentOption<T>).id);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange((options[(index - 1 + options.length) % options.length] as SegmentOption<T>).id);
    }
  };
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cn('inline-flex rounded-lg bg-surface p-0.5', className)}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={String(o.id)}
            id={`${id}-${String(o.id)}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.id)}
            className={cn(
              'rounded-md font-semibold whitespace-nowrap transition-colors',
              size === 'sm' ? 'h-8 px-3 text-xs' : 'h-7 px-2.5 text-[11px]',
              active ? 'bg-panel text-ink shadow-ring' : 'text-ink-secondary hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
