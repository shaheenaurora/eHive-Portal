import { useState } from "react";
import type { ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, Bar, toast } from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";
import { buildScorecardReport } from "@/lib/scorecard";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@contracts/constants";
import type { LeadStatus } from "@contracts/constants";

type LeadRow = {
  id: number; form: string; email: string | null; payload: string | null;
  sourcePage: string | null; createdAt: Date | string;
  status: LeadStatus; ownerUserId: number | null; notes: string | null;
  ownerName: string | null; ownerEmail: string | null;
};

const STATUS_COLOR: Record<LeadStatus, "grey" | "blue" | "gold" | "green" | "red" | "purple"> = {
  new: "blue", contacted: "gold", qualified: "purple", won: "green", lost: "red",
};

export default function AdminLeads() {
  const [q2, setQ2] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const q = trpc.admin.leads.useQuery(
    { q: q2 || undefined, status: (status || undefined) as never },
    { retry: false },
  );
  const counts = trpc.admin.leadCounts.useQuery(undefined, { retry: false });
  const [sel, setSel] = useState<LeadRow | null>(null);

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Pipeline" title="Leads"
                sub="Every website enquiry — Get Started, bookings, the calculator and the Clarity Scorecard — with a light CRM to work them." />

      <div className="eh-tabs">
        <button className={status === "" ? "on" : ""} onClick={() => setStatus("")}>
          All{counts.data ? ` · ${Object.values(counts.data).reduce((a, b) => a + (b as number), 0)}` : ""}
        </button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
            {LEAD_STATUS_LABEL[s]}{counts.data?.[s] ? ` · ${counts.data[s]}` : ""}
          </button>
        ))}
      </div>

      <div className="eh-row eh-mb">
        <input className="eh-input" style={{ maxWidth: 300 }} placeholder="Search by email or form…"
               value={q2} onChange={(e) => setQ2(e.target.value)} />
      </div>

      {q.isLoading && <Spinner />}
      {q.isError && <div className="eh-card"><Empty big="Couldn't load leads." p="Try again in a moment."><button className="eh-btn ghost" onClick={() => q.refetch()}>Retry</button></Empty></div>}
      {q.data && q.data.length === 0 && <div className="eh-card"><Empty big="No leads here yet." p="Submissions land here within seconds of a form being sent." /></div>}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead><tr><th>Contact</th><th>Form</th><th>Detail</th><th>Status</th><th>Owner</th><th>When</th><th></th></tr></thead>
            <tbody>
              {(q.data as LeadRow[]).map((l) => {
                const nm = leadName(l);
                return (
                  <tr key={l.id} className="click" onClick={() => setSel(l)}>
                    <td><b>{nm ?? l.email ?? "—"}</b>{nm && l.email ? <div className="eh-muted eh-sm">{l.email}</div> : null}</td>
                    <td data-label="Form"><Pill>{formLabel(l.form)}</Pill></td>
                    <td data-label="Detail" className="eh-sm">{leadHighlight(l)}</td>
                    <td data-label="Status"><Pill color={STATUS_COLOR[l.status]}>{LEAD_STATUS_LABEL[l.status]}</Pill></td>
                    <td data-label="Owner" className="eh-sm">{l.ownerName ?? l.ownerEmail ?? "—"}</td>
                    <td data-label="When" className="eh-sm eh-muted">{fmtDateTime(l.createdAt)}</td>
                    <td><span className="eh-btn ghost sm">Open →</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sel && <LeadDetail lead={sel} onClose={() => setSel(null)}
                          onSaved={() => { q.refetch(); counts.refetch(); }} />}
    </EhShell>
  );
}

function LeadDetail({ lead, onClose, onSaved }: { lead: LeadRow; onClose: () => void; onSaved: () => void }) {
  const roster = trpc.admin.adminRoster.useQuery(undefined, { retry: false });
  const update = trpc.admin.updateLead.useMutation({
    onSuccess: () => { toast("Lead updated."); onSaved(); },
    onError: (e) => toast(e.message),
  });

  let data: Record<string, unknown> = {};
  try { data = lead.payload ? JSON.parse(lead.payload) : {}; } catch { /* ignore */ }
  const report = buildScorecardReport(data);
  const str = (k: string) => (typeof data[k] === "string" && data[k] ? String(data[k]) : null);
  const contact: [string, string | null][] = [
    ["Name", str("name")], ["Email", lead.email ?? str("email")], ["Phone", str("phone")],
    ["Business", str("company") ?? str("business")], ["Location", str("location")], ["Industry", str("industry")],
  ];

  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [owner, setOwner] = useState<string>(lead.ownerUserId ? String(lead.ownerUserId) : "");
  const [notes, setNotes] = useState(lead.notes ?? "");

  return (
    <Modal title={`Lead — ${leadName(lead) ?? lead.email ?? formLabel(lead.form)}`} onClose={onClose} wide>
      {/* ---- Clarity Scorecard report ---- */}
      {report && (
        <div className="eh-card eh-mb" style={{ background: "var(--eh-paper)" }}>
          <div className="eh-between" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eh-eyebrow">Clarity Scorecard</div>
              <h3 style={{ margin: ".1rem 0 0" }}>{report.band.name}</h3>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="eh-num" style={{ fontSize: "2.2rem", fontWeight: 700, lineHeight: 1, color: "var(--eh-gold)" }}>{report.total}</div>
              <div className="eh-sm eh-muted">/ 100</div>
            </div>
          </div>
          <p className="eh-sm eh-muted" style={{ margin: ".5rem 0 1rem" }}>{report.band.copy}</p>

          <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>By area · weakest highlighted</div>
          <div style={{ display: "grid", gap: ".55rem" }}>
            {report.domains.map((d) => {
              const weak = report.weakest.some((w) => w.key === d.key);
              const strong = report.strongest.some((s) => s.key === d.key);
              return (
                <div key={d.key} style={{ display: "grid", gridTemplateColumns: "9rem 1fr 3.2rem", alignItems: "center", gap: ".6rem" }}>
                  <span className="eh-sm" style={{ fontWeight: weak ? 700 : 500, color: weak ? "var(--eh-red)" : "var(--eh-ink-2)" }}>
                    {d.key}{weak ? " ⚠" : strong ? " ★" : ""}
                  </span>
                  <Bar pct={d.pct} green={strong && !weak} />
                  <span className="eh-num eh-sm" style={{ textAlign: "right", color: weak ? "var(--eh-red)" : "var(--eh-mut)" }}>{d.pct}%</span>
                </div>
              );
            })}
          </div>

          <div className="eh-locked eh-mt" style={{ display: "block" }}>
            <div className="eh-eyebrow" style={{ color: "var(--eh-gold)" }}>Recommended next step</div>
            <b>{report.recommendation.product}</b>
            <div className="eh-sm eh-muted" style={{ marginTop: ".2rem" }}>{report.recommendation.why}</div>
          </div>
        </div>
      )}

      {/* ---- Contact ---- */}
      <div className="eh-eyebrow">Contact</div>
      <div className="eh-list eh-mb">
        {contact.filter(([, v]) => v).map(([k, v]) => (
          <div className="row" key={k}><span className="d">{k}</span><span className="t">{v}</span></div>
        ))}
        <div className="row"><span className="d">Form</span><Pill>{formLabel(lead.form)}</Pill></div>
        <div className="row"><span className="d">Source</span><span className="t eh-sm">{lead.sourcePage ?? "—"}</span></div>
        <div className="row"><span className="d">Captured</span><span className="t eh-sm">{fmtDateTime(lead.createdAt)}</span></div>
      </div>

      {/* ---- Everything else they submitted (booking slot, estimate, enquiry…) ---- */}
      {(() => {
        const extra = extraFields(data);
        if (!extra.length) return null;
        return (
          <>
            <div className="eh-eyebrow">What they submitted</div>
            <div className="eh-list eh-mb">
              {extra.map(([k, v]) => (
                <div className="row" key={k} style={{ alignItems: "flex-start" }}>
                  <span className="d">{k}</span>
                  <span className="t eh-sm" style={{ textAlign: "right", whiteSpace: "pre-wrap" }}>{v}</span>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* ---- CRM controls ---- */}
      <div className="eh-eyebrow">Work this lead</div>
      <div className="eh-grid g2 eh-mb" style={{ marginTop: ".4rem" }}>
        <Field label="Status">
          <select className="eh-select" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <select className="eh-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Unassigned</option>
            {(roster.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name ?? a.email}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Notes">
        <textarea className="eh-textarea" value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Call notes, next step, context for the team…" />
      </Field>
      <button className="eh-btn gold" disabled={update.isPending}
              onClick={() => update.mutate({
                id: lead.id, status,
                ownerUserId: owner ? Number(owner) : null,
                notes,
              })}>
        {update.isPending ? "Saving…" : "Save"}
      </button>
    </Modal>
  );
}

function leadName(l: { payload: string | null }): string | null {
  try { const d = JSON.parse(l.payload ?? "{}"); return typeof d.name === "string" && d.name ? d.name : null; }
  catch { return null; }
}
const FORM_LABELS: Record<string, string> = {
  "clarity-scorecard": "Clarity Scorecard", "get-started": "Get Started", booking: "Booking",
  "calculator-breakdown": "Setup calculator", newsletter: "Newsletter",
};
function formLabel(f: string): string { return FORM_LABELS[f] ?? f; }

const CONTACT_KEYS = new Set(["name", "email", "phone", "company", "business", "location", "industry"]);
const PLUMBING_KEYS = new Set(["form", "source_page", "user_agent", "referrer", "timestamp"]);
const SCORECARD_INTERNAL = new Set(["total", "domains"]);
const prettyKey = (k: string) => k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function fmtVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    // Flatten one level so estimates/objects read as "key: value · key: value".
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${prettyKey(k)}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`)
      .join(" · ");
  }
  return String(v);
}

/** Every submitted field that isn't contact info, plumbing, or scorecard
 *  internals (those render in the report) — so booking/estimate/enquiry details
 *  are never hidden from admins. */
function extraFields(data: Record<string, unknown>): [string, string][] {
  return Object.entries(data)
    .filter(([k, v]) => !CONTACT_KEYS.has(k) && !PLUMBING_KEYS.has(k) && !SCORECARD_INTERNAL.has(k) && v !== "" && v != null)
    .map(([k, v]) => [prettyKey(k), fmtVal(v)] as [string, string]);
}

/** At-a-glance value for the list: score for the scorecard, else the form's
 *  most telling field. */
function leadHighlight(l: LeadRow): ReactNode {
  let d: Record<string, unknown> = {};
  try { d = l.payload ? JSON.parse(l.payload) : {}; } catch { /* ignore */ }
  if (l.form === "clarity-scorecard" && typeof d.total === "number") {
    const band = d.total >= 82 ? "green" : d.total >= 64 ? "gold" : d.total >= 45 ? "blue" : "red";
    return <Pill color={band as never}>Score {d.total as number}/100</Pill>;
  }
  const pick = (k: string) => (typeof d[k] === "string" && d[k] ? String(d[k]) : null);
  if (l.form === "get-started") return [pick("door"), pick("product_or_tier") ?? pick("detail"), pick("question")].filter(Boolean).join(" · ") || "—";
  if (l.form === "booking") return [pick("product"), pick("when")].filter(Boolean).join(" · ") || "—";
  if (l.form === "calculator-breakdown") {
    const e = d.estimate as Record<string, unknown> | undefined;
    return e ? `${e.jurisdiction ?? ""} · AED ${e.low ?? "?"}–${e.high ?? "?"}`.trim() : "—";
  }
  return pick("detail") ?? pick("question") ?? "—";
}
