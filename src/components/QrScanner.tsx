import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

/**
 * Live camera QR scanner for the event door. Calls onScan with the decoded
 * text; a per-code cooldown prevents one physical scan firing repeat check-ins.
 * Surfaces loading and permission-denied states so users know what's happening.
 */
export function QrScanner({
  onScan,
  onError,
}: {
  onScan: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [phase, setPhase] = useState<"loading" | "active" | "denied" | "error">(
    "loading"
  );
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const id = "qr-scan-" + Math.random().toString(36).slice(2);
    el.id = id;
    const scanner = new Html5Qrcode(id, { verbose: false });
    let started = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        decoded => {
          const now = Date.now();
          const prev = lastRef.current;
          // Ignore the same code within 3s so one scan = one check-in.
          if (decoded === prev.code && now - prev.at < 3000) return;
          lastRef.current = { code: decoded, at: now };
          onScan(decoded.trim());
        },
        () => {
          /* per-frame decode miss — normal, ignore */
        }
      )
      .then(() => {
        started = true;
        setPhase("active");
      })
      .catch(e => {
        const msg = e instanceof Error ? e.message : String(e);
        if (/permission|not allowed|access/i.test(msg)) {
          setPhase("denied");
        } else {
          setPhase("error");
        }
        setMessage(msg);
        onError?.(msg);
      });

    return () => {
      if (started) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {
            /* already stopped */
          });
      }
    };
  }, [onScan, onError]);

  const boxStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: 320,
    margin: "0 auto",
    borderRadius: 12,
    overflow: "hidden",
    background: "#000",
    minHeight: 240,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    textAlign: "center",
    padding: "1rem",
  };

  if (phase === "loading") {
    return (
      <div style={boxStyle} role="status" aria-live="polite">
        Starting camera…
      </div>
    );
  }
  if (phase === "denied") {
    return (
      <div style={boxStyle} role="alert">
        <div>
          <b>Camera access denied</b>
          <p style={{ margin: ".5rem 0 0", fontSize: ".9rem", opacity: 0.85 }}>
            Allow camera access in your browser settings to scan QR codes.
          </p>
        </div>
      </div>
    );
  }
  if (phase === "error") {
    return (
      <div style={boxStyle} role="alert">
        <div>
          <b>Camera unavailable</b>
          <p style={{ margin: ".5rem 0 0", fontSize: ".9rem", opacity: 0.85 }}>
            {message}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      style={{
        width: "100%",
        maxWidth: 320,
        margin: "0 auto",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
      }}
    />
  );
}
