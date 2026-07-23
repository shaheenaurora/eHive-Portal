import { useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, StatusPill, TierPill, Empty, Spinner, Modal, Field, Pill, toast } from "@/components/eh";
import { fmtDate, fmtDateTime, initials, relDay } from "@/lib/ehf";
import { SCORE_FACTORS, SCORE_FACTOR_LABEL, TIERS, TIER_LABEL } from "@contracts/constants";

export default function AdminMemberDetail() {
  const { id } = useParams<{ id: string }>();
  const mid = Number(id);
  const utils = trpc.useUtils();
  const q = trpc.admin.memberDetail.useQuery({ id: mid }, { retry: false });
  const [adjust, setAdjust] = useState(false);
  const [adjForm, setAdjForm] = useState({ factor: "contribution", points: 5, note: "" });

  const invalidate = () => { utils.admin.memberDetail.invalidate({ id: mid }); utils.admin.members.invalidate(); };

  const setTier = trpc.admin.setMemberTier.useMutation({
    onSuccess: (r) => { toast(`Tier ${r.type}d.`); invalidate(); },
    onError: (e) => toast(e.message),
  });
  const setStatus = trpc.admin.setMemberStatus.useMutation({
    onSuccess: () => { toast("Status updated."); invalidate(); },
    onError: (e) => toast(e.message),
  });
  const adjustScore = trpc.admin.adjustScore.useMutation({
    onSuccess: () => { toast("Score adjusted."); invalidate(); setAdjust(false); },
    onError: (e) => toast(e.message),
  });

  if (q.isLoading) return <EhShell groups={ADMIN_NAV} brandSub="Admin"><Spinner /></EhShell>;
  if (!q.data) return <EhShell groups={ADMIN_NAV} brandSub="Admin"><Empty big="Member not found." /></EhShell>;

  const { member, userName, userEmail, history, pods, applications, actionItems, scoreHistory, eventRegs } = q.data;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow"><Link to="/admin/members" style={{ color: "inherit" }}>← Members</Link></div>
          <h1 className="eh-h1">
            <span className="eh-avatar" style={{ display: "inline-grid", marginRight: ".6rem", verticalAlign: "-.3rem" }}>{initials(userName)}</span>
            {userName ?? "Member"}
          </h1>
          <p className="eh-sub">{userEmail} · {member.title ?? ""}{member.title && member.company ? " at " : ""}{member.company ?? ""}</p>
        </div>
        <div className="eh-row">
          <TierPill tier={member.tier} />
          <StatusPill status={member.status} />
          <Pill color="gold">Score {member.hiveScore}</Pill>
        </div>
      </div>

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Controls</h3>
            <Field label="Tier">
              <select className="eh-select" value={member.tier}
                      onChange={(e) => setTier.mutate({ memberId: mid, tier: e.target.value as never })}>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="eh-select" value={member.status}
                      onChange={(e) => setStatus.mutate({ memberId: mid, status: e.target.value as never })}>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="cancelled">cancelled</option>
              </select>
            </Field>
            <button className="eh-btn ghost sm" onClick={() => setAdjust(true)}>Adjust Hive Score →</button>
            <hr className="eh-divider" />
            <div className="eh-list">
              <div className="row"><span className="d">Joined</span><span className="t eh-sm">{fmtDate(member.joinedAt)}</span></div>
              <div className="row"><span className="d">Renews</span><span className="t eh-sm">{fmtDate(member.renewalAt)}</span></div>
              <div className="row"><span className="d">Phone</span><span className="t eh-sm">{member.phone ?? "—"}</span></div>
            </div>
          </div>

          <div className="eh-card">
            <h3>Membership events</h3>
            <div className="eh-timeline">
              {history.map((h) => (
                <div className="ev" key={h.id}>
                  <div className="w">{fmtDate(h.createdAt)}</div>
                  <div className="x">{h.type}{h.toTier && h.toTier !== h.fromTier ? ` → ${h.toTier}` : ""}</div>
                  {h.note && <div className="n">{h.note}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Applications ({applications.length})</h3>
            <div className="eh-list">
              {applications.map((a) => (
                <div className="row" key={a.id}>
                  <div>
                    <div className="t">{TIER_LABEL[a.tierRequested]}</div>
                    <div className="d">{fmtDate(a.createdAt)}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Pods ({pods.length})</h3>
            {pods.length === 0 && <Empty big="Not in any pod." />}
            <div className="eh-list">
              {pods.map(({ pod, role }) => (
                <div className="row" key={pod.id}>
                  <div>
                    <div className="t">{pod.name}</div>
                    <div className="d">{pod.kind} · {role}</div>
                  </div>
                  <Link className="eh-btn ghost sm" to={`/admin/pods/${pod.id}`}>Manage →</Link>
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Action items ({actionItems.length})</h3>
            {actionItems.length === 0 && <Empty big="No commitments." />}
            <div className="eh-list">
              {actionItems.map((a) => (
                <div className="row" key={a.id}>
                  <div>
                    <div className="t">{a.text}</div>
                    <div className="d">Due {relDay(a.dueAt)}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Event registrations ({eventRegs.length})</h3>
            <div className="eh-list">
              {eventRegs.map(({ ev, status }) => (
                <div className="row" key={ev.id}>
                  <div>
                    <div className="t">{ev.title}</div>
                    <div className="d">{fmtDateTime(ev.startsAt)}</div>
                  </div>
                  <StatusPill status={status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="eh-card">
          <h3>Score history</h3>
          {scoreHistory.length === 0 && <Empty big="No snapshots yet." />}
          <div className="eh-timeline">
            {scoreHistory.map((h) => (
              <div className="ev" key={h.id}>
                <div className="w">{fmtDateTime(h.computedAt)}</div>
                <div className="x">Score {h.score}</div>
                {h.breakdown && (
                  <div className="n">
                    {Object.entries(JSON.parse(h.breakdown) as Record<string, number>)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => `${SCORE_FACTOR_LABEL[k as keyof typeof SCORE_FACTOR_LABEL] ?? k} ${v}`)
                      .join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {adjust && (
        <Modal title="Adjust Hive Score" onClose={() => setAdjust(false)}>
          <div className="eh-grid g2">
            <Field label="Factor">
              <select className="eh-select" value={adjForm.factor}
                      onChange={(e) => setAdjForm({ ...adjForm, factor: e.target.value })}>
                {SCORE_FACTORS.map((f) => <option key={f} value={f}>{SCORE_FACTOR_LABEL[f]}</option>)}
              </select>
            </Field>
            <Field label="Points (−50 … +50)">
              <input className="eh-input" type="number" min={-50} max={50} value={adjForm.points}
                     onChange={(e) => setAdjForm({ ...adjForm, points: Number(e.target.value) })} />
            </Field>
          </div>
          <Field label="Reason (shown in the member's ledger)">
            <input className="eh-input" value={adjForm.note} onChange={(e) => setAdjForm({ ...adjForm, note: e.target.value })} />
          </Field>
          <button className="eh-btn gold" disabled={adjustScore.isPending}
                  onClick={() => adjustScore.mutate({ memberId: mid, factor: adjForm.factor, points: adjForm.points, note: adjForm.note || undefined })}>
            Apply adjustment →
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
