import { Check } from 'lucide-react';
import { PROGRESS_STEPS, stepIndex, type FlowStep } from '../../../../shared/flow.ts';
import { cn } from '../../lib/cn.ts';

interface StepperProps {
  current: FlowStep;
  orientation: 'vertical' | 'horizontal';
}

export function Stepper({ current, orientation }: StepperProps) {
  const currentIdx = stepIndex(current);
  const total = PROGRESS_STEPS.length;
  const position = Math.min(currentIdx, total - 1);

  if (orientation === 'horizontal') {
    const label = PROGRESS_STEPS[position]?.label ?? '';
    return (
      <div className="px-5 py-3" aria-label={`Step ${position + 1} of ${total}: ${label}`}>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold">
          <span className="text-ink">{label}</span>
          <span className="text-ink-muted">
            Step {position + 1} of {total}
          </span>
        </div>
        <ol className="flex gap-1.5" role="list">
          {PROGRESS_STEPS.map((s, i) => (
            <li
              key={s.step}
              className={cn('h-1.5 flex-1 rounded-full transition-colors duration-500', i < position ? 'bg-positive-500' : i === position ? 'bg-brand-600' : 'bg-line')}
              aria-current={i === position ? 'step' : undefined}
            />
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ol className="relative space-y-1" role="list" aria-label="Onboarding progress">
      {PROGRESS_STEPS.map((s, i) => {
        const done = i < position;
        const active = i === position;
        return (
          <li key={s.step} className="relative flex gap-4 py-2.5" aria-current={active ? 'step' : undefined}>
            {i < total - 1 && (
              <span
                className={cn('absolute top-[38px] left-[15px] h-[calc(100%-22px)] w-px transition-colors duration-500', done ? 'bg-positive-500/70' : 'bg-white/15')}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'relative grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold transition-all duration-500',
                done && 'bg-positive-500 text-white',
                active && 'bg-white text-navy-900 shadow-[0_0_0_6px_rgba(255,255,255,0.12)]',
                !done && !active && 'bg-white/10 text-white/60 ring-1 ring-inset ring-white/15',
              )}
            >
              {done ? <Check className="size-4" strokeWidth={3} aria-hidden="true" /> : i + 1}
            </span>
            <span className="min-w-0 pt-1">
              <span className={cn('block text-sm font-semibold transition-colors', active ? 'text-white' : done ? 'text-white/85' : 'text-white/50')}>{s.label}</span>
              <span className={cn('block text-xs transition-colors', active ? 'text-white/70' : 'text-white/35')}>{s.hint}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
