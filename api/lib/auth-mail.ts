import { sendMail, mailEnabled } from "./mailer";

const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );

function shell(bodyHtml: string): string {
  return `<div style="margin:0;padding:24px;background:#faf7f1;font-family:Inter,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #efe9dd;border-radius:14px;overflow:hidden">
      <div style="background:#101d2c;padding:18px 24px">
        <span style="color:#f5efe2;font-family:Georgia,serif;font-size:18px;font-weight:600">eHive</span>
        <span style="color:#9aa7b6;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-left:8px">Circle</span>
      </div>
      <div style="padding:26px 24px">${bodyHtml}</div>
      <div style="padding:16px 24px;border-top:1px solid #efe9dd;color:#8a97a6;font-size:12px">
        If you didn't request this, you can safely ignore this email.
      </div>
    </div>
  </div>`;
}

function button(href: string, label: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:#b8862e;color:#fff;text-decoration:none;
    font-weight:600;padding:.7rem 1.4rem;border-radius:9px;font-size:15px">${esc(label)}</a>`;
}

/** True if outbound email is configured (so callers can decide whether to
 *  surface the token another way in non-configured environments). */
export const authMailEnabled = mailEnabled;

export async function sendVerifyEmail(
  to: string,
  name: string,
  link: string
): Promise<boolean> {
  const first = name?.split(" ")[0] || "there";
  return sendMail({
    to,
    subject: "Confirm your email — eHive Circle",
    html: shell(`
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">Welcome, ${esc(first)}.</h1>
      <p style="margin:0 0 20px;color:#33465e;font-size:15px;line-height:1.55">Please confirm this is your email address to activate your eHive Circle account. This link expires in 24 hours.</p>
      <p style="margin:0 0 20px">${button(link, "Confirm my email →")}</p>
      <p style="margin:0;color:#8a97a6;font-size:13px;word-break:break-all">Or paste this link into your browser:<br/>${esc(link)}</p>
    `),
  });
}

export async function sendResetEmail(
  to: string,
  name: string,
  link: string
): Promise<boolean> {
  const first = name?.split(" ")[0] || "there";
  return sendMail({
    to,
    subject: "Reset your password — eHive Circle",
    html: shell(`
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">Reset your password</h1>
      <p style="margin:0 0 20px;color:#33465e;font-size:15px;line-height:1.55">Hi ${esc(first)} — we received a request to reset your eHive Circle password. This link expires in 1 hour and can be used once.</p>
      <p style="margin:0 0 20px">${button(link, "Choose a new password →")}</p>
      <p style="margin:0;color:#8a97a6;font-size:13px;word-break:break-all">Or paste this link into your browser:<br/>${esc(link)}</p>
    `),
  });
}

export async function sendPasswordChangedEmail(input: {
  email: string;
  name: string | null;
}): Promise<boolean> {
  const first = input.name?.split(" ")[0] || "there";
  return sendMail({
    to: input.email,
    subject: "Your eHive password was changed",
    html: shell(`
      <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:22px;color:#101d2c;font-weight:600">Password changed</h1>
      <p style="margin:0;color:#33465e;font-size:15px;line-height:1.55">Hi ${esc(first)}, your eHive Circle password was just changed. If this was you, no action is needed. If you didn't make this change, contact us immediately.</p>
    `),
  });
}
