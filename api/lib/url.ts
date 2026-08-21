import { z } from "zod";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function isSafeUrl(value: string): boolean {
  if (!value) return true;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Relative URLs are not allowed for externally-facing links because they
    // are often used for file downloads / integrations and must be absolute.
    return false;
  }
  return ALLOWED_SCHEMES.has(parsed.protocol);
}

/**
 * Zod schema for user-supplied URLs stored in the database and rendered into
 * pages. Allows http, https and mailto only to block javascript: and data:
 * injection vectors.
 */
export const safeUrl = z
  .string()
  .max(512)
  .optional()
  .refine(value => value === undefined || value === "" || isSafeUrl(value), {
    message: "URL must use http, https or mailto scheme",
  });

/**
 * Same validator as a plain function for non-Zod call sites.
 */
export function assertSafeUrl(value: string | null | undefined): void {
  if (value && !isSafeUrl(value)) {
    throw new Error(`Unsafe URL scheme: ${value}`);
  }
}
