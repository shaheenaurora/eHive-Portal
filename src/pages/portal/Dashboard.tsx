import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { EhShell, MEMBER_NAV, PageHead, Stat, Ring, Pill, Empty, TierPill, Spinner } from "@/components/eh";
import { fmtDateTime, fmtDay, relDay } from "@/lib/ehf";

export default function Dashboard() {
  const d = trpc.circle.dashboard.useQuery(undefined, { retry: false });
  const { user } = useAuth();

  if (d.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Spinner /></EhShell>;
  if (!d.data) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Empty big="Could not load your dashboard." /></EhShell>;

  const { member, nextSession, openActionItems, upcomingEvents, podCount } = d.data;
  const first = (user?.name ?? "there").split(" ")[0];

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead
        eyebrow="Dashboard"
        title={`Good to see you, ${first}.`}
        sub={`${member.company ?? "Your company"} · member since ${relDay(member.joinedAt).toLowerCase()}`}
        actions={<TierPill tier={member.tier} />}
      />

      <div className="eh-grid g4">
        <Stat k="Hive Score" v={member.hiveScore} gold n="See the breakdown →" />
        <Stat k="My pods" v={podCount} n="Peer circles you sit in" />
        <Stat k="Open commitments" v={openActionItems} n="Action items owed to your pods" />
        <Stat k="Events booked" v={upcomingEvents.length} n="Your upcoming registrations" />
      </div>

      <div className="eh-grid g3 eh-mt" style={{ alignItems: "start" }}>
        <div style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: "1rem" }}>
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
