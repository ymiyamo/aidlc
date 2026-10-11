/**
 * 構造化ログ（JSON 1 行）。個人情報や秘密の項目名は、値を伏せる（NFR3.14、NFR4.13）。
 * パスワード、メールアドレス、ログイン状態の値、メモ、料理の URL を出さない。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

const REDACT_KEYS = [
  'password',
  'passwordDigest',
  'password_digest',
  'email',
  'cookie',
  'set-cookie',
  'authorization',
  'session',
  'sessionToken',
  'token',
  'csrf',
  'memo',
  'url',
  'displayName',
  'display_name',
];
const REDACT_SET = new Set(REDACT_KEYS.map((k) => k.toLowerCase()));
export const REDACTED = '[伏せ字]';

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name };
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_SET.has(k.toLowerCase()) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
  base: LogFields = {},
): Logger {
  const emit = (level: LogLevel, msg: string, fields: LogFields = {}) => {
    write(
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        msg,
        ...(redact(base) as LogFields),
        ...(redact(fields) as LogFields),
      }),
    );
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

/** 何も出さないログ（テスト用） */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};
