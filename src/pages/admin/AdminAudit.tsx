import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner } from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";

const ACTION_TONE: Record<string, "green" | "red" | "gold" | "blue"> = {
  approve: "green", grant: "green", reject: "red", revoked: "red",
};
function toneFor(action: string): "green" | "red" | "gold" | "blue" {
  for (const k of Object.keys(ACTION_TONE)) if (action.includes(k)) return ACTION_TONE[k];
  return "blue";
}

export default function AdminAudit() {
  const q = trpc.admin.auditTrail.useQuery({ limit: 300 }, { retry: false });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Accountability" title="Admin audit trail"
        sub="An append-only record of privileged actions — approvals, member changes, Zenith decisions, data-request completions and access grants. Nothing here can be edited or deleted." />

      {q.isLoading && <Spinner />}
      {q.isError && (
        <div className="eh-card"><Empty big="Couldn't load the audit trail."
          p="There was a problem reaching the server." />
          <div style={{ textAlign: "center" }}><button className="eh-btn ghost" onClick={() => q.refetch()}>Try again</button></div>
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="eh-card"><Empty big="No admin actions logged yet."
          p="Privileged actions will appear here as your team uses the admin portal." /></div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td className="eh-sm eh-muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.createdAt)}</td>
                  <td className="eh-sm"><b>{r.actorEmail ?? "—"}</b></td>
                  <td><Pill color={toneFor(r.action)}>{r.action}</Pill></td>
                  <td className="eh-sm eh-muted">{r.targetType ? `${r.targetType} ${r.targetId ?? ""}` : "—"}</td>
                  <td className="eh-sm">{r.detail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EhShell>
  );
}
