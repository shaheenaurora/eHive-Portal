import { randomBytes } from "node:crypto";

export type IcsAttendee = { name?: string | null; email: string };
export type IcsOrganizer = { name?: string | null; email: string };

function formatUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  const head = line.slice(0, 75);
  let tail = line.slice(75);
  out.push(head);
  while (tail.length) {
    const chunk = tail.slice(0, 74);
    tail = tail.slice(74);
    out.push(" " + chunk);
  }
  return out.join("\r\n");
}

function buildLine(name: string, value: string): string {
  return foldLine(`${name}:${icsEscape(value)}`);
}

export function generateIcs(opts: {
  title: string;
  start: Date;
  durationMin: number;
  location?: string | null;
  description?: string | null;
  organizer?: IcsOrganizer | null;
  attendee?: IcsAttendee | null;
}): Buffer {
  const end = new Date(opts.start.getTime() + opts.durationMin * 60 * 1000);
  const uid = `${Date.now()}-${randomBytes(8).toString("hex")}@ehiveglobal.com`;
  const now = new Date();

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//eHive//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    buildLine("UID", uid),
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(opts.start)}`,
    `DTEND:${formatUtc(end)}`,
    buildLine("SUMMARY", opts.title),
  ];

  if (opts.description) {
    lines.push(buildLine("DESCRIPTION", opts.description));
  }
  if (opts.location) {
    lines.push(buildLine("LOCATION", opts.location));
  }
  if (opts.organizer) {
    const cn = opts.organizer.name
      ? `;CN=${icsEscape(opts.organizer.name)}`
      : "";
    lines.push(foldLine(`ORGANIZER${cn}:mailto:${opts.organizer.email}`));
  }
  if (opts.attendee) {
    const cn = opts.attendee.name ? `;CN=${icsEscape(opts.attendee.name)}` : "";
    lines.push(
      foldLine(
        `ATTENDEE${cn};ROLE=REQ-PARTICIPANT:mailto:${opts.attendee.email}`
      )
    );
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return Buffer.from(lines.join("\r\n") + "\r\n", "utf-8");
}

/** Build Google Calendar / Outlook web compose links for the same event. */
export function calendarLinks(opts: {
  title: string;
  start: Date;
  durationMin: number;
  location?: string | null;
  description?: string | null;
}): { google: string; outlook: string } {
  const end = new Date(opts.start.getTime() + opts.durationMin * 60 * 1000);
  const fmt = (d: Date) => formatUtc(d).replace(/Z$/, "Z");
  const dates = `${fmt(opts.start)}/${fmt(end)}`;
  const text = encodeURIComponent(opts.title);
  const details = encodeURIComponent(opts.description ?? "");
  const location = encodeURIComponent(opts.location ?? "");
  const google = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${dates}&details=${details}&location=${location}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${text}&startdt=${encodeURIComponent(fmt(opts.start))}&enddt=${encodeURIComponent(fmt(end))}&body=${details}&location=${location}`;
  return { google, outlook };
}
