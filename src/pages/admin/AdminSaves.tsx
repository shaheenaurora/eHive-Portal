import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  TierPill,
  Empty,
  Spinner,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { SAVE_PLAYBOOK_STEPS, type SaveCaseStatus } from "@contracts/constants";

const STATUS_COLOR: Record<SaveCaseStatus, "grey" | "blue" | "green" | "red"> =
  {
    open: "grey",
    working: "blue",
    saved: "green",
    lost: "red",
  };
const STATUS_LABEL: Record<SaveCaseStatus, string> = {
  open: "Open",
  working: "Working",
  saved: "Saved",
  lost: "Lost",
};
type Filter = "open" | "closed" | "all";

type SaveCase = {
  id: number;
  memberId: number;
  memberName: string | null;
  tier: string | null;
  chapterName: string | null;
  status: SaveCaseStatus;
  reason: string;
  ownerUserId: number | null;
  ownerName: string | null;
  stepsMask: number;
  stepsDone: number;
  stepsTotal: number;
  notes: string | null;
  resolution: string | null;
  openedAt: string | Date;
  closedAt: string | Date | null;
  daysOpen: number;
};

function initials(name?: string | null): string {
  if (!name) return "•";
  const p = name.trim().split(/\s+/);
  return (
    (
      (p[0]?.[0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")
    ).toUpperCase() || "•"
  );
}

/** Urgency colour for an open case by how long it's been sitting. */
function urgency(daysOpen: number): { color: string; label: string } {
  if (daysOpen >= 7)
    return { color: "var(--eh-red, #b23a2e)", label: `${daysOpen}d open` };
  if (daysOpen >= 3) return { color: "#b8862e", label: `${daysOpen}d open` };
  return {
    color: "var(--eh-good, #2e7d5b)",
    label: daysOpen === 0 ? "New today" : `${daysOpen}d open`,
  };
}

export default function AdminSaves() {
  const [filter, setFilter] = useState<Filter>("open");
  const q = trpc.adminEngage.savesList.useQuery(
    { status: filter },
    { retry: false }
  );
  const summary = trpc.adminEngage.savesSummary.useQuery(undefined, {
    retry: false,
  });
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => {
    utils.adminEngage.savesList.invalidate();
    utils.adminEngage.savesSummary.invalidate();
  };

  const update = trpc.adminEngage.saveUpdate.useMutation({
    onSuccess: refresh,
    onError: e => toast(e.message),
  });
  const reopen = trpc.adminEngage.saveReopen.useMutation({
    onSuccess: () => {
      toast("Case reopened.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const close = trpc.adminEngage.saveClose.useMutation({
    onSuccess: () => {
      toast("Case closed.");
      refresh();
      setClosing(null);
    },
    onError: e => toast(e.message),
  });

  const [closing, setClosing] = useState<{
    id: number;
    outcome: "saved" | "lost";
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = (q.data ?? []) as SaveCase[];
  const s = summary.data;
  const active = s ? s.open + s.working : 0;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Retention · ML-04b"
        title="Save Playbook"
        sub="When a member is flagged At-Risk, a tracked save opens here. Work the steps, own the outcome — a save is only real once they re-engage."
      />

      {/* summary strip */}
      {s && (
        <div className="eh-grid g4 eh-mb">
          <MetricTile
            k="Active saves"
            v={active}
            n={`${s.open} untouched · ${s.working} in progress`}
          />
          <MetricTile
            k="Need attention"
            v={s.overdue}
            n="Open more than 7 days"
            accent={s.overdue > 0 ? "var(--eh-red, #b23a2e)" : undefined}
          />
          <MetricTile
            k="Saved"
            v={s.saved}
            n={`${s.lost} lost`}
            accent="var(--eh-good, #2e7d5b)"
          />
          <MetricTile
            k="Save rate"
            v={s.saveRate == null ? "—" : `${s.saveRate}%`}
            n="Of all closed cases"
          />
        </div>
      )}

      {/* filter tabs */}
      <div
        className="eh-between eh-mb"
        style={{ flexWrap: "wrap", gap: ".6rem" }}
      >
        <div className="eh-row" style={{ gap: ".4rem" }}>
          {(["open", "closed", "all"] as Filter[]).map(f => (
            <button
              key={f}
              className={`eh-btn sm ${filter === f ? "gold" : "ghost"}`}
              onClick={() => setFilter(f)}
            >
              {f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
              {f === "open" && s ? ` · ${active}` : ""}
            </button>
          ))}
        </div>
        {rows.length > 0 && (
          <span className="eh-muted eh-sm">
            {rows.length} case{rows.length === 1 ? "" : "s"} shown
          </span>
        )}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big={filter === "open" ? "No open saves — nice." : "Nothing here."}
            p="At-risk members show up here automatically for a structured save."
          />
        </div>
      )}

      <div style={{ display: "grid", gap: ".7rem" }}>
        {rows.map(c => (
          <CaseCard
            key={c.id}
            c={c}
            me={me.data?.id ?? null}
            open={expanded.has(c.id)}
            onToggle={() => toggle(c.id)}
            busy={update.isPending}
            onUpdate={patch => update.mutate({ id: c.id, ...patch })}
            onReopen={async () => {
              if (
                await confirmDialog({
                  title: "Reopen this save case?",
                  body: "This undoes the outcome and puts the case back on the board.",
                  confirmLabel: "Reopen",
                })
              )
                reopen.mutate({ id: c.id });
            }}
            onOutcome={outcome => setClosing({ id: c.id, outcome })}
          />
        ))}
      </div>

      {closing && (
        <CloseModal
          outcome={closing.outcome}
          pending={close.isPending}
          onClose={() => setClosing(null)}
          onConfirm={resolution =>
            close.mutate({
              id: closing.id,
              outcome: closing.outcome,
              resolution,
            })
          }
        />
      )}
    </EhShell>
  );
}

function MetricTile({
  k,
  v,
  n,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  n?: string;
  accent?: string;
}) {
  return (
    <div
      className="eh-card"
      style={{
        padding: "1rem 1.1rem",
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      <div className="eh-eyebrow" style={{ marginBottom: ".2rem" }}>
        {k}
      </div>
      <div
        className="eh-num"
        style={{
          fontSize: "2rem",
          fontWeight: 800,
          lineHeight: 1,
          color: accent ?? "var(--eh-ink)",
        }}
      >
        {v}
      </div>
      {n && (
        <div className="eh-muted eh-sm" style={{ marginTop: ".25rem" }}>
          {n}
        </div>
      )}
    </div>
  );
}

function StepDots({ done, total }: { done: number; total: number }) {
  return (
    <span
      className="eh-row"
      style={{ gap: 4, alignItems: "center" }}
      aria-label={`${done} of ${total} steps done`}
    >
      {Array.from({ length: total }).map((_, i) => (
        <i
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            display: "block",
            background:
              i < done ? "var(--eh-good, #2e7d5b)" : "var(--eh-line, #d8d2c4)",
          }}
        />
      ))}
    </span>
  );
}

function CaseCard({
  c,
  me,
  open,
  onToggle,
  busy,
  onUpdate,
  onReopen,
  onOutcome,
}: {
  c: SaveCase;
  me: number | null;
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  onUpdate: (patch: {
    ownerUserId?: number | null;
    stepsMask?: number;
    notes?: string;
  }) => void;
  onReopen: () => void;
  onOutcome: (outcome: "saved" | "lost") => void;
}) {
  const isOpen = c.status === "open" || c.status === "working";
  const mine = me != null && c.ownerUserId === me;
  const u = urgency(c.daysOpen);
  const accent = isOpen ? u.color : "var(--eh-line, #d8d2c4)";

  return (
    <div
      className="eh-card"
      style={{
        padding: 0,
        overflow: "hidden",
        borderLeft: `3px solid ${accent}`,
      }}
    >
      {/* header row — click to expand */}
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: ".85rem",
          width: "100%",
          textAlign: "left",
          flexWrap: "wrap",
          background: "none",
          border: 0,
          cursor: "pointer",
          padding: "1rem 1.2rem",
        }}
      >
        <span
          style={{
            flex: "none",
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            background: "var(--eh-ink-2, #16264c)",
            color: "#F3F1EA",
            fontWeight: 700,
            fontSize: ".85rem",
          }}
        >
          {initials(c.memberName)}
        </span>
        <span style={{ flex: "1 1 11rem", minWidth: 0 }}>
          <span
            className="eh-row"
            style={{ gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}
          >
            <b style={{ fontSize: "1rem" }}>
              {c.memberName ?? `Member #${c.memberId}`}
            </b>
            {c.tier && <TierPill tier={c.tier} />}
            <Pill color={STATUS_COLOR[c.status]}>{STATUS_LABEL[c.status]}</Pill>
          </span>
          <span
            className="eh-muted eh-sm"
            style={{
              display: "block",
              marginTop: ".2rem",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {c.chapterName ? `${c.chapterName} · ` : ""}
            {c.reason}
          </span>
        </span>
        <span
          className="eh-row"
          style={{
            flex: "none",
            gap: ".9rem",
            alignItems: "center",
            marginLeft: "auto",
          }}
        >
          {isOpen && (
            <span
              className="eh-sm"
              style={{ color: u.color, fontWeight: 600, whiteSpace: "nowrap" }}
              title={`Opened ${fmtDate(c.openedAt)}`}
            >
              {u.label}
            </span>
          )}
          <span
            className="eh-row"
            style={{ gap: ".45rem", alignItems: "center" }}
          >
            <StepDots done={c.stepsDone} total={c.stepsTotal} />
            <span
              className="eh-muted eh-sm eh-num"
              style={{ whiteSpace: "nowrap" }}
            >
              {c.stepsDone}/{c.stepsTotal}
            </span>
          </span>
          <span
            aria-hidden
            style={{
              color: "var(--eh-muted, #5f5c53)",
              transition: "transform .2s",
              transform: open ? "rotate(90deg)" : "none",
              fontSize: ".9rem",
            }}
          >
            ▸
          </span>
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: "0 1.2rem 1.2rem",
            borderTop: "1px solid var(--eh-line, #d8d2c4)",
          }}
        >
          <div
            className="eh-between"
            style={{ margin: ".9rem 0 .2rem", flexWrap: "wrap", gap: ".5rem" }}
          >
            <span className="eh-sm eh-muted">
              Opened {fmtDate(c.openedAt)}
              {c.closedAt ? ` · closed ${fmtDate(c.closedAt)}` : ""} · Owner:{" "}
              {c.ownerName ?? "—"}
            </span>
            {isOpen &&
              (mine ? (
                <button
                  className="eh-btn ghost sm"
                  disabled={busy}
                  onClick={() => onUpdate({ ownerUserId: null })}
                >
                  Unassign
                </button>
              ) : (
                <button
                  className="eh-btn ghost sm"
                  disabled={busy}
                  onClick={() => onUpdate({ ownerUserId: me })}
                >
                  Assign to me
                </button>
              ))}
          </div>

          {/* step checklist */}
          <div className="eh-list" style={{ marginTop: ".4rem" }}>
            {SAVE_PLAYBOOK_STEPS.map((step, i) => {
              const done = (c.stepsMask & (1 << i)) !== 0;
              return (
                <button
                  key={step.key}
                  disabled={!isOpen || busy}
                  onClick={() =>
                    onUpdate({ stepsMask: c.stepsMask ^ (1 << i) })
                  }
                  style={{
                    display: "flex",
                    justifyContent: "flex-start",
                    gap: ".7rem",
                    alignItems: "flex-start",
                    textAlign: "left",
                    background: "none",
                    border: 0,
                    width: "100%",
                    cursor: isOpen ? "pointer" : "default",
                    opacity: isOpen ? 1 : 0.8,
                    padding: ".5rem 0",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: "none",
                      width: 20,
                      height: 20,
                      borderRadius: 5,
                      marginTop: 1,
                      border: `1.5px solid ${done ? "var(--eh-good, #2E7D5B)" : "var(--eh-border)"}`,
                      background: done
                        ? "var(--eh-good, #2E7D5B)"
                        : "transparent",
                      color: "#fff",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span>
                    <b
                      style={{
                        fontSize: ".95rem",
                        textDecoration: done ? "line-through" : "none",
                        opacity: done ? 0.7 : 1,
                      }}
                    >
                      {step.label}
                    </b>
                    <span
                      className="eh-sm eh-muted"
                      style={{ display: "block" }}
                    >
                      {step.hint}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <NotesBox
            key={`n${c.id}`}
            initial={c.notes ?? ""}
            disabled={!isOpen || busy}
            onSave={notes => onUpdate({ notes })}
          />

          {c.resolution && (
            <p className="eh-sm" style={{ marginTop: ".6rem" }}>
              <b>Outcome:</b> {c.resolution}
            </p>
          )}

          {isOpen ? (
            <div
              className="eh-row"
              style={{ gap: ".5rem", marginTop: ".9rem" }}
            >
              <button
                className="eh-btn green sm"
                onClick={() => onOutcome("saved")}
              >
                Mark saved
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() => onOutcome("lost")}
              >
                Mark lost
              </button>
            </div>
          ) : (
            <div
              className="eh-row"
              style={{ gap: ".5rem", marginTop: ".9rem" }}
            >
              <button className="eh-btn ghost sm" onClick={onReopen}>
                Reopen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NotesBox({
  initial,
  disabled,
  onSave,
}: {
  initial: string;
  disabled: boolean;
  onSave: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  const dirty = v !== initial;
  return (
    <div style={{ marginTop: ".8rem" }}>
      <textarea
        className="eh-input"
        rows={2}
        value={v}
        disabled={disabled}
        placeholder="Notes — what you tried, what they said, next touchpoint…"
        onChange={e => setV(e.target.value)}
        style={{ width: "100%", resize: "vertical" }}
      />
      {dirty && !disabled && (
        <button
          className="eh-btn ghost sm"
          style={{ marginTop: ".4rem" }}
          onClick={() => onSave(v)}
        >
          Save notes
        </button>
      )}
    </div>
  );
}

function CloseModal({
  outcome,
  pending,
  onClose,
  onConfirm,
}: {
  outcome: "saved" | "lost";
  pending: boolean;
  onClose: () => void;
  onConfirm: (resolution?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal
      title={
        outcome === "saved" ? "Mark this save as won" : "Mark this save as lost"
      }
      onClose={onClose}
    >
      <p className="eh-sm eh-muted" style={{ marginBottom: ".8rem" }}>
        {outcome === "saved"
          ? "The member re-engaged. This clears their At-Risk flag and returns them to Active."
          : "The save didn't land. The renewal/lapse flow will take it from here."}
      </p>
      <Field label="Outcome note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder={
            outcome === "saved"
              ? "e.g. Booked a 1:1 and joined Thursday's session"
              : "e.g. No response after three touchpoints"
          }
        />
      </Field>
      <button
        className={`eh-btn ${outcome === "saved" ? "green" : "gold"}`}
        disabled={pending}
        onClick={() => onConfirm(note || undefined)}
      >
        {pending
          ? "Saving…"
          : outcome === "saved"
            ? "Confirm saved"
            : "Confirm lost"}
      </button>
    </Modal>
  );
}
