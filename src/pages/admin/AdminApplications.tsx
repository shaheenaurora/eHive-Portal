import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, StatusPill, TierPill, Empty, Spinner, Modal, Field, Pill, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { APPLICATION_STATUSES, TIERS, TIER_LABEL } from "@contracts/constants";

type AppRow = {
  id: number; name: string; email: string; company: string | null; stage: string | null;
  revenue: string | null; why: string | null; tierRequested: "horizon" | "ascent" | "vanguard" | "zenith";
  status: string; note: string | null; createdAt: Date | string;
};

export default function AdminApplications() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>("all");
  const q = trpc.admin.applications.useQuery(status === "all" ? undefined : { status }, { retry: false });
  const [sel, setSel] = useState<AppRow | null>(null);
  const [note, setNote] = useState("");
  const [tier, setTier] = useState<string>("ascent");

  const setStatusMut = trpc.admin.setApplicationStatus.useMutation({
    onSuccess: (r) => {
      toast(r.memberId ? `Approved — membership #${r.memberId} created.` : "Status updated.");
      utils.admin.applications.invalidate();
      utils.admin.stats.invalidate();
      setSel(null);
    },
    onError: (e) => toast(e.message),
  });

  const rows = (q.data ?? []).map((r) => r.app as AppRow);

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Screening workflow" title="Applications"
                sub="Received → screening → interview → decision. Approving creates the membership and writes the first membership event." />

      <div className="eh-tabs">
        {["all", ...APPLICATION_STATUSES].map((s) => (
          <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && <div className="eh-card"><Empty big="Nothing in this stage." /></div>}

      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr><th>Applicant</th><th>Company</th><th>Stage</th><th>Tier</th><th>Status</th><th>Applied</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="click" onClick={() => { setSel(a); setNote(a.note ?? ""); setTier(a.tierRequested); }}>
                  <td><b>{a.name}</b><div className="eh-muted eh-sm">{a.email}</div></td>
                  <td data-label="Company">{a.company ?? "—"}</td>
                  <td className="eh-sm" data-label="Stage">{a.stage ?? "—"}</td>
                  <td data-label="Tier"><TierPill tier={a.tierRequested} /></td>
                  <td data-label="Status"><StatusPill status={a.status} /></td>
                  <td className="eh-sm eh-muted" data-label="Applied">{fmtDate(a.createdAt)}</td>
                  <td><span className="eh-btn ghost sm">Review →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <Modal title={`Application — ${sel.name}`} onClose={() => setSel(null)} wide>
          <div className="eh-grid g2" style={{ marginBottom: "1rem" }}>
            <div className="eh-list">
              <div className="row"><span className="d">Email</span><span className="t eh-sm">{sel.email}</span></div>
              <div className="row"><span className="d">Company</span><span className="t eh-sm">{sel.company ?? "—"}</span></div>
              <div className="row"><span className="d">Stage</span><span className="t eh-sm">{sel.stage ?? "—"}</span></div>
              <div className="row"><span className="d">Revenue</span><span className="t eh-sm">{sel.revenue ?? "—"}</span></div>
            </div>
            <div className="eh-list">
              <div className="row"><span className="d">Applied</span><span className="t eh-sm">{fmtDate(sel.createdAt)}</span></div>
              <div className="row"><span className="d">Tier requested</span><TierPill tier={sel.tierRequested} /></div>
              <div className="row"><span className="d">Status</span><StatusPill status={sel.status} /></div>
            </div>
          </div>
          {sel.why && (
            <div className="eh-card" style={{ background: "var(--eh-paper)", marginBottom: "1rem" }}>
              <div className="eh-eyebrow">Why eHive</div>
              <p className="eh-sm" style={{ margin: 0, lineHeight: 1.7 }}>{sel.why}</p>
            </div>
          )}
          <Field label="Internal note">
            <textarea className="eh-textarea" style={{ minHeight: 70 }} value={note}
                      onChange={(e) => setNote(e.target.value)} placeholder="Visible to the team only." />
          </Field>
          <div className="eh-grid g2" style={{ alignItems: "end" }}>
            <Field label="Approve into tier">
              <select className="eh-select" value={tier} onChange={(e) => setTier(e.target.value)}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
              </select>
            </Field>
            <div className="eh-row" style={{ justifyContent: "flex-end" }}>
              {sel.status !== "approved" && (
                <>
                  {sel.status === "received" && (
                    <button className="eh-btn ghost" disabled={setStatusMut.isPending}
                            onClick={() => setStatusMut.mutate({ id: sel.id, status: "screening", note: note || undefined })}>
                      → Screening
                    </button>
                  )}
                  {(sel.status === "received" || sel.status === "screening") && (
                    <button className="eh-btn ghost" disabled={setStatusMut.isPending}
                            onClick={() => setStatusMut.mutate({ id: sel.id, status: "interview", note: note || undefined })}>
                      → Interview
                    </button>
                  )}
                  <button className="eh-btn danger" disabled={setStatusMut.isPending}
                          onClick={() => setStatusMut.mutate({ id: sel.id, status: "rejected", note: note || undefined })}>
                    Reject
                  </button>
                  <button className="eh-btn gold" disabled={setStatusMut.isPending}
                          onClick={() => setStatusMut.mutate({ id: sel.id, status: "approved", note: note || undefined, tier: tier as never })}>
                    Approve & create membership ✓
                  </button>
                </>
              )}
              {sel.status === "approved" && <Pill color="green">Approved — membership exists</Pill>}
            </div>
          </div>
        </Modal>
      )}
    </EhShell>
  );
}
