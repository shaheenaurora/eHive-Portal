import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { CHAPTER_STATUS_LABEL, CHAPTER_ROLE_RESP, chapterRoleTitle } from "@contracts/constants";
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

  function refresh() {
    utils.engage.myChapter.invalidate();
    utils.circle.myChapterTransfer.invalidate();
  }

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
                        </div>
                        {b.electionId ? <Pill color="gold">elected</Pill> : null}
                      </div>
                    );
                  })}
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
