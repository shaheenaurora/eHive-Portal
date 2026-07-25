import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

/**
 * Live camera QR scanner for the event door. Calls onScan with the decoded
 * text; a per-code cooldown prevents one physical scan firing repeat check-ins.
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
        (decoded) => {
          const now = Date.now();
          const prev = lastRef.current;
          // Ignore the same code within 3s so one scan = one check-in.
          if (decoded === prev.code && now - prev.at < 3000) return;
          lastRef.current = { code: decoded, at: now };
          onScan(decoded.trim());
        },
        () => { /* per-frame decode miss — normal, ignore */ },
      )
      .then(() => { started = true; })
      .catch((e) => onError?.(e instanceof Error ? e.message : String(e)));

    return () => {
      if (started) {
        scanner.stop().then(() => scanner.clear()).catch(() => { /* already stopped */ });
      }
    };
  }, [onScan, onError]);

  return (
    <div
      ref={mountRef}
      style={{ width: "100%", maxWidth: 320, margin: "0 auto", borderRadius: 12, overflow: "hidden", background: "#000" }}
    />
  );
}
