type Level = 'info' | 'warn' | 'error';

function write(level: Level, scope: string, message: string, meta?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const extra = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(line + extra);
}

export function createLogger(scope: string) {
  return {
    info: (message: string, meta?: Record<string, unknown>) => write('info', scope, message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => write('warn', scope, message, meta),
    error: (message: string, meta?: Record<string, unknown>) => write('error', scope, message, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
