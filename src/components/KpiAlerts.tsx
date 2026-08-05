import { trpc } from "@/providers/trpc";
import { Pill, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

/** Banner of active KPI threshold alerts (full-admin cockpits only). Renders
 *  nothing when there's nothing breached. */
export function KpiAlertsBanner() {
  const utils = trpc.useUtils();
  const q = trpc.admin.kpiAlerts.useQuery(undefined, { retry: false });
  const ack = trpc.admin.acknowledgeKpiAlert.useMutation({
    onSuccess: () => { toast("Acknowledged."); utils.admin.kpiAlerts.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const evalNow = trpc.admin.evaluateKpiAlerts.useMutation({
    onSuccess: (r) => { toast(`Checked — ${r.opened} new, ${r.resolved} cleared.`); utils.admin.kpiAlerts.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="eh-card eh-mb" style={{ borderColor: "#e5c0b9", background: "#fdf3f1" }}>
      <div className="eh-between" style={{ marginBottom: ".5rem", flexWrap: "wrap", gap: ".5rem" }}>
        <div className="eh-eyebrow" style={{ color: "var(--eh-red, #b23a2e)" }}>KPI alerts · {rows.length} active</div>
        <button className="eh-btn ghost sm" disabled={evalNow.isPending} onClick={() => evalNow.mutate()}>{evalNow.isPending ? "Checking…" : "Re-check now"}</button>
      </div>
      <div className="eh-list">
        {rows.map((a) => (
          <div className="row" key={a.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="t">{a.message}</div>
              <div className="d eh-muted">Raised {fmtDate(a.createdAt)}{a.status === "acknowledged" && a.acknowledgedByEmail ? ` · acknowledged by ${a.acknowledgedByEmail}` : ""}</div>
            </div>
            {a.status === "open"
              ? <button className="eh-btn ghost sm" disabled={ack.isPending} onClick={() => ack.mutate({ id: a.id })}>Acknowledge</button>
              : <Pill color="gold">acknowledged</Pill>}
          </div>
        ))}
      </div>
    </div>
  );
}
