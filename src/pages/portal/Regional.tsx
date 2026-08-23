import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  LoadError,
  Modal,
  Bar,
  Field,
  toast,
  StatusPill,
} from "@/components/eh";
import { fmtDate, fmtDateTime } from "@/lib/ehf";
import {
  CHAPTER_STATUS_LABEL,
  CHAPTER_ROLE_LABEL,
  HEALTH_BAND_LABEL,
  HEALTH_BAND_COLOR,
  healthBand,
  EXPENSE_CATEGORY_LABEL,
  type ChapterStatus,
} from "@contracts/constants";
import {
  FREQUENCY_LABEL,
  periodLabel,
  type Frequency,
} from "@contracts/cadence";

const ROLE_LABEL: Record<string, string> = {
  zone_director: "Zone Director",
  region_director: "Region Director",
  country_director: "Country Director",
  national_director: "National Director",
};

const CADENCE_STATUS_COLOR: Record<string, "green" | "gold" | "red" | "grey"> =
  {
    kept: "green",
    rescheduled: "gold",
    missed: "red",
    open: "grey",
  };

function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

function levelLabel(level: string) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

const money = (aedNum: number) =>
  "AED " +
  aedNum.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(aedNum) ? 0 : 2,
    maximumFractionDigits: 2,
  });

