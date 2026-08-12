import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Shows a one-tap "Install eHive" banner when the browser offers installation. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(
    () => localStorage.getItem("eh-install-dismissed") === "1"
  );

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!evt || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    localStorage.setItem("eh-install-dismissed", "1");
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: 16,
        right: 16,
        maxWidth: 420,
        margin: "0 auto",
        zIndex: 60,
        background: "var(--eh-ink)",
        color: "#f3e9d2",
        borderRadius: 12,
        padding: ".85rem 1rem",
        boxShadow: "0 10px 34px rgba(0,0,0,.32)",
        display: "flex",
        gap: ".8rem",
        alignItems: "center",
      }}
    >
      <img
        src="/assets/icon-192.png"
        width={40}
        height={40}
        style={{ borderRadius: 9 }}
        alt=""
      />
      <div style={{ flex: 1, fontSize: ".85rem", lineHeight: 1.3 }}>
        <b>Install eHive</b>
        <div style={{ color: "#9aa7b6" }}>
          Add the portal to your home screen.
        </div>
      </div>
      <button
        className="eh-btn gold sm"
        onClick={async () => {
          await evt.prompt();
          await evt.userChoice;
          setEvt(null);
        }}
      >
        Install
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          background: "none",
          border: "none",
          color: "#9aa7b6",
          cursor: "pointer",
          fontSize: "1.3rem",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
