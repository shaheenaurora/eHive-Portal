import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, Bar, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { CHAPTER_STATUS_LABEL, CHAPTER_ROLE_RESP, CHAPTER_ROLE_METRIC, chapterRoleTitle,
  HEALTH_COMPONENTS, HEALTH_BAND_LABEL, HEALTH_BAND_COLOR, healthBand,
  ROLE_ONBOARDING_STEPS, CHAPTER_ROLE_LABEL } from "@contracts/constants";
import { FREQUENCY_LABEL, periodLabel, type Frequency } from "@contracts/cadence";

const CADENCE_STATUS_COLOR: Record<string, "green" | "gold" | "red" | "grey"> = {
  kept: "green", rescheduled: "gold", missed: "red", open: "grey",
};
import type { ChapterStatus } from "@contracts/constants";

export default function Chapter() {
  const utils = trpc.useUtils();
  const q = trpc.engage.myChapter.useQuery(undefined, { retry: false });
  const dir = trpc.circle.chaptersDirectory.useQuery(undefined, { retry: false });
  const myTransfer = trpc.circle.myChapterTransfer.useQuery(undefined, { retry: false });
  const [standFor, setStandFor] = useState<number | null>(null);
  const [statement, setStatement] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [toChapter, setToChapter] = useState("");
  const [transferNote, setTransferNote] = useState("");

  const isOfficer = (q.data?.myRoles ?? []).length > 0;
  const overview = trpc.officer.overview.useQuery(undefined, { retry: false, enabled: isOfficer });
  const [signupSearch, setSignupSearch] = useState("");
  const candidates = trpc.officer.signupCandidates.useQuery(
    { q: signupSearch || undefined }, { retry: false, enabled: isOfficer },
  );
  const [mentee, setMentee] = useState("");
  const [mentor, setMentor] = useState("");
  const [learnTitle, setLearnTitle] = useState("");
  const [learnBody, setLearnBody] = useState("");
  const [learnUrl, setLearnUrl] = useState("");

  function refresh() {
    utils.engage.myChapter.invalidate();
    utils.circle.myChapterTransfer.invalidate();
    utils.officer.overview.invalidate();
    utils.officer.signupCandidates.invalidate();
  }

  const signup = trpc.officer.signupMember.useMutation({
    onSuccess: () => { toast("Member added to your chapter."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const assignMentor = trpc.officer.assignMentor.useMutation({
    onSuccess: () => { toast("Mentor assigned."); setMentee(""); setMentor(""); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setupCadences = trpc.officer.setupCadences.useMutation({
    onSuccess: (r) => { toast(r.added ? `Operating rhythm set up — ${r.added} cadences.` : "Already set up."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const updateRoleOnboarding = trpc.officer.updateRoleOnboarding.useMutation({
    onSuccess: () => refresh(),
    onError: (e) => toast(e.message),
  });
  const markCadence = trpc.officer.markCadence.useMutation({
    onSuccess: () => { toast("Cadence updated."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const postLearning = trpc.officer.postLearning.useMutation({
    onSuccess: () => { toast("Learning posted to your chapter."); setLearnTitle(""); setLearnBody(""); setLearnUrl(""); refresh(); },
    onError: (e) => toast(e.message),
  });
  const deleteLearning = trpc.officer.deleteLearning.useMutation({
    onSuccess: () => { toast("Removed."); refresh(); },
    onError: (e) => toast(e.message),
  });

  const requestTransfer = trpc.circle.requestChapterTransfer.useMutation({
    onSuccess: () => {
      toast("Transfer request submitted — the Circle team will review it.");
      setTransferOpen(false); setToChapter(""); setTransferNote(""); refresh();
    },
    onError: (e) => toast(e.message),
  });

  const stand = trpc.engage.standForElection.useMutation({
    onSuccess: () => { toast("You're on the ballot."); setStandFor(null); setStatement(""); refresh(); },
    onError: (e) => toast(e.message),
  });
  const vote = trpc.engage.castVote.useMutation({
    onSuccess: () => { toast("Ballot cast — it's secret and counted."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const voteMotion = trpc.engage.voteMotion.useMutation({
    onSuccess: () => { toast("Vote recorded — one member, one vote."); refresh(); },
    onError: (e) => toast(e.message),
  });

  const ch = q.data?.chapter;
  const chapters = dir.data?.chapters ?? [];
  const chapterName = (id: number | null | undefined) => chapters.find((c) => c.id === id)?.name ?? "another chapter";
  const pending = myTransfer.data ?? null;
  const options = chapters.filter((c) => c.id !== (ch?.id ?? dir.data?.homeChapterId));

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead eyebrow="My Chapter" title={ch ? ch.name : "Chapters"}
                sub="Chapters run their own elections, motions and budgets — one member, one vote." />

      {q.isLoading && <Spinner />}

      {pending && (
        <div className="eh-banner eh-mb">
          <span className="eh-sm">
            <b>Transfer to {chapterName(pending.toChapterId)}</b> is awaiting management approval.
          </span>
        </div>
      )}

      {q.data && !ch && (
        <div className="eh-card">
          <Empty big="No home chapter yet."
                 p="Members belong to a home chapter. If a chapter in your city is open, you can request to join — the Circle team confirms your placement." />
          {!pending && options.length > 0 && (
            <div style={{ textAlign: "center", marginTop: ".5rem" }}>
              <button className="eh-btn gold" onClick={() => setTransferOpen(true)}>Request a chapter →</button>
            </div>
          )}
        </div>
      )}

      {ch && (
        <>
          <div className="eh-grid g3 eh-mb">
            <div className="eh-card eh-stat">
              <div className="k">Status</div>
              <div className="v"><Pill color="gold">{CHAPTER_STATUS_LABEL[ch.status as ChapterStatus] ?? ch.status}</Pill></div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Members</div>
              <div className="v eh-num">{q.data!.memberCount}</div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Location</div>
              <div className="v" style={{ fontSize: "1.1rem" }}>{[ch.zone, ch.city, ch.state, ch.country].filter(Boolean).join(", ") || "—"}</div>
            </div>
          </div>

          {!pending && options.length > 0 && (
            <div className="eh-mb" style={{ marginTop: "-.25rem" }}>
              <button className="eh-btn ghost sm" onClick={() => setTransferOpen(true)}>Request transfer to another chapter →</button>
            </div>
          )}

          {/* leadership board */}
          {(q.data!.board ?? []).length > 0 && (
            <>
              <h2 className="eh-h2" style={{ margin: "1.5rem 0 .75rem" }}>Chapter leadership</h2>
              <div className="eh-card">
                <div className="eh-list">
                  {q.data!.board!.map((b) => {
                    const mine = (q.data!.myRoles ?? []).includes(b.role);
                    return (
                      <div className="row" key={b.id} style={{ alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div className="t">{chapterRoleTitle(b.role, b.title)} — {b.memberName} {mine && <Pill color="green">you</Pill>}</div>
                          <div className="d">{b.responsibilities || CHAPTER_ROLE_RESP[b.role] || ""}</div>
                          {CHAPTER_ROLE_METRIC[b.role] && <div className="d eh-muted">Accountable for: {CHAPTER_ROLE_METRIC[b.role]}</div>}
                        </div>
                        {b.electionId ? <Pill color="gold">elected</Pill> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* officer console — only for members who hold a chapter role */}
          {isOfficer && overview.data && (
            <>
              <div className="eh-between" style={{ margin: "1.5rem 0 .75rem" }}>
                <h2 className="eh-h2" style={{ margin: 0 }}>Chapter console</h2>
                <Pill color="gold">Officer</Pill>
              </div>
              <p className="eh-sm eh-muted" style={{ marginTop: "-.4rem" }}>
                You lead this chapter. Sign up members, assign mentors, onboard newcomers and share learnings — scoped to {ch.name}.
              </p>

              {/* Role Onboarding Playbook — your first-90-days checklist per active role */}
              {(overview.data.myRoles ?? []).map((r) => {
                const ALL = (1 << ROLE_ONBOARDING_STEPS.length) - 1;
                const done = ROLE_ONBOARDING_STEPS.filter((_, i) => (r.onboardingMask & (1 << i)) !== 0).length;
                const complete = (r.onboardingMask & ALL) === ALL;
                if (complete) return null;
                const roleName = r.role === "other" ? (r.title || "Officer") : (CHAPTER_ROLE_LABEL[r.role] || r.role);
                return (
                  <div className="eh-card eh-mb" key={`onb-${r.id}`}>
                    <div className="eh-between" style={{ alignItems: "flex-start" }}>
                      <div>
                        <h3 style={{ margin: 0 }}>Get started as {roleName}</h3>
                        <div className="eh-muted eh-sm">Your onboarding playbook — {done}/{ROLE_ONBOARDING_STEPS.length} done.</div>
                      </div>
                      <Pill color="gold">New role</Pill>
                    </div>
                    <div className="eh-list" style={{ marginTop: ".7rem" }}>
                      {ROLE_ONBOARDING_STEPS.map((s, i) => {
                        const isDone = (r.onboardingMask & (1 << i)) !== 0;
                        return (
                          <button key={s.key} className="row" disabled={updateRoleOnboarding.isPending}
                            onClick={() => updateRoleOnboarding.mutate({ roleId: r.id, mask: r.onboardingMask ^ (1 << i) })}
                            style={{ display: "flex", gap: ".7rem", alignItems: "flex-start", textAlign: "left",
                              background: "none", border: 0, width: "100%", cursor: "pointer", padding: ".5rem 0" }}>
                            <span aria-hidden style={{ flex: "none", width: 20, height: 20, borderRadius: 5, marginTop: 1,
                              border: `1.5px solid ${isDone ? "var(--eh-good,#2E7D5B)" : "var(--eh-border)"}`,
                              background: isDone ? "var(--eh-good,#2E7D5B)" : "transparent", color: "#fff",
                              display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700 }}>{isDone ? "✓" : ""}</span>
                            <span>
                              <b style={{ fontSize: ".95rem", textDecoration: isDone ? "line-through" : "none", opacity: isDone ? .7 : 1 }}>{s.label}</b>
                              <span className="eh-sm eh-muted" style={{ display: "block" }}>{s.hint}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {overview.data.health && (
                <div className="eh-card eh-mb">
                  <div className="eh-between" style={{ alignItems: "flex-start" }}>
                    <div><h3 style={{ margin: 0 }}>Chapter Health Index</h3><div className="eh-muted eh-sm">The number your chapter is measured on.</div></div>
                    <div style={{ textAlign: "right" }}>
                      <div className="eh-num" style={{ fontSize: "2.2rem", fontWeight: 700, lineHeight: 1, color: "var(--eh-gold)" }}>{overview.data.health.total}</div>
                      <Pill color={HEALTH_BAND_COLOR[healthBand(overview.data.health.total)]}>{HEALTH_BAND_LABEL[healthBand(overview.data.health.total)]}</Pill>
                    </div>
                  </div>
                  <div className="eh-mt" style={{ display: "grid", gap: ".45rem" }}>
                    {HEALTH_COMPONENTS.map((c) => {
                      const v = (overview.data!.health.components as Record<string, number>)[c.key];
                      return (
                        <div key={c.key} style={{ display: "grid", gridTemplateColumns: "9.5rem 1fr 2.4rem", alignItems: "center", gap: ".5rem" }}>
                          <span className="eh-sm" title={c.desc}>{c.label}</span>
                          <Bar pct={v} />
                          <span className="eh-num eh-sm" style={{ textAlign: "right" }}>{v}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* operating rhythm */}
              <div className="eh-card eh-mb">
                <div className="eh-between">
                  <h3 style={{ margin: 0 }}>Operating rhythm</h3>
                  {overview.data.cadence && overview.data.cadence.cadences.length > 0 && (
                    <Pill color={overview.data.cadence.adherence >= 80 ? "green" : overview.data.cadence.adherence >= 60 ? "gold" : "red"}>{overview.data.cadence.adherence}% kept</Pill>
                  )}
                </div>
                {(!overview.data.cadence || overview.data.cadence.cadences.length === 0) ? (
                  <div style={{ textAlign: "center", padding: ".4rem 0" }}>
                    <p className="eh-sm eh-muted">Set your chapter's recurring rhythm — meetings, huddle, board, financial close.</p>
                    <button className="eh-btn gold" disabled={setupCadences.isPending} onClick={() => setupCadences.mutate()}>Set up the operating rhythm →</button>
                  </div>
                ) : (
                  <div className="eh-list eh-mt">
                    {overview.data.cadence.cadences.map((c) => (
                      <div className="row" key={c.id} style={{ alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div className="t">{c.title} <span className="eh-muted eh-sm">· {FREQUENCY_LABEL[c.frequency as Frequency]}</span></div>
                          <div className="d">Last {c.expected}: {c.kept} kept{c.missed ? `, ${c.missed} missed` : ""}</div>
                        </div>
                        <div className="eh-row" style={{ gap: ".4rem" }}>
                          <Pill color={CADENCE_STATUS_COLOR[c.currentStatus]}>{c.currentStatus === "open" ? `due ${periodLabel(c.frequency as Frequency)}` : c.currentStatus}</Pill>
                          {c.currentStatus !== "kept" && (
                            <>
                              <button className="eh-btn sm gold" disabled={markCadence.isPending} onClick={() => markCadence.mutate({ cadenceId: c.id, status: "kept" })}>Kept</button>
                              <button className="eh-btn sm ghost" disabled={markCadence.isPending} onClick={() => markCadence.mutate({ cadenceId: c.id, status: "rescheduled" })}>Resched.</button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(overview.data.onboarding ?? []).length > 0 && (
                <div className="eh-card eh-mb">
                  <h3>Onboarding cohort · first 90 days</h3>
                  <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>New members and how far through onboarding they are. POD placement is due by day 60.</p>
                  <div className="eh-list">
                    {overview.data.onboarding.map((o) => (
                      <div className="row" key={o.id}>
                        <div style={{ flex: 1 }}>
                          <div className="t">{o.name}</div>
                          <div className="d">Day {o.dayCount} · {o.doneCount}/{o.total} milestones{o.dayCount > 60 && o.stage < 3 ? " · behind" : ""}</div>
                        </div>
                        <div style={{ width: "6rem" }}><Bar pct={o.percent} /></div>
                        <span className="eh-num eh-sm" style={{ width: "2.4rem", textAlign: "right" }}>{o.percent}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="eh-grid g2" style={{ alignItems: "start" }}>
                {/* sign up members */}
                <div className="eh-card">
                  <h3>Sign up members</h3>
                  <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>Add an unassigned member to your chapter.</p>
                  <Field label="Search">
                    <input className="eh-input" value={signupSearch} onChange={(e) => setSignupSearch(e.target.value)} placeholder="Name, email or company" />
                  </Field>
                  <div className="eh-list">
                    {(candidates.data ?? []).length === 0 && <div className="eh-sm eh-muted">No unassigned members match.</div>}
                    {(candidates.data ?? []).map((c) => (
                      <div className="row" key={c.id}>
                        <div style={{ flex: 1 }}>
                          <div className="t">{c.name ?? c.email}</div>
                          <div className="d">{c.company ?? c.email ?? ""}</div>
                        </div>
                        <button className="eh-btn sm gold" disabled={signup.isPending}
                                onClick={() => signup.mutate({ memberId: c.id })}>Add →</button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* assign mentor */}
                <div className="eh-card">
                  <h3>Assign a mentor</h3>
                  <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>Pair a member with a mentor from your chapter.</p>
                  <Field label="Member (mentee)">
                    <select className="eh-select" value={mentee} onChange={(e) => setMentee(e.target.value)}>
                      <option value="">Select…</option>
                      {overview.data.roster.map((m) => <option key={m.id} value={m.id}>{m.name}{m.hasMentor ? " (has mentor)" : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="Mentor">
                    <select className="eh-select" value={mentor} onChange={(e) => setMentor(e.target.value)}>
                      <option value="">Select…</option>
                      {overview.data.roster.filter((m) => String(m.id) !== mentee).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </Field>
                  <button className="eh-btn gold" disabled={assignMentor.isPending || !mentee || !mentor}
                          onClick={() => assignMentor.mutate({ menteeId: Number(mentee), mentorId: Number(mentor) })}>
                    Assign mentor
                  </button>
                </div>
              </div>

              {/* onboarding queue */}
              <div className="eh-card eh-mt">
                <h3>Onboarding — members without a mentor</h3>
                <div className="eh-list">
                  {overview.data.roster.filter((m) => !m.hasMentor).length === 0 && (
                    <div className="eh-sm eh-muted">Everyone in your chapter has a mentor. 🎉</div>
                  )}
                  {overview.data.roster.filter((m) => !m.hasMentor).map((m) => (
                    <div className="row" key={m.id}>
                      <div style={{ flex: 1 }}><div className="t">{m.name}</div><div className="d">{m.company ?? ""}</div></div>
                      <button className="eh-btn ghost sm" onClick={() => { setMentee(String(m.id)); setMentor(""); }}>Assign mentor →</button>
                    </div>
                  ))}
                </div>
              </div>

              {/* post a learning */}
              <div className="eh-card eh-mt">
                <h3>Share a learning</h3>
                <Field label="Title"><input className="eh-input" value={learnTitle} onChange={(e) => setLearnTitle(e.target.value)} placeholder="e.g. How we filled 3 seats last month" /></Field>
                <Field label="Details (optional)"><textarea className="eh-textarea" value={learnBody} onChange={(e) => setLearnBody(e.target.value)} maxLength={8000} /></Field>
                <Field label="Link (optional)"><input className="eh-input" value={learnUrl} onChange={(e) => setLearnUrl(e.target.value)} placeholder="https://…" /></Field>
                <button className="eh-btn gold" disabled={postLearning.isPending || learnTitle.trim().length < 3}
                        onClick={() => postLearning.mutate({ title: learnTitle.trim(), body: learnBody || undefined, url: learnUrl || undefined })}>
                  Post to chapter
                </button>
              </div>
            </>
          )}

          {/* chapter learnings — visible to all members */}
          {(q.data!.learnings ?? []).length > 0 && (
            <>
              <h2 className="eh-h2" style={{ margin: "1.5rem 0 .75rem" }}>Chapter learnings</h2>
              <div className="eh-card">
                <div className="eh-list">
                  {q.data!.learnings!.map((l) => (
                    <div className="row" key={l.id} style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div className="t">{l.title}</div>
                        {l.body && <div className="d" style={{ whiteSpace: "pre-wrap" }}>{l.body}</div>}
                        {l.url && <a className="eh-sm" href={l.url} target="_blank" rel="noreferrer" style={{ color: "var(--eh-gold)" }}>Open link →</a>}
                        <div className="d eh-muted">{l.authorName} · {fmtDate(l.createdAt)}</div>
                      </div>
                      {isOfficer && (
                        <button className="eh-btn ghost sm danger" disabled={deleteLearning.isPending}
                                onClick={() => deleteLearning.mutate({ id: l.id })}>Remove</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* elections */}
          <h2 className="eh-h2" style={{ margin: "1.5rem 0 .75rem" }}>Elections</h2>
          {(q.data!.elections ?? []).length === 0 && (
            <div className="eh-card"><Empty big="No elections right now." p="Chapter seats open every term — nominations are announced here." /></div>
          )}
          {(q.data!.elections ?? []).map((e) => (
            <div className="eh-card eh-mb" key={e.id}>
              <div className="eh-between">
                <div>
                  <h3 style={{ margin: 0 }}>{e.title}</h3>
                  <div className="eh-muted eh-sm">Seat: {e.seat} · Quorum {e.quorumPct}% · Turnout {e.turnout}/{q.data!.memberCount}</div>
                </div>
                {e.status === "open" && <Pill color="blue">nominations open</Pill>}
                {e.status === "voting" && <Pill color="gold">voting open</Pill>}
                {e.status === "closed" && <Pill color="green">closed</Pill>}
              </div>

              <div className="eh-list eh-mt">
                {e.candidates.map((c) => {
                  const result = e.results?.find((r) => r.candidateId === c.id);
                  return (
                    <div className="row" key={c.id} style={{ alignItems: "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <div className="t">{c.name}{c.mine ? " (you)" : ""}</div>
                        {c.statement && <div className="d">{c.statement}</div>}
                      </div>
                      {e.status === "closed" && result !== undefined && (
                        <Pill color="purple">{result.n} vote{result.n === 1 ? "" : "s"}</Pill>
                      )}
                      {e.status === "voting" && !e.voted && (
                        <button className="eh-btn sm gold" disabled={vote.isPending}
                                onClick={() => vote.mutate({ electionId: e.id, candidateId: c.id })}>
                          Vote
                        </button>
                      )}
                    </div>
                  );
                })}
                {e.candidates.length === 0 && <p className="eh-muted eh-sm">No candidates yet.</p>}
              </div>

              <div className="eh-mt" style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}>
                {e.status === "open" && !e.candidates.some((c) => c.mine) && (
                  <button className="eh-btn sm" onClick={() => { setStandFor(e.id); setStatement(""); }}>
                    Stand for this seat →
                  </button>
                )}
                {e.status === "voting" && e.voted && <Pill color="green">ballot cast ✓</Pill>}
                {e.status === "closed" && e.resultHash && (
                  <span className="eh-muted eh-sm" style={{ fontFamily: "monospace" }}>
                    result digest: {e.resultHash.slice(0, 16)}…
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* motions */}
          <h2 className="eh-h2" style={{ margin: "1.5rem 0 .75rem" }}>Motions</h2>
          {(q.data!.motions ?? []).length === 0 && (
            <div className="eh-card"><Empty big="No open motions." p="Chapter motions are tabled by the chapter board." /></div>
          )}
          {(q.data!.motions ?? []).map((m) => {
            const yes = m.votes.find((v) => v.choice === "yes")?.n ?? 0;
            const no = m.votes.find((v) => v.choice === "no")?.n ?? 0;
            const abstain = m.votes.find((v) => v.choice === "abstain")?.n ?? 0;
            return (
              <div className="eh-card eh-mb" key={m.id}>
                <div className="eh-between">
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: 0 }}>{m.title}</h3>
                    {m.body && <p className="eh-sm eh-muted">{m.body}</p>}
                  </div>
                  {m.status === "open" && <Pill color="blue">open</Pill>}
                  {m.status === "passed" && <Pill color="green">passed</Pill>}
                  {m.status === "rejected" && <Pill>rejected</Pill>}
                </div>
                <div className="eh-mt" style={{ display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                  {m.status === "open" && !m.myChoice && (
                    <>
                      <button className="eh-btn sm gold" disabled={voteMotion.isPending}
                              onClick={() => voteMotion.mutate({ motionId: m.id, choice: "yes" })}>Yes</button>
                      <button className="eh-btn sm" disabled={voteMotion.isPending}
                              onClick={() => voteMotion.mutate({ motionId: m.id, choice: "no" })}>No</button>
                      <button className="eh-btn ghost sm" disabled={voteMotion.isPending}
                              onClick={() => voteMotion.mutate({ motionId: m.id, choice: "abstain" })}>Abstain</button>
                    </>
                  )}
                  {m.myChoice && <Pill color="purple">you voted {m.myChoice}</Pill>}
                  <span className="eh-muted eh-sm">yes {yes} · no {no} · abstain {abstain}</span>
                </div>
              </div>
            );
          })}

          {/* budgets */}
          {(q.data!.budgets ?? []).length > 0 && (
            <>
              <h2 className="eh-h2" style={{ margin: "1.5rem 0 .75rem" }}>Chapter budget</h2>
              <div className="eh-card">
                <div className="eh-list">
                  {q.data!.budgets!.map((b) => (
                    <div className="row" key={b.id}>
                      <div style={{ flex: 1 }}>
                        <div className="t">{b.label}</div>
                        <div className="d">{b.kind} · {fmtDate(b.createdAt)}</div>
                      </div>
                      <span className="eh-num">AED {b.amount.toLocaleString()}</span>
                      {b.status === "approved" && <Pill color="green">approved</Pill>}
                      {b.status === "spent" && <Pill color="purple">spent</Pill>}
                      {b.status === "proposed" && <Pill color="blue">proposed</Pill>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {standFor !== null && (
        <Modal title="Stand for election" onClose={() => setStandFor(null)}>
          <p className="eh-sm eh-muted">
            Your name goes on the ballot for this seat. Voting is by secret ballot with a quorum requirement.
          </p>
          <Field label="Your statement (why you?)">
            <textarea className="eh-textarea" value={statement} onChange={(e) => setStatement(e.target.value)}
                      maxLength={1000} placeholder="What you'd do for the chapter." />
          </Field>
          <button className="eh-btn gold" style={{ width: "100%" }} disabled={stand.isPending}
                  onClick={() => stand.mutate({ electionId: standFor, statement: statement || undefined })}>
            {stand.isPending ? "Submitting…" : "Put me on the ballot →"}
          </button>
        </Modal>
      )}

      {transferOpen && (
        <Modal title={ch ? "Request a chapter transfer" : "Request to join a chapter"} onClose={() => setTransferOpen(false)}>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            {ch ? "Choose the chapter you'd like to move to. " : "Choose the chapter you'd like to join. "}
            The Circle team reviews and confirms every placement — your home chapter changes once it's approved.
          </p>
          <Field label="Chapter">
            <select className="eh-select" value={toChapter} onChange={(e) => setToChapter(e.target.value)}>
              <option value="">Select a chapter…</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{[c.zone, c.city, c.country].filter(Boolean).length ? ` — ${[c.zone, c.city, c.country].filter(Boolean).join(", ")}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason (optional)">
            <textarea className="eh-textarea" value={transferNote} onChange={(e) => setTransferNote(e.target.value)}
                      maxLength={500} placeholder="e.g. I've relocated to Abu Dhabi." />
          </Field>
          <button className="eh-btn gold" style={{ width: "100%" }} disabled={requestTransfer.isPending || !toChapter}
                  onClick={() => requestTransfer.mutate({ toChapterId: Number(toChapter), note: transferNote || undefined })}>
            {requestTransfer.isPending ? "Submitting…" : "Submit request →"}
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
