import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** Renders a value as a scannable QR code image (eHive navy on white). */
export function QrCode({
  value,
  size = 240,
  alt,
}: {
  value: string;
  size?: number;
  alt?: string;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1A1A2E", light: "#ffffff" },
    })
      .then(url => {
        if (alive) setSrc(url);
      })
      .catch(() => {
        /* ignore render errors */
      });
    return () => {
      alive = false;
    };
  }, [value, size]);

  return src ? (
    <img
      src={src}
      width={size}
      height={size}
      alt={alt ?? "QR code"}
      style={{ borderRadius: 10, display: "block" }}
    />
  ) : (
    <div
      style={{
        width: size,
        height: size,
        background: "#f3efe6",
        borderRadius: 10,
      }}
    />
  );
}
