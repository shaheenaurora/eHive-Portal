import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  Modal,
  Field,
  Pill,
  toast,
  confirmDialog,
  Empty,
  Spinner,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import {
  EXPENSE_CATEGORY_KEYS,
  EXPENSE_CATEGORY_LABEL,
  CHAPTER_ROLE_LABEL,
} from "@contracts/constants";

export default function ChapterOfficer() {
  const utils = trpc.useUtils();
  const elections = trpc.officer.elections.useQuery();
  const motions = trpc.officer.motions.useQuery();
  const meetings = trpc.officer.meetings.useQuery();
  const finance = trpc.officer.chapterFinance.useQuery();

  const refresh = () => {
    utils.officer.elections.invalidate();
    utils.officer.motions.invalidate();
    utils.officer.meetings.invalidate();
    utils.officer.chapterFinance.invalidate();
    utils.engage.myChapter.invalidate();
  };

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <OfficerElections
        elections={elections.data ?? []}
        isLoading={elections.isLoading}
        refresh={refresh}
      />
      <OfficerMotions
        motions={motions.data ?? []}
        isLoading={motions.isLoading}
        refresh={refresh}
      />
      <OfficerMeetings
        meetings={meetings.data ?? []}
        isLoading={meetings.isLoading}
        refresh={refresh}
      />
      <OfficerFinance
        finance={finance.data}
        isLoading={finance.isLoading}
        refresh={refresh}
      />
    </div>
  );
}

