import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal } from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";

export default function AdminLeads() {
  const [q2, setQ2] = useState("");
  const q = trpc.admin.leads.useQuery(q2 ? { q: q2 } : undefined, { retry: false });
  const [sel, setSel] = useState<{ id: number; form: string; email: string | null; payload: string | null; sourcePage: string | null; createdAt: Date | string } | null>(null);

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Website leads" title="Lead inbox"
                sub="Every form on the marketing site — get-started, booking, calculator breakdowns — lands here via /api/lead." />

      <div className="eh-row eh-mb">
        <input className="eh-input" style={{ maxWidth: 300 }} placeholder="Search by email or form…"
               value={q2} onChange={(e) => setQ2(e.target.value)} />
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <div className="eh-card"><Empty big="No leads yet." p="Submit a form on the marketing site to see it here within seconds." /></div>}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table">
            <thead><tr><th>Email</th><th>Form</th><th>Source page</th><th>When</th><th></th></tr></thead>
            <tbody>
              {q.data.map((l) => (
                <tr key={l.id} className="click" onClick={() => setSel(l)}>
                  <td><b>{l.email ?? "—"}</b></td>
                  <td><Pill>{l.form}</Pill></td>
                  <td className="eh-sm">{l.sourcePage ?? "—"}</td>
                  <td className="eh-sm eh-muted">{fmtDateTime(l.createdAt)}</td>
                  <td><span className="eh-btn ghost sm">View →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && (() => {
        let data: Record<string, unknown> = {};
        try { data = sel.payload ? JSON.parse(sel.payload) : {}; } catch { /* leave empty */ }
        const str = (k: string) => (typeof data[k] === "string" && data[k] ? String(data[k]) : null);
        const contact: [string, string | null][] = [
          ["Name", str("name")],
          ["Email", sel.email ?? str("email")],
          ["Phone", str("phone")],
          ["Business", str("company") ?? str("business")],
          ["Location", str("location")],
          ["Industry", str("industry")],
        ];
        const shown = contact.filter(([, v]) => v);
        return (
        <Modal title={`Lead — ${str("name") ?? sel.email ?? sel.form}`} onClose={() => setSel(null)} wide>
          <div className="eh-list" style={{ marginBottom: "1rem" }}>
            <div className="row"><span className="d">Form</span><Pill>{sel.form}</Pill></div>
            {shown.map(([label, val]) => (
              <div className="row" key={label}><span className="d">{label}</span><span className="t">{val}</span></div>
            ))}
            <div className="row"><span className="d">Source page</span><span className="t eh-sm">{sel.sourcePage ?? "—"}</span></div>
            <div className="row"><span className="d">Captured</span><span className="t eh-sm">{fmtDateTime(sel.createdAt)}</span></div>
          </div>
          <div className="eh-eyebrow">Full payload</div>
          <pre className="eh-card eh-mono" style={{ background: "var(--eh-paper)", fontSize: ".74rem", overflowX: "auto", whiteSpace: "pre-wrap" }}>
            {sel.payload ? JSON.stringify(data, null, 2) : "—"}
          </pre>
        </Modal>
        );
      })()}
    </EhShell>
  );
}
