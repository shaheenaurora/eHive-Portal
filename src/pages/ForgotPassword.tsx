import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import { AuthShell } from "@/components/AuthShell";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const req = trpc.auth.requestPasswordReset.useMutation({ onSuccess: () => setSent(true) });

  function submit(e: FormEvent) {
    e.preventDefault();
    req.mutate({ email });
  }

  return (
    <AuthShell title="Reset your password"
      sub={sent ? "" : "Enter your account email and we'll send you a link to set a new password."}>
      {sent ? (
        <p style={{ color: "#c4cdd8", fontSize: ".92rem", lineHeight: 1.6, textAlign: "center" }}>
          If an account exists for <b style={{ color: "#f0ead9" }}>{email}</b>, a reset link is on its way.
          Check your inbox (and spam) — the link expires in an hour.
        </p>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: ".7rem", textAlign: "left" }}>
          <input className="eh-input" type="email" placeholder="Email" autoComplete="email"
                 value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="eh-btn gold" style={{ width: "100%", padding: ".8rem" }} disabled={req.isPending}>
            {req.isPending ? "Sending…" : "Send reset link →"}
          </button>
        </form>
      )}
      <p style={{ marginTop: "1.2rem", fontSize: ".82rem", textAlign: "center" }}>
        <a href="/login" style={{ color: "var(--eh-gold-2)" }}>← Back to sign in</a>
      </p>
    </AuthShell>
  );
}
