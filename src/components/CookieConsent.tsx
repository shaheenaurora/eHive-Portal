import { useState } from "react";

const KEY = "eh_cookie_consent";

/**
 * PDPL/GDPR cookie-consent surface. Essential cookies (the session) always run;
 * this gates any *non-essential* analytics/marketing scripts, which should only
 * load after `eh_cookie_consent === "all"`. The choice is persisted locally.
 */
function storedChoice(): string | null {
  try { return localStorage.getItem(KEY); } catch { return "essential"; }
}

export function CookieConsent() {
  // SPA (no SSR): read the stored choice lazily on first render — no effect needed.
  const [choice, setChoice] = useState<string | null>(() => storedChoice());

  if (choice) return null; // already decided

  const decide = (value: "all" | "essential") => {
    try { localStorage.setItem(KEY, value); } catch { /* private mode */ }
    setChoice(value);
    if (value === "all") window.dispatchEvent(new CustomEvent("eh-consent-granted"));
  };

  return (
    <div role="dialog" aria-label="Cookie preferences" style={{
      position: "fixed", left: "1rem", right: "1rem", bottom: "1rem", zIndex: 90,
      maxWidth: 640, margin: "0 auto", background: "var(--eh-card, #fff)",
      border: "1px solid var(--eh-line, #e4ddd0)", borderRadius: 14,
      boxShadow: "0 18px 50px rgba(16,29,44,.28)", padding: "1.1rem 1.25rem",
      display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap",
    }}>
      <p style={{ margin: 0, fontSize: ".86rem", color: "var(--eh-ink-3, #33465e)", flex: "1 1 260px", lineHeight: 1.55 }}>
        We use essential cookies to run your session, and — only with your consent — analytics to
        improve eHive. You can change this anytime. See our{" "}
        <a href="/privacy.html" style={{ color: "var(--eh-gold, #b8862e)" }}>Privacy Policy</a>.
      </p>
      <div style={{ display: "flex", gap: ".5rem", flexShrink: 0 }}>
        <button onClick={() => decide("essential")} style={{
          background: "transparent", color: "var(--eh-ink, #101d2c)",
          border: "1px solid var(--eh-line, #e4ddd0)", borderRadius: 9,
          padding: ".5rem .9rem", fontSize: ".82rem", fontWeight: 600, cursor: "pointer",
        }}>Essential only</button>
        <button onClick={() => decide("all")} style={{
          background: "var(--eh-gold, #b8862e)", color: "#fff", border: "none", borderRadius: 9,
          padding: ".5rem .9rem", fontSize: ".82rem", fontWeight: 600, cursor: "pointer",
        }}>Accept all</button>
      </div>
    </div>
  );
}
