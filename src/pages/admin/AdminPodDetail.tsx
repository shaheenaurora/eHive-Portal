import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  Pill,
  StatusPill,
  TierPill,
  Empty,
  Spinner,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDateTime, fmtDay, initials } from "@/lib/ehf";

export default function AdminPodDetail() {
  const { id } = useParams<{ id: string }>();
  const podId = Number(id);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const q = trpc.admin.podAdmin.useQuery({ id: podId }, { retry: false });

  const [addMember, setAddMember] = useState(false);
  const [addSession, setAddSession] = useState(false);
  const [notesFor, setNotesFor] = useState<{
    sessionId: number;
    summary: string;
  } | null>(null);
  const [taskFor, setTaskFor] = useState(false);
  const [attSession, setAttSession] = useState<number | null>(null);

  const invalidate = () => utils.admin.podAdmin.invalidate({ id: podId });

  const addToPod = trpc.admin.addToPod.useMutation({
    onSuccess: () => {
      toast("Added to roster.");
      invalidate();
      setAddMember(false);
    },
    onError: e => toast(e.message),
  });
  const removeFromPod = trpc.admin.removeFromPod.useMutation({
    onSuccess: () => {
      toast("Removed from roster.");
      invalidate();
    },
    onError: e => toast(e.message),
  });
  const createSession = trpc.admin.createSession.useMutation({
    onSuccess: () => {
      toast("Session scheduled.");
      invalidate();
      setAddSession(false);
    },
    onError: e => toast(e.message),
  });
  const setSessionStatus = trpc.admin.setSessionStatus.useMutation({
    onSuccess: () => {
      toast("Session updated.");
      invalidate();
    },
    onError: e => toast(e.message),
  });
  const saveNotes = trpc.admin.saveSessionNotes.useMutation({
    onSuccess: () => {
      toast("Notes published to the pod.");
      invalidate();
      setNotesFor(null);
    },
    onError: e => toast(e.message),
  });
  const markAtt = trpc.admin.markAttendance.useMutation({
    onSuccess: () => {
      toast("Attendance marked — score updated.");
      invalidate();
    },
    onError: e => toast(e.message),
  });
  const assignTask = trpc.admin.assignActionItem.useMutation({
    onSuccess: () => {
      toast("Commitment assigned.");
      invalidate();
      setTaskFor(false);
    },
    onError: e => toast(e.message),
  });

  if (q.isLoading)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Spinner />
      </EhShell>
    );
  if (!q.data)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Empty big="Pod not found." />
      </EhShell>
    );

  const {
    pod,
    roster,
    sessions,
    notes,
    attendance,
    actionItems,
    allMembers,
    health,
  } = q.data;
  const noteMap = new Map(notes.map(n => [n.sessionId, n]));
  const rosterIds = new Set(roster.map(r => r.member.id));
  const notInPod = allMembers.filter(m => !rosterIds.has(m.id));

  function onAddSession(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createSession.mutate({
      podId,
      startsAt: new Date(String(f.get("startsAt"))),
      durationMin: Number(f.get("durationMin")) || 90,
      topic: String(f.get("topic")) || undefined,
      videoLink: String(f.get("videoLink")) || undefined,
      location: String(f.get("location")) || undefined,
    });
  }

  function onAssign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    assignTask.mutate({
      podId,
      memberId: Number(f.get("memberId")),
      text: String(f.get("text")),
      dueAt: f.get("dueAt") ? new Date(String(f.get("dueAt"))) : undefined,
      sessionId: f.get("sessionId") ? Number(f.get("sessionId")) : undefined,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      {isMobile && (
        <button
          className="eh-btn ghost sm eh-mb"
          onClick={() => navigate(-1)}
          style={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            background: "var(--eh-card, #fff)",
          }}
        >
          ← Back
        </button>
      )}
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">
            <Link to="/admin/pods" style={{ color: "inherit" }}>
              ← Pods
            </Link>
          </div>
          <h1 className="eh-h1">{pod.name}</h1>
          <p className="eh-sub">
            {pod.cadence ?? ""} · {pod.facilitator ?? "No facilitator"}
          </p>
        </div>
        <div className="eh-row">
          {health && (
            <span
              title={`Attendance ${health.attendance}% · Commitments kept ${health.commitments}% · ${health.sessions} recent sessions`}
            >
              <Pill
                color={
                  health.total >= 75
                    ? "green"
                    : health.total >= 55
                      ? "gold"
                      : "red"
                }
              >
                health {health.total}
              </Pill>
            </span>
          )}
          <Pill color={pod.kind === "mastermind" ? "purple" : "blue"}>
            {pod.kind}
          </Pill>
          <TierPill tier={pod.tierGate} />
          <button
            className="eh-btn gold sm"
            onClick={() => setAddSession(true)}
          >
            + Session
          </button>
          <button className="eh-btn sm" onClick={() => setAddMember(true)}>
            + Member
          </button>
        </div>
      </div>

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div className="eh-card">
          <h3>
            Roster ({roster.length}/{pod.capacity})
          </h3>
          {roster.length === 0 && (
            <Empty big="Empty room." p="Add the first member." />
          )}
          <div className="eh-list">
            {roster.map(({ member, userName, userEmail, pm }) => (
              <div className="row" key={pm.id}>
                <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                  <span className="eh-avatar">{initials(userName)}</span>
                  <div>
                    <div className="t">{userName ?? "—"}</div>
                    <div className="d">{member.company ?? userEmail ?? ""}</div>
                  </div>
                </div>
                <div className="eh-row">
                  {pm.role !== "member" && <Pill>{pm.role}</Pill>}
                  <button
                    className="eh-btn ghost sm"
                    aria-label="Remove from pod"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Remove from pod?",
                          body: `${userName ?? "This member"} will be removed from the pod roster.`,
                          danger: true,
                          confirmLabel: "Remove",
                        })
                      ) {
                        removeFromPod.mutate({ podId, memberId: member.id });
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className="eh-span2"
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <div className="eh-card">
            <h3>Sessions</h3>
            {sessions.length === 0 && <Empty big="No sessions scheduled." />}
            <div className="eh-list">
              {sessions.map(s => {
                const note = noteMap.get(s.id);
                const att = attendance.filter(a => a.sessionId === s.id);
                return (
                  <div
                    className="row"
                    key={s.id}
                    style={{ alignItems: "flex-start", display: "block" }}
                  >
                    <div className="eh-between">
                      <div>
                        <div className="t">{s.topic ?? "Pod session"}</div>
                        <div className="d">
                          {fmtDay(s.startsAt)} ·{" "}
                          {fmtDateTime(s.startsAt).split("·")[1]} ·{" "}
                          {s.durationMin} min · {att.length} attendance marks
                        </div>
                      </div>
                      <div className="eh-row">
                        <StatusPill status={s.status} />
                        <button
                          className="eh-btn ghost sm"
                          onClick={() =>
                            setAttSession(attSession === s.id ? null : s.id)
                          }
                        >
                          Attendance
                        </button>
                        <button
                          className="eh-btn ghost sm"
                          onClick={() =>
                            setNotesFor({
                              sessionId: s.id,
                              summary: note?.summary ?? "",
                            })
                          }
                        >
                          Notes
                        </button>
                        {s.status === "scheduled" && (
                          <button
                            className="eh-btn sm"
                            onClick={() =>
                              setSessionStatus.mutate({
                                id: s.id,
                                status: "done",
                              })
                            }
                          >
                            Mark done
                          </button>
                        )}
                      </div>
                    </div>
                    {attSession === s.id && (
                      <div
                        className="eh-card"
                        style={{
                          background: "var(--eh-paper)",
                          marginTop: ".7rem",
                          padding: ".8rem 1rem",
                        }}
                      >
                        <div className="eh-list">
                          {roster.map(({ member, userName }) => {
                            const cur = att.find(a => a.memberId === member.id);
                            return (
                              <div className="row" key={member.id}>
                                <span className="t eh-sm">{userName}</span>
                                <div className="eh-row">
                                  {(
                                    ["attended", "excused", "absent"] as const
                                  ).map(st => (
                                    <button
                                      key={st}
                                      className={
                                        "eh-btn sm" +
                                        (cur?.status === st
                                          ? st === "attended"
                                            ? " gold"
                                            : ""
                                          : " ghost")
                                      }
                                      onClick={() =>
                                        markAtt.mutate({
                                          sessionId: s.id,
                                          memberId: member.id,
                                          status: st,
                                        })
                                      }
                                    >
                                      {st}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {note?.summary && (
                      <p
                        className="eh-sm eh-muted"
                        style={{ margin: ".5rem 0 0", whiteSpace: "pre-line" }}
                      >
                        {note.summary}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Commitments board</h3>
              <button className="eh-btn sm" onClick={() => setTaskFor(true)}>
                + Assign
              </button>
            </div>
            {actionItems.length === 0 && <Empty big="No commitments yet." />}
            <div className="eh-list">
              {actionItems.map(({ ai, userName }) => (
                <div className="row" key={ai.id}>
                  <div>
                    <div
                      className="t"
                      style={
                        ai.status === "done"
                          ? { textDecoration: "line-through", opacity: 0.6 }
                          : undefined
                      }
                    >
                      {ai.text}
                    </div>
                    <div className="d">
                      {userName ?? "—"} · due{" "}
                      {ai.dueAt ? fmtDay(ai.dueAt) : "—"}
                    </div>
                  </div>
                  <StatusPill status={ai.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {addMember && (
        <Modal title="Add member to roster" onClose={() => setAddMember(false)}>
          <div
            className="eh-list"
            style={{ maxHeight: 380, overflowY: "auto" }}
          >
            {notInPod.length === 0 && <Empty big="Everyone is already in." />}
            {notInPod.map(m => (
              <div className="row" key={m.id}>
                <div>
                  <div className="t">{m.userName ?? "—"}</div>
                  <div className="d">
                    {m.company ?? m.userEmail ?? ""} · {m.tier}
                  </div>
                </div>
                <button
                  className="eh-btn gold sm"
                  disabled={addToPod.isPending}
                  onClick={() => addToPod.mutate({ podId, memberId: m.id })}
                >
                  Add
                </button>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {addSession && (
        <Modal title="Schedule a session" onClose={() => setAddSession(false)}>
          <form onSubmit={onAddSession}>
            <Field label="Topic">
              <input
                className="eh-input"
                name="topic"
                placeholder="Q4 planning"
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Starts at">
                <input
                  className="eh-input"
                  name="startsAt"
                  type="datetime-local"
                  required
                />
              </Field>
              <Field label="Duration (min)">
                <input
                  className="eh-input"
                  name="durationMin"
                  type="number"
                  min={15}
                  max={480}
                  defaultValue={90}
                />
              </Field>
            </div>
            <Field label="Video link">
              <input
                className="eh-input"
                name="videoLink"
                placeholder="https://meet.google.com/…"
              />
            </Field>
            <Field label="Location (if in person)">
              <input
                className="eh-input"
                name="location"
                placeholder="eHive Majlis, DIFC"
              />
            </Field>
            <button
              className="eh-btn gold"
              type="submit"
              disabled={createSession.isPending}
            >
              Schedule →
            </button>
          </form>
        </Modal>
      )}

      {notesFor && (
        <Modal
          title="Session notes (visible to the pod)"
          onClose={() => setNotesFor(null)}
        >
          <Field label="Summary">
            <textarea
              className="eh-textarea"
              style={{ minHeight: 160 }}
              value={notesFor.summary}
              onChange={e =>
                setNotesFor({ ...notesFor, summary: e.target.value })
              }
              placeholder="What was decided, who committed to what."
            />
          </Field>
          <button
            className="eh-btn gold"
            disabled={saveNotes.isPending}
            onClick={() =>
              saveNotes.mutate({
                sessionId: notesFor.sessionId,
                summary: notesFor.summary,
              })
            }
          >
            Publish notes →
          </button>
        </Modal>
      )}

      {taskFor && (
        <Modal title="Assign a commitment" onClose={() => setTaskFor(false)}>
          <form onSubmit={onAssign}>
            <Field label="Member">
              <select className="eh-select" name="memberId" required>
                {roster.map(({ member, userName }) => (
                  <option key={member.id} value={member.id}>
                    {userName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="The commitment">
              <textarea
                className="eh-textarea"
                name="text"
                required
                minLength={2}
                style={{ minHeight: 70 }}
                placeholder="Specific, checkable, dated."
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Due date">
                <input className="eh-input" name="dueAt" type="date" />
              </Field>
              <Field label="From session (optional)">
                <select className="eh-select" name="sessionId" defaultValue="">
                  <option value="">—</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.topic ?? fmtDay(s.startsAt)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <button
              className="eh-btn gold"
              type="submit"
              disabled={assignTask.isPending}
            >
              Assign →
            </button>
          </form>
        </Modal>
      )}
    </EhShell>
  );
}
