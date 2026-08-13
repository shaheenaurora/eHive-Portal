/**
 * Minimal HTML helper for public payloads.
 *
 * Insight bodies are authored by admins and the server-rendered article page
 * treats them as plain text — it HTML-escapes the body before inserting it. The
 * public JSON APIs, however, historically returned the raw `body`, so any
 * marketing-site client that injected it as innerHTML could execute injected
 * scripts/handlers. escapeHtml applies the same escaping the SSR page uses, so
 * the value is inert whether a consumer renders it as text or innerHTML.
 */

/** Escape the HTML-significant characters in a string (matches the SSR page). */
export function escapeHtml(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
