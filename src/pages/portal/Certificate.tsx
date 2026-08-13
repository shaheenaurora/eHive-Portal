import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Spinner, LoadError } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import "./certificate.css";

/** Print-optimized certificate view rendered full-page (no portal chrome) so
 *  "Print / Save as PDF" captures only the certificate. Two kinds:
 *   /portal/certificate/membership          — membership certificate
 *   /portal/certificate/attendance/:eventId — event attendance certificate  */
export default function Certificate() {
  const { kind, eventId } = useParams<{ kind: string; eventId?: string }>();
  const q = trpc.circle.myDocuments.useQuery(undefined, { retry: false });

  if (q.isLoading)
    return (
      <div className="cert-page">
        <Spinner />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="cert-page">
        <LoadError what="your certificate" onRetry={() => q.refetch()} />
      </div>
    );

  const d = q.data;
  const isAttendance = kind === "attendance";
  const event = isAttendance
    ? d.attended.find(e => String(e.eventId) === eventId)
    : undefined;

  if (isAttendance && !event)
    return (
      <div className="cert-page">
        <p style={{ textAlign: "center" }}>
          No attendance record found for this event.{" "}
          <Link to="/portal/documents">Back to documents</Link>
        </p>
      </div>
    );

  return (
    <div className="cert-page">
      <div className="cert-bar no-print">
        <Link className="eh-btn ghost sm" to="/portal/documents">
          ← Documents
        </Link>
        <button className="eh-btn gold sm" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <div className="cert" role="document">
        <div className="cert-frame">
          <div className="cert-crest" aria-hidden>
            ⬡
          </div>
          <div className="cert-brand">eHive Circle</div>

          {isAttendance ? (
            <>
              <div className="cert-kicker">Certificate of Attendance</div>
              <p className="cert-lead">This certifies that</p>
              <h1 className="cert-name">{d.membership.name}</h1>
              <p className="cert-lead">attended</p>
              <h2 className="cert-subject">{event!.title}</h2>
              <p className="cert-meta">
                {fmtDate(event!.startsAt)}
                {event!.location ? ` · ${event!.location}` : ""}
              </p>
              {event!.cpdCredits > 0 && (
                <p className="cert-credits">
                  {event!.cpdCredits} CPD credit
                  {event!.cpdCredits === 1 ? "" : "s"} awarded
                </p>
              )}
            </>
          ) : (
            <>
              <div className="cert-kicker">Certificate of Membership</div>
              <p className="cert-lead">This certifies that</p>
              <h1 className="cert-name">{d.membership.name}</h1>
              <p className="cert-lead">is a</p>
              <h2 className="cert-subject">{d.membership.tierLabel} member</h2>
              <p className="cert-meta">
                {d.membership.chapterName
                  ? `${d.membership.chapterName} · `
                  : ""}
                Member since {fmtDate(d.membership.joinedAt)}
              </p>
              <p className="cert-meta">
                Valid through {fmtDate(d.membership.validThrough)}
              </p>
            </>
          )}

          <div className="cert-foot">
            <div>
              <div className="cert-foot-label">Membership No.</div>
              <div className="cert-foot-value">{d.membership.memberNo}</div>
            </div>
            <div className="cert-seal" aria-hidden>
              eHive
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="cert-foot-label">Issued</div>
              <div className="cert-foot-value">{fmtDate(new Date())}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
