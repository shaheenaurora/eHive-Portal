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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /* Set after a successful registration so we can show a "verify your email"
     interstitial instead of silently dropping the brand-new user into the
     portal before they've been told to check their inbox. */
  const [justRegistered, setJustRegistered] = useState(false);

  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  /* Live password-requirement checks (mirror server policy in
     api/lib/password.ts) so feedback is instant rather than one rule per
     round-trip. */
  const pwdChecks = [
    { label: "At least 8 characters", ok: password.length >= 8 },
    { label: "An uppercase letter", ok: /[A-Z]/.test(password) },
    { label: "A lowercase letter", ok: /[a-z]/.test(password) },
    { label: "A number", ok: /[0-9]/.test(password) },
    { label: "A special character", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const passwordValid = pwdChecks.every(c => c.ok);
  const passwordsMatch =
    confirmPassword.length > 0 && confirmPassword === password;

  const onDone = async () => {
    await utils.auth.me.invalidate();
    navigate(PORTAL_PATH);
  };

  const login = trpc.auth.login.useMutation({
    onSuccess: r => {
      if (r.needs2fa) setChallenge(r.challenge);
      else onDone();
    },
    onError: e => setErr(e.message),
  });
  const verify2fa = trpc.auth.loginVerify2fa.useMutation({
    onSuccess: onDone,
    onError: e => setErr(e.message),
  });
  const register = trpc.auth.register.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      setJustRegistered(true);
    },
    onError: e => setErr(e.message),
  });
  const resend = trpc.auth.resendVerification.useMutation({
    onError: e => setErr(e.message),
  });
  const pending = login.isPending || register.isPending || verify2fa.isPending;

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (challenge) {
      verify2fa.mutate({ challenge, code });
      return;
    }
    if (mode === "login") {
      login.mutate({ email, password });
      return;
    }
    if (!passwordValid) {
      setErr("Your password doesn't meet all the requirements below.");
      return;
    }
    if (confirmPassword !== password) {
      setErr("Passwords don't match — re-enter the confirmation.");
      return;
    }
    if (!consent) {
      setErr(
        "Please accept the Privacy Policy and Terms to create an account."
      );
      return;
    }
    register.mutate({ name, email, password, consent: true });
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
          Circle
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          {justRegistered && !challenge
            ? "One last step — verify your email address."
            : challenge
              ? "Enter the 6-digit code from your authenticator app."
              : mode === "login"
                ? "Sign in to your member portal — pods, events, Hive Score and more."
                : "Create your account to join the eHive Circle member portal."}
        </p>

        {justRegistered && !challenge ? (
          <div
            style={{
              display: "grid",
              gap: ".8rem",
              textAlign: "left",
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(184,134,46,.35)",
              borderRadius: 12,
              padding: "1.2rem",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "#8fd0ae",
                fontWeight: 600,
                fontSize: "1rem",
              }}
            >
              ✓ Account created
            </p>
            <p style={{ margin: 0, color: "#c4cdd8", fontSize: ".88rem" }}>
              We&apos;ve sent a verification link to{" "}
              <strong style={{ color: "#f5efe2" }}>{email}</strong>. Please
              check your inbox (and spam folder) and click the link to verify
              your email — you can explore the portal in the meantime.
            </p>
            <div style={{ display: "grid", gap: ".5rem" }}>
              <button
                type="button"
                className="eh-btn gold"
                style={{ width: "100%", padding: ".7rem" }}
                onClick={() => navigate(PORTAL_PATH)}
              >
                Continue to the portal →
              </button>
              <button
                type="button"
                className="eh-btn ghost sm"
                style={{ width: "100%" }}
                disabled={resend.isPending || resend.isSuccess}
                onClick={() => resend.mutate()}
              >
                {resend.isPending
                  ? "Sending…"
                  : resend.isSuccess
                    ? "Verification email re-sent ✓"
                    : "Resend verification email"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setJustRegistered(false);
                setMode("login");
              }}
              style={{
                background: "none",
                border: "none",
                color: "#9aa7b6",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
                fontSize: ".82rem",
                textAlign: "left",
              }}
            >
              Already verified? Sign in →
            </button>
          </div>
        ) : (
          <form
            onSubmit={submit}
            style={{ display: "grid", gap: ".7rem", textAlign: "left" }}
          >
            {challenge ? (
              <label style={{ display: "grid", gap: ".25rem" }}>
                <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                  Authenticator code
                </span>
                <input
                  className="eh-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123 456"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  autoFocus
                  required
                  aria-invalid={err ? "true" : undefined}
                  aria-describedby={err ? "login-error" : undefined}
                  style={{
                    textAlign: "center",
                    letterSpacing: ".3em",
                    fontSize: "1.1rem",
                  }}
                />
              </label>
            ) : (
              <>
                {mode === "register" && (
                  <label style={{ display: "grid", gap: ".25rem" }}>
                    <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                      Full name
                    </span>
                    <input
                      className="eh-input"
                      placeholder="Full name"
                      autoComplete="name"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      required
                      aria-invalid={err ? "true" : undefined}
                    />
                  </label>
                )}
                <label style={{ display: "grid", gap: ".25rem" }}>
                  <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                    Email
                  </span>
                  <input
                    className="eh-input"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    aria-invalid={err ? "true" : undefined}
                  />
                </label>
                <label style={{ display: "grid", gap: ".25rem" }}>
                  <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                    Password
                  </span>
                  <div style={{ display: "flex", gap: ".5rem" }}>
                    <input
                      className="eh-input"
                      type={showPassword ? "text" : "password"}
                      placeholder={
                        mode === "register"
                          ? "At least 8 characters"
                          : "Password"
                      }
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      minLength={8}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                      aria-invalid={err ? "true" : undefined}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="eh-btn ghost sm"
                      onClick={() => setShowPassword(v => !v)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                  </div>
                </label>

                {mode === "register" && (
                  <>
                    <label style={{ display: "grid", gap: ".25rem" }}>
                      <span style={{ fontSize: ".8rem", color: "#c4cdd8" }}>
                        Confirm password
                      </span>
                      <input
                        className="eh-input"
                        type={showPassword ? "text" : "password"}
                        placeholder="Re-enter your password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        required
                        aria-invalid={
                          confirmPassword.length > 0 && !passwordsMatch
                            ? "true"
                            : undefined
                        }
                        aria-describedby="pwd-hint"
                      />
                    </label>

                    <div
                      id="pwd-hint"
                      style={{
                        display: "grid",
                        gap: ".2rem",
                        padding: ".6rem .75rem",
                        background: "rgba(255,255,255,.04)",
                        borderRadius: 8,
                        fontSize: ".76rem",
                        color: "#9aa7b6",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#c4cdd8" }}>
                        Your password needs:
                      </span>
                      {pwdChecks.map(c => (
                        <span
                          key={c.label}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: ".4rem",
                            color: c.ok ? "#8fd0ae" : undefined,
                          }}
                        >
                          <span aria-hidden="true">{c.ok ? "✓" : "○"}</span>
                          {c.label}
                        </span>
                      ))}
                      {confirmPassword.length > 0 && (
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: ".4rem",
                            color: passwordsMatch ? "#8fd0ae" : "#f0a8a0",
                          }}
                        >
                          <span aria-hidden="true">
                            {passwordsMatch ? "✓" : "✕"}
                          </span>
                          {passwordsMatch
                            ? "Passwords match"
                            : "Passwords don't match yet"}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </>
            )}

            {mode === "register" && !challenge && (
              <label
                style={{
                  display: "flex",
                  gap: ".55rem",
                  alignItems: "flex-start",
                  fontSize: ".8rem",
                  color: "#c4cdd8",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={e => setConsent(e.target.checked)}
                  style={{
                    marginTop: ".15rem",
                    accentColor: "#b8862e",
                    flex: "0 0 auto",
                  }}
                />
                <span>
                  I agree to the{" "}
                  <a
                    href="/privacy.html"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--eh-gold-2)" }}
                  >
                    Privacy Policy
                  </a>{" "}
                  and{" "}
                  <a
                    href="/terms.html"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--eh-gold-2)" }}
                  >
                    Terms
                  </a>
                  , and consent to eHive processing my data to run my
                  membership.
                </span>
              </label>
            )}

            {err && (
              <p
                id="login-error"
                role="alert"
                style={{ color: "#f0a8a0", fontSize: ".82rem", margin: 0 }}
              >
                {err}
              </p>
            )}

            <button
              className="eh-btn gold"
              style={{ width: "100%", padding: ".8rem", fontSize: ".95rem" }}
              disabled={pending}
            >
              {pending
                ? "Please wait…"
                : challenge
                  ? "Verify code →"
                  : mode === "login"
                    ? "Sign in →"
                    : "Create account →"}
            </button>
          </form>
        )}

        {challenge && (
          <p style={{ marginTop: "1.2rem", fontSize: ".82rem" }}>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode("");
                setErr(null);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#9aa7b6",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              ← Back to sign in
            </button>
          </p>
        )}

        {mode === "login" && !challenge && (
          <p style={{ marginTop: ".9rem", fontSize: ".82rem" }}>
            <a href="/forgot-password" style={{ color: "#9aa7b6" }}>
              Forgot your password?
            </a>
          </p>
        )}

        {!challenge && !justRegistered && (
          <div
            role="tablist"
            aria-label="Authentication mode"
            style={{
              marginTop: "1.2rem",
              display: "flex",
              justifyContent: "center",
              gap: ".5rem",
              fontSize: ".82rem",
              color: "#9aa7b6",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "login"}
              onClick={() => {
                setErr(null);
                setMode("login");
              }}
              style={{
                background: mode === "login" ? "rgba(184,134,46,0.15)" : "none",
                border: "none",
                color: mode === "login" ? "var(--eh-gold-2)" : "#9aa7b6",
                cursor: "pointer",
                padding: ".35rem .7rem",
                borderRadius: 6,
                font: "inherit",
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "register"}
              onClick={() => {
                setErr(null);
                setMode("register");
              }}
              style={{
                background:
                  mode === "register" ? "rgba(184,134,46,0.15)" : "none",
                border: "none",
                color: mode === "register" ? "var(--eh-gold-2)" : "#9aa7b6",
                cursor: "pointer",
                padding: ".35rem .7rem",
                borderRadius: 6,
                font: "inherit",
              }}
            >
              Create an account
            </button>
          </div>
        )}

        <p style={{ marginTop: "1.4rem", fontSize: ".78rem" }}>
          <a href="/" style={{ color: "#b9c4d1" }}>
            ← Back to the website
          </a>
        </p>
      </div>
    </div>
  );
}
