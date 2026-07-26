import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Spinner, Modal, Field, Empty, toast } from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";
import { CHAPTER_STATUS_LABEL, CHAPTER_ROLES, CHAPTER_ROLE_RESP, chapterRoleTitle } from "@contracts/constants";
import type { ChapterStatus } from "@contracts/constants";

const STATUS_COLOR: Record<string, "grey" | "blue" | "gold" | "green" | "red"> = {
  seed: "grey", provisional: "blue", chartered: "gold", mature: "green", at_risk: "red",
};

type ChapterVals = {
  name: string; code?: string; country?: string; region?: string;
  state?: string; city?: string; zone?: string; meetingCadence?: string; status: ChapterStatus;
};

/** BNI-style location line: Zone · City · State · Region · Country. */
function geoLine(c: { zone?: string | null; city?: string | null; state?: string | null; region?: string | null; country?: string | null }): string {
  return [c.zone, c.city, c.state, c.region, c.country].filter(Boolean).join(" · ") || "—";
}

export default function AdminChapters() {
  const utils = trpc.useUtils();
  const list = trpc.adminEngage.chaptersAdmin.useQuery(undefined, { retry: false });
  const transfers = trpc.adminEngage.pendingChapterTransfers.useQuery(undefined, { retry: false });
  const [sel, setSel] = useState<number | null>(null);
  const detail = trpc.adminEngage.chapterDetail.useQuery({ id: sel! }, { retry: false, enabled: sel !== null });

  const [chapterOpen, setChapterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [electionOpen, setElectionOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [rolePrefill, setRolePrefill] = useState<{ memberId: number; name: string } | null>(null);

  function refresh() {
    utils.adminEngage.chaptersAdmin.invalidate();
    utils.adminEngage.chapterDetail.invalidate();
    utils.adminEngage.pendingChapterTransfers.invalidate();
    utils.adminEngage.assignableMembers.invalidate();
  }

  const saveChapter = trpc.adminEngage.saveChapter.useMutation({
    onSuccess: () => { toast("Chapter saved."); setChapterOpen(false); setEditOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setHome = trpc.adminEngage.setHomeChapter.useMutation({
    onSuccess: () => { toast("Member assigned to this chapter."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const decideTransfer = trpc.adminEngage.decideChapterTransfer.useMutation({
    onSuccess: (_r, v) => { toast(v.decision === "approve" ? "Transfer approved — home chapter moved." : "Transfer rejected."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const saveElection = trpc.adminEngage.saveElection.useMutation({
    onSuccess: () => { toast("Election created — nominations open."); setElectionOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const assignRole = trpc.adminEngage.assignChapterRole.useMutation({
    onSuccess: () => { toast("Role assigned."); setRoleOpen(false); setRolePrefill(null); refresh(); },
    onError: (e) => toast(e.message),
  });
  const endRole = trpc.adminEngage.endChapterRole.useMutation({
    onSuccess: () => { toast("Role ended."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setElStatus = trpc.adminEngage.setElectionStatus.useMutation({
    onSuccess: (r) => {
      if (r.quorumMet !== undefined) {
        toast(`Election closed — turnout ${r.turnout}/${r.memberCount}, quorum ${r.quorumMet ? "met" : "NOT met"}.`);
        if (r.winner) {
          toast(`Winner: ${r.winner.name} (${r.winner.votes} votes) — appoint to a role.`);
          setRolePrefill({ memberId: r.winner.memberId, name: r.winner.name });
          setRoleOpen(true);
        }
      } else toast("Election updated.");
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
                sub="Seed → Provisional → Chartered → Mature. Members are admitted into a chapter; elections, motions and budgets run inside each one." />

      {/* Transfer requests — always visible so requests never get missed. */}
      {(transfers.data ?? []).length > 0 && (
        <div className="eh-card eh-mb">
          <div className="eh-between" style={{ marginBottom: ".6rem" }}>
            <h3 style={{ margin: 0 }}>Chapter transfer requests</h3>
            <Pill color="gold">{transfers.data!.length} awaiting approval</Pill>
          </div>
          <div className="eh-list">
            {transfers.data!.map(({ req, memberName, memberEmail, fromName, toName }) => (
              <div className="row" key={req.id} style={{ alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div className="t">{memberName ?? memberEmail ?? "Member"}</div>
                  <div className="d">{fromName ?? "No chapter"} → <b>{toName ?? "?"}</b></div>
                  {req.note && <div className="d" style={{ marginTop: ".2rem" }}>“{req.note}”</div>}
                  <div className="d eh-muted">{fmtDate(req.createdAt)}</div>
                </div>
                <div className="eh-row">
                  <button className="eh-btn gold sm" disabled={decideTransfer.isPending}
                          onClick={() => decideTransfer.mutate({ id: req.id, decision: "approve" })}>Approve</button>
                  <button className="eh-btn ghost sm danger" disabled={decideTransfer.isPending}
                          onClick={() => decideTransfer.mutate({ id: req.id, decision: "reject" })}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
                <h3 className="eh-mt">{c.name}{c.code ? <span className="eh-muted eh-sm eh-num" style={{ marginLeft: ".4rem" }}>{c.code}</span> : null}</h3>
                <p className="eh-sm eh-muted">{geoLine(c)}</p>
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
                <h3 style={{ margin: 0 }}>{ch.name}{ch.code ? <span className="eh-muted eh-sm eh-num" style={{ marginLeft: ".5rem" }}>{ch.code}</span> : null}</h3>
                <div className="eh-muted eh-sm">{geoLine(ch)} · {detail.data!.roster.length} members</div>
                {ch.meetingCadence && <div className="eh-muted eh-sm">Meets: {ch.meetingCadence}</div>}
              </div>
              <Pill color={STATUS_COLOR[ch.status] ?? "grey"}>{CHAPTER_STATUS_LABEL[ch.status as ChapterStatus]}</Pill>
            </div>
            <div className="eh-row eh-mt">
              <button className="eh-btn ghost sm" onClick={() => setEditOpen(true)}>Edit details</button>
              <ChapterStatusSelect current={ch.status} pending={saveChapter.isPending}
                                   onChange={(status) => saveChapter.mutate({ id: ch.id, name: ch.name, status })} />
            </div>
          </div>

          {/* leadership board */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Leadership board</h2>
            <button className="eh-btn sm gold" onClick={() => { setRolePrefill(null); setRoleOpen(true); }}>+ Assign role</button>
          </div>
          <div className="eh-card">
            {(detail.data!.board ?? []).length === 0 && <Empty big="No officers yet." p="Assign roles directly, or close an election to appoint the winner." />}
            <div className="eh-list">
              {(detail.data!.board ?? []).map((b) => (
                <div className="row" key={b.id} style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{chapterRoleTitle(b.role, b.title)} — <b>{b.memberName}</b>{b.electionId ? <Pill color="gold">elected</Pill> : null}</div>
                    <div className="d">{b.responsibilities || CHAPTER_ROLE_RESP[b.role] || ""}</div>
                  </div>
                  <button className="eh-btn ghost sm danger" disabled={endRole.isPending}
                          onClick={() => endRole.mutate({ id: b.id })}>End term</button>
                </div>
              ))}
            </div>
          </div>

          {/* members / roster */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Members</h2>
            <button className="eh-btn sm gold" onClick={() => setAddOpen(true)}>+ Add members</button>
          </div>
          <div className="eh-card">
            {detail.data!.roster.length === 0 && <Empty big="No members yet." p="Assign members to this chapter to build its roster." />}
            <div className="eh-list">
              {detail.data!.roster.map(({ member, user }) => (
                <div className="row" key={member.id}>
                  <div className="eh-row" style={{ flexWrap: "nowrap", flex: 1 }}>
                    <span className="eh-avatar">{initials(user.name)}</span>
                    <div>
                      <div className="t">{user.name ?? user.email}</div>
                      <div className="d">{member.company ?? user.email ?? ""}</div>
                    </div>
                  </div>
                  <button className="eh-btn ghost sm" disabled={setHome.isPending}
                          onClick={() => setHome.mutate({ memberId: member.id, chapterId: null })}>Remove</button>
                </div>
              ))}
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
          <ChapterForm pending={saveChapter.isPending} submitLabel="Create seed chapter →"
                       onSubmit={(v) => saveChapter.mutate(v)} />
        </Modal>
      )}
      {editOpen && ch && (
        <Modal title="Edit chapter" onClose={() => setEditOpen(false)}>
          <ChapterForm pending={saveChapter.isPending} submitLabel="Save chapter →"
                       initial={ch} onSubmit={(v) => saveChapter.mutate({ ...v, id: ch.id })} />
        </Modal>
      )}
      {addOpen && ch && (
        <Modal title={`Add members to ${ch.name}`} onClose={() => setAddOpen(false)} wide>
          <AddMembers chapterId={ch.id} pending={setHome.isPending}
                      onAssign={(memberId) => setHome.mutate({ memberId, chapterId: ch.id })} />
        </Modal>
      )}
      {roleOpen && ch && (
        <Modal title="Assign a leadership role" onClose={() => { setRoleOpen(false); setRolePrefill(null); }}>
          <AssignRoleForm
            roster={detail.data!.roster.map((r) => ({ id: r.member.id, name: r.user.name ?? r.user.email ?? "Member" }))}
            prefill={rolePrefill} pending={assignRole.isPending}
            onSubmit={(v) => assignRole.mutate({ chapterId: ch.id, ...v })} />
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

function AddMembers(props: { chapterId: number; pending: boolean; onAssign: (memberId: number) => void }) {
  const [q, setQ] = useState("");
  const res = trpc.adminEngage.assignableMembers.useQuery(
    { q: q || undefined, excludeChapterId: props.chapterId }, { retry: false },
  );
  return (
    <>
      <Field label="Search members by name, email or company">
        <input className="eh-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing…" autoFocus />
      </Field>
      {res.isLoading && <Spinner />}
      {res.data && res.data.length === 0 && <Empty big="No members match." p="Everyone matching is already in this chapter." />}
      <div className="eh-list">
        {(res.data ?? []).map((m) => (
          <div className="row" key={m.id}>
            <div className="eh-row" style={{ flexWrap: "nowrap", flex: 1 }}>
              <span className="eh-avatar">{initials(m.name)}</span>
              <div>
                <div className="t">{m.name ?? m.email}</div>
                <div className="d">
                  {m.company ?? m.email ?? ""}
                  {m.chapterName ? <> · currently <b>{m.chapterName}</b></> : <> · no chapter</>}
                </div>
              </div>
            </div>
            <button className="eh-btn sm gold" disabled={props.pending}
                    onClick={() => props.onAssign(m.id)}>
              {m.chapterName ? "Move here" : "Assign"}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function ChapterForm(props: {
  pending: boolean; submitLabel: string; initial?: Partial<ChapterVals>;
  onSubmit: (v: ChapterVals) => void;
}) {
  const i = props.initial ?? {};
  const [v, setV] = useState<ChapterVals>({
    name: i.name ?? "", code: i.code ?? "", country: i.country ?? "", region: i.region ?? "",
    state: i.state ?? "", city: i.city ?? "", zone: i.zone ?? "", meetingCadence: i.meetingCadence ?? "",
    status: (i.status as ChapterStatus) ?? "seed",
  });
  const set = (k: keyof ChapterVals) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const clean = (): ChapterVals => ({
    name: v.name.trim(), code: v.code || undefined, country: v.country || undefined, region: v.region || undefined,
    state: v.state || undefined, city: v.city || undefined, zone: v.zone || undefined,
    meetingCadence: v.meetingCadence || undefined, status: v.status,
  });
  return (
    <>
      <div className="eh-grid g2">
        <Field label="Chapter name"><input className="eh-input" value={v.name} onChange={set("name")} minLength={2} placeholder="eHive Dubai" /></Field>
        <Field label="Chapter code"><input className="eh-input" value={v.code} onChange={set("code")} placeholder="AE-DXB-01" /></Field>
      </div>
      <div className="eh-eyebrow" style={{ margin: ".2rem 0 .4rem" }}>Location — Country → Region → State → City → Zone</div>
      <div className="eh-grid g2">
        <Field label="Country"><input className="eh-input" value={v.country} onChange={set("country")} placeholder="United Arab Emirates" /></Field>
        <Field label="Region"><input className="eh-input" value={v.region} onChange={set("region")} placeholder="Gulf" /></Field>
      </div>
      <div className="eh-grid g2">
        <Field label="State / Emirate"><input className="eh-input" value={v.state} onChange={set("state")} placeholder="Dubai" /></Field>
        <Field label="City"><input className="eh-input" value={v.city} onChange={set("city")} placeholder="Dubai" /></Field>
      </div>
      <div className="eh-grid g2">
        <Field label="Zone / Area"><input className="eh-input" value={v.zone} onChange={set("zone")} placeholder="DIFC" /></Field>
        <Field label="Meeting cadence"><input className="eh-input" value={v.meetingCadence} onChange={set("meetingCadence")} placeholder="Weekly · Tue 7:30am" /></Field>
      </div>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || v.name.trim().length < 2}
              onClick={() => props.onSubmit(clean())}>
        {props.pending ? "Saving…" : props.submitLabel}
      </button>
    </>
  );
}

function AssignRoleForm(props: {
  roster: { id: number; name: string }[];
  prefill: { memberId: number; name: string } | null;
  pending: boolean;
  onSubmit: (v: { memberId: number; role: string; title?: string; responsibilities?: string }) => void;
}) {
  const [memberId, setMemberId] = useState<string>(props.prefill ? String(props.prefill.memberId) : "");
  const [role, setRole] = useState<string>("president");
  const [title, setTitle] = useState("");
  const [resp, setResp] = useState("");
  const def = CHAPTER_ROLES.find((r) => r.key === role);
  return (
    <>
      <Field label="Member">
        <select className="eh-select" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
          <option value="">Select a member…</option>
          {props.roster.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </Field>
      {props.roster.length === 0 && <p className="eh-sm" style={{ color: "var(--eh-gold)" }}>Add members to this chapter first.</p>}
      <Field label="Role">
        <select className="eh-select" value={role} onChange={(e) => setRole(e.target.value)}>
          {CHAPTER_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Field>
      {role === "other" && (
        <Field label="Role title"><input className="eh-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Visitor Host" /></Field>
      )}
      <Field label="Responsibilities">
        <textarea className="eh-textarea" value={resp} onChange={(e) => setResp(e.target.value)}
                  placeholder={def?.responsibilities || "What this officer owns."} maxLength={2000} />
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }}
              disabled={props.pending || !memberId || (role === "other" && !title.trim())}
              onClick={() => props.onSubmit({
                memberId: Number(memberId), role,
                title: role === "other" ? title.trim() : undefined,
                responsibilities: resp.trim() || undefined,
              })}>
        {props.pending ? "Assigning…" : "Assign role →"}
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
