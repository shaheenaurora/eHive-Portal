import type { ReactNode } from "react";

/** Shared centered dark layout for the standalone auth screens
 *  (login, forgot/reset password, email verification). */
export function AuthShell({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--eh-ink)", padding: "1rem" }}>
      <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
        <img src="/assets/ehive-wordmark.png" alt="eHive"
             style={{ height: 44, width: "auto", margin: "0 auto 1rem", display: "block" }} />
        <h1 className="eh-serif" style={{ color: "#f5efe2", fontSize: "1.35rem", fontWeight: 600, margin: "0 0 .4rem" }}>
          {title}
        </h1>
        {sub && <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 1.6rem" }}>{sub}</p>}
        {children}
      </div>
    </div>
  );
}
