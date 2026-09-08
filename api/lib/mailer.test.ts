import { describe, it, expect, vi, afterEach } from "vitest";

/* ZeptoMail payload-shape test: guards the { email_address } wrapper that the
   API requires for recipient objects — a bare { address } in reply_to is
   rejected with "Mandatory Field missing" (seen in production). */

const originalEnv = { ...process.env };

async function loadMailer() {
  vi.resetModules();
  process.env.ZEPTOMAIL_TOKEN = "test-token";
  process.env.MAIL_FROM = "hello@example.com";
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  return import("./mailer");
}

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("sendMailDetailed via ZeptoMail", () => {
  it("wraps reply_to in the email_address object ZeptoMail requires", async () => {
    const mailer = await loadMailer();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "OK" }), { status: 201 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const r = await mailer.sendMailDetailed({
      to: "visitor@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
      replyTo: "owner@example.com",
    });

    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(payload.reply_to).toEqual([
      { email_address: { address: "owner@example.com" } },
    ]);
    // `to` uses the same wrapper shape.
    expect(payload.to).toEqual([
      { email_address: { address: "visitor@example.com" } },
    ]);
  });

  it("omits reply_to entirely when not set", async () => {
    const mailer = await loadMailer();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "OK" }), { status: 201 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const r = await mailer.sendMailDetailed({
      to: "visitor@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(r.ok).toBe(true);
    const payload = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(payload).not.toHaveProperty("reply_to");
  });

  it("base64-encodes ICS attachments for the Zepto attachments field", async () => {
    const mailer = await loadMailer();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "OK" }), { status: 201 })
      );
    vi.stubGlobal("fetch", fetchMock);

    const r = await mailer.sendMailDetailed({
      to: "visitor@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
      attachments: [
        {
          filename: "invite.ics",
          content: Buffer.from("BEGIN:VCALENDAR"),
          contentType: "text/calendar",
        },
      ],
    });

    expect(r.ok).toBe(true);
    const payload = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(payload.attachments).toEqual([
      {
        file_name: "invite.ics",
        file_type: "text/calendar",
        file_cache: Buffer.from("BEGIN:VCALENDAR").toString("base64"),
      },
    ]);
  });
});
