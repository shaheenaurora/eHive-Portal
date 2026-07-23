import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";

export default function AdminGovernance() {
  const utils = trpc.useUtils();
  const q = trpc.admin.govAdmin.useQuery(undefined, { retry: false });
  const [bodyFor, setBodyFor] = useState(false);
  const [seatFor, setSeatFor] = useState<number | null>(null);
  const [minutesFor, setMinutesFor] = useState<number | null>(null);
  const [policyFor, setPolicyFor] = useState<{ id?: number; title: string; body: string; version: number } | null>(null);

  const invalidate = () => utils.admin.govAdmin.invalidate();

  const createBody = trpc.admin.createBody.useMutation({
    onSuccess: () => { toast("Body created."); invalidate(); setBodyFor(false); }, onError: (e) => toast(e.message),
  });
  const assignSeat = trpc.admin.assignSeat.useMutation({
    onSuccess: () => { toast("Seat assigned."); invalidate(); setSeatFor(null); }, onError: (e) => toast(e.message),
  });
  const removeSeat = trpc.admin.removeSeat.useMutation({
    onSuccess: () => { toast("Seat removed."); invalidate(); }, onError: (e) => toast(e.message),
  });
  const publishMinutes = trpc.admin.publishMinutes.useMutation({
    onSuccess: () => { toast("Minutes published to all members."); invalidate(); setMinutesFor(null); }, onError: (e) => toast(e.message),
  });
  const savePolicy = trpc.admin.savePolicy.useMutation({
    onSuccess: () => { toast("Policy saved."); invalidate(); setPolicyFor(null); }, onError: (e) => toast(e.message),
  });

  const members = trpc.admin.members.useQuery(undefined, { retry: false });

  function onSeat(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    assignSeat.mutate({
      bodyId: seatFor!,
      memberId: Number(f.get("memberId")),
      seat: String(f.get("seat")),
      termStart: f.get("termStart") ? new Date(String(f.get("termStart"))) : undefined,
      termEnd: f.get("termEnd") ? new Date(String(f.get("termEnd"))) : undefined,
    });
  }

  function onMinutes(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    publishMinutes.mutate({
      bodyId: minutesFor!,
      title: String(f.get("title")),
      date: f.get("date") ? new Date(String(f.get("date"))) : undefined,
      text: String(f.get("text")) || undefined,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Governance" title="Bodies, seats, minutes, policies"
                sub="Everything published here is visible to every member immediately."
                actions={<button className="eh-btn gold" onClick={() => setBodyFor(true)}>+ New body</button>} />

      {q.isLoading && <Spinner />}

      <div className="eh-grid g2" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {q.data?.bodies.map((b) => (
            <div className="eh-card" key={b.id}>
              <div className="eh-between">
                <h3 style={{ margin: 0 }}>{b.name}</h3>
                <div className="eh-row">
                  <button className="eh-btn ghost sm" onClick={() => setSeatFor(b.id)}>+ Seat</button>
                  <button className="eh-btn ghost sm" onClick={() => setMinutesFor(b.id)}>+ Minutes</button>
                </div>
              </div>
              <p className="eh-sm eh-muted">{b.description}</p>
              <div className="eh-list">
                {b.roles.map(({ role, userName }) => (
                  <div className="row" key={role.id}>
                    <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                      <span className="eh-avatar">{initials(userName)}</span>
                      <div>
                        <div className="t">{userName}</div>
                        <div className="d">{fmtDate(role.termStart)} → {fmtDate(role.termEnd)}</div>
                      </div>
                    </div>
                    <div className="eh-row">
                      <Pill>{role.seat}</Pill>
                      <button className="eh-btn ghost sm" onClick={() => removeSeat.mutate({ id: role.id })}>✕</button>
                    </div>
                  </div>
                ))}
                {b.roles.length === 0 && <p className="eh-sm eh-muted">No seats assigned.</p>}
              </div>
              {b.minutes.length > 0 && (
                <>
                  <hr className="eh-divider" />
                  <div className="eh-list">
                    {b.minutes.map((m) => (
                      <div className="row" key={m.id}>
                        <div className="t eh-sm">{m.title}</div>
                        <span className="d">{fmtDate(m.date)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="eh-card">
          <div className="eh-between">
            <h3 style={{ margin: 0 }}>Policies</h3>
            <button className="eh-btn gold sm" onClick={() => setPolicyFor({ title: "", body: "", version: 1 })}>+ New policy</button>
          </div>
          {q.data?.policies.length === 0 && <Empty big="No policies yet." />}
          <div className="eh-list">
            {q.data?.policies.map((p) => (
              <div className="row" key={p.id}>
                <div>
                  <div className="t">{p.title}</div>
                  <div className="d">v{p.version} · {p.ackCount} acknowledgments</div>
                </div>
                <button className="eh-btn ghost sm"
                        onClick={() => setPolicyFor({ id: p.id, title: p.title, body: p.body ?? "", version: p.version + 1 })}>
                  New version →
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {bodyFor && (
        <Modal title="New governance body" onClose={() => setBodyFor(false)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            createBody.mutate({ name: String(f.get("name")), description: String(f.get("description")) || undefined });
          }}>
            <Field label="Name"><input className="eh-input" name="name" required placeholder="Ethics Committee" /></Field>
            <Field label="Description"><textarea className="eh-textarea" name="description" /></Field>
            <button className="eh-btn gold" type="submit" disabled={createBody.isPending}>Create →</button>
          </form>
        </Modal>
      )}

      {seatFor !== null && (
        <Modal title="Assign a seat" onClose={() => setSeatFor(null)}>
          <form onSubmit={onSeat}>
            <Field label="Member">
              <select className="eh-select" name="memberId" required>
                {members.data?.map(({ member, userName }) => (
                  <option key={member.id} value={member.id}>{userName} ({member.tier})</option>
                ))}
              </select>
            </Field>
            <Field label="Seat title">
              <input className="eh-input" name="seat" required placeholder="Secretary" />
            </Field>
            <div className="eh-grid g2">
              <Field label="Term start"><input className="eh-input" name="termStart" type="date" /></Field>
              <Field label="Term end"><input className="eh-input" name="termEnd" type="date" /></Field>
            </div>
            <button className="eh-btn gold" type="submit" disabled={assignSeat.isPending}>Assign seat →</button>
          </form>
        </Modal>
      )}

      {minutesFor !== null && (
        <Modal title="Publish minutes" onClose={() => setMinutesFor(null)}>
          <form onSubmit={onMinutes}>
            <Field label="Title"><input className="eh-input" name="title" required placeholder="Council minutes — August 2026" /></Field>
            <Field label="Date"><input className="eh-input" name="date" type="date" /></Field>
            <Field label="Minutes">
              <textarea className="eh-textarea" name="text" style={{ minHeight: 160 }}
                        placeholder="1. …&#10;2. …" />
            </Field>
            <button className="eh-btn gold" type="submit" disabled={publishMinutes.isPending}>Publish →</button>
          </form>
        </Modal>
      )}

      {policyFor && (
        <Modal title={policyFor.id ? `New version of “${policyFor.title}”` : "New policy"} onClose={() => setPolicyFor(null)}>
          <form onSubmit={(e) => {
            e.preventDefault();
            savePolicy.mutate({ id: policyFor.id, title: policyFor.title, body: policyFor.body, version: policyFor.version });
          }}>
            <Field label="Title">
              <input className="eh-input" value={policyFor.title} required
                     onChange={(e) => setPolicyFor({ ...policyFor, title: e.target.value })} />
            </Field>
            <Field label={`Version ${policyFor.version} text (members must re-acknowledge)`}>
              <textarea className="eh-textarea" style={{ minHeight: 180 }} value={policyFor.body} required
                        onChange={(e) => setPolicyFor({ ...policyFor, body: e.target.value })} />
            </Field>
            <button className="eh-btn gold" type="submit" disabled={savePolicy.isPending}>Save policy →</button>
          </form>
        </Modal>
      )}
    </EhShell>
  );
}
