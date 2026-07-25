import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Spinner, Modal, Field, Empty, toast } from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";
import { SCORE_FACTOR_LABEL, DORMANCY_LABEL, TIER_LABEL } from "@contracts/constants";
import type { DormancyStage, Tier } from "@contracts/constants";

const STAGE_COLOR: Record<string, "green" | "gold" | "red" | "grey"> = {
  active: "green", at_risk: "gold", dormant: "red", non_renewal: "grey",
};

export default function AdminEngagement() {
  const utils = trpc.useUtils();
  const rules = trpc.adminEngage.pointRules.useQuery(undefined, { retry: false });
  const config = trpc.adminEngage.engagementConfig.useQuery(undefined, { retry: false });
  const board = trpc.adminEngage.dormancyBoard.useQuery(undefined, { retry: false });

  const [editRule, setEditRule] = useState<{ key: string; label: string; points: number } | null>(null);
  const [points, setPoints] = useState(0);
  const [editCfg, setEditCfg] = useState<string | null>(null);
  const [overrideFor, setOverrideFor] = useState<{ id: number; name: string } | null>(null);
  const [pauseFor, setPauseFor] = useState<{ id: number; name: string } | null>(null);

  function refresh() {
    utils.adminEngage.pointRules.invalidate();
    utils.adminEngage.engagementConfig.invalidate();
    utils.adminEngage.dormancyBoard.invalidate();
  }

  const setRule = trpc.adminEngage.setPointRule.useMutation({
    onSuccess: () => { toast("Point rule updated — applies from the next event."); setEditRule(null); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setCfg = trpc.adminEngage.setEngagementConfig.useMutation({
    onSuccess: () => { toast("Engagement Standard saved."); setEditCfg(null); refresh(); },
    onError: (e) => toast(e.message),
  });
  const evaluate = trpc.adminEngage.runDormancyEvaluation.useMutation({
    onSuccess: (r) => { toast(`Evaluation complete — ${r.evaluated} members reviewed, ${r.transitions} stage changes.`); refresh(); },
    onError: (e) => toast(e.message),
  });
  const override = trpc.adminEngage.setDormancyOverride.useMutation({
    onSuccess: () => { toast("Stage overridden and logged."); setOverrideFor(null); refresh(); },
    onError: (e) => toast(e.message),
  });
  const pause = trpc.adminEngage.setExceptionPause.useMutation({
    onSuccess: () => { toast("Exception pause saved."); setPauseFor(null); refresh(); },
    onError: (e) => toast(e.message),
  });

  const cfgByTier = new Map((config.data ?? []).map((c) => [c.tier, c]));

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead eyebrow="Engagement" title="The engagement engine"
                sub="Point rules, the Engagement Standard per tier, and the Dormancy Ladder — all configurable, all logged." />

      <div className="eh-grid g2" style={{ alignItems: "start" }}>
        <div className="eh-card">
          <h3>Hive Score point rules</h3>
          <p className="eh-muted eh-sm">What each action earns (or costs). Changes apply immediately.</p>
          {rules.isLoading && <Spinner />}
          <div className="eh-list">
            {(rules.data ?? []).map((r) => (
              <div className="row" key={r.key}>
                <div style={{ flex: 1 }}>
                  <div className="t">{r.label}</div>
                  <div className="d">{SCORE_FACTOR_LABEL[r.factor as keyof typeof SCORE_FACTOR_LABEL] ?? r.factor}</div>
                </div>
                <Pill color={r.points >= 0 ? "green" : "red"}>{r.points >= 0 ? "+" : ""}{r.points}</Pill>
                <button className="eh-btn ghost sm"
                        onClick={() => { setEditRule({ key: r.key, label: r.label, points: r.points }); setPoints(r.points); }}>
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="eh-card">
          <h3>Engagement Standard per tier</h3>
          <p className="eh-muted eh-sm">The minimum a member owes the Circle. Evaluated quarterly against the Dormancy Ladder.</p>
          <div className="eh-list">
            {(["horizon", "ascent", "vanguard", "zenith"] as Tier[]).map((t) => {
              const c = cfgByTier.get(t);
              return (
                <div className="row" key={t}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{TIER_LABEL[t]}</div>
                    <div className="d">
                      {c
                        ? `${c.sessionsRequired ?? "—"} of ${c.sessionsOffered ?? "—"} sessions/yr · ${c.oneToOnesPerQuarter ?? "—"} 1-2-1s/qtr · ${c.giveBackPerYear ?? "—"} give-back/yr`
                        : "Not configured"}
                    </div>
                  </div>
                  <button className="eh-btn ghost sm" onClick={() => setEditCfg(t)}>{c ? "Edit" : "Set"}</button>
                </div>
              );
            })}
          </div>

          <hr className="eh-divider" />
          <div className="eh-between">
            <div>
              <h3 style={{ margin: 0 }}>Quarterly evaluation</h3>
              <p className="eh-muted eh-sm" style={{ margin: 0 }}>Runs the ladder for every active member and notifies transitions.</p>
            </div>
            <button className="eh-btn gold" disabled={evaluate.isPending} onClick={() => evaluate.mutate()}>
              {evaluate.isPending ? "Running…" : "Run now"}
            </button>
          </div>
        </div>
      </div>

      <h2 className="eh-h2" style={{ margin: "1.75rem 0 .75rem" }}>Dormancy board</h2>
      <div className="eh-card">
        {board.isLoading && <Spinner />}
        {board.data && board.data.rows.length === 0 && <Empty big="No members yet." />}
        <div className="eh-table-wrap">
          <table className="eh-table">
            <thead><tr><th>Member</th><th>Tier</th><th>Stage</th><th>Pause</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {(board.data?.rows ?? []).map((r) => {
                const stage = (r.member.dormancyStage ?? "active") as DormancyStage;
                return (
                  <tr key={r.member.id}>
                    <td>{r.user.name ?? r.user.email}</td>
                    <td>{TIER_LABEL[r.member.tier as Tier]}</td>
                    <td><Pill color={STAGE_COLOR[stage] ?? "grey"}>{DORMANCY_LABEL[stage]}</Pill></td>
                    <td className="eh-num">{r.member.exceptionPause > 0 ? `${r.member.exceptionPause}q` : "—"}</td>
                    <td className="eh-muted">{r.member.dormancyNote ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="eh-btn ghost sm" onClick={() => setOverrideFor({ id: r.member.id, name: r.user.name ?? "member" })}>Override</button>{" "}
                      <button className="eh-btn ghost sm" onClick={() => setPauseFor({ id: r.member.id, name: r.user.name ?? "member" })}>Pause</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {(board.data?.log.length ?? 0) > 0 && (
        <>
          <h2 className="eh-h2" style={{ margin: "1.75rem 0 .75rem" }}>Transition log</h2>
          <div className="eh-card">
            <div className="eh-list">
              {board.data!.log.map((l) => (
                <div className="row" key={l.id}>
                  <span className="d">{fmtDateTime(l.createdAt)}</span>
                  <span className="t eh-sm" style={{ flex: 1 }}>
                    Member #{l.memberId}: {DORMANCY_LABEL[l.fromStage as DormancyStage] ?? l.fromStage} → {DORMANCY_LABEL[l.toStage as DormancyStage] ?? l.toStage}
                    {l.reason ? ` — ${l.reason}` : ""}
                  </span>
                  <Pill color={l.actor === "system" ? "grey" : "purple"}>{l.actor}</Pill>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {editRule && (
        <Modal title={`Point rule — ${editRule.label}`} onClose={() => setEditRule(null)}>
          <Field label="Points (negative to deduct)">
            <input className="eh-input" type="number" min={-100} max={100} value={points}
                   onChange={(e) => setPoints(Number(e.target.value))} />
          </Field>
          <button className="eh-btn gold" style={{ width: "100%" }} disabled={setRule.isPending}
                  onClick={() => setRule.mutate({ key: editRule.key as never, points })}>
            {setRule.isPending ? "Saving…" : "Save rule →"}
          </button>
        </Modal>
      )}

      {editCfg && (
        <Modal title={`Engagement Standard — ${TIER_LABEL[editCfg as Tier]}`} onClose={() => setEditCfg(null)}>
          <CfgForm tier={editCfg as Tier} existing={cfgByTier.get(editCfg as Tier)} pending={setCfg.isPending}
                   onSubmit={(v) => setCfg.mutate({ tier: editCfg as Tier, ...v })} />
        </Modal>
      )}

      {overrideFor && (
        <Modal title={`Override stage — ${overrideFor.name}`} onClose={() => setOverrideFor(null)}>
          <OverrideForm pending={override.isPending}
                        onSubmit={(stage, note) => override.mutate({ memberId: overrideFor.id, stage, note })} />
        </Modal>
      )}

      {pauseFor && (
        <Modal title={`Exception pause — ${pauseFor.name}`} onClose={() => setPauseFor(null)}>
          <PauseForm pending={pause.isPending}
                     onSubmit={(quarters, note) => pause.mutate({ memberId: pauseFor.id, quarters, note })} />
        </Modal>
      )}
    </EhShell>
  );
}

function CfgForm(props: {
  tier: Tier;
  existing?: { sessionsRequired: number | null; sessionsOffered: number | null; oneToOnesPerQuarter: number | null; giveBackPerYear: number | null };
  pending: boolean;
  onSubmit: (v: { sessionsRequired: number | null; sessionsOffered: number | null; oneToOnesPerQuarter: number | null; giveBackPerYear: number | null }) => void;
}) {
  const [sr, setSr] = useState(props.existing?.sessionsRequired?.toString() ?? "");
  const [so, setSo] = useState(props.existing?.sessionsOffered?.toString() ?? "");
  const [ot, setOt] = useState(props.existing?.oneToOnesPerQuarter?.toString() ?? "");
  const [gb, setGb] = useState(props.existing?.giveBackPerYear?.toString() ?? "");
  const num = (s: string) => (s.trim() === "" ? null : Math.max(0, Number(s) || 0));
  return (
    <>
      <div className="eh-grid g2">
        <Field label="Sessions required / year"><input className="eh-input" type="number" min={0} value={sr} onChange={(e) => setSr(e.target.value)} placeholder="8" /></Field>
        <Field label="Sessions offered / year"><input className="eh-input" type="number" min={0} value={so} onChange={(e) => setSo(e.target.value)} placeholder="12" /></Field>
        <Field label="1-2-1s per quarter"><input className="eh-input" type="number" min={0} value={ot} onChange={(e) => setOt(e.target.value)} placeholder="6" /></Field>
        <Field label="Give-Back per year"><input className="eh-input" type="number" min={0} value={gb} onChange={(e) => setGb(e.target.value)} placeholder="2" /></Field>
      </div>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending}
              onClick={() => props.onSubmit({ sessionsRequired: num(sr), sessionsOffered: num(so), oneToOnesPerQuarter: num(ot), giveBackPerYear: num(gb) })}>
        {props.pending ? "Saving…" : "Save standard →"}
      </button>
    </>
  );
}

function OverrideForm(props: { pending: boolean; onSubmit: (stage: DormancyStage, note: string) => void }) {
  const [stage, setStage] = useState<DormancyStage>("active");
  const [note, setNote] = useState("");
  return (
    <>
      <Field label="Set stage">
        <select className="eh-select" value={stage} onChange={(e) => setStage(e.target.value as DormancyStage)}>
          {(Object.keys(DORMANCY_LABEL) as DormancyStage[]).map((s) => <option key={s} value={s}>{DORMANCY_LABEL[s]}</option>)}
        </select>
      </Field>
      <Field label="Reason (required — overrides are logged with your name)">
        <textarea className="eh-textarea" value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={500} />
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || note.trim().length < 3}
              onClick={() => props.onSubmit(stage, note.trim())}>
        {props.pending ? "Saving…" : "Override stage →"}
      </button>
    </>
  );
}

function PauseForm(props: { pending: boolean; onSubmit: (quarters: number, note?: string) => void }) {
  const [quarters, setQuarters] = useState(1);
  const [note, setNote] = useState("");
  return (
    <>
      <Field label="Pause evaluation for (quarters; 0 clears)">
        <input className="eh-input" type="number" min={0} max={4} value={quarters}
               onChange={(e) => setQuarters(Math.max(0, Math.min(4, Number(e.target.value) || 0)))} />
      </Field>
      <Field label="Note (e.g. parental leave, health)">
        <input className="eh-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending}
              onClick={() => props.onSubmit(quarters, note || undefined)}>
        {props.pending ? "Saving…" : "Save pause →"}
      </button>
    </>
  );
}
