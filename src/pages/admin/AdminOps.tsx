import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, toast, confirmDialog } from "@/components/eh";
import { KpiAlertsBanner } from "@/components/KpiAlerts";
import { fmtDate, fmtDateTime } from "@/lib/ehf";

export default function AdminOps() {
  const utils = trpc.useUtils();
  const ov = trpc.admin.opsOverview.useQuery(undefined, { retry: false });
  const follow = trpc.adminEngage.followUps.useQuery({ status: "open" }, { retry: false });
  const data = trpc.adminEngage.dataRequestsAdmin.useQuery(undefined, { retry: false });

  const refresh = () => { utils.admin.opsOverview.invalidate(); utils.adminEngage.followUps.invalidate(); utils.adminEngage.dataRequestsAdmin.invalidate(); };

  const run = trpc.admin.runScheduler.useMutation({
    onSuccess: (r) => { toast(r.ran ? "Automation run complete." : "Nothing was due."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const followDone = trpc.adminEngage.followUpDone.useMutation({ onSuccess: () => { toast("Updated."); refresh(); }, onError: (e) => toast(e.message) });
  const resolveData = trpc.adminEngage.resolveDataRequest.useMutation({ onSuccess: () => { toast("Marked fulfilled."); refresh(); }, onError: (e) => toast(e.message) });

  const s = ov.data;
  const openData = (data.data ?? []).filter((d) => d.status === "open");

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Operations · is the machine running?" title="Operations"
        sub="The command centre for the timed and exception work — automation, follow-ups, at-risk saves, dormancy and data requests, in one place." />

      <KpiAlertsBanner />

      {ov.isLoading && <Spinner />}
      {s && (
        <>
          {/* signal strip */}
          <div className="eh-grid g4 eh-mb">
            <Metric k="Open follow-ups" v={s.followUps.open} n={s.followUps.overdue > 0 ? `${s.followUps.overdue} overdue` : "On track"} accent={s.followUps.overdue > 0 ? "var(--eh-red, #b23a2e)" : undefined} />
            <Metric k="Open saves" v={s.saves.open} n="At-risk interventions" accent={s.saves.open > 0 ? "#b8862e" : undefined} />
            <Metric k="At-risk / dormant" v={`${s.members.atRisk} / ${s.members.dormant}`} n="Active members" accent={s.members.atRisk > 0 ? "#b8862e" : undefined} />
            <Metric k="Data requests" v={s.dataRequests.open} n="PDPL — awaiting action" accent={s.dataRequests.open > 0 ? "var(--eh-red, #b23a2e)" : undefined} />
          </div>

          {/* automation */}
          <div className="eh-card eh-mb">
            <div className="eh-between" style={{ flexWrap: "wrap", gap: ".6rem" }}>
              <div>
                <h3 style={{ margin: 0 }}>Daily automation</h3>
                <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
                  The timed pass the platform runs on its own. {s.chapters.belowBar > 0 ? <b>{s.chapters.belowBar} chapter(s) below the health bar.</b> : "All chapters at/above the health bar."}
                </p>
              </div>
              <div className="eh-row" style={{ gap: ".6rem", alignItems: "center" }}>
                {s.scheduler.ranToday ? <Pill color="green">Ran today</Pill> : <Pill color="amber">Pending</Pill>}
                <button className="eh-btn gold sm" disabled={run.isPending} onClick={() => run.mutate()}>{run.isPending ? "Running…" : "Run now"}</button>
              </div>
            </div>
            <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap", marginTop: ".8rem" }}>
              {s.jobs.map((j) => <Pill key={j} color="grey">{j}</Pill>)}
            </div>
            <p className="eh-sm eh-muted" style={{ marginBottom: 0, marginTop: ".6rem" }}>
              Last daily pass: {s.scheduler.lastDaily ?? "not yet run"}.
            </p>
          </div>

          {/* follow-ups */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Follow-up tasks</h2>
            {s.followUps.overdue > 0 && <Pill color="red">{s.followUps.overdue} overdue</Pill>}
          </div>
          <div className="eh-card">
            {follow.isLoading && <Spinner />}
            {follow.data && follow.data.length === 0 && <Empty big="No open follow-ups." p="Guest and prospect follow-ups (CH-01/03) appear here with their 48-hour deadline." />}
            <div className="eh-list">
              {(follow.data ?? []).map((f) => (
                <div className="row" key={f.id} style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{f.title}</div>
                    <div className="d">
                      {f.chapterName ? `${f.chapterName} · ` : ""}{f.ownerName ? `owner ${f.ownerName} · ` : ""}
                      {f.dueAt ? <span style={{ color: f.overdue ? "var(--eh-red, #b23a2e)" : undefined, fontWeight: f.overdue ? 600 : 400 }}>{f.overdue ? "Overdue " : "Due "}{fmtDate(f.dueAt)}</span> : "No due date"}
                    </div>
                  </div>
                  <span className="eh-row" style={{ gap: ".3rem" }}>
                    <button className="eh-btn green sm" disabled={followDone.isPending} onClick={() => followDone.mutate({ id: f.id })}>Done</button>
                    <button className="eh-btn ghost sm" disabled={followDone.isPending} onClick={() => followDone.mutate({ id: f.id, dismiss: true })}>Dismiss</button>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* data requests (PDPL) */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>Data requests · PDPL</h2>
            {openData.length > 0 && <Pill color="amber">{openData.length} awaiting</Pill>}
          </div>
          <div className="eh-card">
            {data.isLoading && <Spinner />}
            {data.data && openData.length === 0 && <Empty big="No open data requests." p="Member export / deletion requests (data-subject rights) appear here for fulfilment." />}
            <div className="eh-list">
              {openData.map((d) => (
                <div className="row" key={d.id} style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{d.memberName} <Pill color={d.kind === "deletion" ? "red" : "blue"}>{d.kind}</Pill></div>
                    <div className="d">Raised {fmtDateTime(d.createdAt)}</div>
                  </div>
                  <button className="eh-btn gold sm" disabled={resolveData.isPending}
                    onClick={async () => { if (await confirmDialog({ title: `Mark this ${d.kind} request fulfilled?`, body: "Confirm you've completed the export or deletion outside the app as required.", confirmLabel: "Mark fulfilled" })) resolveData.mutate({ id: d.id }); }}>Mark fulfilled</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </EhShell>
  );
}

function Metric({ k, v, n, accent }: { k: string; v: React.ReactNode; n?: string; accent?: string }) {
  return (
    <div className="eh-card" style={{ padding: "1rem 1.1rem", borderLeft: accent ? `3px solid ${accent}` : undefined }}>
      <div className="eh-eyebrow" style={{ marginBottom: ".2rem" }}>{k}</div>
      <div className="eh-num" style={{ fontSize: "1.6rem", fontWeight: 800, lineHeight: 1.1, color: accent ?? "var(--eh-ink)" }}>{v}</div>
      {n && <div className="eh-muted eh-sm" style={{ marginTop: ".25rem" }}>{n}</div>}
    </div>
  );
}
