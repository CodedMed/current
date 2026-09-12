import { Check, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface SelectOption<T extends string> {
  id: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

export interface SelectProps<T extends string> {
  label: string;
  placeholder?: string;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
}

/**
 * Accessible single-select listbox (combobox pattern) with keyboard support:
 * arrows move, Enter/Space select, Escape closes, Home/End jump.
 */
export function Select<T extends string>({ label, placeholder = 'Select an option', value, options, onChange, error, hint, disabled }: SelectProps<T>) {
  const id = useId();
  const listId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.id === value)));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((o) => o.id === value) ?? null;

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, options.findIndex((o) => o.id === value));
    setActive(idx);
    // Focus synchronously: the list exists once this effect runs, and frame callbacks can be throttled.
    listRef.current?.focus({ preventScroll: true });
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.id);
    close();
  };

  const onButtonKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        choose(active);
        break;
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const needle = e.key.toLowerCase();
          const idx = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(needle));
          const wrap = idx === -1 ? options.findIndex((o) => o.label.toLowerCase().startsWith(needle)) : idx;
          if (wrap !== -1) setActive(wrap);
        }
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <label id={`${id}-label`} htmlFor={`${id}-button`} className="mb-2 block text-sm font-semibold text-ink">
        {label}
      </label>
      <button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={`${id}-label ${id}-button`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl bg-panel px-4 py-3 text-left shadow-ring transition-shadow',
          'hover:shadow-[0_0_0_1px_var(--color-line-strong)] disabled:opacity-60',
          open && 'shadow-[0_0_0_2px_var(--color-brand-500)]',
          error && 'shadow-[0_0_0_1px_var(--color-danger-500)]',
        )}
      >
        {selected ? (
          <>
            {selected.icon && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">{selected.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-ink">{selected.label}</span>
              {selected.description && <span className="block truncate text-sm text-ink-secondary">{selected.description}</span>}
            </span>
          </>
        ) : (
          <span className="flex-1 py-1.5 text-ink-muted">{placeholder}</span>
        )}
        <ChevronDown className={cn('size-5 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={`${id}-label`}
          aria-activedescendant={`${id}-option-${active}`}
          onKeyDown={onListKeyDown}
          className="animate-scale-in absolute z-30 mt-2 max-h-80 w-full origin-top overflow-auto rounded-xl bg-panel p-1.5 shadow-float ring-1 ring-ink/10 focus:outline-hidden"
        >
          {options.map((option, index) => {
            const isSelected = option.id === value;
            const isActive = index === active;
            return (
              <li
                key={option.id}
                id={`${id}-option-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                  isActive ? 'bg-brand-50' : 'bg-transparent',
                )}
              >
                {option.icon && (
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', isActive || isSelected ? 'bg-brand-100 text-brand-700' : 'bg-surface text-ink-secondary')}>
                    {option.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{option.label}</span>
                  {option.description && <span className="block truncate text-xs text-ink-secondary">{option.description}</span>}
                </span>
                {isSelected && <Check className="size-4 shrink-0 text-brand-600" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p id={`${id}-error`} className="mt-2 text-sm font-medium text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-2 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
