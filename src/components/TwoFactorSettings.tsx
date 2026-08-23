import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { QrCode } from "@/components/QrCode";
import { toast } from "@/components/eh";

function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/** Enrol / manage TOTP two-factor authentication. Strongly recommended for
 *  admins; available to every member. */
export function TwoFactorSettings() {
  const status = trpc.auth.twoFactorStatus.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const refresh = () => utils.auth.twoFactorStatus.invalidate();

  const [setup, setSetup] = useState<{
    otpauthUri: string;
  } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [code, setCode] = useState("");

  const begin = trpc.auth.twoFactorSetup.useMutation({
    onSuccess: d => setSetup(d),
    onError: e => toast(e.message),
  });
  const enable = trpc.auth.twoFactorEnable.useMutation({
    onSuccess: () => {
      toast("Two-factor authentication is on.");
      setSetup(null);
      setShowSecret(false);
      setCode("");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const disable = trpc.auth.twoFactorDisable.useMutation({
    onSuccess: () => {
      toast("Two-factor authentication turned off.");
      setCode("");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const enabled = status.data?.enabled;

  return (
    <div className="eh-card">
      <div className="eh-between" style={{ marginBottom: ".4rem" }}>
        <h3 style={{ margin: 0 }}>Two-factor authentication</h3>
        <span className={"eh-pill " + (enabled ? "green" : "grey")}>
          {enabled ? "On" : "Off"}
        </span>
      </div>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Add a one-time code from an authenticator app (Google Authenticator,
        Authy, 1Password) on top of your password. Strongly recommended —
        especially for admins.
      </p>

      {/* Enabled → allow disabling with a current code */}
      {enabled && (
        <div
          className="eh-row"
          style={{ alignItems: "flex-end", gap: ".6rem" }}
        >
          <input
            className="eh-input"
            style={{ maxWidth: 160 }}
            inputMode="numeric"
            placeholder="Current code"
            value={code}
            onChange={e => setCode(e.target.value)}
          />
          <button
            className="eh-btn ghost sm danger"
            disabled={disable.isPending || code.length < 6}
            onClick={() => disable.mutate({ code })}
          >
            Turn off
          </button>
        </div>
      )}

      {/* Not enabled, not mid-setup → start */}
      {!enabled && !setup && (
        <button
          className="eh-btn gold"
          disabled={begin.isPending}
          onClick={() => begin.mutate()}
        >
          {begin.isPending ? "Preparing…" : "Set up two-factor"}
        </button>
      )}

      {/* Mid-setup → show QR + confirm */}
      {!enabled && setup && (
        <div>
          <p className="eh-sm">1. Scan this with your authenticator app:</p>
          <div style={{ margin: ".4rem 0 .8rem" }}>
            <QrCode
              value={setup.otpauthUri}
              size={190}
              alt="Two-factor authentication setup QR code"
            />
          </div>
          {secretFromUri(setup.otpauthUri) && (
            <div className="eh-sm eh-muted" style={{ marginBottom: ".8rem" }}>
              Can&apos;t scan?{" "}
              <button
                type="button"
                className="eh-btn ghost sm"
                style={{ padding: 0, height: "auto" }}
                onClick={() => setShowSecret(s => !s)}
              >
                {showSecret ? "Hide setup key" : "Show setup key"}
              </button>
              {showSecret && (
                <>
                  <br />
                  <code
                    style={{
                      wordBreak: "break-all",
                      background: "var(--eh-paper)",
                      padding: ".15rem .35rem",
                      borderRadius: 4,
                    }}
                  >
                    {secretFromUri(setup.otpauthUri)}
                  </code>{" "}
                  <button
                    type="button"
                    className="eh-btn ghost sm"
                    style={{ padding: 0, height: "auto" }}
                    onClick={() => {
                      navigator.clipboard
                        .writeText(secretFromUri(setup.otpauthUri) || "")
                        .then(() => toast("Setup key copied."))
                        .catch(() => toast("Could not copy."));
                    }}
                  >
                    Copy
                  </button>
                </>
              )}
            </div>
          )}
          <p className="eh-sm">2. Enter the 6-digit code it shows:</p>
          <div
            className="eh-row"
            style={{ alignItems: "flex-end", gap: ".6rem", marginTop: ".3rem" }}
          >
            <input
              className="eh-input"
              style={{ maxWidth: 160 }}
              inputMode="numeric"
              placeholder="123 456"
              value={code}
              onChange={e => setCode(e.target.value)}
              autoFocus
            />
            <button
              className="eh-btn gold sm"
              disabled={enable.isPending || code.length < 6}
              onClick={() => enable.mutate({ code })}
            >
              Confirm &amp; turn on
            </button>
            <button
              className="eh-btn ghost sm"
              onClick={() => {
                setSetup(null);
                setShowSecret(false);
                setCode("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
