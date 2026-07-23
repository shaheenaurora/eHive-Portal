/* Shared formatting helpers for the portal */
export function fmtDate(d?: string | Date | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(d?: string | Date | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return (
    t.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) +
    " · " +
    t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
}

export function fmtDay(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

export function relDay(d?: string | Date | null): string {
  if (!d) return "—";
  const t = new Date(d);
  const now = new Date();
  const diff = Math.round((t.getTime() - now.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 30) return `In ${diff} days`;
  if (diff < -1 && diff > -30) return `${-diff} days ago`;
  return fmtDate(t);
}
