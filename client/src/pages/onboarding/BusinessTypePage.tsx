import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { BusinessTypeId, BusinessTypeOption } from '../../../../shared/types.ts';
import { OnboardingShell } from '../../components/layout/OnboardingShell.tsx';
import { Alert } from '../../components/ui/Alert.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Select } from '../../components/ui/Select.tsx';
import { CatalogIcon } from '../../components/ui/catalogIcons.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';

export default function BusinessTypePage() {
  const { session, apply } = useSession();
  const navigate = useNavigate();
  const [options, setOptions] = useState<BusinessTypeOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState<BusinessTypeId | null>(session?.user?.onboarding.businessType ?? null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    setOptions(null);
    try {
      const catalog = await api.onboarding.catalog();
      setOptions(catalog.businessTypes);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load business types.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = options?.find((o) => o.id === value) ?? null;
  const validationError = touched && !value ? 'Choose the closest match to continue.' : null;

  const submit = async () => {
    setTouched(true);
    if (!value) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await api.onboarding.setBusinessType(value);
      apply(next);
      navigate('/onboarding/features');
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save your selection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingShell
      step="business-type"
      eyebrow="Step 3 · Business profile"
      title="What type of business do you operate?"
      description="We use this to shape your categories, forecasts, and the example books we set up for you."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-ink-muted">You can refine this later in settings.</span>
          <Button size="lg" onClick={() => void submit()} loading={saving} iconRight={<ArrowRight className="size-4" aria-hidden="true" />}>
            Continue
          </Button>
        </div>
      }
    >
      <Card>
        {loadError ? (
          <Alert
            tone="danger"
            title="Could not load options"
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                Retry
              </Button>
            }
          >
            {loadError}
          </Alert>
        ) : !options ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading business types">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton h-14 w-full" />
            <div className="skeleton h-3 w-56" />
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            <Select<BusinessTypeId>
              label="Business type"
              placeholder="Choose the closest match"
              value={value}
              onChange={(v) => {
                setValue(v);
                setTouched(true);
              }}
              options={options.map((o) => ({
                id: o.id,
                label: o.label,
                description: o.description,
                icon: <CatalogIcon name={o.icon} className="size-5" />,
              }))}
              error={validationError}
              hint="Pick the one that best describes how you earn revenue."
            />
          </form>
        )}

        {selected && (
          <div key={selected.id} className="animate-fade-in mt-5 rounded-xl bg-brand-50/70 p-4 ring-1 ring-brand-100">
            <p className="text-sm font-semibold text-brand-900">Tailored for {selected.label.toLowerCase()} businesses</p>
            <p className="mt-1 text-sm leading-relaxed text-brand-900/75">
              Typical for {selected.examples.toLowerCase()}. We will seed a realistic set of accounts, income, bills, and vendors so your dashboard is useful from the first
              minute.
            </p>
          </div>
        )}

        {saveError && (
          <Alert tone="danger" className="mt-5">
            {saveError}
          </Alert>
        )}
      </Card>
    </OnboardingShell>
  );
}
