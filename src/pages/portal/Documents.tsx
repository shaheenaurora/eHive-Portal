import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  LoadError,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

export default function Documents() {
  const q = trpc.circle.myDocuments.useQuery(undefined, { retry: false });
  const d = q.data;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead
        eyebrow="Documents"
        title="Your certificates & records"
        sub="Download your membership certificate, attendance certificates for events you've attended, and track your CPD credits."
      />

      {q.isLoading && <Spinner />}
      {q.isError && (
        <LoadError what="your documents" onRetry={() => q.refetch()} />
      )}

      {d && (
        <>
          {/* summary strip */}
          <div className="eh-grid g3 eh-mb">
            <div className="eh-card" style={{ padding: "1rem 1.1rem" }}>
              <div className="eh-eyebrow">Membership No.</div>
              <div
                className="eh-num"
                style={{ fontSize: "1.4rem", fontWeight: 800 }}
              >
                {d.membership.memberNo}
              </div>
              <div className="eh-muted eh-sm" style={{ marginTop: ".2rem" }}>
                {d.membership.tierLabel} ·{" "}
                {d.membership.inGoodStanding ? (
                  <Pill color="green">in good standing</Pill>
                ) : (
                  <Pill color="amber">{d.membership.status}</Pill>
                )}
              </div>
            </div>
            <div className="eh-card" style={{ padding: "1rem 1.1rem" }}>
              <div className="eh-eyebrow">Member since</div>
              <div
                className="eh-num"
                style={{ fontSize: "1.4rem", fontWeight: 800 }}
              >
                {fmtDate(d.membership.joinedAt)}
              </div>
              <div className="eh-muted eh-sm" style={{ marginTop: ".2rem" }}>
                Valid through {fmtDate(d.membership.validThrough)}
              </div>
            </div>
            <div className="eh-card" style={{ padding: "1rem 1.1rem" }}>
              <div className="eh-eyebrow">CPD credits earned</div>
              <div
                className="eh-num"
                style={{
                  fontSize: "1.4rem",
                  fontWeight: 800,
                  color: "var(--eh-gold)",
                }}
              >
                {d.cpdTotal}
              </div>
              <div className="eh-muted eh-sm" style={{ marginTop: ".2rem" }}>
                Across {d.attended.length} attended event
                {d.attended.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>

          {/* membership certificate */}
          <div className="eh-card eh-mb">
            <div
              className="eh-between"
              style={{ flexWrap: "wrap", gap: ".6rem" }}
            >
              <div>
                <h3 style={{ margin: 0 }}>Membership certificate</h3>
                <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
                  An official certificate confirming your{" "}
                  {d.membership.tierLabel} membership. Print it or save it as a
                  PDF.
                </p>
              </div>
              <Link
                className="eh-btn gold sm"
                to="/portal/certificate/membership"
              >
                Open certificate →
              </Link>
            </div>
          </div>

          {/* attendance certificates */}
          <div className="eh-between" style={{ margin: "1.25rem 0 .75rem" }}>
            <h2 className="eh-h2" style={{ margin: 0 }}>
              Attendance certificates
            </h2>
          </div>
          <div className="eh-card">
            {d.attended.length === 0 && (
              <Empty
                big="No attendance certificates yet."
                p="Once you attend an event and are checked in, its certificate appears here."
              />
            )}
            <div className="eh-list">
              {d.attended.map(e => (
                <div
                  className="row"
                  key={e.eventId}
                  style={{ alignItems: "center" }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="t">{e.title}</div>
                    <div className="d">
                      {fmtDate(e.startsAt)}
                      {e.location ? ` · ${e.location}` : ""}
                      {e.cpdCredits > 0
                        ? ` · ${e.cpdCredits} CPD credit${e.cpdCredits === 1 ? "" : "s"}`
                        : ""}
                    </div>
                  </div>
                  <Link
                    className="eh-btn ghost sm"
                    to={`/portal/certificate/attendance/${e.eventId}`}
                  >
                    Certificate →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </EhShell>
  );
}
