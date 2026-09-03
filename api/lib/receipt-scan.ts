import { env } from "./env";
import { logger } from "./log";

const ALLOWED_MAGIC = [
  { mime: "application/pdf", prefix: Buffer.from("%PDF") },
  { mime: "image/jpeg", prefix: Buffer.from([0xff, 0xd8, 0xff]) },
  {
    mime: "image/png",
    prefix: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    mime: "image/webp",
    prefix: Buffer.from("RIFF"),
    offset: 8,
    extra: Buffer.from("WEBP"),
  },
];

function looksSafe(buffer: Buffer): boolean {
  return ALLOWED_MAGIC.some(m => {
    if (!buffer.slice(0, m.prefix.length).equals(m.prefix)) return false;
    if (m.offset && m.extra) {
      return buffer.slice(m.offset, m.offset + m.extra.length).equals(m.extra);
    }
    return true;
  });
}

export type ReceiptScanResult =
  { ok: true; clean: true } | { ok: false; reason: string };

/** Lightweight receipt safety pass. Verifies the declared data URL is a genuine
 *  PDF or image by magic bytes. When CLAMAV_URL is configured, submits the
 *  decoded bytes to a ClamAV REST endpoint and rejects infected uploads.
 *  Otherwise it logs a placeholder and allows the upload. */
export async function scanReceipt(
  dataUrl: string,
  name?: string
): Promise<ReceiptScanResult> {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return { ok: false, reason: "Invalid receipt data URL." };
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length === 0) return { ok: false, reason: "Empty receipt file." };
  if (buffer.length > 6_000_000)
    return { ok: false, reason: "Receipt exceeds size limit." };

  if (!looksSafe(buffer)) {
    return {
      ok: false,
      reason: "Receipt file type does not match its contents.",
    };
  }

  if (env.clamavUrl) {
    try {
      const url = env.clamavUrl.replace(/\/$/, "") + "/v2/scan";
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          ...(env.clamavToken
            ? { Authorization: `Bearer ${env.clamavToken}` }
            : {}),
        },
        body: buffer,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        success: boolean;
        infected?: boolean;
        result?: string;
      };
      if (!json.success || json.infected) {
        return {
          ok: false,
          reason: json.result || "Receipt failed malware scan.",
        };
      }
    } catch (err) {
      logger.error("[receipt-scan] ClamAV scan failed", {
        error: String(err),
        name,
      });
      return {
        ok: false,
        reason: "Receipt could not be scanned. Try again or contact support.",
      };
    }
  } else {
    logger.info("[receipt-scan] no AV configured; magic-byte check passed", {
      name,
    });
  }

  return { ok: true, clean: true };
}
