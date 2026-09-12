import { Send } from 'lucide-react';
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn.ts';
import type { AdvisorStrings } from '../../lib/advisor/strings.ts';
import { Button } from '../ui/Button.tsx';

const MAX_CHARS = 2000;

interface ComposerProps {
  strings: AdvisorStrings;
  placeholder: string;
  pending: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
}

/** Enter sends, Shift+Enter adds a line. Length matches the BFF's limit so nothing is rejected late. */
export function Composer({ strings, placeholder, pending, disabled = false, onSend }: ComposerProps) {
  const id = useId();
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const canSend = trimmed.length > 0 && !pending && !disabled;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setText('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const rows = Math.min(5, Math.max(1, text.split('\n').length));

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-line bg-panel p-3 sm:p-4">
      <label htmlFor={id} className="sr-only">
        {strings.placeholder}
      </label>
      <textarea
        id={id}
        value={text}
        rows={rows}
        maxLength={MAX_CHARS}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        className={cn(
          'min-h-11 flex-1 resize-none rounded-xl bg-surface px-4 py-2.5 text-sm leading-relaxed text-ink ring-1 ring-inset ring-line placeholder:text-ink-muted',
          'transition-shadow focus:bg-panel focus:ring-2 focus:ring-brand-500 focus:outline-hidden disabled:opacity-60',
        )}
      />
      <Button type="submit" disabled={!canSend} loading={pending} icon={<Send className="size-4" aria-hidden="true" />} aria-label={strings.send}>
        <span className="hidden sm:inline">{pending ? strings.sending : strings.send}</span>
      </Button>
    </form>
  );
}
