import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Spinner, Modal, Field, Empty, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { CHAPTER_STATUS_LABEL } from "@contracts/constants";
import type { ChapterStatus } from "@contracts/constants";

const STATUS_COLOR: Record<string, "grey" | "blue" | "gold" | "green" | "red"> = {
  seed: "grey", provisional: "blue", chartered: "gold", mature: "green", at_risk: "red",
};

export default function AdminChapters() {
  const utils = trpc.useUtils();
  const list = trpc.adminEngage.chaptersAdmin.useQuery(undefined, { retry: false });
  const [sel, setSel] = useState<number | null>(null);
  const detail = trpc.adminEngage.chapterDetail.useQuery({ id: sel! }, { retry: false, enabled: sel !== null });

  const [chapterOpen, setChapterOpen] = useState(false);
  const [electionOpen, setElectionOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  function refresh() {
    utils.adminEngage.chaptersAdmin.invalidate();
    utils.adminEngage.chapterDetail.invalidate();
  }

  const saveChapter = trpc.adminEngage.saveChapter.useMutation({
    onSuccess: () => { toast("Chapter saved."); setChapterOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const saveElection = trpc.adminEngage.saveElection.useMutation({
    onSuccess: () => { toast("Election created — nominations open."); setElectionOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setElStatus = trpc.adminEngage.setElectionStatus.useMutation({
    onSuccess: (r) => {
      toast(r.quorumMet !== undefined
        ? `Election closed — turnout ${r.turnout}/${r.memberCount}, quorum ${r.quorumMet ? "met" : "NOT met"}. Result digest published.`
        : "Election updated.");
      refresh();
    },
    onError: (e) => toast(e.message),
  });
  const saveMotion = trpc.adminEngage.saveMotion.useMutation({
    onSuccess: () => { toast("Motion tabled."); setMotionOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const closeMotion = trpc.adminEngage.closeMotion.useMutation({
    onSuccess: (r) => { toast(`Motion ${r.status} — yes ${r.yes}, no ${r.no}.`); refresh(); },
    onError: (e) => toast(e.message),
  });
  const saveBudget = trpc.adminEngage.saveBudget.useMutation({
    onSuccess: () => { toast("Budget line saved."); setBudgetOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });

  const ch = detail.data?.chapter;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead eyebrow="Chapters" title="Chapter lifecycle"
                sub="Seed → Provisional → Chartered → Mature. Elections, motions and budgets run inside each chapter." />

      {!ch && (
        <>
          <div className="eh-between eh-mb">
            <span className="eh-muted eh-sm">{list.data?.length ?? 0} chapter(s)</span>
            <button className="eh-btn gold" onClick={() => setChapterOpen(true)}>New chapter →</button>
          </div>
          {list.isLoading && <Spinner />}
          <div className="eh-grid g3">
            {(list.data ?? []).map((c) => (
              <button key={c.id} className="eh-card" style={{ textAlign: "left", cursor: "pointer" }}
                      onClick={() => setSel(c.id)}>
                <div className="eh-between">
                  <Pill color={STATUS_COLOR[c.status] ?? "grey"}>{CHAPTER_STATUS_LABEL[c.status as ChapterStatus]}</Pill>
                  <span className="eh-muted eh-sm eh-num">{c.memberCount} members</span>
                </div>
                <h3 className="eh-mt">{c.name}</h3>
                <p className="eh-sm eh-muted">{[c.city, c.country].filter(Boolean).join(", ") || "—"}</p>
              </button>
            ))}
          </div>
          {list.data && list.data.length === 0 && (
            <div className="eh-card"><Empty big="No chapters yet." p="Create the first seed chapter to get started." /></div>
          )}
        </>
      )}

      {ch && (
        <>
          <button className="eh-btn ghost sm eh-mb" onClick={() => setSel(null)}>← All chapters</button>
          <div className="eh-card eh-mb">
            <div className="eh-between">
              <div>
                <h3 style={{ margin: 0 }}>{ch.name}</h3>
                <div className="eh-muted eh-sm">{[ch.city, ch.country].filter(Boolean).join(", ") || "—"} · {detail.data!.roster.length} members</div>
              </div>
              <Pill color={STATUS_COLOR[ch.status] ?? "grey"}>{CHAPTER_STATUS_LABEL[ch.status as ChapterStatus]}</Pill>
            </div>
            <div className="eh-row eh-mt">
              <ChapterStatusSelect current={ch.status} pending={saveChapter.isPending}
                                   onChange={(status) => saveChapter.mutate({ id: ch.id, name: ch.name, city: ch.city ?? undefined, country: ch.country ?? undefined, status })} />
            </div>
          </div>

          {/* elections */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Elections</h2>
            <button className="eh-btn sm gold" onClick={() => setElectionOpen(true)}>New election →</button>
          </div>
          {(detail.data!.elections ?? []).length === 0 && <div className="eh-card"><Empty big="No elections." /></div>}
          {(detail.data!.elections ?? []).map((e) => (
            <div className="eh-card eh-mb" key={e.id}>
              <div className="eh-between">
                <div>
                  <h3 style={{ margin: 0 }}>{e.title}</h3>
                  <div className="eh-muted eh-sm">Seat: {e.seat} · quorum {e.quorumPct}%{e.resultHash ? ` · digest ${e.resultHash.slice(0, 12)}…` : ""}</div>
                </div>
                <Pill color={e.status === "closed" ? "green" : e.status === "voting" ? "gold" : "blue"}>{e.status}</Pill>
              </div>
              <div className="eh-row eh-mt">
                {e.status === "open" && (
                  <button className="eh-btn sm" disabled={setElStatus.isPending}
                          onClick={() => setElStatus.mutate({ id: e.id, status: "voting" })}>Open voting</button>
                )}
                {e.status === "voting" && (
                  <button className="eh-btn sm gold" disabled={setElStatus.isPending}
                          onClick={() => setElStatus.mutate({ id: e.id, status: "closed" })}>Close & tally</button>
                )}
              </div>
            </div>
          ))}

          {/* motions */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Motions</h2>
            <button className="eh-btn sm gold" onClick={() => setMotionOpen(true)}>Table a motion →</button>
          </div>
          {(detail.data!.motions ?? []).length === 0 && <div className="eh-card"><Empty big="No motions." /></div>}
          {(detail.data!.motions ?? []).map((m) => (
            <div className="eh-card eh-mb" key={m.id}>
              <div className="eh-between">
                <div>
                  <h3 style={{ margin: 0 }}>{m.title}</h3>
                  {m.body && <div className="eh-muted eh-sm">{m.body}</div>}
                </div>
                {m.status === "open"
                  ? <button className="eh-btn sm" disabled={closeMotion.isPending}
                            onClick={() => closeMotion.mutate({ id: m.id })}>Close & count</button>
                  : <Pill color={m.status === "passed" ? "green" : "grey"}>{m.status}</Pill>}
              </div>
            </div>
          ))}

          {/* budgets */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Budget</h2>
            <button className="eh-btn sm gold" onClick={() => setBudgetOpen(true)}>Add line →</button>
          </div>
          <div className="eh-card">
            {(detail.data!.budgets ?? []).length === 0 && <Empty big="No budget lines." />}
            <div className="eh-list">
              {(detail.data!.budgets ?? []).map((b) => (
                <div className="row" key={b.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{b.label}</div>
                    <div className="d">{b.kind} · {fmtDate(b.createdAt)}</div>
                  </div>
                  <span className="eh-num">AED {b.amount.toLocaleString()}</span>
                  <Pill color={b.status === "approved" ? "green" : b.status === "spent" ? "purple" : b.status === "rejected" ? "grey" : "blue"}>
                    {b.status}
                  </Pill>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {chapterOpen && (
        <Modal title="New chapter" onClose={() => setChapterOpen(false)}>
          <ChapterForm pending={saveChapter.isPending}
                       onSubmit={(v) => saveChapter.mutate(v)} />
        </Modal>
      )}
      {electionOpen && ch && (
        <Modal title="New election" onClose={() => setElectionOpen(false)}>
          <ElectionForm pending={saveElection.isPending}
                        onSubmit={(v) => saveElection.mutate({ ...v, chapterId: ch.id })} />
        </Modal>
      )}
      {motionOpen && ch && (
        <Modal title="Table a motion" onClose={() => setMotionOpen(false)}>
          <MotionForm pending={saveMotion.isPending}
                      onSubmit={(v) => saveMotion.mutate({ ...v, chapterId: ch.id })} />
        </Modal>
      )}
      {budgetOpen && ch && (
        <Modal title="Add budget line" onClose={() => setBudgetOpen(false)}>
          <BudgetForm pending={saveBudget.isPending}
                      onSubmit={(v) => saveBudget.mutate({ ...v, chapterId: ch.id })} />
        </Modal>
      )}
    </EhShell>
  );
}

function ChapterStatusSelect(props: { current: string; pending: boolean; onChange: (s: ChapterStatus) => void }) {
  const [v, setV] = useState(props.current);
  return (
    <span style={{ display: "inline-flex", gap: ".5rem", alignItems: "center" }}>
      <select className="eh-select" style={{ width: "auto" }} value={v} onChange={(e) => setV(e.target.value)}>
        {(Object.keys(CHAPTER_STATUS_LABEL) as ChapterStatus[]).map((s) => (
          <option key={s} value={s}>{CHAPTER_STATUS_LABEL[s]}</option>
        ))}
      </select>
      <button className="eh-btn sm" disabled={props.pending || v === props.current}
              onClick={() => props.onChange(v as ChapterStatus)}>Move stage</button>
    </span>
  );
}

function ChapterForm(props: { pending: boolean; onSubmit: (v: { name: string; city?: string; country?: string; status: ChapterStatus }) => void }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  return (
    <>
      <Field label="Chapter name"><input className="eh-input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} placeholder="eHive Dubai" /></Field>
      <div className="eh-grid g2">
        <Field label="City"><input className="eh-input" value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="Country"><input className="eh-input" value={country} onChange={(e) => setCountry(e.target.value)} /></Field>
      </div>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || name.trim().length < 2}
              onClick={() => props.onSubmit({ name: name.trim(), city: city || undefined, country: country || undefined, status: "seed" })}>
        {props.pending ? "Saving…" : "Create seed chapter →"}
      </button>
    </>
  );
}

function ElectionForm(props: { pending: boolean; onSubmit: (v: { title: string; seat: string; quorumPct: number }) => void }) {
  const [title, setTitle] = useState("");
  const [seat, setSeat] = useState("");
  const [quorum, setQuorum] = useState(50);
  return (
    <>
      <Field label="Election title"><input className="eh-input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} placeholder="Chapter Board 2026" /></Field>
      <Field label="Seat"><input className="eh-input" value={seat} onChange={(e) => setSeat(e.target.value)} minLength={2} placeholder="President / Treasurer / Secretary" /></Field>
      <Field label="Quorum % (min turnout for a valid result)">
        <input className="eh-input" type="number" min={1} max={100} value={quorum} onChange={(e) => setQuorum(Number(e.target.value) || 50)} />
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || title.trim().length < 3 || seat.trim().length < 2}
              onClick={() => props.onSubmit({ title: title.trim(), seat: seat.trim(), quorumPct: quorum })}>
        {props.pending ? "Creating…" : "Open nominations →"}
      </button>
    </>
  );
}

function MotionForm(props: { pending: boolean; onSubmit: (v: { title: string; body?: string }) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <>
      <Field label="Motion title"><input className="eh-input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} /></Field>
      <Field label="Text"><textarea className="eh-textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} /></Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || title.trim().length < 3}
              onClick={() => props.onSubmit({ title: title.trim(), body: body || undefined })}>
        {props.pending ? "Tabling…" : "Table motion →"}
      </button>
    </>
  );
}

function BudgetForm(props: {
  pending: boolean;
  onSubmit: (v: { label: string; kind: "allocation" | "sponsorship" | "spend"; amount: number; status: "proposed" | "approved" | "spent" | "rejected" }) => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"allocation" | "sponsorship" | "spend">("allocation");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<"proposed" | "approved" | "spent" | "rejected">("proposed");
  return (
    <>
      <Field label="Label"><input className="eh-input" value={label} onChange={(e) => setLabel(e.target.value)} minLength={3} placeholder="Q3 venue sponsorship" /></Field>
      <div className="eh-grid g2">
        <Field label="Kind">
          <select className="eh-select" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="allocation">Allocation</option><option value="sponsorship">Sponsorship</option><option value="spend">Spend</option>
          </select>
        </Field>
        <Field label="Amount (AED)"><input className="eh-input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      <Field label="Status">
        <select className="eh-select" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="proposed">Proposed</option><option value="approved">Approved</option>
          <option value="spent">Spent</option><option value="rejected">Rejected</option>
        </select>
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || label.trim().length < 3 || !amount}
              onClick={() => props.onSubmit({ label: label.trim(), kind, amount: Math.max(0, Number(amount) || 0), status })}>
        {props.pending ? "Saving…" : "Add line →"}
      </button>
    </>
  );
}
