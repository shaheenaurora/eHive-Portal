import { useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = trpc.auth.resetPassword.useMutation({
    onSuccess: () => {
      setDone(true);
      setTimeout(() => navigate("/login"), 2200);
    },
    onError: e => setErr(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password !== confirm) {
      setErr("The two passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters.");
      return;
    }
    reset.mutate({ token, password });
  }

  if (!token) {
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
            Reset link needed
          </h1>
          <p
            style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}
          >
            This page needs a valid reset link from your email.
          </p>
          <p
            style={{
              marginTop: ".4rem",
              fontSize: ".85rem",
              textAlign: "center",
            }}
          >
            <a href="/forgot-password" style={{ color: "var(--eh-gold-2)" }}>
              Request a new reset link →
            </a>
          </p>
        </div>
      </div>
    );
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
          Choose a new password
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          {done
            ? "Your password has been reset."
            : "Pick a strong password you don't use elsewhere."}
        </p>

        {done ? (
          <p
            style={{
              color: "#c4cdd8",
              fontSize: ".92rem",
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            Your password has been reset. Taking you to sign in…
          </p>
        ) : (
          <form
            onSubmit={submit}
            style={{ display: "grid", gap: ".7rem", textAlign: "left" }}
          >
            <label style={{ display: "grid", gap: ".25rem" }}>
              <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                New password
              </span>
              <input
                className="eh-input"
                type="password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                aria-invalid={err ? "true" : undefined}
                aria-describedby={err ? "reset-error" : undefined}
              />
            </label>
            <label style={{ display: "grid", gap: ".25rem" }}>
              <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                Confirm new password
              </span>
              <input
                className="eh-input"
                type="password"
                placeholder="Re-enter your new password"
                autoComplete="new-password"
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                aria-invalid={err ? "true" : undefined}
                aria-describedby={err ? "reset-error" : undefined}
              />
            </label>
            {err && (
              <p
                id="reset-error"
                role="alert"
                style={{ color: "#f0a8a0", fontSize: ".82rem", margin: 0 }}
              >
                {err}
              </p>
            )}
            <button
              className="eh-btn gold"
              style={{ width: "100%", padding: ".8rem" }}
              disabled={reset.isPending}
            >
              {reset.isPending ? "Saving…" : "Set new password →"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
