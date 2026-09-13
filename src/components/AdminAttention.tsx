import { Link } from "react-router";
import { trpc } from "@/providers/trpc";

type Tile = {
  key: string;
  count: number | null;
  label: string;
  hint: string;
  to: string;
  urgent: boolean;
};

/** "Needs attention now" — the small set of live counts the back-office should
 *  act on today, each a click-through. Urgent (non-zero) items lead; when
 *  everything is clear it says so. */
export function AdminAttention() {
  const q = trpc.admin.needsAttention.useQuery(undefined, { retry: false });
  if (q.isLoading || q.isError || !q.data) return null;
  const d = q.data;

  const tiles: Tile[] = [
    {
      key: "apps",
      count: d.pendingApplications,
      label: "Applications in review",
      hint: "Received → interview",
      to: "/admin/applications",
      urgent: d.pendingApplications > 0,
    },
    {
      key: "leads",
      count: d.leadsBreachingSla,
      label: "Leads past 24h",
      hint: "Uncontacted — SLA breach",
      to: "/admin/leads",
      urgent: d.leadsBreachingSla > 0,
    },
    {
      key: "atrisk",
      count: d.atRiskMembers,
      label: "At-risk members",
      hint: "Disengaging — needs a save",
      to: "/admin/members",
      urgent: d.atRiskMembers > 0,
    },
    {
      key: "saves",
      count: d.openSaveCases,
      label: "Open save cases",
      hint: "In the retention playbook",
      to: "/admin/saves",
      urgent: d.openSaveCases > 0,
    },
    {
      key: "dsar",
      count: d.openDataRequests,
      label: "Data requests",
      hint: "PDPL — 30-day clock",
      to: "/admin/data-requests",
      urgent: d.openDataRequests > 0,
    },
  ];

  if (d.foundingSeatsLeft !== null) {
    tiles.push({
      key: "seats",
      count: d.foundingSeatsLeft,
      label: "Founding seats left",
      hint: "Vanguard cohort",
      to: "/admin/members",
      urgent: false,
    });
  }

  // Urgent items first, then the rest — so what needs doing leads.
  tiles.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const anyUrgent = tiles.some(t => t.urgent);

  return (
    <div className="eh-card eh-mb">
      <div className="eh-between" style={{ alignItems: "baseline" }}>
        <div className="eh-eyebrow" style={{ color: "var(--eh-gold-2)" }}>
          Needs attention now
        </div>
        {!anyUrgent && (
          <span className="eh-sm" style={{ color: "var(--eh-green, #2e7d5b)" }}>
            All clear ✓
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: ".6rem",
          marginTop: ".7rem",
        }}
      >
        {tiles.map(t => (
          <Link
            key={t.key}
            to={t.to}
            style={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
              padding: ".7rem .8rem",
              borderRadius: 11,
              border: "1px solid",
              borderColor: t.urgent ? "rgba(199,74,52,.35)" : "rgba(0,0,0,.08)",
              background: t.urgent
                ? "rgba(199,74,52,.06)"
                : "var(--eh-bg, #faf7f0)",
              transition: "transform .12s ease",
            }}
            onMouseEnter={e =>
              (e.currentTarget.style.transform = "translateY(-1px)")
            }
            onMouseLeave={e => (e.currentTarget.style.transform = "none")}
          >
            <div
              className="eh-serif eh-num"
              style={{
                fontSize: "1.7rem",
                lineHeight: 1.1,
                color: t.urgent ? "var(--eh-red, #c74a34)" : "inherit",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {t.count ?? "—"}
            </div>
            <div style={{ fontWeight: 600, fontSize: ".85rem", marginTop: 2 }}>
              {t.label}
            </div>
            <div className="eh-sm eh-muted" style={{ fontSize: ".72rem" }}>
              {t.hint}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