function OfficerElections({
  elections,
  isLoading,
  refresh,
}: {
  elections: {
    id: number;
    title: string;
    seat: string;
    status: string;
    quorumPct: number;
    turnout: number;
    candidates: { id: number; name: string; statement: string | null }[];
  }[];
  isLoading: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [seat, setSeat] = useState("");
  const [quorum, setQuorum] = useState(50);

  const save = trpc.officer.saveElection.useMutation({
    onSuccess: () => {
      toast("Election created.");
      setOpen(false);
      setTitle("");
      setSeat("");
      setQuorum(50);
      refresh();
    },
    onError: e => toast(e.message),
  });
  const setStatus = trpc.officer.setElectionStatus.useMutation({
    onSuccess: r => {
      if (r.winner) toast(`${r.seat} winner: ${r.winner.name}`);
      else refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Officer — Elections</h3>
        <button className="eh-btn sm gold" onClick={() => setOpen(true)}>
          Create election
        </button>
      </div>
      {isLoading && <Spinner />}
      {!isLoading && elections.length === 0 && (
        <Empty
          big="No elections yet."
          p="Create an election for a chapter seat."
        />
      )}
      <div className="eh-list eh-mt">
        {elections.map(e => (
          <div className="row" key={e.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="t">{e.title}</div>
              <div className="d">
                {e.seat} · {e.candidates.length} candidate
                {e.candidates.length === 1 ? "" : "s"} · quorum {e.quorumPct}% ·
                turnout {e.turnout}
              </div>
            </div>
            <div className="eh-row" style={{ gap: ".3rem" }}>
              <Pill
                color={
                  e.status === "closed"
                    ? "green"
                    : e.status === "voting"
                      ? "gold"
                      : "blue"
                }
              >
                {e.status}
              </Pill>
              {e.status === "open" && (
                <button
                  className="eh-btn sm"
                  disabled={setStatus.isPending}
                  onClick={() =>
                    setStatus.mutate({ id: e.id, status: "voting" })
                  }
                >
                  Open voting
                </button>
              )}
              {e.status === "voting" && (
                <button
                  className="eh-btn sm green"
                  disabled={setStatus.isPending}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Close election and tally?",
                        body: "This finalises the result, fills the seat if quorum is met, and cannot be undone.",
                        confirmLabel: "Close & tally",
                      })
                    )
                      setStatus.mutate({ id: e.id, status: "closed" });
                  }}
                >
                  Close
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Create election" onClose={() => setOpen(false)}>
          <Field label="Title">
            <input
              className="eh-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Board elections 2026"
            />
          </Field>
          <Field label="Seat">
            <select
              className="eh-select"
              value={seat}
              onChange={e => setSeat(e.target.value)}
            >
              <option value="">Select a seat…</option>
              {Object.entries(CHAPTER_ROLE_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quorum %">
            <input
              className="eh-input"
              type="number"
              min={1}
              max={100}
              value={quorum}
              onChange={e => setQuorum(Number(e.target.value))}
            />
          </Field>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={
              save.isPending || title.trim().length < 3 || !seat || quorum < 1
            }
            onClick={() =>
              save.mutate({ title: title.trim(), seat, quorumPct: quorum })
            }
          >
            {save.isPending ? "Creating…" : "Create election →"}
          </button>
        </Modal>
      )}
    </div>
  );
}

function OfficerMotions({
  motions,
  isLoading,
  refresh,
}: {
  motions: {
    id: number;
    title: string;
    body: string | null;
    status: string;
    votes: { choice: string; n: number }[];
  }[];
  isLoading: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const save = trpc.officer.saveMotion.useMutation({
    onSuccess: () => {
      toast("Motion tabled.");
      setOpen(false);
      setTitle("");
      setBody("");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const close = trpc.officer.closeMotion.useMutation({
    onSuccess: r => {
      toast(`Motion ${r.status} (yes ${r.yes}, no ${r.no}).`);
      refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Officer — Motions</h3>
        <button className="eh-btn sm gold" onClick={() => setOpen(true)}>
          Tabel motion
        </button>
      </div>
      {isLoading && <Spinner />}
      {!isLoading && motions.length === 0 && (
        <Empty
          big="No motions yet."
          p="Table a motion for the chapter to vote on."
        />
      )}
      <div className="eh-list eh-mt">
        {motions.map(m => {
          const yes = m.votes.find(v => v.choice === "yes")?.n ?? 0;
          const no = m.votes.find(v => v.choice === "no")?.n ?? 0;
          return (
            <div
              className="row"
              key={m.id}
              style={{ alignItems: "flex-start" }}
            >
              <div style={{ flex: 1 }}>
                <div className="t">{m.title}</div>
                {m.body && <div className="d">{m.body}</div>}
                <div className="d eh-muted">
                  yes {yes} · no {no}
                </div>
              </div>
              <div className="eh-row" style={{ gap: ".3rem" }}>
                <Pill color={m.status === "open" ? "blue" : "green"}>
                  {m.status}
                </Pill>
                {m.status === "open" && (
                  <button
                    className="eh-btn sm green"
                    disabled={close.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Close this motion?",
                          body: "The motion will be marked passed or rejected based on current votes.",
                          confirmLabel: "Close motion",
                        })
                      )
                        close.mutate({ id: m.id });
                    }}
                  >
                    Close
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <Modal title="Table a motion" onClose={() => setOpen(false)}>
          <Field label="Title">
            <input
              className="eh-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Approve the annual social budget"
            />
          </Field>
          <Field label="Details (optional)">
            <textarea
              className="eh-textarea"
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={4000}
            />
          </Field>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={save.isPending || title.trim().length < 3}
            onClick={() =>
              save.mutate({ title: title.trim(), body: body || undefined })
            }
          >
            {save.isPending ? "Tabling…" : "Table motion →"}
          </button>
        </Modal>
      )}
    </div>
  );
}

function OfficerMeetings({
  meetings,
  isLoading,
  refresh,
}: {
  meetings: {
    id: number;
    title: string;
    kind: string;
    status: string;
    scheduledAt: Date | null;
  }[];
  isLoading: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("chapter_meeting");
  const [scheduledAt, setScheduledAt] = useState("");

  const save = trpc.officer.createMeeting.useMutation({
    onSuccess: () => {
      toast("Meeting scheduled.");
      setOpen(false);
      setTitle("");
      setKind("chapter_meeting");
      setScheduledAt("");
      refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Officer — Meetings</h3>
        <button className="eh-btn sm gold" onClick={() => setOpen(true)}>
          Schedule meeting
        </button>
      </div>
      {isLoading && <Spinner />}
      {!isLoading && meetings.length === 0 && (
        <Empty
          big="No meetings scheduled."
          p="Schedule chapter, board or huddle meetings."
        />
      )}
      <div className="eh-list eh-mt">
        {meetings.map(m => (
          <div className="row" key={m.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="t">{m.title}</div>
              <div className="d">
                {m.kind.replace("_", " ")} ·{" "}
                {m.scheduledAt ? fmtDate(m.scheduledAt) : "no date"}
              </div>
            </div>
            <Pill color={m.status === "held" ? "green" : "blue"}>
              {m.status}
            </Pill>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Schedule meeting" onClose={() => setOpen(false)}>
          <Field label="Title">
            <input
              className="eh-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. March chapter meeting"
            />
          </Field>
          <Field label="Kind">
            <select
              className="eh-select"
              value={kind}
              onChange={e => setKind(e.target.value)}
            >
              <option value="chapter_meeting">Chapter meeting</option>
              <option value="board_meeting">Board meeting</option>
              <option value="huddle">Huddle</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Scheduled at">
            <input
              className="eh-input"
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </Field>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={save.isPending || title.trim().length < 3}
            onClick={() =>
              save.mutate({
                title: title.trim(),
                kind: kind as never,
                scheduledAt: scheduledAt || undefined,
              })
            }
          >
            {save.isPending ? "Scheduling…" : "Schedule meeting →"}
          </button>
        </Modal>
      )}
    </div>
  );
}

function OfficerFinance({
  finance,
  isLoading,
  refresh,
}: {
  finance:
    | {
        allocated: number;
        spent: number;
        remaining: number;
        expenses: {
          id: number;
          label: string;
          amount: number;
          category: string | null;
          status: string;
          createdAt: Date;
        }[];
      }
    | undefined;
  isLoading: boolean;
  refresh: () => void;
}) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  const record = trpc.officer.recordExpense.useMutation({
    onSuccess: r => {
      toast(
        r.pending
          ? "Expense recorded — pending approval."
          : "Expense recorded against budget."
      );
      setLabel("");
      setAmount("");
      setCategory("");
      setNote("");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const fmt = (n: number) => `AED ${n.toLocaleString()}`;

  return (
    <div className="eh-card">
      <h3 style={{ margin: 0 }}>Officer — Chapter finance</h3>
      {isLoading && <Spinner />}
      {finance && (
        <div className="eh-grid g3 eh-mt" style={{ alignItems: "start" }}>
          <div className="eh-card eh-stat">
            <div className="k">Allocated</div>
            <div className="v eh-num">{fmt(finance.allocated)}</div>
          </div>
          <div className="eh-card eh-stat">
            <div className="k">Spent</div>
            <div className="v eh-num">{fmt(finance.spent)}</div>
          </div>
          <div className="eh-card eh-stat">
            <div className="k">Remaining</div>
            <div className="v eh-num">{fmt(finance.remaining)}</div>
          </div>
        </div>
      )}

      <div className="eh-grid g2 eh-mt" style={{ alignItems: "start" }}>
        <div>
          <h4>Record an expense</h4>
          <Field label="Label">
            <input
              className="eh-input"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Venue deposit"
            />
          </Field>
          <Field label="Amount (AED)">
            <input
              className="eh-input"
              type="number"
              min={0.01}
              step={0.01}
              value={amount}
              onChange={e => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <select
              className="eh-select"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="">Select…</option>
              {EXPENSE_CATEGORY_KEYS.map(k => (
                <option key={k} value={k}>
                  {EXPENSE_CATEGORY_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input
              className="eh-input"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Receipt reference, etc."
            />
          </Field>
          <button
            className="eh-btn gold"
            disabled={
              record.isPending ||
              label.trim().length < 2 ||
              !amount ||
              Number(amount) <= 0
            }
            onClick={() =>
              record.mutate({
                label: label.trim(),
                amountAed: Number(amount),
                category: category || undefined,
                note: note || undefined,
              })
            }
          >
            {record.isPending ? "Recording…" : "Record expense →"}
          </button>
        </div>

        <div>
          <h4>Recent expenses</h4>
          {(finance?.expenses ?? []).length === 0 && (
            <div className="eh-sm eh-muted">No expenses recorded yet.</div>
          )}
          <div className="eh-list">
            {(finance?.expenses ?? []).map(ex => (
              <div className="row" key={ex.id}>
                <div style={{ flex: 1 }}>
                  <div className="t">{ex.label}</div>
                  <div className="d eh-muted">
                    {ex.category
                      ? EXPENSE_CATEGORY_LABEL[ex.category]
                      : "Uncategorised"}{" "}
                    · {fmtDate(ex.createdAt)}
                  </div>
                </div>
                <span className="eh-num">{fmt(ex.amount)}</span>
                <Pill
                  color={
                    ex.status === "approved"
                      ? "green"
                      : ex.status === "proposed"
                        ? "blue"
                        : "purple"
                  }
                >
                  {ex.status}
                </Pill>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
