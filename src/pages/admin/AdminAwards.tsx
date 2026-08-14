import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Field,
  Modal,
  toast,
  confirmDialog,
} from "@/components/eh";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate } from "@/lib/ehf";
import {
  AWARD_CATEGORIES,
  AWARD_LEVELS,
  AWARD_LEVEL_LABEL,
  awardLevelNeedsUnit,
  type AwardCycleStatus,
} from "@contracts/constants";

function CategoryCard({ cat }: { cat: (typeof AWARD_CATEGORIES)[number] }) {
  return (
    <div
      className="eh-card"
      style={{ display: "flex", flexDirection: "column", gap: ".3rem" }}
    >
      <div className="eh-between" style={{ alignItems: "flex-start" }}>
        <b>{cat.label}</b>
        <span className="eh-pill sm">{cat.subject}</span>
      </div>
      <p className="eh-sm eh-muted" style={{ margin: 0, flex: 1 }}>
        {cat.blurb}
      </p>
    </div>
  );
}

const CYCLE_COLOR: Record<
  AwardCycleStatus,
  "grey" | "blue" | "gold" | "green" | "red"
> = {
  draft: "grey",
  open: "blue",
  judging: "gold",
  announced: "green",
  closed: "red",
};
const NEXT: Record<
  AwardCycleStatus,
  { to: AwardCycleStatus; label: string }[]
> = {
  draft: [{ to: "open", label: "Open nominations" }],
  open: [{ to: "judging", label: "Close & judge" }],
  judging: [{ to: "announced", label: "Announce winners" }],
  announced: [{ to: "closed", label: "Archive" }],
  closed: [],
};
const NOM_COLOR: Record<string, "grey" | "gold" | "green" | "red"> = {
  nominated: "grey",
  shortlisted: "gold",
  winner: "green",
  declined: "red",
};

export default function AdminAwards() {
  const q = trpc.adminEngage.awardsCycles.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.awardsCycles.invalidate();
  const err = (e: { message: string }) => toast(e.message);

  const createCycle = trpc.adminEngage.awardsCreateCycle.useMutation({
    onSuccess: () => {
      toast("Cycle created.");
      refresh();
      setName("");
    },
    onError: err,
  });
  const setStatus = trpc.adminEngage.awardsSetCycleStatus.useMutation({
    onSuccess: refresh,
    onError: err,
  });

  const [name, setName] = useState("");
  const [level, setLevel] = useState<string>("network");
  const [unitId, setUnitId] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [judgeId, setJudgeId] = useState<number | null>(null);
  const [autoId, setAutoId] = useState<number | null>(null);
  const cycles = q.data ?? [];
  const needsUnit = awardLevelNeedsUnit(level);
  const units = trpc.adminEngage.awardsUnits.useQuery(
    { level: level as "chapter" | "zone" | "region" | "country" },
    { retry: false, enabled: needsUnit }
  );

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Recognition · NA-03"
        title="Awards"
        sub="Run recognition cycles: open nominations to members, shortlist and name winners, then announce them to the whole Circle."
      />

      <div className="eh-card eh-mb">
        <Field label="New award cycle">
          <input
            className="eh-input"
            placeholder="e.g. 2026 Annual eHive Awards"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </Field>
        <div className="eh-grid g2">
          <Field label="Level">
            <select
              className="eh-select"
              value={level}
              onChange={e => {
                setLevel(e.target.value);
                setUnitId("");
              }}
            >
              {AWARD_LEVELS.map(l => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          {needsUnit && (
            <Field label={AWARD_LEVEL_LABEL[level]}>
              <select
                className="eh-select"
                value={unitId}
                onChange={e => setUnitId(e.target.value)}
              >
                <option value="">Choose a {level}…</option>
                {(units.data ?? []).map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <button
          className="eh-btn gold sm"
          disabled={
            createCycle.isPending ||
            name.trim().length < 2 ||
            (needsUnit && !unitId)
          }
          onClick={() =>
            createCycle.mutate({
              name,
              level: level as never,
              unitId: needsUnit ? Number(unitId) : undefined,
            })
          }
        >
          Create cycle
        </button>
      </div>

      <div className="eh-mb">
        <div className="eh-eyebrow" style={{ marginBottom: ".6rem" }}>
          Award categories
        </div>
        <div className="eh-grid g3">
          {AWARD_CATEGORIES.map(cat => (
            <CategoryCard key={cat.key} cat={cat} />
          ))}
        </div>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && cycles.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No award cycles yet."
            p="Create a cycle, open nominations, and let the Circle recognise its own."
          />
        </div>
      )}

      {cycles.map(c => (
        <div className="eh-card eh-mb" key={c.id}>
          <div
            className="eh-between"
            style={{ flexWrap: "wrap", gap: ".6rem" }}
          >
            <div>
              <div
                className="eh-row"
                style={{ gap: ".5rem", alignItems: "center" }}
              >
                <b style={{ fontSize: "1.05rem" }}>{c.name}</b>
                <Pill color={CYCLE_COLOR[c.status]}>{c.status}</Pill>
                <Pill color="blue">
                  {AWARD_LEVEL_LABEL[c.level] ?? c.level}
                  {c.unitName ? ` · ${c.unitName}` : ""}
                </Pill>
                <span className="eh-muted eh-sm">
                  {c.nominations} nomination{c.nominations === 1 ? "" : "s"}
                </span>
              </div>
              <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
                Created {fmtDate(c.createdAt)}
              </p>
            </div>
            <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
              {NEXT[c.status].map(n => (
                <button
                  key={n.to}
                  className="eh-btn gold sm"
                  disabled={setStatus.isPending}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: `${n.label}?`,
                        body: `This moves the cycle to "${n.to}".`,
                        confirmLabel: n.label,
                      })
                    )
                      setStatus.mutate({ id: c.id, status: n.to });
                  }}
                >
                  {n.label}
                </button>
              ))}
              <button
                className="eh-btn ghost sm"
                onClick={() => setOpenId(openId === c.id ? null : c.id)}
              >
                {openId === c.id ? "Hide nominations" : "Manage nominations"}
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() => setJudgeId(judgeId === c.id ? null : c.id)}
              >
                {judgeId === c.id ? "Hide judging" : "Judging panel"}
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() => setAutoId(autoId === c.id ? null : c.id)}
              >
                {autoId === c.id ? "Hide auto-score" : "Auto-score"}
              </button>
            </div>
          </div>
          {openId === c.id && <Nominations cycleId={c.id} />}
          {judgeId === c.id && <JudgingPanel cycleId={c.id} />}
          {autoId === c.id && <AutoScoreSection cycleId={c.id} />}
        </div>
      ))}
    </EhShell>
  );
}

