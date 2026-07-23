import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Ring, Bar, Pill, Empty, Spinner } from "@/components/eh";
import { fmtDate, fmtDateTime } from "@/lib/ehf";
import { SCORE_FACTOR_LABEL } from "@contracts/constants";

const FACTOR_ORDER: (keyof typeof SCORE_FACTOR_LABEL)[] = ["attendance", "action_items", "events", "contribution", "frp", "tenure"];
const FACTOR_HINT: Record<string, string> = {
  attendance: "Pod and mastermind sessions attended",
  action_items: "Commitments completed on time",
  events: "Registrations and event attendance",
  contribution: "Intros, playbooks and hosting",
  frp: "Fundraising programme milestones",
  tenure: "Time in the circle",
};

export default function Score() {
  const q = trpc.circle.myScore.useQuery(undefined, { retry: false });

  if (q.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Spinner /></EhShell>;
  if (!q.data) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Empty big="Score unavailable." /></EhShell>;

  const { member, config, sums, history, recent } = q.data;
  const weightMap = new Map(config.map((c) => [c.factor, c.weight]));
  const sumMap = new Map(sums.map((s) => [s.factor, s.total]));
  const totalWeight = config.reduce((a, c) => a + c.weight, 0) || 100;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead eyebrow="Hive Score" title="How the circle sees your quarter"
                sub="The Hive Score is not a ranking — it's the mirror. Six factors, each capped, so one loud month can't fake a quiet year." />

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div className="eh-card" style={{ textAlign: "center" }}>
          <h3>Right now</h3>
          <div style={{ display: "grid", placeItems: "center", margin: ".8rem 0" }}>
            <Ring value={member.hiveScore} max={totalWeight} />
          </div>
          <p className="eh-sm eh-muted" style={{ margin: 0 }}>
            Scores recompute the moment anything happens — a session attended, a commitment closed, an event booked.
          </p>
        </div>

        <div className="eh-card" style={{ gridColumn: "span 2" }}>
          <h3>The six factors</h3>
          <div className="eh-list">
            {FACTOR_ORDER.map((f) => {
              const cap = weightMap.get(f) ?? 0;
              const raw = sumMap.get(f) ?? 0;
              const val = Math.min(raw, cap || raw);
              return (
                <div className="row" key={f} style={{ display: "block" }}>
                  <div className="eh-between" style={{ marginBottom: ".3rem" }}>
                    <div>
                      <span className="t">{SCORE_FACTOR_LABEL[f] ?? f}</span>
                      <span className="d" style={{ marginLeft: ".6rem" }}>{FACTOR_HINT[f]}</span>
                    </div>
                    <span className="eh-num eh-sm eh-strong">{val}<span className="eh-muted">/{cap || "∞"}</span></span>
                  </div>
                  <Bar pct={cap ? (val / cap) * 100 : 0} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="eh-grid g2 eh-mt" style={{ alignItems: "start" }}>
        <div className="eh-card">
          <h3>Score history</h3>
          {history.length === 0 ? <Empty big="No snapshots yet." /> : (
            <div className="eh-timeline">
              {history.map((h) => (
                <div className="ev" key={h.id}>
                  <div className="w">{fmtDateTime(h.computedAt)}</div>
                  <div className="x">Score {h.score}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="eh-card">
          <h3>What moved it recently</h3>
          {recent.length === 0 ? <Empty big="No activity yet." p="Attend a session or close a commitment to start the ledger." /> : (
            <div className="eh-list">
              {recent.map((r) => (
                <div className="row" key={r.id}>
                  <div>
                    <div className="t">{r.note ?? SCORE_FACTOR_LABEL[r.factor as keyof typeof SCORE_FACTOR_LABEL] ?? r.factor}</div>
                    <div className="d">{fmtDate(r.createdAt)}</div>
                  </div>
                  <Pill color={r.points >= 0 ? "green" : "red"}>{r.points >= 0 ? "+" : ""}{r.points}</Pill>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </EhShell>
  );
}
