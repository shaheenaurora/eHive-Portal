import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { PORTAL_PATH } from "@/const";

type Mode = "login" | "register";

export default function Login() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onDone = async () => {
    await utils.auth.me.invalidate();
    navigate(PORTAL_PATH);
  };

  const login = trpc.auth.login.useMutation({ onSuccess: onDone, onError: (e) => setErr(e.message) });
  const register = trpc.auth.register.useMutation({ onSuccess: onDone, onError: (e) => setErr(e.message) });
  const pending = login.isPending || register.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === "login") { login.mutate({ email, password }); return; }
    if (!consent) { setErr("Please accept the Privacy Policy and Terms to create an account."); return; }
    register.mutate({ name, email, password });
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--eh-ink)", padding: "1rem" }}>
      <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
        <img src="/assets/ehive-wordmark.png" alt="eHive" style={{ height: 44, width: "auto", margin: "0 auto 1rem", display: "block" }} />
        <h1 className="eh-serif" style={{ color: "#f5efe2", fontSize: "1.35rem", fontWeight: 600, margin: "0 0 .4rem" }}>
          Circle
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          {mode === "login"
            ? "Sign in to your member portal — pods, events, Hive Score and more."
            : "Create your account to join the eHive Circle member portal."}
        </p>

        <form onSubmit={submit} style={{ display: "grid", gap: ".7rem", textAlign: "left" }}>
          {mode === "register" && (
            <input
              className="eh-input"
              placeholder="Full name"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="eh-input"
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="eh-input"
            type="password"
            placeholder={mode === "register" ? "Password (min 8 characters)" : "Password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {mode === "register" && (
            <label style={{ display: "flex", gap: ".55rem", alignItems: "flex-start", fontSize: ".8rem", color: "#c4cdd8", cursor: "pointer" }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                     style={{ marginTop: ".15rem", accentColor: "#b8862e", flex: "0 0 auto" }} />
              <span>
                I agree to the{" "}
                <a href="/privacy.html" target="_blank" rel="noreferrer" style={{ color: "var(--eh-gold-2)" }}>Privacy Policy</a>{" "}and{" "}
                <a href="/terms.html" target="_blank" rel="noreferrer" style={{ color: "var(--eh-gold-2)" }}>Terms</a>, and consent to eHive processing my data to run my membership.
              </span>
            </label>
          )}

          {err && (
            <p style={{ color: "#f0a8a0", fontSize: ".82rem", margin: 0 }}>{err}</p>
          )}

          <button className="eh-btn gold" style={{ width: "100%", padding: ".8rem", fontSize: ".95rem" }} disabled={pending}>
            {pending ? "Please wait…" : mode === "login" ? "Sign in →" : "Create account →"}
          </button>
        </form>

        {mode === "login" && (
          <p style={{ marginTop: ".9rem", fontSize: ".82rem" }}>
            <a href="/forgot-password" style={{ color: "#9aa7b6" }}>Forgot your password?</a>
          </p>
        )}

        <p style={{ marginTop: "1.2rem", fontSize: ".82rem", color: "#9aa7b6" }}>
          {mode === "login" ? "New to eHive?" : "Already have an account?"}{" "}
          <button
            type="button"
            onClick={() => { setErr(null); setMode(mode === "login" ? "register" : "login"); }}
            style={{ background: "none", border: "none", color: "var(--eh-gold-2)", cursor: "pointer", padding: 0, font: "inherit" }}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>

        <p style={{ marginTop: "1.4rem", fontSize: ".78rem" }}>
          <a href="/" style={{ color: "#b9c4d1" }}>← Back to the website</a>
        </p>
      </div>
    </div>
  );
}