function Nominations({ cycleId }: { cycleId: number }) {
  const q = trpc.adminEngage.awardsNominations.useQuery(
    { cycleId },
    { retry: false }
  );
  const utils = trpc.useUtils();
  const setStatus = trpc.adminEngage.awardsSetNominationStatus.useMutation({
    onSuccess: () =>
      utils.adminEngage.awardsNominations.invalidate({ cycleId }),
    onError: e => toast(e.message),
  });
  const noms = q.data ?? [];

  return (
    <div
      style={{
        marginTop: "1rem",
        borderTop: "1px solid var(--eh-border)",
        paddingTop: "1rem",
      }}
    >
      {q.isLoading && <Spinner />}
      {q.data && noms.length === 0 && (
        <p className="eh-sm eh-muted">No nominations yet in this cycle.</p>
      )}
      {AWARD_CATEGORIES.map(cat => {
        const inCat = noms.filter(n => n.category === cat.key);
        if (!inCat.length) return null;
        return (
          <div key={cat.key} style={{ marginBottom: "1rem" }}>
            <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>
              {cat.label}
            </div>
            <div className="eh-list">
              {inCat.map(n => (
                <div
                  className="row"
                  key={n.id}
                  style={{ alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1 }}>
                    <span className="t">
                      {n.nomineeName ?? n.nomineeChapterName ?? "—"}
                    </span>
                    <Pill color={NOM_COLOR[n.status]}>{n.status}</Pill>
                    {n.nominatedByName && (
                      <span className="eh-muted eh-sm">
                        {" "}
                        · by {n.nominatedByName}
                      </span>
                    )}
                    {n.citation && <div className="d">{n.citation}</div>}
                  </div>
                  <span className="eh-row" style={{ gap: ".3rem" }}>
                    <button
                      className="eh-btn ghost sm"
                      disabled={n.status === "shortlisted"}
                      onClick={() =>
                        setStatus.mutate({ id: n.id, status: "shortlisted" })
                      }
                    >
                      Shortlist
                    </button>
                    <button
                      className="eh-btn green sm"
                      disabled={n.status === "winner"}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: `Name ${n.nomineeName ?? n.nomineeChapterName ?? "this nominee"} the winner?`,
                            body: "This records the win — announced to the Circle when the cycle is announced.",
                            confirmLabel: "Confirm winner",
                          })
                        )
                          setStatus.mutate({ id: n.id, status: "winner" });
                      }}
                    >
                      Winner
                    </button>
                    <button
                      className="eh-btn ghost sm"
                      disabled={n.status === "declined"}
                      onClick={() =>
                        setStatus.mutate({ id: n.id, status: "declined" })
                      }
                    >
                      Decline
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* Panel judging: assign an independent panel, score shortlisted nominees against
   the cycle rubric, and ratify a winner (a judge cannot ratify — four eyes). */
function JudgingPanel({ cycleId }: { cycleId: number }) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const judges = trpc.adminEngage.awardsJudges.useQuery(
    { cycleId },
    { retry: false }
  );
  const board = trpc.adminEngage.awardsJudgingBoard.useQuery(
    { cycleId },
    { retry: false }
  );
  const [judgeUserId, setJudgeUserId] = useState("");
  const [scoreFor, setScoreFor] = useState<{
    nominationId: number;
    nominee: string;
  } | null>(null);

  const refresh = () => {
    utils.adminEngage.awardsJudges.invalidate({ cycleId });
    utils.adminEngage.awardsJudgingBoard.invalidate({ cycleId });
  };
  const assign = trpc.adminEngage.awardsAssignJudge.useMutation({
    onSuccess: () => {
      setJudgeUserId("");
      utils.adminEngage.awardsJudges.invalidate({ cycleId });
    },
    onError: e => toast(e.message),
  });
  const remove = trpc.adminEngage.awardsRemoveJudge.useMutation({
    onSuccess: () => utils.adminEngage.awardsJudges.invalidate({ cycleId }),
    onError: e => toast(e.message),
  });
  const ratify = trpc.adminEngage.awardsRatifyWinner.useMutation({
    onSuccess: () => {
      toast("Winner ratified.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const judgeList = judges.data ?? [];
  const iAmJudge = judgeList.some(j => j.userId === user?.id);
  const rows = board.data?.rows ?? [];
  const rubric = board.data?.rubric ?? [];

  return (
    <div
      style={{
        marginTop: "1rem",
        borderTop: "1px solid var(--eh-border)",
        paddingTop: "1rem",
      }}
    >
      <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>
        Judging panel
      </div>

      {/* Judges */}
      <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
        {judgeList.map(j => (
          <Pill key={j.userId} color="blue">
            {j.name ?? j.email ?? `User #${j.userId}`}
            <button
              className="eh-linkbtn"
              style={{ marginLeft: ".4rem" }}
              title="Remove judge"
              onClick={() => remove.mutate({ cycleId, userId: j.userId })}
            >
              ×
            </button>
          </Pill>
        ))}
        {judgeList.length === 0 && (
          <span className="eh-sm eh-muted">No judges assigned yet.</span>
        )}
      </div>
      <div className="eh-row" style={{ gap: ".4rem", marginTop: ".5rem" }}>
        <input
          className="eh-input sm"
          style={{ maxWidth: 160 }}
          placeholder="Judge user ID"
          value={judgeUserId}
          onChange={e => setJudgeUserId(e.target.value)}
        />
        <button
          className="eh-btn ghost sm"
          disabled={assign.isPending || !judgeUserId}
          onClick={() => {
            const id = Number(judgeUserId);
            if (Number.isInteger(id) && id > 0)
              assign.mutate({ cycleId, userId: id });
            else
              toast("Enter a numeric user ID (see the EH-U code on Access).");
          }}
        >
          Add judge
        </button>
      </div>

      {/* Board */}
      <div style={{ marginTop: "1rem" }}>
        {board.isLoading && <Spinner />}
        {rows.length === 0 && !board.isLoading && (
          <p className="eh-sm eh-muted">
            No shortlisted nominees yet — shortlist nominees, then judges score
            them here.
          </p>
        )}
        {rows.length > 0 && (
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Nominee</th>
                <th>Panel avg</th>
                <th>Judges</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.nominationId}>
                  <td data-label="Nominee">
                    {i === 0 && r.average > 0 && "🥇 "}
                    {r.nomineeName ?? r.nomineeChapterName ?? "—"}
                    {r.ratifiedByUserId ? (
                      <>
                        {" "}
                        <Pill color="green">winner</Pill>
                      </>
                    ) : null}
                  </td>
                  <td data-label="Panel avg">
                    <b>{r.average}</b>
                  </td>
                  <td data-label="Judges">{r.scoredBy}</td>
                  <td data-label="Actions">
                    <div className="eh-row" style={{ gap: ".35rem" }}>
                      {iAmJudge && (
                        <button
                          className="eh-btn ghost sm"
                          onClick={() =>
                            setScoreFor({
                              nominationId: r.nominationId,
                              nominee:
                                r.nomineeName ??
                                r.nomineeChapterName ??
                                "nominee",
                            })
                          }
                        >
                          Score
                        </button>
                      )}
                      {!iAmJudge && !r.ratifiedByUserId && (
                        <button
                          className="eh-btn gold sm"
                          disabled={ratify.isPending || r.scoredBy === 0}
                          onClick={async () => {
                            if (
                              await confirmDialog({
                                title: "Ratify this winner?",
                                body: "Confirms the award for this nominee. You must not be a judge of this cycle.",
                                confirmLabel: "Ratify winner",
                              })
                            )
                              ratify.mutate({
                                cycleId,
                                nominationId: r.nominationId,
                              });
                          }}
                        >
                          Ratify winner
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {scoreFor && (
        <ScoreModal
          cycleId={cycleId}
          nominationId={scoreFor.nominationId}
          nominee={scoreFor.nominee}
          rubric={rubric}
          onClose={() => setScoreFor(null)}
          onDone={() => {
            refresh();
            setScoreFor(null);
          }}
        />
      )}
    </div>
  );
}

function ScoreModal({
  cycleId,
  nominationId,
  nominee,
  rubric,
  onClose,
  onDone,
}: {
  cycleId: number;
  nominationId: number;
  nominee: string;
  rubric: { key: string; label: string; weight: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const submit = trpc.adminEngage.awardsSubmitScore.useMutation({
    onSuccess: r => {
      toast(`Score recorded (${r.total}).`);
      onDone();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title={`Score — ${nominee}`} onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Score each criterion 0–100 against the published rubric.
      </p>
      {rubric.map(c => (
        <Field key={c.key} label={`${c.label} (${c.weight}%)`}>
          <input
            className="eh-input"
            type="number"
            min={0}
            max={100}
            value={vals[c.key] ?? ""}
            onChange={e => setVals(v => ({ ...v, [c.key]: e.target.value }))}
          />
        </Field>
      ))}
      <Field label="Note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={submit.isPending}
        onClick={() =>
          submit.mutate({
            cycleId,
            nominationId,
            scores: rubric.map(c => ({
              key: c.key,
              value: Number(vals[c.key] ?? 0),
            })),
            note: note || undefined,
          })
        }
      >
        {submit.isPending ? "Saving…" : "Submit score"}
      </button>
    </Modal>
  );
}

/* Auto-scored judging (the default mechanism): the portal ranks eligible members
   from live KPI data against the auto-score rubric — no nomination, no campaign.
   Read-only preview for review; conferral automation follows in a later phase. */
function AutoScoreSection({ cycleId }: { cycleId: number }) {
  const [run, setRun] = useState(false);
  const q = trpc.adminEngage.awardsAutoScore.useQuery(
    { cycleId },
    { retry: false, enabled: run }
  );
  const data = q.data;
  return (
    <div
      style={{
        marginTop: "1rem",
        borderTop: "1px solid var(--eh-border)",
        paddingTop: "1rem",
      }}
    >
      <div
        className="eh-between"
        style={{ alignItems: "center", flexWrap: "wrap", gap: ".5rem" }}
      >
        <div className="eh-eyebrow">Auto-score · the data decides</div>
        <button
          className="eh-btn gold sm"
          disabled={q.isFetching}
          onClick={() => {
            if (run) q.refetch();
            else setRun(true);
          }}
        >
          {q.isFetching
            ? "Scoring…"
            : run
              ? "Re-run auto-score"
              : "Run auto-score"}
        </button>
      </div>

      {!run && (
        <p className="eh-sm eh-muted" style={{ marginTop: ".5rem" }}>
          Ranks eligible members (active standing, no open conduct case) on
          engagement, referrals and attendance over the cycle window.
        </p>
      )}
      {q.isFetching && <Spinner />}
      {data && (
        <>
          <p className="eh-sm eh-muted" style={{ margin: ".5rem 0" }}>
            {data.eligible} eligible member{data.eligible === 1 ? "" : "s"} ·
            window {fmtDate(data.window.from)} → {fmtDate(data.window.to)}
          </p>
          {data.rows.length === 0 ? (
            <Empty
              big="No eligible members scored."
              p="No active members with activity in this window."
            />
          ) : (
            <table className="eh-table stack">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Member</th>
                  {data.rubric.map(c => (
                    <th key={c.key}>{c.label.split(" (")[0]}</th>
                  ))}
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(r => (
                  <tr key={r.memberId}>
                    <td data-label="#">{r.rank === 1 ? "🥇" : r.rank}</td>
                    <td data-label="Member">
                      {r.name ?? r.email ?? `Member #${r.memberId}`}
                    </td>
                    {data.rubric.map(c => (
                      <td key={c.key} data-label={c.label}>
                        <span title={`raw ${r.raw[c.key] ?? 0}`}>
                          {r.normalized[c.key] ?? 0}
                        </span>
                      </td>
                    ))}
                    <td data-label="Score">
                      <b>{r.total}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
