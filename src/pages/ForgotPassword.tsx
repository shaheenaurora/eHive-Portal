import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const req = trpc.auth.requestPasswordReset.useMutation({
    onSuccess: () => setSent(true),
    onError: () => setSent(false),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    req.mutate({ email });
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--eh-ink)",
        padding: "1rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
        <img
          src="/assets/ehive-wordmark.png"
          alt="eHive"
          style={{
            height: 44,
            width: "auto",
            margin: "0 auto 1rem",
            display: "block",
          }}
        />
        <h1
          className="eh-serif"
          style={{
            color: "#f5efe2",
            fontSize: "1.35rem",
            fontWeight: 600,
            margin: "0 0 .4rem",
          }}
        >
          Reset your password
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          {sent
            ? "If an account exists, a reset link is on its way."
            : "Enter your account email and we'll send you a link to set a new password."}
        </p>

        {sent ? (
          <p
            style={{
              color: "#c4cdd8",
              fontSize: ".92rem",
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            If an account exists for <b style={{ color: "#f0ead9" }}>{email}</b>
            , a reset link is on its way. Check your inbox (and spam) — the link
            expires in an hour.
          </p>
        ) : (
          <form
            onSubmit={submit}
            style={{ display: "grid", gap: ".7rem", textAlign: "left" }}
          >
            <label style={{ display: "grid", gap: ".25rem" }}>
              <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>Email</span>
              <input
                className="eh-input"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </label>
            <button
              className="eh-btn gold"
              style={{ width: "100%", padding: ".8rem" }}
              disabled={req.isPending}
            >
              {req.isPending ? "Sending…" : "Send reset link →"}
            </button>
          </form>
        )}

        <p
          style={{
            marginTop: "1.2rem",
            fontSize: ".82rem",
            textAlign: "center",
          }}
        >
          <a href="/login" style={{ color: "var(--eh-gold-2)" }}>
            ← Back to sign in
          </a>
        </p>
      </div>
    </div>
  );
}
