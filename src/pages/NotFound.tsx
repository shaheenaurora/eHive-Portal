import { Link } from "react-router";

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--eh-paper)",
        padding: "1rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          className="eh-hex"
          style={{ width: 46, height: 46, fontSize: 18, margin: "0 auto 1rem" }}
        >
          ⬡
        </div>
        <h1
          className="eh-serif"
          style={{
            fontSize: "1.6rem",
            margin: "0 0 .4rem",
            color: "var(--eh-ink)",
          }}
        >
          This page flew the hive.
        </h1>
        <p className="eh-muted" style={{ margin: "0 0 1.4rem" }}>
          The page you were looking for doesn't exist.
        </p>
        <div
          style={{
            display: "flex",
            gap: ".75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link className="eh-btn" to="/portal">
            Back to the portal →
          </Link>
          <a className="eh-btn ghost" href="/index.html">
            Marketing home
          </a>
        </div>
      </div>
    </div>
  );
}
