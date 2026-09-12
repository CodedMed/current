import { CalendarDays, Check, Plus, TrendingUp, X } from 'lucide-react';
import type { ProposedAction, TodoPriority } from '../../../../shared/copilot.ts';
import { cn } from '../../lib/cn.ts';
import { mediumDate, money } from '../../lib/format.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';

export type RecommendationStatus = 'open' | 'adding' | 'added' | 'dismissed';

const PRIORITY_TONE: Record<TodoPriority, BadgeTone> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };
const PRIORITY_LABEL: Record<'en' | 'es', Record<TodoPriority, string>> = {
  en: { HIGH: 'High priority', MEDIUM: 'Medium priority', LOW: 'Low priority' },
  es: { HIGH: 'Prioridad alta', MEDIUM: 'Prioridad media', LOW: 'Prioridad baja' },
};

interface RecommendationCardProps {
  action: ProposedAction;
  index: number;
  status: RecommendationStatus;
  strings: AdvisorStrings;
  language: 'en' | 'es';
  onAdd: () => void;
  onDismiss: () => void;
  onUndo: () => void;
}

/** One proposed action. It stays a proposal until the owner presses "Add to tasks". */
export function RecommendationCard({ action, index, status, strings, language, onAdd, onDismiss, onUndo }: RecommendationCardProps) {
  if (status === 'dismissed') {
    return (
      <li className="flex items-center justify-between gap-3 rounded-xl bg-surface/70 px-3.5 py-2 text-sm text-ink-muted">
        <span className="truncate">
          <span className="line-through">{action.title}</span> · {strings.dismissed}
        </span>
        <button type="button" onClick={onUndo} className="shrink-0 font-semibold text-brand-700 hover:underline">
          {strings.undo}
        </button>
      </li>
    );
  }
  return (
    <li className={cn('rounded-xl border-l-[3px] bg-surface/70 py-3 pr-3.5 pl-3.5 transition-colors', status === 'added' ? 'border-positive-500' : action.priority === 'HIGH' ? 'border-danger-500' : action.priority === 'MEDIUM' ? 'border-warning-500' : 'border-line-strong')}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink">
          <span className="mr-1.5 text-ink-muted">{index + 1}.</span>
          {action.title}
        </p>
        <Badge tone={PRIORITY_TONE[action.priority]}>{PRIORITY_LABEL[language][action.priority]}</Badge>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{action.rationale}</p>
      {(action.dueDate || action.estimatedImpact !== null) && (
        <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          {action.dueDate && (
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5 text-ink-muted" aria-hidden="true" />
              <dt className="text-ink-muted">{strings.due}</dt>
              <dd className="font-semibold text-ink">{mediumDate(action.dueDate)}</dd>
            </div>
          )}
          {action.estimatedImpact !== null && (
            <div className="flex items-center gap-1.5">
              <TrendingUp className="size-3.5 text-ink-muted" aria-hidden="true" />
              <dt className="text-ink-muted">{strings.impact}</dt>
              <dd className="tabular font-semibold text-ink">{money(Math.abs(action.estimatedImpact))}</dd>
            </div>
          )}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {status === 'added' ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-positive-700">
            <Check className="size-4" aria-hidden="true" />
            {strings.added}
          </span>
        ) : (
          <>
            <Button size="sm" onClick={onAdd} loading={status === 'adding'} icon={<Plus className="size-4" aria-hidden="true" />}>
              {status === 'adding' ? strings.adding : strings.addToTasks}
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss} disabled={status === 'adding'} icon={<X className="size-4" aria-hidden="true" />}>
              {strings.dismiss}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
