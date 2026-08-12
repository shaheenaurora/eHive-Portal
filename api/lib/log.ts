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
