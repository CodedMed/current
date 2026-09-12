import { AudioLines, Bot, CircleAlert, ListChecks, RefreshCw, TriangleAlert } from 'lucide-react';
import type { AdvisorLanguage, RiskSeverity } from '../../../../shared/copilot.ts';
import { cn } from '../../lib/cn.ts';
import type { AdvisorMessage, UserMessage } from '../../lib/advisor/conversation.ts';
import { actionKey } from '../../lib/advisor/conversation.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { Badge, type BadgeTone } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { LogoMark } from '../ui/Logo.tsx';
import { RecommendationCard, type RecommendationStatus } from './RecommendationCard.tsx';

const SEVERITY_TONE: Record<RiskSeverity, BadgeTone> = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'neutral' };

export function UserBubble({ message, strings }: { message: UserMessage; strings: AdvisorStrings }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-navy-900 px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm sm:max-w-[75%]">
        {message.channel === 'voice' && (
          <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-brand-200">
            <AudioLines className="size-3" aria-hidden="true" />
            {strings.spokenTurn}
          </span>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

interface AdvisorBubbleProps {
  message: AdvisorMessage;
  strings: AdvisorStrings;
  language: AdvisorLanguage;
  statuses: Record<string, RecommendationStatus | undefined>;
  onAddTask: (message: AdvisorMessage, index: number) => void;
  onDismiss: (key: string) => void;
  onUndo: (key: string) => void;
  onRetry: (message: AdvisorMessage) => void;
}

/** Renders the answer with facts, projections and recommendations visibly separated. */
export function AdvisorBubble({ message, strings, language, statuses, onAddTask, onDismiss, onUndo, onRetry }: AdvisorBubbleProps) {
  const { reply, error, spoken } = message;
  const pending = !reply && !error && !spoken;
  return (
    <div className="flex gap-3">
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-navy-900" aria-hidden="true">
        <LogoMark className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        {pending && (
          <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md bg-surface px-4 py-3 text-sm text-ink-secondary" role="status" aria-live="polite">
            <span className="flex items-center gap-1" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className="block size-1.5 rounded-full bg-brand-500 animate-pulse-soft" style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </span>
            {strings.thinking}
          </div>
        )}

        {error && (
          <div className="rounded-2xl rounded-tl-md bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-100" role="alert">
            <p className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error.message}</span>
            </p>
            {error.retryable && message.channel === 'text' && (
              <Button size="sm" variant="secondary" className="mt-3" onClick={() => onRetry(message)} icon={<RefreshCw className="size-4" aria-hidden="true" />}>
                {strings.retry}
              </Button>
            )}
          </div>
        )}

        {spoken && !reply && (
          <div className="rounded-2xl rounded-tl-md bg-surface px-4 py-3 text-sm leading-relaxed text-ink">
            <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-ink-muted">
              <Bot className="size-3" aria-hidden="true" />
              {strings.spokenByAgent}
            </span>
            <p className="whitespace-pre-wrap">{spoken}</p>
          </div>
        )}

        {reply && (
          <div className="rounded-2xl rounded-tl-md bg-surface px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-2">
              {message.channel === 'voice' && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-ink-muted">
                  <AudioLines className="size-3" aria-hidden="true" />
                  {strings.spokenTurn}
                </span>
              )}
              {reply.meta?.provider === 'mock' && (
                <Badge tone={reply.meta.fallbackReason ? 'warning' : 'neutral'} title={reply.meta.fallbackReason ?? strings.demoAdvisorTitle}>
                  {reply.meta.fallbackReason ? strings.fallbackAdvisor : strings.demoAdvisor}
                </Badge>
              )}
              {reply.meta?.provider === 'gemini' && (
                <Badge tone="brand" title={reply.meta.model ?? undefined}>
                  {strings.gemini}
                </Badge>
              )}
            </div>
            <AnswerText text={reply.answer} className={cn(reply.meta && 'mt-2')} />

            {reply.summary && reply.summary.trim() !== reply.answer.trim() && (
              <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900 ring-1 ring-inset ring-brand-100">
                <span className="mr-1.5 text-[11px] font-semibold tracking-wide text-brand-700 uppercase">{strings.headline}</span>
                <span className="font-medium">{reply.summary}</span>
              </p>
            )}

            {reply.risks.length > 0 && (
              <section className="mt-4" aria-label={strings.risks}>
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {strings.risks}
                </h3>
                <ul className="mt-2 space-y-2">
                  {reply.risks.map((risk, i) => (
                    <li key={i} className="rounded-lg bg-panel px-3 py-2 ring-1 ring-ink/5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{risk.title}</p>
                        <Badge tone={SEVERITY_TONE[risk.severity]}>{risk.severity}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-secondary">{risk.explanation}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {reply.proposedActions.length > 0 && (
              <section className="mt-4" aria-label={strings.actions}>
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                  <ListChecks className="size-3.5" aria-hidden="true" />
                  {strings.actions}
                </h3>
                <p className="mt-0.5 text-xs text-ink-muted">{strings.actionsHint}</p>
                <ul className="mt-2 space-y-2">
                  {reply.proposedActions.map((action, i) => {
                    const key = actionKey(message.id, i);
                    return (
                      <RecommendationCard
                        key={key}
                        action={action}
                        index={i}
                        status={statuses[key] ?? 'open'}
                        strings={strings}
                        language={language}
                        onAdd={() => onAddTask(message, i)}
                        onDismiss={() => onDismiss(key)}
                        onUndo={() => onUndo(key)}
                      />
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Plain-text answers with light structure: numbered lines become a list, blank lines paragraphs. */
function AnswerText({ text, className }: { text: string; className?: string }) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  const blocks: Array<{ kind: 'p'; text: string } | { kind: 'ol'; items: string[] } | { kind: 'ul'; items: string[] }> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const ordered = /^\d+[.)]\s+/.test(line);
    const bullet = /^[-•]\s+/.test(line);
    const last = blocks[blocks.length - 1];
    if (ordered) {
      const item = line.replace(/^\d+[.)]\s+/, '');
      if (last?.kind === 'ol') last.items.push(item);
      else blocks.push({ kind: 'ol', items: [item] });
    } else if (bullet) {
      const item = line.replace(/^[-•]\s+/, '');
      if (last?.kind === 'ul') last.items.push(item);
      else blocks.push({ kind: 'ul', items: [item] });
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  return (
    <div className={cn('space-y-2 text-sm leading-relaxed text-ink', className)}>
      {blocks.map((block, i) =>
        block.kind === 'p' ? (
          <p key={i}>{block.text}</p>
        ) : block.kind === 'ol' ? (
          <ol key={i} className="list-decimal space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
