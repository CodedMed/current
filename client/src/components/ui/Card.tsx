import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn.ts';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className, padded = true, children, ...rest }: CardProps) {
  return (
    <div className={cn('rounded-2xl bg-panel shadow-card ring-1 ring-ink/5', padded && 'p-6 sm:p-7', className)} {...rest}>
      {children}
    </div>
  );
}
