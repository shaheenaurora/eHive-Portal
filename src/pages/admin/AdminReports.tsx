import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, toast, adminHasScope } from "@/components/eh";
import { useAuth } from "@/hooks/useAuth";
import { downloadCsv } from "@/lib/csv";
import { TIER_LABEL } from "@contracts/constants";

const RAG_COLOR: Record<string, string> = {
  green: "var(--eh-good, #2e7d5b)", amber: "#b8862e", red: "var(--eh-red, #b23a2e)", none: "var(--eh-line, #d8d2c4)",
};
const aedWhole = (n: number) => "AED " + Math.round(n).toLocaleString("en-AE");
type Tab = "exec" | "chapters" | "atrisk" | "pipeline";

function Dot({ status }: { status: string }) {
  return <span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: RAG_COLOR[status] ?? RAG_COLOR.none, flex: "none" }} />;
}

export default function AdminReports() {
  const { user } = useAuth();
  const scopes = user?.adminScopes;
  // Role-scoped drill-down: each head sees the scorecard their capability owns;
  // full admins see the whole board (the Executive tab is full-admin only).
  const TABS: { key: Tab; label: string; can: boolean }[] = [
    { key: "exec", label: "Executive KPIs", can: adminHasScope(scopes, "full") },
    { key: "chapters", label: "Chapter scorecards", can: adminHasScope(scopes, "chapters") },
    { key: "atrisk", label: "At-risk list", can: adminHasScope(scopes, "member_success") },
    { key: "pipeline", label: "Pipeline", can: adminHasScope(scopes, "membership") },
  ];
  const visible = TABS.filter((t) => t.can);
  const [tab, setTab] = useState<Tab>(visible[0]?.key ?? "exec");
  const active = visible.some((t) => t.key === tab) ? tab : (visible[0]?.key ?? "exec");

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Reporting · KPI framework v1.0" title="Reports & KPIs"
        sub="Every scorecard opens with its numbers against target and a red / amber / green. Reports are generated from live data and downloadable — no leader builds a deck the system should assemble." />
      {visible.length === 0 && <div className="eh-card"><Empty big="No reports for your role." p="Your capabilities don't include a scorecard here yet." /></div>}
      {visible.length > 0 && (
        <>
          <div className="eh-tabs eh-mb">
            {visible.map((t) => (
              <button key={t.key} className={active === t.key ? "on" : ""} onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          {active === "exec" && <ExecTab />}
          {active === "chapters" && <ChaptersTab />}
          {active === "atrisk" && <AtRiskTab />}
          {active === "pipeline" && <PipelineTab />}
        </>
      )}
    </EhShell>
  );
}

function Toolbar({ onCsv }: { onCsv: () => void }) {
  return (
    <div className="eh-row" style={{ gap: ".4rem", justifyContent: "flex-end", marginBottom: ".7rem" }}>
      <button className="eh-btn ghost sm" onClick={() => window.print()}>Print / PDF</button>
      <button className="eh-btn gold sm" onClick={onCsv}>Download CSV</button>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 78, h = 22, min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const step = w / (points.length - 1);
  const d = points.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: "block" }}>
      <polyline points={d} fill="none" stroke={up ? "var(--eh-good, #2e7d5b)" : "var(--eh-red, #b23a2e)"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ExecTab() {
  const utils = trpc.useUtils();
  const q = trpc.admin.reportsNetworkKpis.useQuery(undefined, { retry: false });
  const trends = trpc.admin.kpiTrends.useQuery(undefined, { retry: false });
  const capture = trpc.admin.captureKpiSnapshots.useMutation({
    onSuccess: (r) => { toast(`Snapshot captured — ${r.captured} metrics.`); utils.admin.kpiTrends.invalidate(); },
    onError: (e) => toast(e.message),
  });

  if (q.isLoading) return <Spinner />;
  if (!q.data) return <div className="eh-card"><Empty big="Couldn't load KPIs." /></div>;
  const kpis = q.data.kpis;
  const tr = trends.data ?? {};
  const fams: [string, "community" | "commercial"][] = [["Community health — is the product working?", "community"], ["Commercial — is the business working?", "commercial"]];

  const csv = () => downloadCsv("executive-kpis",
    [["family", "Family"], ["label", "KPI"], ["display", "Value"], ["target", "Target"], ["status", "RAG"]],
    kpis.map((k) => ({ ...k })));

  return (
    <div>
      <div className="eh-row" style={{ gap: ".4rem", justifyContent: "flex-end", marginBottom: ".7rem" }}>
        <button className="eh-btn ghost sm" disabled={capture.isPending} onClick={() => capture.mutate()}>{capture.isPending ? "Capturing…" : "Capture snapshot"}</button>
        <button className="eh-btn ghost sm" onClick={() => window.print()}>Print / PDF</button>
        <button className="eh-btn gold sm" onClick={csv}>Download CSV</button>
      </div>
      <div className="eh-grid g2" style={{ alignItems: "start" }}>
        {fams.map(([title, fam]) => (
          <div className="eh-card" key={fam}>
            <div className="eh-eyebrow" style={{ marginBottom: ".6rem" }}>{title}</div>
            <div className="eh-list">
              {kpis.filter((k) => k.family === fam).map((k) => {
                const pts = (tr[k.key] ?? []).map((p) => p.value);
                const delta = pts.length >= 2 ? pts[pts.length - 1] - pts[0] : null;
                return (
                  <div className="row" key={k.key} style={{ alignItems: "center" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="t">{k.label}</div>
                      <div className="d">Target {k.target}{delta != null && delta !== 0 ? ` · ${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toLocaleString()} over ${pts.length}d` : ""}</div>
                    </div>
                    <span className="eh-row" style={{ gap: ".6rem", alignItems: "center", flex: "none" }}>
                      {pts.length >= 2 && <Sparkline points={pts} />}
                      <b className="eh-num" style={{ fontSize: "1.05rem" }}>{k.display}</b>
                      <Dot status={k.status} />
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <p className="eh-muted eh-sm" style={{ marginTop: ".8rem" }}>
        Generated {new Date(q.data.generatedAt).toLocaleString("en-GB")}. Trends build as daily snapshots accrue (the daily automation captures one; "Capture snapshot" forces one now). Retention is an approximation until cohort tracking lands.
      </p>
    </div>
  );
}

function ChaptersTab() {
  const q = trpc.admin.reportsChapterScorecards.useQuery(undefined, { retry: false });
  const rows = q.data ?? [];
  const csv = () => downloadCsv("chapter-scorecards",
    [["chapterName", "Chapter"], ["members", "Members"], ["chi", "CHI"], ["activeRate", "Active %"], ["atRisk", "At-risk"], ["arrAed", "ARR (AED)"]],
    rows.map((r) => ({ ...r, arrAed: Math.round(r.arrAed) })));

  return (
    <div>
      <Toolbar onCsv={csv} />
      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && <div className="eh-card"><Empty big="No chapters yet." /></div>}
      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead><tr><th>Chapter</th><th>Members</th><th>CHI</th><th>Active %</th><th>At-risk</th><th>ARR</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.chapterId}>
                  <td><b>{r.chapterName}</b></td>
                  <td data-label="Members" className="eh-num">{r.members}</td>
                  <td data-label="CHI"><span className="eh-row" style={{ gap: ".4rem", alignItems: "center" }}><Dot status={r.chiStatus} /><span className="eh-num">{r.chi ?? "—"}</span></span></td>
                  <td data-label="Active %" className="eh-num">{r.activeRate}%</td>
                  <td data-label="At-risk">{r.atRisk > 0 ? <Pill color="red">{r.atRisk}</Pill> : <span className="eh-num">0</span>}</td>
                  <td data-label="ARR" className="eh-num">{aedWhole(r.arrAed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="eh-muted eh-sm" style={{ marginTop: ".8rem" }}>CHI target ≥ 65 (green). ARR is contract dues for the active base.</p>
    </div>
  );
}

function AtRiskTab() {
  const q = trpc.admin.reportsAtRisk.useQuery(undefined, { retry: false });
  const rows = q.data ?? [];
  const csv = () => downloadCsv("member-at-risk",
    [["name", "Member"], ["email", "Email"], ["chapterName", "Chapter"], ["tier", "Tier"], ["hiveScore", "Hive Score"]],
    rows.map((r) => ({ ...r })));

  return (
    <div>
      <Toolbar onCsv={csv} />
      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && <div className="eh-card"><Empty big="No members at-risk — nice." p="Members whose engagement drops surface here for a personal reach-out (ML-04)." /></div>}
      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead><tr><th>Member</th><th>Chapter</th><th>Tier</th><th>Hive Score</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.memberId}>
                  <td><b>{r.name ?? "—"}</b><div className="eh-sm eh-muted">{r.email}</div></td>
                  <td data-label="Chapter" className="eh-sm">{r.chapterName ?? "—"}</td>
                  <td data-label="Tier" className="eh-sm">{TIER_LABEL[r.tier as keyof typeof TIER_LABEL] ?? r.tier}</td>
                  <td data-label="Hive Score"><Pill color="red">{r.hiveScore}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PipelineTab() {
  const q = trpc.admin.reportsPipeline.useQuery(undefined, { retry: false });
  const d = q.data;
  const csv = () => {
    if (!d) return;
    const rows = [
      ...Object.entries(d.prospectStages).map(([k, v]) => ({ funnel: "Prospect", stage: k, count: v })),
      ...Object.entries(d.appStatuses).map(([k, v]) => ({ funnel: "Application", stage: k, count: v })),
    ];
    downloadCsv("pipeline", [["funnel", "Funnel"], ["stage", "Stage"], ["count", "Count"]], rows);
  };

  return (
    <div>
      <Toolbar onCsv={csv} />
      {q.isLoading && <Spinner />}
      {d && (
        <div className="eh-grid g3">
          <div className="eh-card">
            <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>Prospects · {d.totalProspects}</div>
            <div className="eh-list">
              {Object.entries(d.prospectStages).map(([k, v]) => (
                <div className="row" key={k}><span className="t">{k}</span><span className="eh-num eh-strong">{v}</span></div>
              ))}
              {d.totalProspects === 0 && <p className="eh-sm eh-muted">No prospects tracked.</p>}
            </div>
          </div>
          <div className="eh-card">
            <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>Applications · {d.totalApps}</div>
            <div className="eh-list">
              {Object.entries(d.appStatuses).map(([k, v]) => (
                <div className="row" key={k}><span className="t">{k}</span><span className="eh-num eh-strong">{v}</span></div>
              ))}
              {d.totalApps === 0 && <p className="eh-sm eh-muted">No applications yet.</p>}
            </div>
          </div>
          <div className="eh-card">
            <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>Conversion</div>
            <div className="eh-num" style={{ fontSize: "2.2rem", fontWeight: 800, color: "var(--eh-gold)" }}>{d.conversionPct}%</div>
            <p className="eh-muted eh-sm" style={{ marginTop: ".3rem" }}>Approved ÷ all applications.</p>
          </div>
        </div>
      )}
    </div>
  );
}
