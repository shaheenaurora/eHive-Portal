import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Stat,
  StatusPill,
  Pill,
  Empty,
  Spinner,
  Bar,
  adminHasScope,
} from "@/components/eh";
import { useAuth } from "@/hooks/useAuth";
import { fmtDate } from "@/lib/ehf";
import { TIER_LABEL } from "@contracts/constants";

const BANDS = ["80+", "60-79", "40-59", "20-39", "0-19"];

export default function AdminDashboard() {
  const q = trpc.admin.stats.useQuery(undefined, { retry: false });
  const { user } = useAuth();
  const canApplications = adminHasScope(user?.adminScopes, "membership");
  const canLeads = adminHasScope(user?.adminScopes, "finance");

  if (q.isLoading)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Spinner />
      </EhShell>
    );
  if (!q.data)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Empty big="Stats unavailable." />
      </EhShell>
    );

  const s = q.data;
  const tierMap = new Map(s.byTier.map(t => [t.tier, t.n]));
  const distMap = new Map(s.scoreDist.map(d => [d.band, d.n]));
  const maxBand = Math.max(1, ...BANDS.map(b => distMap.get(b) ?? 0));

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Admin dashboard"
        title="The circle at a glance"
        sub="Membership, applications, events and website leads — live from the same database the portal runs on."
      />

      <div className="eh-grid g4">
        <Stat
          k="Active members"
          v={s.activeMembers}
          n="Across all four tiers"
        />
        <Stat
          k="Pending applications"
          v={s.pendingApplications}
          gold
          n="Received → interview stages"
        />
        <Stat k="Average Hive Score" v={s.avgScore} n="Active members" />
        <Stat
          k="Upcoming events"
          v={s.upcomingEvents}
          n={`${s.totalLeads} website leads captured`}
        />
      </div>

      <div className="eh-grid g3 eh-mt" style={{ alignItems: "start" }}>
        <div className="eh-card">
          <h3>Members by tier</h3>
          <div className="eh-list">
            {(["zenith", "vanguard", "ascent", "horizon"] as const).map(t => (
              <div className="row" key={t} style={{ display: "block" }}>
                <div className="eh-between" style={{ marginBottom: ".3rem" }}>
                  <span className="t">{TIER_LABEL[t]}</span>
                  <span className="eh-num eh-sm eh-strong">
                    {tierMap.get(t) ?? 0}
                  </span>
                </div>
                <Bar
                  pct={
                    ((tierMap.get(t) ?? 0) / Math.max(1, s.activeMembers)) * 100
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <div className="eh-card">
          <h3>Hive Score distribution</h3>
          <div className="eh-list">
            {BANDS.map(b => (
              <div className="row" key={b} style={{ display: "block" }}>
                <div className="eh-between" style={{ marginBottom: ".3rem" }}>
                  <span className="t eh-num">{b}</span>
                  <span className="eh-num eh-sm eh-strong">
                    {distMap.get(b) ?? 0}
                  </span>
                </div>
                <Bar
                  pct={((distMap.get(b) ?? 0) / maxBand) * 100}
                  green={b === "80+"}
                />
              </div>
            ))}
          </div>
        </div>

        {canApplications && (
          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Latest applications</h3>
              <Link className="eh-btn ghost sm" to="/admin/applications">
                All →
              </Link>
            </div>
            {s.recentApps.length === 0 && <Empty big="No applications yet." />}
            <div className="eh-list">
              {s.recentApps.map(a => (
                <div className="row" key={a.id}>
                  <div>
                    <div className="t">{a.name}</div>
                    <div className="d">
                      {a.company ?? "—"} · {fmtDate(a.createdAt)}
                    </div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {canLeads && (
        <div className="eh-card eh-mt">
          <div className="eh-between">
            <h3 style={{ margin: 0 }}>Latest website leads</h3>
            <Link className="eh-btn ghost sm" to="/admin/leads">
              All leads →
            </Link>
          </div>
          {s.recentLeads.length === 0 && (
            <Empty
              big="No leads yet."
              p="The marketing site forms post here via /api/lead."
            />
          )}
          <div className="eh-list">
            {s.recentLeads.map(l => (
              <div className="row" key={l.id}>
                <div>
                  <div className="t">{l.email ?? "(no email)"}</div>
                  <div className="d">
                    {l.sourcePage ?? "—"} · {fmtDate(l.createdAt)}
                  </div>
                </div>
                <Pill>{l.form}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </EhShell>
  );
}
