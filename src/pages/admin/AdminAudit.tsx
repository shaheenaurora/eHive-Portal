import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  RefCode,
  toast,
} from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";
import { auditEntityType } from "@contracts/ids";

const ACTION_TONE: Record<string, "green" | "red" | "gold" | "blue"> = {
  approve: "green",
  grant: "green",
  reject: "red",
  revoked: "red",
};
function toneFor(action: string): "green" | "red" | "gold" | "blue" {
  for (const k of Object.keys(ACTION_TONE))
    if (action.includes(k)) return ACTION_TONE[k];
  return "blue";
}

export default function AdminAudit() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filters = {
    limit: 300,
    actor: actor || undefined,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
  };
  const q = trpc.admin.auditTrail.useQuery(filters, { retry: false });
  const utils = trpc.useUtils();

  const exportCsv = async () => {
    try {
      const { filename, csv } = await utils.admin.auditTrailCsv.fetch(filters);
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed.");
    }
  };

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Accountability"
        title="Admin audit trail"
        sub="An append-only record of privileged actions — approvals, member changes, Zenith decisions, data-request completions and access grants. Nothing here can be edited or deleted."
      />

      <div
        className="eh-row eh-mb"
        style={{ gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}
      >
        <input
          className="eh-input sm"
          placeholder="Filter by actor email…"
          value={actor}
          onChange={e => setActor(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <input
          className="eh-input sm"
          placeholder="Filter by action…"
          value={action}
          onChange={e => setAction(e.target.value)}
          style={{ maxWidth: 180 }}
        />
        <input
          className="eh-input sm"
          type="date"
          aria-label="From date"
          value={from}
          max={to || undefined}
          onChange={e => setFrom(e.target.value)}
        />
        <input
          className="eh-input sm"
          type="date"
          aria-label="To date"
          value={to}
          min={from || undefined}
          onChange={e => setTo(e.target.value)}
        />
        {(actor || action || from || to) && (
          <button
            className="eh-btn ghost sm"
            onClick={() => {
              setActor("");
              setAction("");
              setFrom("");
              setTo("");
            }}
          >
            Clear
          </button>
        )}
        <button
          className="eh-btn ghost sm"
          style={{ marginLeft: "auto" }}
          disabled={!q.data || q.data.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>

      {q.isLoading && <Spinner />}
      {q.isError && (
        <div className="eh-card">
          <Empty
            big="Couldn't load the audit trail."
            p="There was a problem reaching the server."
          />
          <div style={{ textAlign: "center" }}>
            <button className="eh-btn ghost" onClick={() => q.refetch()}>
              Try again
            </button>
          </div>
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No admin actions logged yet."
            p="Privileged actions will appear here as your team uses the admin portal."
          />
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map(r => (
                <tr key={r.id}>
                  <td
                    className="eh-sm eh-muted"
                    data-label="When"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {fmtDateTime(r.createdAt)}
                  </td>
                  <td className="eh-sm" data-label="Who">
                    <b>{r.actorEmail ?? "—"}</b>
                  </td>
                  <td data-label="Action">
                    <Pill color={toneFor(r.action)}>{r.action}</Pill>
                  </td>
                  <td className="eh-sm eh-muted" data-label="Target">
                    {(() => {
                      const et = auditEntityType(r.targetType);
                      const idNum = Number(r.targetId);
                      if (et && r.targetId && Number.isInteger(idNum))
                        return <RefCode type={et} id={idNum} />;
                      return r.targetType
                        ? `${r.targetType} ${r.targetId ?? ""}`
                        : "—";
                    })()}
                  </td>
                  <td className="eh-sm" data-label="Detail">
                    {r.detail ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EhShell>
  );
}
