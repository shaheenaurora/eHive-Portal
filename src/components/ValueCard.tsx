import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Bar, Pill, Spinner } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

/** Count a number up from 0 to `to` over `ms`, easing out. Respects
 *  prefers-reduced-motion (jumps straight to the value). */
function useCountUp(to: number, ms = 900): number {
  const [n, setN] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || to <= 0) {
      // Jump to the final value on the next frame (a callback, not a
      // synchronous setState in the effect body).
      raf.current = requestAnimationFrame(() => setN(to));
      return () => {
        if (raf.current) cancelAnimationFrame(raf.current);
      };
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setN(Math.round(to * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [to, ms]);
  return n;
}

const KIND_META: Record<string, { label: string; color: string }> = {
  offer: { label: "Offer", color: "gold" },
  advisory: { label: "Advisory", color: "purple" },
  event: { label: "Event", color: "green" },
  activation: { label: "Activation", color: "gold" },
  other: { label: "Benefit", color: "grey" },
};

function aed(n: number): string {
  return "AED " + n.toLocaleString("en-US");
}

/** B5 — "used & saved this year". A polished, animated view of the real value a
 *  member has drawn from membership, measured against what they invested. */
export function ValueCard() {
  const q = trpc.circle.valueSummary.useQuery(undefined, { retry: false });
  const total = q.data?.totalSavedAed ?? 0;
  const paid = q.data?.membershipPaidAed ?? 0;
  const shown = useCountUp(total);
  const pct = paid > 0 ? Math.min(100, Math.round((total / paid) * 100)) : 0;
  const brokeEven = q.data?.brokeEven ?? false;

  if (q.isLoading)
    return (
      <div className="eh-card">
        <Spinner />
      </div>
    );
  if (q.isError || !q.data) return null;

  return (
    <div className="eh-card">
      <div className="eh-between" style={{ alignItems: "baseline" }}>
        <div className="eh-eyebrow" style={{ color: "var(--eh-gold-2)" }}>
          Your year of value · {q.data.year}
        </div>
        {brokeEven && <Pill color="green">Paid for itself ✓</Pill>}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: ".5rem",
          margin: ".4rem 0 .2rem",
        }}
      >
        <span
          className="eh-serif eh-num"
          style={{
            fontSize: "2.4rem",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {aed(shown)}
        </span>
      </div>
      <p className="eh-sm eh-muted" style={{ margin: "0 0 1rem" }}>
        used &amp; saved this year through membership
      </p>

      {paid > 0 && (
        <div style={{ marginBottom: brokeEven ? ".75rem" : "1rem" }}>
          <Bar
            pct={pct}
            green={brokeEven}
            label={
              brokeEven
                ? `You've saved more than the ${aed(paid)} you invested`
                : `${aed(total)} of the ${aed(paid)} you invested`
            }
          />
        </div>
      )}

      {q.data.count === 0 ? (
        <p className="eh-sm eh-muted" style={{ margin: 0 }}>
          We track the value you draw from membership — as you use benefits,
          advisory sessions and events, they&apos;ll appear here with what they
          saved you.
        </p>
      ) : (
        <div className="eh-list">
          {q.data.breakdown.map(r => {
            const meta = KIND_META[r.kind] ?? KIND_META.other;
            return (
              <div className="row" key={r.id}>
                <span
                  className="d"
                  style={{
                    display: "flex",
                    gap: ".5rem",
                    alignItems: "center",
                  }}
                >
                  <Pill color={meta.color as never}>{meta.label}</Pill>
                  <span>{r.label}</span>
                </span>
                <span
                  className="t eh-sm eh-num"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {r.valueSavedAed > 0 ? aed(r.valueSavedAed) : "—"}
                  <span
                    className="eh-muted"
                    style={{ marginLeft: ".5rem", fontWeight: 400 }}
                  >
                    {fmtDate(r.occurredAt)}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
