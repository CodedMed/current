import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn.ts';

export interface DropdownOption {
  id: string;
  label: string;
  description?: string;
}

interface BaseProps {
  label: string;
  icon?: ReactNode;
  options: DropdownOption[];
  className?: string;
  align?: 'left' | 'right';
}

interface SingleProps extends BaseProps {
  multi?: false;
  value: string;
  onChange: (id: string) => void;
}

interface MultiProps extends BaseProps {
  multi: true;
  /** null = everything. */
  value: string[] | null;
  allLabel: string;
  onChange: (ids: string[] | null) => void;
}

type DropdownProps = SingleProps | MultiProps;

/** Compact toolbar select. Single-select behaves like a menu; multi-select toggles with an "all" row. */
export function Dropdown(props: DropdownProps) {
  const { label, icon, options, className, align = 'left' } = props;
  const id = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    listRef.current?.querySelector<HTMLElement>('[role="option"],[role="menuitemcheckbox"]')?.focus({ preventScroll: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"],[role="menuitemcheckbox"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[Math.min(items.length - 1, index + 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[Math.max(0, index - 1)]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  const summary = props.multi
    ? props.value === null || props.value.length === 0
      ? props.allLabel
      : props.value.length === 1
        ? (options.find((o) => o.id === props.value?.[0])?.label ?? props.allLabel)
        : `${props.value.length} of ${options.length} accounts`
    : (options.find((o) => o.id === props.value)?.label ?? label);

  const isAll = props.multi === true && (props.value === null || props.value.length === 0);

  const toggleMulti = (optionId: string) => {
    if (!props.multi) return;
    const current = new Set(props.value ?? []);
    if (current.has(optionId)) current.delete(optionId);
    else current.add(optionId);
    if (current.size === 0 || current.size === options.length) props.onChange(null);
    else props.onChange(options.filter((o) => current.has(o.id)).map((o) => o.id));
  };

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        id={`${id}-button`}
        type="button"
        aria-haspopup={props.multi ? 'menu' : 'listbox'}
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-9 max-w-64 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-ink ring-1 ring-inset ring-line transition-colors hover:bg-surface',
          open && 'bg-surface ring-line-strong',
        )}
      >
        {icon && <span className="text-ink-muted">{icon}</span>}
        <span className="truncate">{summary}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={listRef}
          role={props.multi ? 'menu' : 'listbox'}
          aria-labelledby={`${id}-button`}
          onKeyDown={onListKeyDown}
          className={cn(
            'animate-scale-in absolute z-40 mt-2 max-h-96 w-72 origin-top overflow-auto rounded-xl bg-panel p-1.5 shadow-float ring-1 ring-ink/10',
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left',
          )}
        >
          {props.multi && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={isAll}
              onClick={() => {
                props.onChange(null);
                close();
              }}
              className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface focus:bg-surface focus:outline-hidden', isAll && 'text-brand-700')}
            >
              <Checkbox checked={isAll} />
              {props.allLabel}
            </button>
          )}
          {props.multi && <div className="mx-2 my-1 border-t border-line" role="separator" />}
          {options.map((option) => {
            const selected = props.multi ? !isAll && (props.value?.includes(option.id) ?? false) : props.value === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role={props.multi ? 'menuitemcheckbox' : 'option'}
                aria-checked={props.multi ? selected : undefined}
                aria-selected={props.multi ? undefined : selected}
                onClick={() => {
                  if (props.multi) toggleMulti(option.id);
                  else {
                    props.onChange(option.id);
                    close();
                  }
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface focus:bg-surface focus:outline-hidden',
                  selected && !props.multi && 'bg-brand-50/70',
                )}
              >
                {props.multi && <Checkbox checked={selected} />}
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', selected ? 'font-semibold text-ink' : 'font-medium text-ink')}>{option.label}</span>
                  {option.description && <span className="block truncate text-xs text-ink-muted">{option.description}</span>}
                </span>
                {!props.multi && selected && <Check className="size-4 shrink-0 text-brand-600" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span className={cn('grid size-4 shrink-0 place-items-center rounded-[5px] ring-1 ring-inset transition-colors', checked ? 'bg-brand-600 ring-brand-600 text-white' : 'bg-panel ring-line-strong')} aria-hidden="true">
      {checked && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}
