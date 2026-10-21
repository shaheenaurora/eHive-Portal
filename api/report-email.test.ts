import { describe, it, expect, vi, beforeEach } from "vitest";

/* The report email flow: the submitter gets a SHORT summary with the designed
 * PDF attached (generated client-side, uploaded via /api/report/upload-pdf),
 * not the detailed in-line results the generic lead confirmation carries.
 * Mail transport is mocked — these tests assert content + routing decisions. */

const sent: Array<{
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}> = [];

vi.mock("./lib/mailer", () => ({
  mailEnabled: () => true,
  sendMailDetailed: vi.fn(async (input: (typeof sent)[number]) => {
    sent.push(input);
    return { ok: true };
  }),
  sendMail: vi.fn(async () => true),
  mailProvider: () => "zeptomail",
  mailHealth: () => ({ consecutiveFails: 0 }),
  verifyMailTransport: async () => ({ ok: true }),
  mailStatus: () => ({}),
  sendTestEmail: async () => ({ ok: true }),
}));

import { sendReportSummary } from "./lib/report-mail";
import { notifyLead } from "./lib/lead-mail";

beforeEach(() => {
  sent.length = 0;
});

describe("sendReportSummary", () => {
  const base = {
    tool: "brand-check",
    email: "founder@example.com",
    name: "Amina Founder",
    total: 52,
    band: "Blending In",
    weakestDimLabel: "Metrics & ROI Visibility",
    productLabel: "Clarity Sprint™",
    token: "1.999.sig",
  };
  const tinyPdf = Buffer.from("%PDF-1.7 tiny").toString("base64");

  it("sends a short summary with the PDF attached", async () => {
    const r = await sendReportSummary({ ...base, pdfBase64: tinyPdf });
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail.to).toBe("founder@example.com");
    expect(mail.subject).toBe("Your eHive Brand Check report");
    expect(mail.html).toContain("Hi Amina");
    expect(mail.html).toContain("52/100");
    expect(mail.html).toContain("Blending In");
    expect(mail.html).toContain("Metrics &amp; ROI Visibility");
    expect(mail.html).toContain("Clarity Sprint™");
    expect(mail.html).not.toContain("<table");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments![0].filename).toBe("ehive-brand-check-report.pdf");
    expect(mail.attachments![0].contentType).toBe("application/pdf");
    expect(
      mail.attachments![0].content.toString("latin1").startsWith("%PDF")
    ).toBe(true);
  });

  it("sends without an attachment when no PDF was uploaded, and keeps the link", async () => {
    const r = await sendReportSummary({ ...base, pdfBase64: null });
    expect(r.ok).toBe(true);
    expect(sent[0].attachments ?? []).toHaveLength(0);
    expect(sent[0].html).toContain("?report=1.999.sig");
  });
});

describe("notifyLead submitter-copy suppression", () => {
  it("skips the detailed confirmation for engine report submissions (sections)", async () => {
    const r = await notifyLead({
      form: "brand-check",
      email: "lead@example.com",
      payload: { name: "Lead", sections: [{ title: "T", items: [] }] },
      sourcePage: "/brand-check.html",
    });
    // No notify inbox is configured in the test env, so ownerSent is false —
    // what matters: the detailed confirmation was suppressed and NOTHING went
    // to the lead (the report flow emails them the summary + PDF instead).
    expect(r.confirmSent).toBe(false);
    expect(sent.some(m => m.to === "lead@example.com")).toBe(false);
  });

  it("skips for clarity-scorecard engine payloads (domains)", async () => {
    await notifyLead({
      form: "clarity-scorecard",
      email: "lead2@example.com",
      payload: { domains: [{ key: "Finance", raw: 4, pct: 40 }] },
      sourcePage: "/clarity-scorecard.html",
    });
    expect(sent.some(m => m.to === "lead2@example.com")).toBe(false);
  });

  it("still confirms plain brand-check posts and other forms", async () => {
    const plain = await notifyLead({
      form: "brand-check",
      email: "plain@example.com",
      payload: { name: "Plain", message: "hi" },
      sourcePage: "/contact.html",
    });
    expect(plain.confirmSent).toBe(true);
    const contact = await notifyLead({
      form: "contact",
      email: "c@example.com",
      payload: { name: "C" },
      sourcePage: "/contact.html",
    });
    expect(contact.confirmSent).toBe(true);
  });
});
