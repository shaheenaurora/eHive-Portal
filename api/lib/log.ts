import { maskEmail } from "./audit";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE =
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

/** Redact email addresses and phone-like numbers from a string. */
function redact(s: string): string {
  return s
    .replace(EMAIL_RE, m => maskEmail(m))
    .replace(PHONE_RE, "[phone-redacted]");
}

/** Scrub one log argument: strings are redacted, Errors keep their type but
 *  have the message redacted, and other values are stringified/redacted so we
 *  never accidentally dump a raw user object into the logs. */
export function scrub(arg: unknown): unknown {
  if (typeof arg === "string") return redact(arg);
  if (arg instanceof Error) {
    const next = new Error(redact(arg.message));
    next.name = arg.name;
    next.stack = arg.stack;
    return next;
  }
  if (arg && typeof arg === "object") {
    try {
      return redact(JSON.stringify(arg));
    } catch {
      return "[object-redacted]";
    }
  }
  return arg;
}

type LogLevel = "debug" | "info" | "warn" | "error";

/** Build a structured log entry. In production we emit a single JSON line so
 *  log aggregators can index level, service, correlation id and message without
 *  parsing free-form text. In development we pretty-print for readability. */
function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const entry = {
    time: new Date().toISOString(),
    level,
    service: "ehive-portal",
    msg: redact(message),
    ...meta,
  };
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    const color =
      level === "error" ? "\x1b[31m"
      : level === "warn" ? "\x1b[33m"
      : level === "debug" ? "\x1b[90m"
      : "\x1b[36m";
    const extra = meta && Object.keys(meta).length ? JSON.stringify(meta, null, 2) : "";
    // eslint-disable-next-line no-console
    console.log(`${color}[${level.toUpperCase()}]\x1b[0m ${entry.msg}${extra ? " " + extra : ""}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }
}

/** Structured logger with PII redaction. Use this in preference to raw
 *  console.* so logs are consistent and searchable in production. */
export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => write("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write("error", msg, meta),
};

/** Install PII-redacting wrappers around the global console methods.
 *  Call once at process startup, before other modules emit logs. */
export function installLogScrubber(): void {
  if ((console as unknown as { __ehiveScrubbed?: boolean }).__ehiveScrubbed)
    return;
  const originals = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...args: unknown[]) => originals.log(...args.map(scrub));
  console.warn = (...args: unknown[]) => originals.warn(...args.map(scrub));
  console.error = (...args: unknown[]) => originals.error(...args.map(scrub));
  (console as unknown as { __ehiveScrubbed?: boolean }).__ehiveScrubbed = true;
}
