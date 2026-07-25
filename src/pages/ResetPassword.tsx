import { useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { AuthShell } from "@/components/AuthShell";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: () => { setDone(true); setTimeout(() => navigate("/login"), 2200); },
    onError: (e) => setErr(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) { setErr("The two passwords don't match."); return; }
    reset.mutate({ token, password });
  }

  if (!token) {
    return (
      <AuthShell title="Reset link needed" sub="This page needs a valid reset link from your email.">
        <p style={{ marginTop: ".4rem", fontSize: ".85rem", textAlign: "center" }}>
          <a href="/forgot-password" style={{ color: "var(--eh-gold-2)" }}>Request a new reset link →</a>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" sub={done ? "" : "Pick a strong password you don't use elsewhere."}>
      {done ? (
        <p style={{ color: "#c4cdd8", fontSize: ".92rem", lineHeight: 1.6, textAlign: "center" }}>
          Your password has been reset. Taking you to sign in…
        </p>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: ".7rem", textAlign: "left" }}>
          <input className="eh-input" type="password" placeholder="New password (min 8 characters)"
                 autoComplete="new-password" minLength={8} value={password}
                 onChange={(e) => setPassword(e.target.value)} required />
          <input className="eh-input" type="password" placeholder="Confirm new password"
                 autoComplete="new-password" minLength={8} value={confirm}
                 onChange={(e) => setConfirm(e.target.value)} required />
          {err && <p style={{ color: "#f0a8a0", fontSize: ".82rem", margin: 0 }}>{err}</p>}
          <button className="eh-btn gold" style={{ width: "100%", padding: ".8rem" }} disabled={reset.isPending}>
            {reset.isPending ? "Saving…" : "Set new password →"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
