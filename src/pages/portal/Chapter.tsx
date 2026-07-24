import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { CHAPTER_STATUS_LABEL } from "@contracts/constants";
import type { ChapterStatus } from "@contracts/constants";

export default function Chapter() {
  const utils = trpc.useUtils();
  const q = trpc.engage.myChapter.useQuery(undefined, { retry: false });
  const [standFor, setStandFor] = useState<number | null>(null);
  const [statement, setStatement] = useState("");

  function refresh() { utils.engage.myChapter.invalidate(); }

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

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead eyebrow="My Chapter" title={ch ? ch.name : "Chapters"}
                sub="Chapters run their own elections, motions and budgets — one member, one vote." />

      {q.isLoading && <Spinner />}

      {q.data && !ch && (
        <div className="eh-card">
          <Empty big="No home chapter yet."
                 p="Chapters are opening city by city. The Circle team will assign your home chapter as yours charters — we'll notify you." />
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
              <div className="v" style={{ fontSize: "1.1rem" }}>{[ch.city, ch.country].filter(Boolean).join(", ") || "—"}</div>
            </div>
          </div>

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
                {e.candidates.map((c: any) => {
                  const result = e.results?.find((r: any) => r.candidateId === c.id);
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
                {e.status === "open" && !e.candidates.some((c: any) => c.mine) && (
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
            const yes = m.votes.find((v: any) => v.choice === "yes")?.n ?? 0;
            const no = m.votes.find((v: any) => v.choice === "no")?.n ?? 0;
            const abstain = m.votes.find((v: any) => v.choice === "abstain")?.n ?? 0;
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
    </EhShell>
  );
}
