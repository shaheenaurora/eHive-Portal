import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, TierPill, Spinner, LoadError } from "@/components/eh";
import { fmtDay, fmtDateTime } from "@/lib/ehf";

export default function Pods() {
  const q = trpc.circle.myPods.useQuery(undefined, { retry: false });

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead eyebrow="Pods & masterminds" title="Your circles"
                sub="Small rooms, real numbers, one commitment per week. Chatham House Rule applies everywhere." />
      {q.isLoading && <Spinner />}
      {q.isError && <LoadError what="your pods" onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty big="You're not in a pod yet."
                 p="Pod placement happens in your first month — the team matches you by stage, sector and time zone. Ask about it at your next event." />
        </div>
      )}
      <div className="eh-grid g3">
        {q.data?.map(({ pod, role, memberCount, nextSession }) => (
          <Link key={pod.id} to={`/portal/pods/${pod.id}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className="eh-card" style={{ height: "100%", transition: "border-color .15s" }}
                 onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--eh-gold)")}
                 onMouseLeave={(e) => (e.currentTarget.style.borderColor = "")}>
              <div className="eh-between">
                <Pill color={pod.kind === "mastermind" ? "purple" : "blue"}>{pod.kind}</Pill>
                <TierPill tier={pod.tierGate} />
              </div>
              <h3 className="eh-mt">{pod.name}</h3>
              <p className="eh-sm eh-muted" style={{ minHeight: "2.6em" }}>{pod.description}</p>
              <hr className="eh-divider" />
              <div className="eh-list">
                <div className="row"><span className="d">Facilitator</span><span className="t eh-sm">{pod.facilitator ?? "—"}</span></div>
                <div className="row"><span className="d">Cadence</span><span className="t eh-sm">{pod.cadence ?? "—"}</span></div>
                <div className="row"><span className="d">Seats</span><span className="t eh-sm eh-num">{memberCount}/{pod.capacity}</span></div>
                <div className="row"><span className="d">Next session</span>
                  <span className="t eh-sm">{nextSession ? `${fmtDay(nextSession.startsAt)} ${fmtDateTime(nextSession.startsAt).split("·")[1]}` : "To be scheduled"}</span></div>
              </div>
              {role !== "member" && <div className="eh-mt"><Pill>Your role: {role}</Pill></div>}
            </div>
          </Link>
        ))}
      </div>
    </EhShell>
  );
}
