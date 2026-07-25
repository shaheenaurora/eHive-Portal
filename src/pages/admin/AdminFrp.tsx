import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, StatusPill, Empty, TierPill, Spinner, Modal, Field, Bar, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { TIERS, TIER_LABEL, MILESTONE_LABEL } from "@contracts/constants";

export default function AdminFrp() {
  const utils = trpc.useUtils();
  const q = trpc.admin.frpCohortsAdmin.useQuery(undefined, { retry: false });
  const [create, setCreate] = useState(false);
  const [enrolId, setEnrolId] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");

  const invalidate = () => utils.admin.frpCohortsAdmin.invalidate();

  const createCohort = trpc.admin.createCohort.useMutation({
    onSuccess: () => { toast("Cohort created."); invalidate(); setCreate(false); },
    onError: (e) => toast(e.message),
  });
  const setEnrolStatus = trpc.admin.setEnrolmentStatus.useMutation({
    onSuccess: () => { toast("Enrolment updated."); invalidate(); },
    onError: (e) => toast(e.message),
  });
  const review = trpc.admin.reviewMilestone.useMutation({
    onSuccess: () => { toast("Review saved — score awarded where due."); invalidate(); utils.admin.enrolmentDetail.invalidate(); },
    onError: (e) => toast(e.message),
  });

  const detail = trpc.admin.enrolmentDetail.useQuery({ id: enrolId! }, { enabled: enrolId !== null, retry: false });

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createCohort.mutate({
      name: String(f.get("name")),
      tierGate: String(f.get("tierGate")) as never,
      startsAt: f.get("startsAt") ? new Date(String(f.get("startsAt"))) : undefined,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Fundraising Readiness Programme" title="Cohorts and reviews"
                sub="Enrolments, readiness scores and the deck/model/data-room review queue."
                actions={<button className="eh-btn gold" onClick={() => setCreate(true)}>+ New cohort</button>} />

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <div className="eh-card"><Empty big="No cohorts yet." /></div>}

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {q.data?.map((c) => (
          <div className="eh-card" key={c.id}>
            <div className="eh-between">
              <div>
                <h3 style={{ margin: 0 }}>{c.name}</h3>
                <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
                  Starts {fmtDate(c.startsAt)} · {c.enrolments.length} enrolled
                </p>
              </div>
              <div className="eh-row">
                <StatusPill status={c.status} />
                <TierPill tier={c.tierGate} />
              </div>
            </div>
            {c.enrolments.length > 0 && (
              <table className="eh-table stack" style={{ marginTop: ".8rem" }}>
                <thead><tr><th>Member</th><th>Company</th><th>Status</th><th>Enrolled</th><th></th></tr></thead>
                <tbody>
                  {c.enrolments.map(({ en, member, userName }) => (
                    <tr key={en.id}>
                      <td><b>{userName}</b></td>
                      <td className="eh-sm" data-label="Company">{member.company ?? "—"}</td>
                      <td data-label="Status">
                        <select className="eh-select" style={{ maxWidth: 140, padding: ".3rem .5rem", fontSize: ".78rem" }}
                                value={en.status}
                                onChange={(e) => setEnrolStatus.mutate({ id: en.id, status: e.target.value as never })}>
                          <option value="enrolled">enrolled</option>
                          <option value="active">active</option>
                          <option value="completed">completed</option>
                          <option value="withdrawn">withdrawn</option>
                        </select>
                      </td>
                      <td className="eh-sm eh-muted" data-label="Enrolled">{fmtDate(en.createdAt)}</td>
                      <td><button className="eh-btn ghost sm" onClick={() => setEnrolId(en.id)}>Review →</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {create && (
        <Modal title="New FRP cohort" onClose={() => setCreate(false)}>
          <form onSubmit={onCreate}>
            <Field label="Name">
              <input className="eh-input" name="name" required placeholder="FRP Cohort 4 — Spring 2027" />
            </Field>
            <div className="eh-grid g2">
              <Field label="Tier gate">
                <select className="eh-select" name="tierGate" defaultValue="vanguard">
                  {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}+</option>)}
                </select>
              </Field>
              <Field label="Starts">
                <input className="eh-input" name="startsAt" type="date" />
              </Field>
            </div>
            <button className="eh-btn gold" type="submit" disabled={createCohort.isPending}>Create cohort →</button>
          </form>
        </Modal>
      )}

      {enrolId !== null && (
        <Modal title="Enrolment review" onClose={() => setEnrolId(null)} wide>
          {detail.isLoading && <Spinner />}
          {detail.data && (
            <>
              <div className="eh-between eh-mb">
                <div>
                  <b className="eh-strong">{detail.data.userName}</b>
                  <span className="eh-muted eh-sm"> · {detail.data.member.company} · {detail.data.cohort.name}</span>
                </div>
                <StatusPill status={detail.data.en.status} />
              </div>

              {detail.data.assessment && (
                <div className="eh-card" style={{ background: "var(--eh-paper)", marginBottom: "1rem" }}>
                  <div className="eh-eyebrow">Readiness assessment</div>
                  <div className="eh-grid g3" style={{ marginTop: ".6rem" }}>
                    {(["team", "traction", "market", "financials", "narrative", "legal"] as const).map((k) => (
                      <div key={k}>
                        <div className="eh-between" style={{ marginBottom: ".25rem" }}>
                          <span className="eh-sm eh-strong">{k}</span>
                          <span className="eh-num eh-sm">{detail.data!.assessment![k]}/5</span>
                        </div>
                        <Bar pct={(detail.data!.assessment![k] / 5) * 100} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="eh-list">
                {detail.data.milestones.map((m) => (
                  <div className="row" key={m.id} style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div className="t">{MILESTONE_LABEL[m.key]}</div>
                      {m.note && <div className="d" style={{ maxWidth: "46ch" }}>{m.note}</div>}
                    </div>
                    <div className="eh-row">
                      <StatusPill status={m.status} />
                      {m.status === "submitted" && (
                        <button className="eh-btn gold sm"
                                onClick={() => review.mutate({ id: m.id, status: "reviewed", note: reviewNote || undefined })}>
                          Mark reviewed ✓
                        </button>
                      )}
                      {m.status === "reviewed" && (
                        <button className="eh-btn ghost sm"
                                onClick={() => review.mutate({ id: m.id, status: "in_progress", note: "Returned for revision" })}>
                          Return for revision
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Field label="Review note (sent with the next state change)">
                <input className="eh-input" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)}
                       placeholder="e.g. Deck approved — pricing slide much sharper." />
              </Field>
            </>
          )}
        </Modal>
      )}
    </EhShell>
  );
}
