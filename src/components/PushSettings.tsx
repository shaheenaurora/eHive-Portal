import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { PUSH_CATEGORIES } from "@contracts/constants";
import {
  pushSupported,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { toast } from "@/components/eh";

/** Member-facing push notification opt-in with per-category control (UX-10). */
export function PushSettings() {
  const utils = trpc.useUtils();
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();

  const keyQ = trpc.engage.pushKey.useQuery(undefined, {
    retry: false,
    enabled: supported,
  });
  const catQ = trpc.engage.pushCategories.useQuery(
    { endpoint: endpoint ?? "" },
    { enabled: !!endpoint, retry: false }
  );
  const subscribe = trpc.engage.pushSubscribe.useMutation();
  const setCats = trpc.engage.setPushCategories.useMutation();
  const unsub = trpc.engage.pushUnsubscribe.useMutation();

  useEffect(() => {
    if (!supported) return;
    getExistingSubscription()
      .then(s => setEndpoint(s?.endpoint ?? null))
      .catch(() => {});
  }, [supported]);

  if (!supported) {
    return (
      <div className="eh-card">
        <h3>Notifications</h3>
        <p className="eh-sm eh-muted">
          This device or browser doesn't support push notifications.
        </p>
      </div>
    );
  }

  const enabled = !!endpoint;
  const cats: string[] =
    catQ.data?.categories ?? PUSH_CATEGORIES.map(c => c.key);

  async function enable() {
    if (!keyQ.data) return;
    setBusy(true);
    try {
      const sub = await subscribeToPush(keyQ.data);
      if (!sub) {
        toast(
          "Permission denied — allow notifications in your browser settings."
        );
        return;
      }
      await subscribe.mutateAsync(sub);
      setEndpoint(sub.endpoint);
      toast("Notifications are on for this device.");
    } catch {
      toast("Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const ep = await unsubscribeFromPush();
      if (ep) await unsub.mutateAsync({ endpoint: ep });
      setEndpoint(null);
      toast("Notifications turned off on this device.");
    } catch {
      toast("Could not turn off notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: string) {
    if (!endpoint) return;
    const next = cats.includes(key)
      ? cats.filter(c => c !== key)
      : [...cats, key];
    await setCats.mutateAsync({ endpoint, categories: next });
    utils.engage.pushCategories.invalidate({ endpoint });
  }

  return (
    <div className="eh-card">
      <h3>Notifications</h3>
      {!enabled ? (
        <>
          <p className="eh-sm eh-muted">
            Session reminders, event nudges, waitlist promotions and renewal
            alerts — on this device.
          </p>
          <button
            className="eh-btn gold"
            disabled={busy || keyQ.isLoading}
            onClick={enable}
          >
            {busy ? "Enabling…" : "Enable notifications"}
          </button>
        </>
      ) : (
        <>
          <p className="eh-sm eh-muted">
            On for this device. Choose what you'd like to be notified about:
          </p>
          <div className="eh-list">
            {PUSH_CATEGORIES.map(c => (
              <label className="row" key={c.key} style={{ cursor: "pointer" }}>
                <span className="t">{c.label}</span>
                <input
                  type="checkbox"
                  checked={cats.includes(c.key)}
                  onChange={() => toggle(c.key)}
                  style={{ accentColor: "#b8862e", width: 18, height: 18 }}
                />
              </label>
            ))}
          </div>
          <button
            className="eh-btn ghost sm"
            disabled={busy}
            onClick={disable}
            style={{ marginTop: ".5rem" }}
          >
            Turn off on this device
          </button>
        </>
      )}
    </div>
  );
}
