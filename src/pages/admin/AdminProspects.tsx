import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { PROSPECT_STAGES, PROSPECT_STAGE_LABEL } from "@contracts/constants";
import type { ProspectStage } from "@contracts/constants";

const STAGE_COLOR: Record<ProspectStage, "grey" | "blue" | "gold" | "green" | "red"> = {
  prospect: "grey", guest: "blue", invited: "gold", converted: "green", declined: "red",
};

type Row = {
  id: number; name: string; email: string | null; phone: string | null; company: string | null;
  stage: ProspectStage; source: string | null; notes: string | null; createdAt: string | Date;
};

export default function AdminProspects() {
  const [stage, setStage] = useState<ProspectStage | "">("");
  const q = trpc.adminEngage.prospects.useQuery({ stage: (stage || undefined) as never }, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.prospects.invalidate();
  const [addOpen, setAddOpen] = useState(false);
  const [sel, setSel] = useState<Row | null>(null);

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Top of funnel" title="Prospects & Guests"
        sub="Capture prospects and event guests, nurture them, and move them toward applying (ML-01). This sits before the Application." />

      <div className="eh-between eh-mb">
        <div className="eh-tabs" style={{ margin: 0 }}>
          <button className={stage === "" ? "on" : ""} onClick={() => setStage("")}>All</button>
          {PROSPECT_STAGES.map((s) => (
            <button key={s} className={stage === s ? "on" : ""} onClick={() => setStage(s)}>{PROSPECT_STAGE_LABEL[s]}</button>
          ))}
        </div>
        <button className="eh-btn gold sm" onClick={() => setAddOpen(true)}>Add prospect →</button>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <div className="eh-card"><Empty big="No prospects here yet." p="Log a prospect or an event guest to start the funnel." /></div>}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead><tr><th>Name</th><th>Contact</th><th>Company</th><th>Stage</th><th>Source</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {(q.data as Row[]).map((p) => (
                <tr key={p.id} className="click" onClick={() => setSel(p)}>
                  <td><b>{p.name}</b></td>
                  <td data-label="Contact" className="eh-sm">{p.email ?? p.phone ?? "—"}</td>
                  <td data-label="Company" className="eh-sm">{p.company ?? "—"}</td>
                  <td data-label="Stage"><Pill color={STAGE_COLOR[p.stage]}>{PROSPECT_STAGE_LABEL[p.stage]}</Pill></td>
                  <td data-label="Source" className="eh-sm">{p.source ?? "—"}</td>
                  <td data-label="Added" className="eh-sm eh-muted">{fmtDate(p.createdAt)}</td>
                  <td><span className="eh-btn ghost sm">Open →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen && <AddProspect onClose={() => setAddOpen(false)} onSaved={() => { refresh(); setAddOpen(false); }} />}
      {sel && <ProspectDetail p={sel} onClose={() => setSel(null)} onSaved={() => { refresh(); setSel(null); }} />}
    </EhShell>
  );
}

function AddProspect({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", source: "", notes: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const add = trpc.adminEngage.addProspect.useMutation({
    onSuccess: () => { toast("Prospect added."); onSaved(); },
    onError: (e) => toast(e.message),
  });
  return (
    <Modal title="Add prospect" onClose={onClose}>
      <div className="eh-grid g2">
        <Field label="Name"><input className="eh-input" value={f.name} onChange={set("name")} placeholder="Full name" /></Field>
        <Field label="Company"><input className="eh-input" value={f.company} onChange={set("company")} placeholder="Company" /></Field>
        <Field label="Email"><input className="eh-input" type="email" value={f.email} onChange={set("email")} placeholder="name@company.com" /></Field>
        <Field label="Phone"><input className="eh-input" value={f.phone} onChange={set("phone")} placeholder="+971…" /></Field>
      </div>
      <Field label="Source"><input className="eh-input" value={f.source} onChange={set("source")} placeholder="e.g. Chapter meeting guest, referral, event" /></Field>
      <Field label="Notes"><textarea className="eh-textarea" value={f.notes} onChange={set("notes")} placeholder="Context, who introduced them, what they're building…" /></Field>
      <button className="eh-btn gold" disabled={add.isPending || f.name.trim().length < 2}
              onClick={() => add.mutate({ name: f.name, email: f.email || undefined, phone: f.phone || undefined, company: f.company || undefined, source: f.source || undefined, notes: f.notes || undefined })}>
        {add.isPending ? "Adding…" : "Add prospect"}
      </button>
    </Modal>
  );
}

function ProspectDetail({ p, onClose, onSaved }: { p: Row; onClose: () => void; onSaved: () => void }) {
  const [stage, setStage] = useState<ProspectStage>(p.stage);
  const [notes, setNotes] = useState(p.notes ?? "");
  const save = trpc.adminEngage.updateProspect.useMutation({
    onSuccess: () => { toast("Prospect updated."); onSaved(); },
    onError: (e) => toast(e.message),
  });
  return (
    <Modal title={p.name} onClose={onClose}>
      <div className="eh-list eh-mb">
        <div className="row"><span className="d">Email</span><span className="t">{p.email ?? "—"}</span></div>
        <div className="row"><span className="d">Phone</span><span className="t">{p.phone ?? "—"}</span></div>
        <div className="row"><span className="d">Company</span><span className="t">{p.company ?? "—"}</span></div>
        <div className="row"><span className="d">Source</span><span className="t">{p.source ?? "—"}</span></div>
      </div>
      <Field label="Stage">
        <select className="eh-select" value={stage} onChange={(e) => setStage(e.target.value as ProspectStage)}>
          {PROSPECT_STAGES.map((s) => <option key={s} value={s}>{PROSPECT_STAGE_LABEL[s]}</option>)}
        </select>
      </Field>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Move through the funnel: Prospect → Guest (attended) → Invited to apply → Converted. When they're ready, invite
        them to the Application.
      </p>
      <Field label="Notes"><textarea className="eh-textarea" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <button className="eh-btn gold" disabled={save.isPending}
              onClick={() => save.mutate({ id: p.id, stage, notes })}>
        {save.isPending ? "Saving…" : "Save"}
      </button>
    </Modal>
  );
}
