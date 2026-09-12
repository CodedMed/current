import { ArrowLeft, ArrowRight, Check, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { FeatureId, FeatureOption } from '../../../../shared/types.ts';
import { OnboardingShell } from '../../components/layout/OnboardingShell.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { CatalogIcon } from '../../components/ui/catalogIcons.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { cn } from '../../lib/cn.ts';
import { useSession } from '../../lib/session.tsx';

export default function FeaturesPage() {
  const { session, apply } = useSession();
  const navigate = useNavigate();
  const [options, setOptions] = useState<FeatureOption[] | null>(null);
  const [recommended, setRecommended] = useState<FeatureId[]>([]);
  const [selected, setSelected] = useState<Set<FeatureId>>(() => new Set(session?.user?.onboarding.features ?? []));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const load = async () => {
    setLoadError(null);
    setOptions(null);
    try {
      const catalog = await api.onboarding.catalog();
      setOptions(catalog.features);
      setRecommended(catalog.recommended);
      setSelected((prev) => (prev.size > 0 ? prev : new Set(catalog.recommended)));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load features.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = (id: FeatureId) => {
    setTouched(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const count = selected.size;
  const validationError = touched && count === 0 ? 'Choose at least one area to continue.' : null;
  const orderedSelection = useMemo(() => (options ?? []).filter((o) => selected.has(o.id)).map((o) => o.id), [options, selected]);

  const submit = async () => {
    setTouched(true);
    if (count === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api.onboarding.setFeatures(orderedSelection);
      apply(next);
      navigate('/onboarding/setup');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save your selection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingShell
      step="features"
      width="lg"
      eyebrow="Step 4 · Priorities"
      title="What do you need help managing?"
      description="Choose everything that applies. We pre-selected what businesses like yours usually start with."
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" onClick={() => navigate('/onboarding/business-type')} icon={<ArrowLeft className="size-4" aria-hidden="true" />}>
            Back
          </Button>
          <div className="flex items-center gap-4">
            <span className={cn('text-sm', validationError ? 'font-medium text-danger-600' : 'text-ink-muted')} aria-live="polite">
              {validationError ?? `${count} selected`}
            </span>
            <Button size="lg" onClick={() => void submit()} loading={saving} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
              Continue
            </Button>
          </div>
        </div>
      }
    >
      {loadError ? (
        <Alert
          tone="danger"
          title="Could not load features"
          action={
            <Button size="sm" variant="secondary" onClick={() => void load()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : !options ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading features">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-28 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => { setTouched(true); setSelected(new Set(recommended)); }}>
              Recommended only
            </button>
            <span className="text-ink-muted">·</span>
            <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => { setTouched(true); setSelected(new Set(options.map((o) => o.id))); }}>
              Select all
            </button>
            <span className="text-ink-muted">·</span>
            <button type="button" className="font-semibold text-ink-secondary hover:underline" onClick={() => { setTouched(true); setSelected(new Set()); }}>
              Clear
            </button>
          </div>

          <fieldset>
            <legend className="sr-only">Areas to manage</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {options.map((option, i) => {
                const checked = selected.has(option.id);
                const isRecommended = recommended.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={cn(
                      `animate-fade-up stagger-${Math.min(i + 1, 12)} group relative flex cursor-pointer gap-3.5 rounded-2xl bg-panel p-4 shadow-ring transition-all`,
                      'hover:shadow-card has-focus-visible:ring-2 has-focus-visible:ring-brand-500',
                      checked && 'shadow-[0_0_0_2px_var(--color-brand-500)]',
                    )}
                  >
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(option.id)} />
                    <span
                      className={cn(
                        'grid size-11 shrink-0 place-items-center rounded-xl transition-colors',
                        checked ? 'bg-brand-600 text-white' : 'bg-surface text-ink-secondary group-hover:bg-brand-50 group-hover:text-brand-700',
                      )}
                    >
                      <CatalogIcon name={option.icon} className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink">{option.label}</span>
                        {isRecommended && <Badge tone="brand">Recommended</Badge>}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-ink-secondary">{option.description}</span>
                    </span>
                    <span
                      className={cn(
                        'grid size-6 shrink-0 place-items-center self-start rounded-full transition-all',
                        checked ? 'bg-brand-600 text-white' : 'bg-panel ring-1 ring-inset ring-line-strong',
                      )}
                      aria-hidden="true"
                    >
                      {checked && <Check className="size-3.5" strokeWidth={3} />}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {saveError && (
            <Alert tone="danger" className="mt-5">
              {saveError}
            </Alert>
          )}
        </>
      )}
    </OnboardingShell>
  );
}
