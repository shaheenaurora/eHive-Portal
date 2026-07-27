import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { EhShell, MEMBER_NAV, PageHead, Stat, Ring, Pill, Empty, TierPill, Spinner, toast, LoadError } from "@/components/eh";
import { fmtDateTime, fmtDay, relDay } from "@/lib/ehf";
import { ONBOARDING_STAGES } from "@contracts/constants";

/** Where to go to complete an auto-tracked onboarding milestone. */
const OB_LINK: Record<string, { to: string; cta: string }> = {
  profile_complete: { to: "/portal/membership", cta: "Add details" },
  first_meeting: { to: "/portal/events", cta: "See events" },
  buddy_assigned: { to: "/portal/connect", cta: "Connect" },
  pod_placed: { to: "/portal/pods", cta: "Browse pods" },
  pod_meeting: { to: "/portal/pods", cta: "Your pod" },
};

export default function Dashboard() {
  const d = trpc.circle.dashboard.useQuery(undefined, { retry: false });
  const ob = trpc.circle.myOnboarding.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const completeStep = trpc.circle.completeOnboardingStep.useMutation({
    onSuccess: (r) => {
      toast(r.complete ? "Onboarding complete — welcome to full membership! 🎉" : "Nice — step done.");
      utils.circle.myOnboarding.invalidate();
      utils.circle.dashboard.invalidate();
    },
    onError: (e) => toast(e.message),
  });

  useEffect(() => {
    if (params.get("paid") === "1") {
      toast("Payment received — welcome to eHive Circle! 🎉");
      params.delete("paid");
      setParams(params, { replace: true });
      void d.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (d.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif><Spinner /></EhShell>;
  if (!d.data) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif><LoadError what="your dashboard" onRetry={() => d.refetch()} /></EhShell>;

  const { member, nextSession, openActionItems, upcomingEvents, podCount } = d.data;
  const first = (user?.name ?? "there").split(" ")[0];
  const showOnboarding = ob.data && !ob.data.complete && ob.data.lifecycleState === "onboarding";

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Dashboard"
        title={`Good to see you, ${first}.`}
        sub={`${member.company ?? "Your company"} · member since ${relDay(member.joinedAt).toLowerCase()}`}
        actions={<TierPill tier={member.tier} />}
      />

      {showOnboarding && (
        <div className="eh-banner eh-mb">
          <div className="eh-between" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eh-eyebrow" style={{ color: "var(--eh-gold-2)" }}>Your first 90 days · Day {ob.data!.dayCount}</div>
              <h2 style={{ margin: ".2rem 0 .1rem" }}>Onboarding · {ob.data!.doneCount} of {ob.data!.total}</h2>
              <p className="eh-sm" style={{ marginBottom: 0 }}>Members who complete this are far more likely to thrive. POD placement is due by day 60.</p>
            </div>
            <Ring value={ob.data!.percent} />
          </div>
          <div style={{ marginTop: ".7rem", display: "grid", gap: ".9rem" }}>
            {ONBOARDING_STAGES.map((st) => {
              const items = ob.data!.milestones.filter((m) => m.stage === st.stage);
              return (
                <div key={st.stage}>
                  <div className="eh-eyebrow" style={{ marginBottom: ".3rem" }}>{st.label} · {st.window}</div>
                  <div className="eh-list">
                    {items.map((m) => (
                      <div className="row" key={m.key}>
                        <span style={{ fontSize: "1.05rem", width: "1.5rem" }}>{m.done ? "✅" : "⬜"}</span>
                        <span className="t" style={{ flex: 1, textDecoration: m.done ? "line-through" : "none", opacity: m.done ? 0.6 : 1 }}>{m.label}</span>
                        {!m.done && !m.auto && (
                          <button className="eh-btn ghost sm" disabled={completeStep.isPending}
                                  onClick={() => completeStep.mutate({ milestone: m.key })}>Mark done</button>
                        )}
                        {!m.done && m.auto && OB_LINK[m.key] && (
                          <Link className="eh-btn ghost sm" to={OB_LINK[m.key].to}>{OB_LINK[m.key].cta} →</Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="eh-grid g4">
        <Stat k="Hive Score" v={member.hiveScore} gold n="See the breakdown →" />
        <Stat k="My pods" v={podCount} n="Peer circles you sit in" />
        <Stat k="Open commitments" v={openActionItems} n="Action items owed to your pods" />
        <Stat k="Events booked" v={upcomingEvents.length} n="Your upcoming registrations" />
      </div>

      <div className="eh-grid g3 eh-mt" style={{ alignItems: "start" }}>
        <div className="eh-span2" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {nextSession ? (
            <div className="eh-banner">
              <div className="eh-eyebrow" style={{ color: "var(--eh-gold-2)" }}>Next session</div>
              <h2>{nextSession.session.topic ?? "Pod session"}</h2>
              <p>
                {nextSession.pod.name} · {fmtDay(nextSession.session.startsAt)} · {fmtDateTime(nextSession.session.startsAt).split("·")[1]}
              </p>
              <div className="eh-row eh-mt">
                {nextSession.session.videoLink && (
                  <a className="eh-btn gold sm" href={nextSession.session.videoLink} target="_blank" rel="noreferrer">
                    Join video room →
                  </a>
                )}
                <Link className="eh-btn ghost sm" style={{ color: "#f5efe2", borderColor: "rgba(255,255,255,.3)" }}
                      to={`/portal/pods/${nextSession.pod.id}`}>
                  Open pod
                </Link>
              </div>
            </div>
          ) : (
            <div className="eh-banner">
              <div className="eh-eyebrow" style={{ color: "var(--eh-gold-2)" }}>Next session</div>
              <h2>No session scheduled yet.</h2>
              <p>Your facilitator schedules pod sessions — check back soon, or browse the events calendar meanwhile.</p>
            </div>
          )}

          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Your upcoming events</h3>
              <Link className="eh-btn ghost sm" to="/portal/events">All events →</Link>
            </div>
            {upcomingEvents.length === 0 ? (
              <Empty big="Nothing booked yet." p="Spark Evenings, Circle Dinners and retreats — the calendar fills fast.">
                <Link className="eh-btn gold sm" to="/portal/events">Browse events</Link>
              </Empty>
            ) : (
              <div className="eh-list">
                {upcomingEvents.map(({ event, reg }) => (
                  <div className="row" key={reg.id}>
                    <div>
                      <div className="t">{event.title}</div>
                      <div className="d">{fmtDay(event.startsAt)} · {event.location ?? "TBA"}</div>
                    </div>
                    <Pill color={reg.status === "attended" ? "green" : "blue"}>{reg.status}</Pill>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="eh-card" style={{ textAlign: "center" }}>
          <h3>Your Hive Score</h3>
          <div style={{ display: "grid", placeItems: "center", margin: ".6rem 0" }}>
            <Ring value={member.hiveScore} />
          </div>
          <p className="eh-sm eh-muted" style={{ margin: "0 0 .8rem" }}>
            Attendance, commitments, events, contribution, FRP progress and tenure — the six factors that keep the circle strong.
          </p>
          <Link className="eh-btn ghost sm" to="/portal/score">Score breakdown →</Link>
        </div>
      </div>
    </EhShell>
  );
}
