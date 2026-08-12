import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, StatusPill, TierPill } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

const STEPS = [
  {
    key: "received",
    label: "Received",
    note: "Your application is in the queue.",
  },
  {
    key: "screening",
    label: "Screening",
    note: "The Circle team is reviewing your profile.",
  },
  {
    key: "interview",
    label: "Conversation",
    note: "A 30-minute call with two members of the team.",
  },
  {
    key: "decision",
    label: "Decision",
    note: "The council confirms new members weekly.",
  },
];

export default function Status() {
  const me = trpc.circle.me.useQuery(undefined, {
    retry: false,
    refetchInterval: 30000,
  });
  const app = me.data?.application;

  const idx = !app
    ? 0
    : app.status === "received"
      ? 0
      : app.status === "screening"
        ? 1
        : app.status === "interview"
          ? 2
          : app.status === "approved"
            ? 3
            : 2;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">Application status</div>
          <h1 className="eh-h1">
            {app?.status === "rejected"
              ? "Not this time."
              : "Your application is moving."}
          </h1>
          <p className="eh-sub">
            {app?.status === "rejected"
              ? "The council passes on more applications than it accepts — you're welcome to reapply in six months."
              : "Every application is read by a human. The typical cycle is five working days."}
          </p>
        </div>
        {app && <StatusPill status={app.status} />}
      </div>

      {app && app.status !== "rejected" && (
        <div className="eh-card">
          <div className="eh-grid g4">
            {STEPS.map((s, i) => (
              <div key={s.key} style={{ opacity: i <= idx ? 1 : 0.38 }}>
                <div className="eh-row" style={{ gap: ".45rem" }}>
                  <span
                    className="eh-avatar"
                    style={{
                      width: 26,
                      height: 26,
                      flexBasis: 26,
                      fontSize: ".68rem",
                      background:
                        i < idx
                          ? "var(--eh-green)"
                          : i === idx
                            ? "var(--eh-gold)"
                            : "#c9c2b2",
                    }}
                  >
                    {i < idx ? "✓" : i + 1}
                  </span>
                  <b className="eh-strong">{s.label}</b>
                </div>
                <p className="eh-sm eh-muted" style={{ margin: ".4rem 0 0" }}>
                  {s.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {app && (
        <div className="eh-card">
          <h3>Your application</h3>
          <div className="eh-list">
            <div className="row">
              <span className="t">Submitted</span>
              <span className="eh-muted eh-sm">{fmtDate(app.createdAt)}</span>
            </div>
            <div className="row">
              <span className="t">Company</span>
              <span className="eh-muted eh-sm">{app.company ?? "—"}</span>
            </div>
            <div className="row">
              <span className="t">Stage</span>
              <span className="eh-muted eh-sm">{app.stage ?? "—"}</span>
            </div>
            <div className="row">
              <span className="t">Tier requested</span>
              <TierPill tier={app.tierRequested} />
            </div>
            {app.why && (
              <div className="row" style={{ alignItems: "flex-start" }}>
                <span className="t">Why eHive</span>
                <span
                  className="eh-muted eh-sm"
                  style={{ maxWidth: "60ch", textAlign: "right" }}
                >
                  {app.why}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </EhShell>
  );
}