export default function Regional() {
  useDocumentTitle("My Region");
  const [tab, setTab] = useState<"overview" | "council" | "finance">(
    "overview"
  );
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(
    null
  );

  const utils = trpc.useUtils();
  const overview = trpc.officer.regionalOverview.useQuery(undefined, {
    retry: false,
  });

  const chapterDetail = trpc.officer.chapterDetail.useQuery(
    { chapterId: selectedChapterId! },
    { retry: false, enabled: selectedChapterId !== null }
  );

  const isForbidden = overview.error?.data?.code === "FORBIDDEN";
  const selectedChapter = overview.data?.chapters.find(
    c => c.id === selectedChapterId
  );

  const detail = chapterDetail.data;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Regional"
        title="My Region"
        sub="Overview of the chapters, members and operating rhythm in your zone."
      />

      {overview.isLoading && <Spinner />}

      {!overview.isLoading && overview.error && !isForbidden && (
        <LoadError
          what="regional overview"
          onRetry={() => overview.refetch()}
        />
      )}

      {isForbidden && (
        <div className="eh-card">
          <Empty
            big="You don't hold a regional director role."
            p="This page is for zone, region and country directors. If you think you should have access, reach out to the Circle team."
          />
        </div>
      )}

      {overview.data && (
        <>
          <div className="eh-mb">
            <Pill color="gold">
              {roleLabel(overview.data.scope.role)} ·{" "}
              {levelLabel(overview.data.scope.level)}
            </Pill>
          </div>

          <div className="eh-tabs eh-mb">
            {[
              { key: "overview", label: "Overview" },
              { key: "council", label: "Council" },
              { key: "finance", label: "Finance" },
            ].map(t => (
              <button
                key={t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key as typeof tab)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <OverviewTab
              overview={overview.data}
              onSelectChapter={setSelectedChapterId}
            />
          )}
          {tab === "council" && (
            <CouncilTab
              onInvalidate={() => utils.officer.regionalCouncil.invalidate()}
            />
          )}
          {tab === "finance" && <FinanceTab />}
        </>
      )}

      {selectedChapterId !== null && (
        <Modal
          title={selectedChapter?.name ?? "Chapter detail"}
          onClose={() => setSelectedChapterId(null)}
          wide
        >
          {chapterDetail.isLoading ? (
            <Spinner />
          ) : chapterDetail.error || !detail ? (
            <LoadError
              what="chapter details"
              onRetry={() => chapterDetail.refetch()}
            />
          ) : (
            <>
              <div className="eh-grid g2 eh-mb" style={{ alignItems: "start" }}>
                <div>
                  <div className="eh-sm eh-muted">Location</div>
                  <div>
                    {[
                      detail.chapter.city,
                      detail.chapter.zone,
                      detail.chapter.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="eh-sm eh-muted">Health</div>
                  <div className="eh-row" style={{ gap: ".5rem" }}>
                    {detail.health ? (
                      <>
                        <span className="eh-num" style={{ fontSize: "1.3rem" }}>
                          {detail.health.total}
                        </span>
                        <Pill
                          color={
                            HEALTH_BAND_COLOR[healthBand(detail.health.total)]
                          }
                        >
                          {HEALTH_BAND_LABEL[healthBand(detail.health.total)]}
                        </Pill>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Board
              </h3>
              {detail.board.length === 0 ? (
                <p className="eh-sm eh-muted">No active board roles.</p>
              ) : (
                <div className="eh-list" style={{ marginBottom: "1.2rem" }}>
                  {detail.board.map(b => (
                    <div className="row" key={b.id}>
                      <div>
                        <div className="t">{b.memberName}</div>
                        <div className="d">
                          {CHAPTER_ROLE_LABEL[b.role] ?? b.title ?? b.role}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Roster · {detail.roster.length} member
                {detail.roster.length === 1 ? "" : "s"}
              </h3>
              {detail.roster.length === 0 ? (
                <p className="eh-sm eh-muted">No members in this chapter.</p>
              ) : (
                <div className="eh-list" style={{ marginBottom: "1.2rem" }}>
                  {detail.roster.map(m => (
                    <div className="row" key={m.id}>
                      <div>
                        <div className="t">{m.name}</div>
                        <div className="d">{m.status.replace(/_/g, " ")}</div>
                      </div>
                      <Pill
                        color={
                          m.lifecycleState === "at_risk"
                            ? "red"
                            : m.lifecycleState === "active"
                              ? "green"
                              : "grey"
                        }
                      >
                        {m.lifecycleState.replace(/_/g, " ")}
                      </Pill>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Operating rhythm
                {detail.cadence && detail.cadence.adherence !== undefined && (
                  <span
                    className="eh-sm eh-muted"
                    style={{ marginLeft: ".6rem" }}
                  >
                    {detail.cadence.adherence}% kept
                  </span>
                )}
              </h3>
              {(detail.cadence?.cadences ?? []).length === 0 ? (
                <p className="eh-sm eh-muted">No cadences set up yet.</p>
              ) : (
                <div className="eh-list">
                  {detail.cadence!.cadences.map(c => (
                    <div
                      className="row"
                      key={c.id}
                      style={{ alignItems: "flex-start" }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="t">{c.title}</div>
                        <div className="d">
                          {FREQUENCY_LABEL[c.frequency as Frequency]} · {c.kept}{" "}
                          kept
                          {c.missed ? `, ${c.missed} missed` : ""}
                        </div>
                        <div style={{ marginTop: ".35rem", maxWidth: 220 }}>
                          <Bar pct={c.adherence} />
                        </div>
                      </div>
                      <Pill
                        color={CADENCE_STATUS_COLOR[c.currentStatus] ?? "grey"}
                      >
                        {c.currentStatus === "open"
                          ? `due ${periodLabel(c.frequency as Frequency)}`
                          : c.currentStatus}
                      </Pill>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </EhShell>
  );
}

function OverviewTab({
  overview,
  onSelectChapter,
}: {
  overview: {
    chapterCount: number;
    memberCount: number;
    atRiskCount: number;
    chapters: {
      id: number;
      name: string;
      status: string;
      city: string | null;
      zoneId: number | null;
      members: number;
      atRisk: number;
      health: number | null;
    }[];
  };
  onSelectChapter: (id: number) => void;
}) {
  return (
    <>
      <div className="eh-grid g3 eh-mb">
        <div className="eh-card eh-stat">
          <div className="k">Chapters</div>
          <div className="v eh-num">{overview.chapterCount}</div>
        </div>
        <div className="eh-card eh-stat">
          <div className="k">Total Members</div>
          <div className="v eh-num">{overview.memberCount}</div>
        </div>
        <div className="eh-card eh-stat">
          <div className="k">At-Risk Members</div>
          <div className="v eh-num" style={{ color: "var(--eh-red)" }}>
            {overview.atRiskCount}
          </div>
        </div>
      </div>

      <div className="eh-card">
        <h3 style={{ margin: 0 }}>Chapters</h3>
        {overview.chapters.length === 0 ? (
          <Empty
            big="No chapters found."
            p="There are no chapters under your regional scope yet."
          />
        ) : (
          <table className="eh-table stack eh-mt">
            <thead>
              <tr>
                <th>Name</th>
                <th>City</th>
                <th>Members</th>
                <th>At-Risk</th>
                <th>Health</th>
              </tr>
            </thead>
            <tbody>
              {overview.chapters.map(ch => (
                <tr
                  key={ch.id}
                  className="click"
                  onClick={() => onSelectChapter(ch.id)}
                >
                  <td data-label="Name">
                    <strong>{ch.name}</strong>
                    <div className="eh-sm eh-muted">
                      {CHAPTER_STATUS_LABEL[ch.status as ChapterStatus] ??
                        ch.status}
                    </div>
                  </td>
                  <td data-label="City">{ch.city ?? "—"}</td>
                  <td data-label="Members">{ch.members}</td>
                  <td data-label="At-Risk">
                    {ch.atRisk > 0 ? (
                      <span style={{ color: "var(--eh-red)" }}>
                        {ch.atRisk}
                      </span>
                    ) : (
                      0
                    )}
                  </td>
                  <td data-label="Health">
                    {ch.health !== null ? (
                      <span className="eh-row" style={{ gap: ".5rem" }}>
                        <span className="eh-num">{ch.health}</span>
                        <Pill color={HEALTH_BAND_COLOR[healthBand(ch.health)]}>
                          {HEALTH_BAND_LABEL[healthBand(ch.health)]}
                        </Pill>
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function CouncilTab({ onInvalidate }: { onInvalidate: () => void }) {
  const council = trpc.officer.regionalCouncil.useQuery(undefined, {
    retry: false,
  });
  const [meetOpen, setMeetOpen] = useState(false);
  const [decOpen, setDecOpen] = useState(false);
  const [editMeeting, setEditMeeting] = useState<{
    id: number;
    title: string;
    agenda: string | null;
    minutes: string | null;
    status: string;
  } | null>(null);

  return (
    <div className="eh-grid g2" style={{ alignItems: "start" }}>
      <div className="eh-card">
        <div className="eh-between">
          <h3 style={{ margin: 0 }}>Council meetings</h3>
          <button className="eh-btn sm gold" onClick={() => setMeetOpen(true)}>
            Schedule meeting
          </button>
        </div>
        {council.isLoading && <Spinner />}
        {!council.isLoading && council.error && (
          <LoadError
            what="council meetings"
            onRetry={() => council.refetch()}
          />
        )}
        {council.data && council.data.meetings.length === 0 && (
          <Empty
            big="No meetings yet."
            p="Schedule the first council meeting."
          />
        )}
        {council.data && council.data.meetings.length > 0 && (
          <div className="eh-list eh-mt">
            {council.data.meetings.map(m => (
              <div
                className="row"
                key={m.id}
                style={{ alignItems: "flex-start" }}
              >
                <div style={{ flex: 1 }}>
                  <div className="t">{m.title}</div>
                  <div className="d">
                    {fmtDateTime(m.scheduledAt)} ·{" "}
                    <StatusPill status={m.status} />
                  </div>
                  {m.agenda && (
                    <div className="d eh-muted">{m.agenda.slice(0, 140)}</div>
                  )}
                </div>
                <button
                  className="eh-btn ghost sm"
                  onClick={() => setEditMeeting(m)}
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="eh-card">
        <div className="eh-between">
          <h3 style={{ margin: 0 }}>Decisions</h3>
          <button className="eh-btn sm gold" onClick={() => setDecOpen(true)}>
            Log decision
          </button>
        </div>
        {council.isLoading && <Spinner />}
        {council.data && council.data.decisions.length === 0 && (
          <Empty
            big="No decisions yet."
            p="Record council motions and outcomes."
          />
        )}
        {council.data && council.data.decisions.length > 0 && (
          <div className="eh-list eh-mt">
            {council.data.decisions.map(d => (
              <DecisionRow
                key={d.id}
                decision={d}
                meetings={council.data!.meetings}
                onInvalidate={onInvalidate}
              />
            ))}
          </div>
        )}
      </div>

      {meetOpen && (
        <CreateMeetingModal
          onClose={() => setMeetOpen(false)}
          onInvalidate={onInvalidate}
        />
      )}
      {decOpen && (
        <LogDecisionModal
          meetings={council.data?.meetings ?? []}
          onClose={() => setDecOpen(false)}
          onInvalidate={onInvalidate}
        />
      )}
      {editMeeting && (
        <EditMeetingModal
          meeting={editMeeting}
          onClose={() => setEditMeeting(null)}
          onInvalidate={onInvalidate}
        />
      )}
    </div>
  );
}

function DecisionRow({
  decision,
  meetings,
  onInvalidate,
}: {
  decision: {
    id: number;
    meetingId: number | null;
    title: string;
    detail: string | null;
    status: string;
    createdAt: Date;
  };
  meetings: { id: number; title: string }[];
  onInvalidate: () => void;
}) {
  const decide = trpc.officer.regionalDecideDecision.useMutation({
    onSuccess: () => {
      toast("Decision updated.");
      onInvalidate();
    },
    onError: e => toast(e.message),
  });
  const meeting = meetings.find(m => m.id === decision.meetingId);
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div className="t">{decision.title}</div>
        <div className="d eh-muted">
          {meeting ? `Meeting: ${meeting.title}` : "Standalone decision"} ·{" "}
          {fmtDate(decision.createdAt)}
        </div>
        {decision.detail && (
          <div className="d eh-muted">{decision.detail.slice(0, 140)}</div>
        )}
      </div>
      <select
        className="eh-select sm"
        value={decision.status}
        disabled={decide.isPending}
        onChange={e =>
          decide.mutate({ id: decision.id, status: e.target.value as never })
        }
      >
        {["proposed", "carried", "failed", "deferred"].map(s => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}

function CreateMeetingModal({
  onClose,
  onInvalidate,
}: {
  onClose: () => void;
  onInvalidate: () => void;
}) {
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [agenda, setAgenda] = useState("");
  const create = trpc.officer.regionalCreateCouncilMeeting.useMutation({
    onSuccess: () => {
      toast("Meeting scheduled.");
      onClose();
      onInvalidate();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title="Schedule council meeting" onClose={onClose}>
      <Field label="Title">
        <input
          className="eh-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Q3 Regional Council"
        />
      </Field>
      <Field label="Scheduled at">
        <input
          className="eh-input"
          type="datetime-local"
          value={scheduledAt}
          onChange={e => setScheduledAt(e.target.value)}
        />
      </Field>
      <Field label="Agenda">
        <textarea
          className="eh-input"
          rows={4}
          value={agenda}
          onChange={e => setAgenda(e.target.value)}
          placeholder="Agenda items..."
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={create.isPending || title.trim().length < 3}
        onClick={() =>
          create.mutate({
            title: title.trim(),
            scheduledAt: scheduledAt || undefined,
            agenda: agenda || undefined,
          })
        }
      >
        {create.isPending ? "Scheduling…" : "Schedule meeting →"}
      </button>
    </Modal>
  );
}

function EditMeetingModal({
  meeting,
  onClose,
  onInvalidate,
}: {
  meeting: {
    id: number;
    title: string;
    agenda: string | null;
    minutes: string | null;
    status: string;
  };
  onClose: () => void;
  onInvalidate: () => void;
}) {
  const [status, setStatus] = useState(meeting.status);
  const [agenda, setAgenda] = useState(meeting.agenda ?? "");
  const [minutes, setMinutes] = useState(meeting.minutes ?? "");
  const update = trpc.officer.regionalUpdateCouncilMeeting.useMutation({
    onSuccess: () => {
      toast("Meeting updated.");
      onClose();
      onInvalidate();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title={meeting.title} onClose={onClose}>
      <Field label="Status">
        <select
          className="eh-select"
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          {["scheduled", "held", "cancelled"].map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Agenda">
        <textarea
          className="eh-input"
          rows={4}
          value={agenda}
          onChange={e => setAgenda(e.target.value)}
        />
      </Field>
      <Field label="Minutes">
        <textarea
          className="eh-input"
          rows={6}
          value={minutes}
          onChange={e => setMinutes(e.target.value)}
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={update.isPending}
        onClick={() =>
          update.mutate({
            id: meeting.id,
            status: status as "scheduled" | "held" | "cancelled",
            agenda: agenda || undefined,
            minutes: minutes || undefined,
          })
        }
      >
        {update.isPending ? "Saving…" : "Save changes →"}
      </button>
    </Modal>
  );
}

function LogDecisionModal({
  meetings,
  onClose,
  onInvalidate,
}: {
  meetings: { id: number; title: string }[];
  onClose: () => void;
  onInvalidate: () => void;
}) {
  const [meetingId, setMeetingId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const log = trpc.officer.regionalLogDecision.useMutation({
    onSuccess: () => {
      toast("Decision logged.");
      onClose();
      onInvalidate();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title="Log council decision" onClose={onClose}>
      <Field label="Linked meeting (optional)">
        <select
          className="eh-select"
          value={meetingId}
          onChange={e => setMeetingId(e.target.value)}
        >
          <option value="">Standalone decision</option>
          {meetings.map(m => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input
          className="eh-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Approve regional event budget"
        />
      </Field>
      <Field label="Detail (optional)">
        <textarea
          className="eh-input"
          rows={4}
          value={detail}
          onChange={e => setDetail(e.target.value)}
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={log.isPending || title.trim().length < 3}
        onClick={() =>
          log.mutate({
            meetingId: meetingId ? Number(meetingId) : undefined,
            title: title.trim(),
            detail: detail || undefined,
          })
        }
      >
        {log.isPending ? "Saving…" : "Log decision →"}
      </button>
    </Modal>
  );
}

function FinanceTab() {
  const report = trpc.officer.regionalFinanceReport.useQuery(undefined, {
    retry: false,
  });
  const expenses = trpc.officer.regionalExpenses.useQuery(undefined, {
    retry: false,
  });
  const t = report.data?.totals;

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="eh-card">
        <h3 style={{ margin: 0 }}>Regional finance report</h3>
        {report.isLoading && <Spinner />}
        {report.error && (
          <LoadError what="finance report" onRetry={() => report.refetch()} />
        )}
        {report.data && t && (
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
              {report.data.revenueByMonth.length === 0 ? (
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
                    {report.data.revenueByMonth.map(m => (
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
                {report.data.byTier.length === 0 ? (
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
                      {report.data.byTier.map(row => (
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
                <h4 style={{ margin: ".6rem 0 .3rem" }}>
                  Expenses by category
                </h4>
                {report.data.expenseByCategory.length === 0 ? (
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
                      {report.data.expenseByCategory.map(row => (
                        <tr key={row.category}>
                          <td data-label="Category">
                            {EXPENSE_CATEGORY_LABEL[row.category] ??
                              row.category}
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

      <div className="eh-card">
        <h3 style={{ margin: 0 }}>Regional expenses</h3>
        {expenses.isLoading && <Spinner />}
        {expenses.error && (
          <LoadError what="expenses" onRetry={() => expenses.refetch()} />
        )}
        {expenses.data && expenses.data.length === 0 && (
          <Empty
            big="No expenses found."
            p="No spend recorded in your regional scope."
          />
        )}
        {expenses.data && expenses.data.length > 0 && (
          <table className="eh-table stack eh-mt">
            <thead>
              <tr>
                <th>Chapter</th>
                <th>Label</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {expenses.data.map(ex => (
                <tr key={ex.id}>
                  <td data-label="Chapter">{ex.chapterName ?? "—"}</td>
                  <td data-label="Label">{ex.label}</td>
                  <td data-label="Category">
                    {ex.category
                      ? (EXPENSE_CATEGORY_LABEL[ex.category] ?? ex.category)
                      : "Uncategorised"}
                  </td>
                  <td data-label="Amount">{money(ex.amount)}</td>
                  <td data-label="Status">
                    <StatusPill status={ex.status} />
                  </td>
                  <td data-label="Date">{fmtDate(ex.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
