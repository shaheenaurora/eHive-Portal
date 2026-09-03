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
  EVENT_KIND_LABEL,
  EVENT_AUDIENCE_LABEL,
} from "@contracts/constants";

export default function ChapterOfficer() {
  const utils = trpc.useUtils();
  const elections = trpc.officer.elections.useQuery();
  const motions = trpc.officer.motions.useQuery();
  const meetings = trpc.officer.meetings.useQuery();
  const events = trpc.officer.events.useQuery();
  const finance = trpc.officer.chapterFinance.useQuery();
  const financeReport = trpc.officer.chapterFinanceReport.useQuery();
  const transfers = trpc.officer.chapterTransfers.useQuery();

  const refresh = () => {
    utils.officer.elections.invalidate();
    utils.officer.motions.invalidate();
    utils.officer.meetings.invalidate();
    utils.officer.events.invalidate();
    utils.officer.chapterFinance.invalidate();
    utils.officer.chapterFinanceReport.invalidate();
    utils.officer.chapterTransfers.invalidate();
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
      <OfficerEvents
        events={events.data ?? []}
        isLoading={events.isLoading}
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
      <OfficerFinanceReport
        report={financeReport.data}
        isLoading={financeReport.isLoading}
      />
      <OfficerTransfers
        transfers={transfers.data ?? []}
        isLoading={transfers.isLoading}
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
                <Pill
                  color={
                    m.status === "open"
                      ? "blue"
                      : m.status === "passed"
                        ? "green"
                        : m.status === "rejected"
                          ? "red"
                          : "gold"
                  }
                >
                  {m.status === "failed" ? "no quorum" : m.status}
                </Pill>
                {m.status === "open" && (
                  <button
                    className="eh-btn sm green"
                    disabled={close.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Close this motion?",
                          body: "The motion will be marked passed or rejected based on current votes — or failed if member turnout hasn't met quorum.",
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

const money = (aedNum: number) =>
  "AED " +
  aedNum.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(aedNum) ? 0 : 2,
    maximumFractionDigits: 2,
  });

function OfficerFinanceReport({
  report,
  isLoading,
}: {
  report:
    | {
        totals: {
          grossAed: number;
          refundsAed: number;
          netRevenueAed: number;
          expensesAed: number;
          surplusAed: number;
        };
        revenueByMonth: {
          month: string;
          grossAed: number;
          refundsAed: number;
          netAed: number;
        }[];
        byTier: { tier: string; grossAed: number; count: number }[];
        expenseByCategory: { category: string; aed: number }[];
      }
    | undefined;
  isLoading: boolean;
}) {
  const t = report?.totals;
  return (
    <div className="eh-card">
      <h3 style={{ margin: 0 }}>Officer — Finance report</h3>
      {isLoading && <Spinner />}
      {report && t && (
        <>
          <div className="eh-grid g4 eh-mt" style={{ alignItems: "start" }}>
            <div className="eh-card eh-stat">
              <div className="k">Revenue</div>
              <div className="v eh-num">{money(t.grossAed)}</div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Expenses</div>
              <div className="v eh-num">{money(t.expensesAed)}</div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Net</div>
              <div
                className="v eh-num"
                style={{
                  color:
                    t.netRevenueAed >= 0
                      ? "var(--eh-good, #2e7d5b)"
                      : "var(--eh-red, #b23a2e)",
                }}
              >
                {money(t.netRevenueAed)}
              </div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Surplus</div>
              <div
                className="v eh-num"
                style={{
                  color:
                    t.surplusAed >= 0
                      ? "var(--eh-good, #2e7d5b)"
                      : "var(--eh-red, #b23a2e)",
                }}
              >
                {money(t.surplusAed)}
              </div>
            </div>
          </div>

          <div className="eh-card eh-mt" style={{ padding: ".4rem 1.25rem" }}>
            <h4 style={{ margin: ".6rem 0 .3rem" }}>Revenue by month</h4>
            {report.revenueByMonth.length === 0 ? (
              <div className="eh-sm eh-muted">No settled revenue yet.</div>
            ) : (
              <table className="eh-table stack">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Gross</th>
                    <th>Refunds</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {report.revenueByMonth.map(m => (
                    <tr key={m.month}>
                      <td data-label="Month">{m.month}</td>
                      <td data-label="Gross">{money(m.grossAed)}</td>
                      <td data-label="Refunds">{money(m.refundsAed)}</td>
                      <td data-label="Net">
                        <b>{money(m.netAed)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="eh-grid g2 eh-mt">
            <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
              <h4 style={{ margin: ".6rem 0 .3rem" }}>Revenue by tier</h4>
              {report.byTier.length === 0 ? (
                <div className="eh-sm eh-muted">No paid memberships yet.</div>
              ) : (
                <table className="eh-table stack">
                  <thead>
                    <tr>
                      <th>Tier</th>
                      <th>Gross</th>
                      <th>Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byTier.map(row => (
                      <tr key={row.tier}>
                        <td data-label="Tier">{row.tier}</td>
                        <td data-label="Gross">{money(row.grossAed)}</td>
                        <td data-label="Payments">{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
              <h4 style={{ margin: ".6rem 0 .3rem" }}>Expenses by category</h4>
              {report.expenseByCategory.length === 0 ? (
                <div className="eh-sm eh-muted">
                  No chapter spend recorded yet.
                </div>
              ) : (
                <table className="eh-table stack">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.expenseByCategory.map(row => (
                      <tr key={row.category}>
                        <td data-label="Category">
                          {EXPENSE_CATEGORY_LABEL[row.category] ?? row.category}
                        </td>
                        <td data-label="Spend">{money(row.aed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OfficerEvents({
  events,
  isLoading,
  refresh,
}: {
  events: {
    id: number;
    title: string;
    kind: string;
    startsAt: Date;
    location: string | null;
    audience: string;
    capacity: number;
    regCount: number;
    costAed: number | null;
    status?: string;
  }[];
  isLoading: boolean;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("meetup");
  const [location, setLocation] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [capacity, setCapacity] = useState(40);
  const [costAed, setCostAed] = useState<number | "">("");

  const save = trpc.officer.createEvent.useMutation({
    onSuccess: () => {
      toast("Event created.");
      setOpen(false);
      setTitle("");
      setKind("meetup");
      setLocation("");
      setStartsAt("");
      setCapacity(40);
      setCostAed("");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const archive = trpc.officer.archiveEvent.useMutation({
    onSuccess: () => {
      toast("Event archived.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Officer — Events</h3>
        <button className="eh-btn sm gold" onClick={() => setOpen(true)}>
          Create event
        </button>
      </div>
      {isLoading && <Spinner />}
      {!isLoading && events.length === 0 && (
        <Empty
          big="No chapter events."
          p="Create events for your chapter members."
        />
      )}
      <div className="eh-list eh-mt">
        {events.map(e => (
          <div className="row" key={e.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div className="t">{e.title}</div>
              <div className="d">
                {EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL] ??
                  e.kind}{" "}
                · {fmtDate(e.startsAt)} · {e.location || "no location"} ·{" "}
                {EVENT_AUDIENCE_LABEL[
                  e.audience as keyof typeof EVENT_AUDIENCE_LABEL
                ] ?? e.audience}
                {e.costAed != null
                  ? ` · AED ${e.costAed.toLocaleString()}`
                  : ""}
              </div>
              <div className="d eh-muted">
                {e.regCount}/{e.capacity} registered
              </div>
            </div>
            <button
              className="eh-btn ghost sm danger"
              disabled={archive.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Archive this event?",
                    body: "It will no longer be visible to members.",
                    danger: true,
                    confirmLabel: "Archive",
                  })
                )
                  archive.mutate({ id: e.id });
              }}
            >
              Archive
            </button>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Create chapter event" onClose={() => setOpen(false)}>
          <Field label="Title">
            <input
              className="eh-input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. March Circle Dinner"
            />
          </Field>
          <Field label="Kind">
            <select
              className="eh-select"
              value={kind}
              onChange={e => setKind(e.target.value)}
            >
              {Object.entries(EVENT_KIND_LABEL).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input
              className="eh-input"
              value={location}
              onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Dubai Marina"
            />
          </Field>
          <Field label="Starts at">
            <input
              className="eh-input"
              type="datetime-local"
              value={startsAt}
              onChange={e => setStartsAt(e.target.value)}
            />
          </Field>
          <Field label="Capacity">
            <input
              className="eh-input"
              type="number"
              min={1}
              max={2000}
              value={capacity}
              onChange={e => setCapacity(Number(e.target.value))}
            />
          </Field>
          <Field label="Cost (AED)">
            <input
              className="eh-input"
              type="number"
              min={0}
              max={1_000_000}
              value={costAed}
              onChange={e =>
                setCostAed(e.target.value === "" ? "" : Number(e.target.value))
              }
              placeholder="Optional — consumes approved chapter budget"
            />
          </Field>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={
              save.isPending ||
              title.trim().length < 2 ||
              !startsAt ||
              capacity < 1
            }
            onClick={() =>
              save.mutate({
                title: title.trim(),
                kind: kind as never,
                location: location || undefined,
                startsAt: new Date(startsAt),
                capacity,
                costAed: costAed === "" ? undefined : Number(costAed),
              })
            }
          >
            {save.isPending ? "Creating…" : "Create event →"}
          </button>
        </Modal>
      )}
    </div>
  );
}

function OfficerTransfers({
  transfers,
  isLoading,
  refresh,
}: {
  transfers: {
    transfer: {
      id: number;
      note: string | null;
      createdAt: Date;
    };
    memberName: string | null;
    memberEmail: string | null;
    fromName: string | null;
  }[];
  isLoading: boolean;
  refresh: () => void;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const review = trpc.officer.reviewChapterTransfer.useMutation({
    onSuccess: () => {
      toast("Transfer review recorded.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Officer — Incoming transfers</h3>
      </div>
      {isLoading && <Spinner />}
      {!isLoading && transfers.length === 0 && (
        <Empty
          big="No incoming transfers."
          p="Members requesting to join this chapter will appear here."
        />
      )}
      <div className="eh-list eh-mt">
        {transfers.map(({ transfer, memberName, memberEmail, fromName }) => (
          <div
            className="row"
            key={transfer.id}
            style={{ alignItems: "flex-start" }}
          >
            <div style={{ flex: 1 }}>
              <div className="t">{memberName ?? memberEmail ?? "Member"}</div>
              <div className="d">
                {fromName ?? "No chapter"} → <b>your chapter</b>
              </div>
              {transfer.note && (
                <div className="d" style={{ marginTop: ".2rem" }}>
                  “{transfer.note}”
                </div>
              )}
              <div className="d eh-muted">
                Requested {fmtDate(transfer.createdAt)}
              </div>
              <Field label="Officer note (optional)">
                <input
                  className="eh-input"
                  value={notes[transfer.id] ?? ""}
                  onChange={e =>
                    setNotes(prev => ({
                      ...prev,
                      [transfer.id]: e.target.value,
                    }))
                  }
                  placeholder="Reason for your recommendation"
                  maxLength={500}
                />
              </Field>
            </div>
            <div className="eh-row" style={{ gap: ".3rem" }}>
              <button
                className="eh-btn sm green"
                disabled={review.isPending}
                onClick={() =>
                  review.mutate({
                    transferId: transfer.id,
                    decision: "approve",
                    note: notes[transfer.id] || undefined,
                  })
                }
              >
                Approve
              </button>
              <button
                className="eh-btn ghost sm danger"
                disabled={review.isPending}
                onClick={() =>
                  review.mutate({
                    transferId: transfer.id,
                    decision: "reject",
                    note: notes[transfer.id] || undefined,
                  })
                }
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
