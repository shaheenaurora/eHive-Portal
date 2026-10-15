import { useEffect, useState } from "react";
import { isInstallable, onInstallChange, promptInstall } from "@/lib/install";

/** Shows a one-tap "Install eHive" banner when the browser offers installation. */
export function InstallPrompt() {
  const [canInstall, setCanInstall] = useState(isInstallable());
  const [hidden, setHidden] = useState(
    () => localStorage.getItem("eh-install-dismissed") === "1"
  );

  useEffect(
    () => onInstallChange(() => setCanInstall(isInstallable())),
    []
  );

  if (!canInstall || hidden) return null;

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
        onClick={() => void promptInstall()}
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
