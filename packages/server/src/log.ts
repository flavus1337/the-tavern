type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const MIN_LEVEL: Level = (process.env['LOG_LEVEL'] as Level | undefined) ?? 'info';

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function format(level: Level, msg: string): string {
  return `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${msg}`;
}

export const log = {
  debug(msg: string): void {
    if (shouldLog('debug')) process.stdout.write(format('debug', msg) + '\n');
  },
  info(msg: string): void {
    if (shouldLog('info')) process.stdout.write(format('info', msg) + '\n');
  },
  warn(msg: string): void {
    if (shouldLog('warn')) process.stderr.write(format('warn', msg) + '\n');
  },
  error(msg: string): void {
    if (shouldLog('error')) process.stderr.write(format('error', msg) + '\n');
  },
};
