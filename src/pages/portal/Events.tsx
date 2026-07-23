import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, TierPill, Spinner, toast } from "@/components/eh";
import { fmtDateTime, fmtDay } from "@/lib/ehf";

const KIND_COLOR: Record<string, "blue" | "purple" | "green" | "gold" | "grey"> = {
  spark: "blue", meetup: "grey", circle: "purple", retreat: "green", summit: "gold",
};

export default function Events() {
  const utils = trpc.useUtils();
  const q = trpc.circle.events.useQuery(undefined, { retry: false });
  const [filter, setFilter] = useState<string>("all");

  const reg = trpc.circle.registerEvent.useMutation({
    onSuccess: (r) => { toast(`You're in — Hive Score now ${r.score}`); utils.circle.events.invalidate(); utils.circle.dashboard.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const cancel = trpc.circle.cancelEventReg.useMutation({
    onSuccess: () => { toast("Registration cancelled."); utils.circle.events.invalidate(); utils.circle.dashboard.invalidate(); },
    onError: (e) => toast(e.message),
  });

  const list = (q.data ?? []).filter((e) => filter === "all" || e.kind === filter);

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead eyebrow="Events" title="The calendar"
                sub="Spark Evenings are working sessions. Circle Dinners are off the record. Retreats are for going deep." />

      <div className="eh-tabs">
        {["all", "spark", "circle", "meetup", "retreat", "summit"].map((k) => (
          <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1) + "s"}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && list.length === 0 && (
        <div className="eh-card"><Empty big="Nothing in this bucket right now." p="New events publish monthly — the next batch lands on the 1st." /></div>
      )}

      <div className="eh-grid g3">
        {list.map((e) => {
          const full = e.seatsLeft <= 0;
          return (
            <div className="eh-card" key={e.id} style={{ display: "flex", flexDirection: "column" }}>
              <div className="eh-between">
                <Pill color={KIND_COLOR[e.kind] ?? "grey"}>{e.kind}</Pill>
                <TierPill tier={e.tierGate} />
              </div>
              <h3 className="eh-mt">{e.title}</h3>
              <p className="eh-sm eh-muted" style={{ flex: 1 }}>{e.description}</p>
              <hr className="eh-divider" />
              <div className="eh-list">
                <div className="row"><span className="d">When</span><span className="t eh-sm">{fmtDay(e.startsAt)}, {fmtDateTime(e.startsAt).split("·")[1]}</span></div>
                <div className="row"><span className="d">Where</span><span className="t eh-sm">{e.location ?? "TBA"}</span></div>
                <div className="row"><span className="d">Seats left</span><span className="t eh-sm eh-num">{Math.max(0, e.seatsLeft)}</span></div>
              </div>
              <div className="eh-mt">
                {!e.allowed ? (
                  <div className="eh-locked"><Pill>{e.tierGate}+</Pill><span className="eh-sm">Opens at {e.tierGate} tier — see Membership to upgrade.</span></div>
                ) : e.registered ? (
                  <div className="eh-between">
                    <Pill color="green">You're registered ✓</Pill>
                    <button className="eh-btn ghost sm" disabled={cancel.isPending}
                            onClick={() => cancel.mutate({ eventId: e.id })}>Cancel</button>
                  </div>
                ) : (
                  <button className="eh-btn gold" style={{ width: "100%" }} disabled={full || reg.isPending}
                          onClick={() => reg.mutate({ eventId: e.id })}>
                    {full ? "Fully booked" : "Reserve my seat →"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </EhShell>
  );
}
