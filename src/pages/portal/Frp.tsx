import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  StatusPill,
  Empty,
  TierPill,
  Modal,
  Field,
  Bar,
  toast,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { MILESTONE_LABEL } from "@contracts/constants";

const DIMS = [
  {
    key: "team",
    label: "Team",
    hint: "Can this team survive the founder getting flu?",
  },
  {
    key: "traction",
    label: "Traction",
    hint: "Revenue, retention, pipeline — evidence, not hope.",
  },
  {
    key: "market",
    label: "Market",
    hint: "Is the wedge sharp and the ceiling high?",
  },
  {
    key: "financials",
    label: "Financials",
    hint: "A model a sceptical CFO would sign.",
  },
  {
    key: "narrative",
    label: "Narrative",
    hint: "The story a partner retells at Monday's partners' meeting.",
  },
  {
    key: "legal",
    label: "Legal",
    hint: "Structure, IP, ESOP — diligence-ready?",
  },
] as const;

export default function Frp() {
  const utils = trpc.useUtils();
  const cohorts = trpc.circle.frpCohorts.useQuery(undefined, { retry: false });
  const mine = trpc.circle.myFrp.useQuery(undefined, { retry: false });

  const enrol = trpc.circle.frpEnrol.useMutation({
    onSuccess: () => {
      toast("Enrolled — welcome to the programme.");
      utils.circle.myFrp.invalidate();
      utils.circle.frpCohorts.invalidate();
    },
    onError: e => toast(e.message),
  });
  const saveAssess = trpc.circle.saveAssessment.useMutation({
    onSuccess: () => {
      toast("Readiness assessment saved.");
      utils.circle.myFrp.invalidate();
    },
    onError: e => toast(e.message),
  });
  const submit = trpc.circle.submitMilestone.useMutation({
    onSuccess: () => {
      toast("Submitted for review.");
      utils.circle.myFrp.invalidate();
    },
    onError: e => toast(e.message),
  });

  const [submitFor, setSubmitFor] = useState<{
    id: number;
    key: string;
  } | null>(null);
  const [note, setNote] = useState("");

  const enrolled = mine.data;
  const a = enrolled?.assessment;
  const scores = a
    ? [a.team, a.traction, a.market, a.financials, a.narrative, a.legal]
    : [0, 0, 0, 0, 0, 0];
  const readiness = scores.reduce((x, y) => x + y, 0);

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead
        eyebrow="Fundraising Readiness Programme"
        title="Raise ready, not desperate"
        sub="Twelve weeks from scattered materials to a data room a GCC fund can diligence in days. Deck, model, data room — reviewed by operators who have sat on both sides of the table."
      />

      {!enrolled && (
        <div className="eh-grid g3">
          {(cohorts.data ?? []).map(c => (
            <div className="eh-card" key={c.id}>
              <div className="eh-between">
                <StatusPill status={c.status} />
                <TierPill tier={c.tierGate} />
              </div>
              <h3 className="eh-mt">{c.name}</h3>
              <p className="eh-sm eh-muted">Starts {fmtDate(c.startsAt)}</p>
              <div className="eh-mt">
                {!c.allowed ? (
                  <div className="eh-locked">
                    <Pill>{c.tierGate}+</Pill>
                    <span className="eh-sm">
                      The FRP opens at {c.tierGate} tier.
                    </span>
                  </div>
                ) : c.enrolled ? (
                  <Pill color="green">Enrolled ✓</Pill>
                ) : (
                  <button
                    className="eh-btn gold"
                    style={{ width: "100%" }}
                    disabled={enrol.isPending}
                    onClick={() => enrol.mutate({ cohortId: c.id })}
                  >
                    Enrol in this cohort →
                  </button>
                )}
              </div>
            </div>
          ))}
          {cohorts.data?.length === 0 && (
            <div className="eh-card">
              <Empty
                big="No open cohort right now."
                p="The next cohort opens with the quarter — check back on the 1st."
              />
            </div>
          )}
        </div>
      )}

      {enrolled && (
        <>
          <div className="eh-card">
            <div className="eh-between">
              <div>
                <div className="eh-eyebrow">Current cohort</div>
                <h3 style={{ margin: 0 }}>{enrolled.cohort.name}</h3>
              </div>
              <StatusPill status={enrolled.enrolment.status} />
            </div>
          </div>

          <div className="eh-grid g2 eh-mt" style={{ alignItems: "start" }}>
            <div className="eh-card">
              <div className="eh-between">
                <h3 style={{ margin: 0 }}>Readiness assessment</h3>
                <Pill
                  color={
                    readiness >= 24
                      ? "green"
                      : readiness >= 15
                        ? "gold"
                        : "grey"
                  }
                >
                  {readiness}/30
                </Pill>
              </div>
              <p className="eh-sm eh-muted">
                Score yourself honestly — your reviewers recalibrate it together
                with you in week one.
              </p>
              <div className="eh-list">
                {DIMS.map((d, i) => (
                  <div className="row" key={d.key} style={{ display: "block" }}>
                    <div
                      className="eh-between"
                      style={{ marginBottom: ".35rem" }}
                    >
                      <div>
                        <span className="t">{d.label}</span>
                        <div className="d">{d.hint}</div>
                      </div>
                      <div className="eh-row" style={{ gap: ".25rem" }}>
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            onClick={() => {
                              const next = [...scores];
                              next[i] = n;
                              saveAssess.mutate({
                                enrolmentId: enrolled.enrolment.id,
                                team: next[0],
                                traction: next[1],
                                market: next[2],
                                financials: next[3],
                                narrative: next[4],
                                legal: next[5],
                              });
                            }}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 7,
                              border: "1px solid var(--eh-line)",
                              background:
                                scores[i] >= n ? "var(--eh-gold)" : "#fff",
                              color: scores[i] >= n ? "#fff" : "var(--eh-mut)",
                              cursor: "pointer",
                              fontSize: ".72rem",
                              fontWeight: 700,
                            }}
                          >
                            {n}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Bar pct={(scores[i] / 5) * 100} green={scores[i] >= 4} />
                  </div>
                ))}
              </div>
            </div>

            <div className="eh-card">
              <h3>Deliverables</h3>
              <p className="eh-sm eh-muted">
                Three artefacts, three reviews. Submit when ready — feedback
                lands within a week.
              </p>
              <div className="eh-list">
                {enrolled.milestones.map(m => (
                  <div
                    className="row"
                    key={m.id}
                    style={{ alignItems: "flex-start" }}
                  >
                    <div>
                      <div className="t">{MILESTONE_LABEL[m.key] ?? m.key}</div>
                      {m.note && (
                        <div className="d" style={{ maxWidth: "38ch" }}>
                          {m.note}
                        </div>
                      )}
                    </div>
                    <div className="eh-row">
                      <StatusPill status={m.status} />
                      {(m.status === "not_started" ||
                        m.status === "in_progress") && (
                        <button
                          className="eh-btn sm"
                          onClick={() => {
                            setSubmitFor({ id: m.id, key: m.key });
                            setNote(m.note ?? "");
                          }}
                        >
                          Submit →
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <hr className="eh-divider" />
              <p className="eh-sm eh-muted" style={{ margin: 0 }}>
                Reviews are done by two operators plus one investor from the
                advisory board. Expect line-level comments, not a pat on the
                back.
              </p>
            </div>
          </div>
        </>
      )}

      {submitFor && (
        <Modal
          title={`Submit: ${MILESTONE_LABEL[submitFor.key as keyof typeof MILESTONE_LABEL] ?? submitFor.key}`}
          onClose={() => setSubmitFor(null)}
        >
          <Field label="A note for your reviewers (where to look, what's uncertain)">
            <textarea
              className="eh-textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={1000}
              placeholder="e.g. Deck v4 — slides 8–11 reworked after last review. Unsure about the pricing slide."
            />
          </Field>
          <button
            className="eh-btn gold"
            disabled={submit.isPending}
            onClick={() =>
              submit.mutate(
                { id: submitFor.id, note: note || undefined },
                { onSuccess: () => setSubmitFor(null) }
              )
            }
          >
            Submit for review →
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
