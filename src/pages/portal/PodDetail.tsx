import { useState } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, Pill, StatusPill, Empty, TierPill, Spinner, toast } from "@/components/eh";
import { fmtDateTime, fmtDay, relDay, initials } from "@/lib/ehf";

export default function PodDetail() {
  const { id } = useParams<{ id: string }>();
  const podId = Number(id);
  const utils = trpc.useUtils();
  const q = trpc.circle.podDetail.useQuery({ id: podId }, { retry: false });
  // Fixed "now" reference for partitioning sessions, captured once on mount.
  const [now] = useState(() => Date.now());
  const complete = trpc.circle.completeActionItem.useMutation({
    onSuccess: (r) => {
      toast(`Done — Hive Score now ${r.score}`);
      utils.circle.podDetail.invalidate({ id: podId });
      utils.circle.dashboard.invalidate();
    },
    onError: (e) => toast(e.message),
  });
  const accept = trpc.circle.acceptPodConfidentiality.useMutation({
    onSuccess: () => { toast("Thank you — welcome to the pod."); utils.circle.podDetail.invalidate({ id: podId }); },
    onError: (e) => toast(e.message),
  });

  if (q.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Spinner /></EhShell>;
  if (q.error || !q.data)
    return (
      <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
        <Empty big="This pod isn't open to you." p="If you think that's a mistake, message your facilitator.">
          <Link className="eh-btn ghost sm" to="/portal/pods">← Back to my pods</Link>
        </Empty>
      </EhShell>
    );

  const { pod, roster, sessions, notes, myAttendance, actionItems, me, confidentialityAccepted } = q.data;
  const noteMap = new Map(notes.map((n) => [n.sessionId, n]));
  const attMap = new Map(myAttendance.map((a) => [a.sessionId, a]));
  const upcoming = sessions.filter((s) => new Date(s.startsAt).getTime() >= now && s.status === "scheduled");
  const past = sessions.filter((s) => !upcoming.includes(s));
  const myOpen = actionItems.filter((a) => a.item.memberId === me.id && a.item.status === "open");

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">
            <Link to="/portal/pods" style={{ color: "inherit" }}>← Pods</Link>
          </div>
          <h1 className="eh-h1">{pod.name}</h1>
          <p className="eh-sub">{pod.description}</p>
        </div>
        <div className="eh-row">
          <Pill color={pod.kind === "mastermind" ? "purple" : "blue"}>{pod.kind}</Pill>
          <TierPill tier={pod.tierGate} />
        </div>
      </div>

      {!confidentialityAccepted ? (
        <div className="eh-card" style={{ maxWidth: 640 }}>
          <h3>Confidentiality agreement</h3>
          <p className="eh-sm eh-muted">What's said in a POD stays in the POD. It's the trust the whole thing runs on. Before you can see this pod's sessions, commitments and notes, please confirm you'll keep everything shared here strictly confidential — a breach is a conduct matter.</p>
          <button className="eh-btn gold" disabled={accept.isPending} onClick={() => accept.mutate({ podId })}>
            I agree — keep it confidential →
          </button>
        </div>
      ) : (
      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div className="eh-span2" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {myOpen.length > 0 && (
            <div className="eh-card" style={{ borderColor: "#e8d5ac", background: "#fdfaf3" }}>
              <h3>Your open commitments ({myOpen.length})</h3>
              <div className="eh-list">
                {myOpen.map(({ item }) => (
                  <div className="row" key={item.id}>
                    <div>
                      <div className="t">{item.text}</div>
                      <div className="d">Due {relDay(item.dueAt)}</div>
                    </div>
                    <button className="eh-btn gold sm" disabled={complete.isPending}
                            onClick={() => complete.mutate({ id: item.id })}>
                      Mark done ✓
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="eh-card">
            <h3>Sessions</h3>
            {sessions.length === 0 && <Empty big="No sessions yet." p="Your facilitator will schedule the first one." />}
            <div className="eh-list">
              {upcoming.map((s) => (
                <div className="row" key={s.id}>
                  <div>
                    <div className="t">{s.topic ?? "Pod session"}</div>
                    <div className="d">{fmtDay(s.startsAt)} · {fmtDateTime(s.startsAt).split("·")[1]} · {s.durationMin} min</div>
                  </div>
                  <div className="eh-row">
                    {s.videoLink && <a className="eh-btn sm" href={s.videoLink} target="_blank" rel="noreferrer">Join →</a>}
                    <StatusPill status={s.status} />
                  </div>
                </div>
              ))}
              {past.map((s) => {
                const note = noteMap.get(s.id);
                const att = attMap.get(s.id);
                return (
                  <div className="row" key={s.id} style={{ alignItems: "flex-start" }}>
                    <div style={{ flex: 1 }}>
                      <div className="t">{s.topic ?? "Pod session"}</div>
                      <div className="d">{fmtDateTime(s.startsAt)}</div>
                      {note?.summary && (
                        <p className="eh-sm eh-muted" style={{ margin: ".4rem 0 0", whiteSpace: "pre-line" }}>{note.summary}</p>
                      )}
                    </div>
                    <div className="eh-row">
                      {att && <StatusPill status={att.status} />}
                      <StatusPill status={s.status} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="eh-card">
            <h3>All commitments in the room</h3>
            {actionItems.length === 0 && <Empty big="Nothing on the board." />}
            <div className="eh-list">
              {actionItems.map(({ item, user }) => (
                <div className="row" key={item.id}>
                  <div>
                    <div className="t" style={item.status === "done" ? { textDecoration: "line-through", opacity: .6 } : undefined}>
                      {item.text}
                    </div>
                    <div className="d">{user.name ?? "Member"} · due {relDay(item.dueAt)}</div>
                  </div>
                  <StatusPill status={item.status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="eh-card">
          <h3>The room ({roster.length})</h3>
          <div className="eh-list">
            {roster.map(({ member, user, role }) => (
              <div className="row" key={member.id}>
                <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                  <span className="eh-avatar">{initials(user.name)}</span>
                  <div>
                    <div className="t">{user.name ?? "Member"}</div>
                    <div className="d">{member.company ?? ""}</div>
                  </div>
                </div>
                {role !== "member" && <Pill>{role}</Pill>}
              </div>
            ))}
          </div>
          <hr className="eh-divider" />
          <div className="eh-list">
            <div className="row"><span className="d">Facilitator</span><span className="t eh-sm">{pod.facilitator ?? "—"}</span></div>
            <div className="row"><span className="d">Cadence</span><span className="t eh-sm">{pod.cadence ?? "—"}</span></div>
          </div>
        </div>
      </div>
      )}
    </EhShell>
  );
}
