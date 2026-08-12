import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Top-level error boundary so one page's render error degrades to a branded
 * recovery panel instead of white-screening the whole SPA.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for logging/observability; safe no-op if none configured.
    console.error("Unhandled UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--eh-ink, #101d2c)",
          padding: "1.5rem",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 440 }}>
          <img
            src="/assets/ehive-wordmark.png"
            alt="eHive"
            style={{
              height: 40,
              width: "auto",
              margin: "0 auto 1.4rem",
              display: "block",
            }}
          />
          <h1
            style={{
              fontFamily: "Fraunces, Georgia, serif",
              color: "#f5efe2",
              fontSize: "1.5rem",
              fontWeight: 600,
              margin: "0 0 .6rem",
            }}
          >
            Something went wrong on this page
          </h1>
          <p
            style={{
              color: "#9aa7b6",
              fontSize: ".95rem",
              margin: "0 0 1.6rem",
              lineHeight: 1.6,
            }}
          >
            The rest of eHive is fine — this screen just hit an unexpected
            error. Reloading usually fixes it. If it keeps happening, please let
            us know.
          </p>
          <div
            style={{
              display: "flex",
              gap: ".7rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#b8862e",
                color: "#fff",
                border: "none",
                borderRadius: 9,
                padding: ".7rem 1.3rem",
                fontSize: ".92rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload the page
            </button>
            <a
              href="/portal"
              style={{
                background: "transparent",
                color: "#c9d2dd",
                border: "1px solid rgba(255,255,255,.24)",
                borderRadius: 9,
                padding: ".7rem 1.3rem",
                fontSize: ".92rem",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Back to portal
            </a>
          </div>
        </div>
      </div>
    );
  }
}
