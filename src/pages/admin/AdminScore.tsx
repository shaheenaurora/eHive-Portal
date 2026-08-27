import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  LoadError,
  TierPill,
  toast,
} from "@/components/eh";
import { SCORE_FACTORS, SCORE_FACTOR_LABEL } from "@contracts/constants";

export default function AdminScore() {
  const utils = trpc.useUtils();
  const q = trpc.admin.scoreConfig.useQuery(undefined, { retry: false });

  /* Weights are seeded from the server config and become locally editable once
     the admin touches an input — derived here rather than synced via effect. */
  const serverWeights = useMemo(() => {
    const w: Record<string, number> = {};
    for (const c of q.data?.config ?? []) w[c.factor] = c.weight;
    return w;
  }, [q.data]);
  const [edited, setEdited] = useState<Record<string, number> | null>(null);
  const weights = edited ?? serverWeights;
  const setWeights = setEdited;

  const save = trpc.admin.setScoreWeights.useMutation({
    onSuccess: () => {
      toast("Weights saved — recompute to apply to everyone.");
      utils.admin.scoreConfig.invalidate();
    },
    onError: e => toast(e.message),
  });
  const recompute = trpc.admin.recomputeAll.useMutation({
    onSuccess: r => {
      toast(`Recomputed ${r.recomputed} members.`);
      utils.admin.scoreConfig.invalidate();
      utils.admin.members.invalidate();
    },
    onError: e => toast(e.message),
  });

  const total = Object.values(weights).reduce(
    (a, b) => a + (Number(b) || 0),
    0
  );

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Hive Score engine"
        title="Weights and recalculation"
        sub="Each weight is that factor's maximum points — they should sum to 100. Raw ledger entries beyond the cap don't count."
      />

      <div className="eh-grid g2" style={{ alignItems: "start" }}>
        <div className="eh-card">
          <h3>Factor weights</h3>
          {q.isError && <LoadError onRetry={() => q.refetch()} />}
          {q.isLoading && <Spinner />}
          {q.data && (
            <>
              <div className="eh-list">
                {SCORE_FACTORS.map(f => (
                  <div className="row" key={f}>
                    <span className="t">{SCORE_FACTOR_LABEL[f]}</span>
                    <input
                      className="eh-input eh-num"
                      type="number"
                      min={0}
                      max={100}
                      style={{ maxWidth: 90, textAlign: "right" }}
                      value={weights[f] ?? 0}
                      onChange={e =>
                        setWeights({ ...weights, [f]: Number(e.target.value) })
                      }
                    />
                  </div>
                ))}
              </div>
              <hr className="eh-divider" />
              <div className="eh-between">
                <Pill color={total === 100 ? "green" : "red"}>
                  Total: {total}/100
                </Pill>
                <div className="eh-row">
                  <button
                    className="eh-btn"
                    disabled={save.isPending || total !== 100}
                    onClick={() =>
                      save.mutate(
                        SCORE_FACTORS.map(f => ({
                          factor: f,
                          weight: weights[f] ?? 0,
                        }))
                      )
                    }
                  >
                    Save weights
                  </button>
                  <button
                    className="eh-btn gold"
                    disabled={recompute.isPending}
                    onClick={() => recompute.mutate()}
                  >
                    Recompute all members →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="eh-card">
          <h3>Top of the hive</h3>
          {q.data?.top.length === 0 && <Empty big="No members yet." />}
          <div className="eh-list">
            {q.data?.top.map(({ member, userName }, i) => (
              <div className="row" key={member.id}>
                <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                  <span className="eh-num eh-muted" style={{ width: 20 }}>
                    {i + 1}
                  </span>
                  <div>
                    <div className="t">{userName ?? "—"}</div>
                    <div className="d">{member.company ?? ""}</div>
                  </div>
                </div>
                <div className="eh-row">
                  <TierPill tier={member.tier} />
                  <b className="eh-num">{member.hiveScore}</b>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </EhShell>
  );
}
