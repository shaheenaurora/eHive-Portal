function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--eh-ink)", padding: "1rem" }}>
      <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
        <div className="eh-hex" style={{ width: 54, height: 54, fontSize: 22, margin: "0 auto 1.2rem" }}>⬡</div>
        <h1 className="eh-serif" style={{ color: "#f5efe2", fontSize: "1.8rem", fontWeight: 600, margin: "0 0 .4rem" }}>
          eHive Circle
        </h1>
        <p style={{ color: "#9aa7b6", fontSize: ".9rem", margin: "0 0 2rem" }}>
          The member portal — pods, events, Hive Score, library and your membership, one sign-in away.
        </p>
        <button
          className="eh-btn gold"
          style={{ width: "100%", padding: ".8rem", fontSize: ".95rem" }}
          onClick={() => (window.location.href = getOAuthUrl())}
        >
          Sign in with Kimi →
        </button>
        <p style={{ marginTop: "1.6rem", fontSize: ".78rem" }}>
          <a href="/" style={{ color: "#b9c4d1" }}>← Back to the website</a>
        </p>
      </div>
    </div>
  );
}
