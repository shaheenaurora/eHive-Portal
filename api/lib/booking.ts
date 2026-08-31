/**
 * Pure helpers for the public booking calendar. All times are Gulf Standard
 * Time (UTC+4) and the backend stores UTC timestamps.
 */

export const BOOKING_SLOTS = ["09:00", "11:00", "14:00", "16:00"] as const;
export const DEFAULT_TIMEZONE = "Asia/Dubai";
const GST_OFFSET = "+04:00";

export function productDurationMin(product: string): number {
  switch (product) {
    case "clarity-sprint":
      return 180;
    case "strategy-sprint":
      return 480;
    case "gapnavigator":
    case "brand-3d":
      return 60;
    case "opsblueprint":
    case "momentum90":
      return 45;
    case "setup":
    case "discovery":
    default:
      return 30;
  }
}

export function toGstTimestamp(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${GST_OFFSET}`);
}

export function formatGstDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: DEFAULT_TIMEZONE,
  });
}

export function formatGstTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_TIMEZONE,
  });
}

function isWeekend(dateStr: string): boolean {
  // Use a noon GST timestamp so UTC day matches GST day.
  const d = new Date(`${dateStr}T12:00:00${GST_OFFSET}`);
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export type ExistingSlot = {
  scheduledAt: Date;
  durationMin: number;
  status: string;
};

/**
 * Build the availability grid for a date range. A slot is unavailable if it
 * falls on a weekend or overlaps an existing non-cancelled appointment.
 * `durationMin` is the length of the product being booked, so a long session
 * (e.g. 480 min) correctly blocks overlapping slots.
 */
export function generateAvailability(
  existing: ExistingSlot[],
  fromDate: string,
  toDate: string,
  durationMin = 60
): { date: string; time: string; available: boolean }[] {
  const results: { date: string; time: string; available: boolean }[] = [];
  const start = new Date(`${fromDate}T00:00:00${GST_OFFSET}`);
  const end = new Date(`${toDate}T23:59:59${GST_OFFSET}`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toLocaleDateString("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
    });
    if (isWeekend(dateStr)) continue;
    for (const time of BOOKING_SLOTS) {
      const slotStart = toGstTimestamp(dateStr, time);
      const slotEnd = new Date(slotStart.getTime() + durationMin * 60 * 1000);
      const taken = existing.some(appt => {
        if (appt.status === "cancelled") return false;
        const aStart = new Date(appt.scheduledAt);
        const aEnd = new Date(
          aStart.getTime() + (appt.durationMin || 60) * 60 * 1000
        );
        return aStart < slotEnd && slotStart < aEnd;
      });
      results.push({
        date: dateStr,
        time,
        available: !taken,
      });
    }
  }
  return results;
}

/**
 * Validate that a requested slot is a weekday and does not overlap an existing
 * non-cancelled appointment.
 */
export function isSlotAvailable(
  existing: ExistingSlot[],
  date: string,
  time: string,
  durationMin: number
): boolean {
  if (isWeekend(date)) return false;
  const slotStart = toGstTimestamp(date, time);
  const slotEnd = new Date(slotStart.getTime() + durationMin * 60 * 1000);
  return !existing.some(appt => {
    if (appt.status === "cancelled") return false;
    const aStart = new Date(appt.scheduledAt);
    const aEnd = new Date(
      aStart.getTime() + (appt.durationMin || 60) * 60 * 1000
    );
    return aStart < slotEnd && slotStart < aEnd;
  });
}
