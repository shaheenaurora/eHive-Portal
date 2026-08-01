import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, TierPill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { SAVE_PLAYBOOK_STEPS, type SaveCaseStatus } from "@contracts/constants";

const STATUS_COLOR: Record<SaveCaseStatus, "grey" | "blue" | "green" | "red"> = {
  open: "grey", working: "blue", saved: "green", lost: "red",
};
const STATUS_LABEL: Record<SaveCaseStatus, string> = {
  open: "Open", working: "Working", saved: "Saved", lost: "Lost",
};
type Filter = "open" | "closed" | "all";

export default function AdminSaves() {
  const [filter, setFilter] = useState<Filter>("open");
  const q = trpc.adminEngage.savesList.useQuery({ status: filter }, { retry: false });
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.savesList.invalidate();

  const update = trpc.adminEngage.saveUpdate.useMutation({ onSuccess: refresh, onError: (e) => toast(e.message) });
  const close = trpc.adminEngage.saveClose.useMutation({
    onSuccess: () => { toast("Case closed."); refresh(); setClosing(null); },
    onError: (e) => toast(e.message),
  });

  const [closing, setClosing] = useState<{ id: number; outcome: "saved" | "lost" } | null>(null);
  const rows = q.data ?? [];
  const openCount = rows.filter((r) => r.status === "open" || r.status === "working").length;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Retention · ML-04b" title="Save Playbook"
        sub="When a member is flagged At-Risk, a tracked save opens here. Work the steps, own the outcome — a save is only real once they re-engage." />

      <div className="eh-between eh-mb">
        <div className="eh-row" style={{ gap: ".4rem" }}>
          {(["open", "closed", "all"] as Filter[]).map((f) => (
            <button key={f} className={`eh-btn sm ${filter === f ? "gold" : "ghost"}`} onClick={() => setFilter(f)}>
              {f === "open" ? "Open" : f === "closed" ? "Closed" : "All"}
            </button>
          ))}
        </div>
        {filter === "open" && <span className="eh-muted eh-sm">{openCount} open case{openCount === 1 ? "" : "s"}</span>}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && (
        <div className="eh-card"><Empty big={filter === "open" ? "No open saves — nice." : "Nothing here."}
          p="At-risk members show up here automatically for a structured save." /></div>
      )}

      {rows.map((c) => {
        const isOpen = c.status === "open" || c.status === "working";
        const mine = me.data?.id != null && c.ownerUserId === me.data.id;
        return (
          <div className="eh-card eh-mb" key={c.id}>
            <div className="eh-between" style={{ alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <div className="eh-row" style={{ gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <b style={{ fontSize: "1.05rem" }}>{c.memberName ?? `Member #${c.memberId}`}</b>
                  {c.tier && <TierPill tier={c.tier} />}
                  <Pill color={STATUS_COLOR[c.status]}>{STATUS_LABEL[c.status]}</Pill>
                  <span className="eh-muted eh-sm">{c.stepsDone}/{c.stepsTotal} steps</span>
                </div>
                <p className="eh-sm eh-muted" style={{ margin: ".35rem 0 0" }}>
                  {c.chapterName ? `${c.chapterName} · ` : ""}{c.reason}
                </p>
                <p className="eh-sm eh-muted" style={{ margin: ".2rem 0 0" }}>
                  Opened {fmtDate(c.openedAt)}{c.closedAt ? ` · closed ${fmtDate(c.closedAt)}` : ""}
                </p>
              </div>
              <div className="eh-row" style={{ gap: ".4rem", alignItems: "center" }}>
                <span className="eh-sm eh-muted">Owner: {c.ownerName ?? "—"}</span>
                {isOpen && !mine && (
                  <button className="eh-btn ghost sm" disabled={update.isPending}
                    onClick={() => update.mutate({ id: c.id, ownerUserId: me.data?.id ?? null })}>Assign to me</button>
                )}
                {isOpen && mine && (
                  <button className="eh-btn ghost sm" disabled={update.isPending}
                    onClick={() => update.mutate({ id: c.id, ownerUserId: null })}>Unassign</button>
                )}
              </div>
            </div>

            {/* step checklist */}
            <div className="eh-list" style={{ marginTop: ".9rem" }}>
              {SAVE_PLAYBOOK_STEPS.map((s, i) => {
                const done = (c.stepsMask & (1 << i)) !== 0;
                return (
                  <button key={s.key} className="row" disabled={!isOpen || update.isPending}
                    onClick={() => update.mutate({ id: c.id, stepsMask: c.stepsMask ^ (1 << i) })}
                    style={{
                      display: "flex", gap: ".7rem", alignItems: "flex-start", textAlign: "left",
                      background: "none", border: 0, width: "100%", cursor: isOpen ? "pointer" : "default",
                      opacity: isOpen ? 1 : .8, padding: ".5rem 0",
                    }}>
                    <span aria-hidden style={{
                      flex: "none", width: 20, height: 20, borderRadius: 5, marginTop: 1,
                      border: `1.5px solid ${done ? "var(--eh-good, #2E7D5B)" : "var(--eh-border)"}`,
                      background: done ? "var(--eh-good, #2E7D5B)" : "transparent", color: "#fff",
                      display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
                    }}>{done ? "✓" : ""}</span>
                    <span>
                      <b style={{ fontSize: ".95rem", textDecoration: done ? "line-through" : "none", opacity: done ? .7 : 1 }}>{s.label}</b>
                      <span className="eh-sm eh-muted" style={{ display: "block" }}>{s.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <NotesBox key={`n${c.id}`} initial={c.notes ?? ""} disabled={!isOpen || update.isPending}
              onSave={(notes) => update.mutate({ id: c.id, notes })} />

            {c.resolution && <p className="eh-sm" style={{ marginTop: ".6rem" }}><b>Outcome:</b> {c.resolution}</p>}

            {isOpen && (
              <div className="eh-row" style={{ gap: ".5rem", marginTop: ".9rem" }}>
                <button className="eh-btn green sm" onClick={() => setClosing({ id: c.id, outcome: "saved" })}>Mark saved</button>
                <button className="eh-btn ghost sm" onClick={() => setClosing({ id: c.id, outcome: "lost" })}>Mark lost</button>
              </div>
            )}
          </div>
        );
      })}

      {closing && (
        <CloseModal outcome={closing.outcome} pending={close.isPending}
          onClose={() => setClosing(null)}
          onConfirm={(resolution) => close.mutate({ id: closing.id, outcome: closing.outcome, resolution })} />
      )}
    </EhShell>
  );
}

function NotesBox({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const dirty = v !== initial;
  return (
    <div style={{ marginTop: ".8rem" }}>
      <textarea className="eh-input" rows={2} value={v} disabled={disabled}
        placeholder="Notes — what you tried, what they said, next touchpoint…"
        onChange={(e) => setV(e.target.value)} style={{ width: "100%", resize: "vertical" }} />
      {dirty && !disabled && (
        <button className="eh-btn ghost sm" style={{ marginTop: ".4rem" }} onClick={() => onSave(v)}>Save notes</button>
      )}
    </div>
  );
}

function CloseModal({ outcome, pending, onClose, onConfirm }: {
  outcome: "saved" | "lost"; pending: boolean; onClose: () => void; onConfirm: (resolution?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal title={outcome === "saved" ? "Mark this save as won" : "Mark this save as lost"} onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginBottom: ".8rem" }}>
        {outcome === "saved"
          ? "The member re-engaged. This clears their At-Risk flag and returns them to Active."
          : "The save didn't land. The renewal/lapse flow will take it from here."}
      </p>
      <Field label="Outcome note (optional)">
        <input className="eh-input" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder={outcome === "saved" ? "e.g. Booked a 1:1 and joined Thursday's session" : "e.g. No response after three touchpoints"} />
      </Field>
      <button className={`eh-btn ${outcome === "saved" ? "green" : "gold"}`} disabled={pending}
        onClick={() => onConfirm(note || undefined)}>
        {pending ? "Saving…" : outcome === "saved" ? "Confirm saved" : "Confirm lost"}
      </button>
    </Modal>
  );
}
