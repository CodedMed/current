import { Check, Globe, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LANGUAGES, languageInfo, type AdvisorLanguage } from '../../../../shared/copilot.ts';
import { cn } from '../../lib/cn.ts';
import { useLanguage } from '../../lib/i18n/LanguageProvider.tsx';

/**
 * Switches the language of the whole app. The menu itself is marked `data-no-translate` so the
 * names stay in their own language — a reader looking for "日本語" should always find it written
 * that way, whatever the page is currently showing.
 */
export function LanguageSwitcher({ className, align = 'right' }: { className?: string; align?: 'left' | 'right' }) {
  const { language, setLanguage, status } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = languageInfo(language);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (next: AdvisorLanguage) => {
    setLanguage(next);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative', className)} data-no-translate>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Language — ${current.english}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-secondary ring-1 ring-inset ring-line transition-colors hover:bg-ink/5 hover:text-ink"
      >
        {status === 'translating' ? (
          <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden="true" />
        ) : (
          <Globe className="size-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{current.label}</span>
        <span className="sm:hidden">{language.toUpperCase()}</span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Language"
          className={cn(
            'absolute z-50 mt-1.5 max-h-80 w-52 overflow-y-auto rounded-xl bg-panel p-1 shadow-lg ring-1 ring-ink/10',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {LANGUAGES.map((info) => (
            <button
              key={info.code}
              type="button"
              role="option"
              aria-selected={info.code === language}
              onClick={() => choose(info.code)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-brand-50',
                info.code === language ? 'font-semibold text-brand-800' : 'text-ink-secondary',
              )}
            >
              <span className="flex-1" dir={info.rtl ? 'rtl' : 'ltr'}>
                {info.label}
              </span>
              <span className="text-xs text-ink-muted">{info.english}</span>
              {info.code === language && <Check className="size-4 text-brand-600" aria-hidden="true" />}
            </button>
          ))}
          {status === 'unavailable' && (
            <p className="px-2.5 py-2 text-xs text-ink-muted">
              Translation is unavailable right now, so text stays in English.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
