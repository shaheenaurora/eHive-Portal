import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Modal, Pill, TierPill, toast } from "@/components/eh";
import { TIERS, TIER_LABEL } from "@contracts/constants";

type AppLite = {
  id: number;
  name: string;
  email: string;
  company: string | null;
  why: string | null;
  tierRequested: "horizon" | "ascent" | "vanguard" | "zenith";
  muslimIdentity: number | null;
  valuesAligned: number | null;
  affirmationNote: string | null;
};

type Cohort = {
  seatsLeft: number;
  cap: number;
  open: boolean;
} | null;

const STEPS = ["Review", "Seat & tier", "Chapter", "Confirm"];

/** Guided admission — walks an admin through admitting an applicant so no step
 *  is missed: review the applicant, check founding-seat availability and tier,
 *  assign a home chapter, then confirm. Reuses setApplicationStatus; on success
 *  it shows the next steps for a new founding member. */
export function AdmissionWizard(props: {
  app: AppLite;
  chapters: { id: number; name: string }[];
  onClose: () => void;
  onApproved: () => void;
}) {
  const { app, chapters } = props;
  const [step, setStep] = useState(0);
  const [reviewed, setReviewed] = useState(false);
  const [tier, setTier] = useState<string>(app.tierRequested);
  const [chapter, setChapter] = useState<string>("");
  const [cohort, setCohort] = useState<Cohort>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/vanguard/cohort", { headers: { accept: "application/json" } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (live && d && typeof d.seatsLeft === "number") setCohort(d);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const admit = trpc.admin.setApplicationStatus.useMutation({
    onSuccess: () => {
      setDone(true);
    },
    onError: e => toast(e.message),
  });

  const hasChapters = chapters.length > 0;
  const seatsFull =
    tier === "vanguard" && cohort !== null && cohort.seatsLeft <= 0;

  const canNext =
    (step === 0 && reviewed) ||
    (step === 1 && !!tier) ||
    (step === 2 && (!hasChapters || !!chapter)) ||
    step === 3;

  const submit = () => {
    admit.mutate({
      id: app.id,
      status: "approved",
      tier: tier as never,
      chapterId: chapter ? Number(chapter) : undefined,
    });
  };

  return (
    <Modal
      title={done ? "Admitted" : `Admit ${app.name}`}
      onClose={props.onClose}
    >
      {done ? (
        <div>
          <p className="eh-strong" style={{ marginTop: 0 }}>
            {app.name} is now a {TIER_LABEL[tier as never]} member. ✓
          </p>
          <div className="eh-eyebrow" style={{ margin: ".75rem 0 .4rem" }}>
            Next steps
          </div>
          <ul className="eh-sm" style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>
              Place them onto a peer advisory board (Members → their profile →
              Suggested PODs).
            </li>
            <li>
              Offer the AED 499 Clarity Sprint activation to start their year.
            </li>
            <li>
              The onboarding welcome and buddy pairing were triggered
              automatically.
            </li>
          </ul>
          <div className="eh-row eh-mt" style={{ justifyContent: "flex-end" }}>
            <button
              className="eh-btn gold"
              onClick={() => {
                props.onApproved();
                props.onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Step indicator */}
          <div
            style={{
              display: "flex",
              gap: ".4rem",
              marginBottom: "1rem",
              flexWrap: "wrap",
            }}
          >
            {STEPS.map((label, i) => (
              <span
                key={label}
                className="eh-sm"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".35rem",
                  opacity: i === step ? 1 : 0.5,
                  fontWeight: i === step ? 700 : 400,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    fontSize: ".7rem",
                    background:
                      i < step
                        ? "var(--eh-green, #2e7d5b)"
                        : i === step
                          ? "var(--eh-gold, #b8862e)"
                          : "rgba(0,0,0,.1)",
                    color: i <= step ? "#fff" : "inherit",
                  }}
                >
                  {i < step ? "✓" : i + 1}
                </span>
                {label}
              </span>
            ))}
          </div>

          {step === 0 && (
            <div>
              <div className="eh-list">
                <div className="row">
                  <span className="d">Applicant</span>
                  <span className="t">
                    {app.name}
                    {app.company ? ` · ${app.company}` : ""}
                  </span>
                </div>
                <div className="row">
                  <span className="d">Requested tier</span>
                  <span className="t">
                    <TierPill tier={app.tierRequested} />
                  </span>
                </div>
                <div className="row">
                  <span className="d">Values / gate</span>
                  <span className="t">
                    {app.muslimIdentity ? (
                      <Pill color="green">identity ✓</Pill>
                    ) : null}
                    {app.valuesAligned ? (
                      <Pill color="green">values ✓</Pill>
                    ) : (
                      <Pill color="amber">values not affirmed</Pill>
                    )}
                  </span>
                </div>
              </div>
              {app.why && (
                <p className="eh-sm eh-muted" style={{ marginTop: ".6rem" }}>
                  &ldquo;{app.why}&rdquo;
                </p>
              )}
              <label
                className="eh-sm"
                style={{
                  display: "flex",
                  gap: ".5rem",
                  marginTop: ".75rem",
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={e => setReviewed(e.target.checked)}
                />
                I&rsquo;ve reviewed this applicant and they fit the cohort.
              </label>
            </div>
          )}

          {step === 1 && (
            <div>
              {cohort && (
                <div className="eh-banner eh-mb">
                  <span className="eh-sm">
                    Founding cohort:{" "}
                    <b>
                      {cohort.seatsLeft} of {cohort.cap}
                    </b>{" "}
                    seats left.
                  </span>
                </div>
              )}
              <label className="eh-sm" style={{ display: "block" }}>
                Approve into tier
                <select
                  className="eh-input"
                  value={tier}
                  onChange={e => setTier(e.target.value)}
                  style={{ marginTop: ".3rem" }}
                >
                  {TIERS.map(t => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              {seatsFull && (
                <p
                  className="eh-sm"
                  style={{
                    color: "var(--eh-red, #c74a34)",
                    marginTop: ".5rem",
                  }}
                >
                  The founding cohort is full — admitting anyway will exceed the
                  cap. Confirm this is intended before continuing.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div>
              <label className="eh-sm" style={{ display: "block" }}>
                {hasChapters
                  ? "Admit into home chapter"
                  : "No chapters yet — create one first, or admit without one"}
                <select
                  className="eh-input"
                  value={chapter}
                  onChange={e => setChapter(e.target.value)}
                  style={{ marginTop: ".3rem" }}
                  disabled={!hasChapters}
                >
                  <option value="">
                    {hasChapters ? "Select a chapter…" : "No chapters"}
                  </option>
                  {chapters.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {step === 3 && (
            <div className="eh-list">
              <div className="row">
                <span className="d">Applicant</span>
                <span className="t">{app.name}</span>
              </div>
              <div className="row">
                <span className="d">Tier</span>
                <span className="t">
                  <TierPill tier={tier} />
                </span>
              </div>
              <div className="row">
                <span className="d">Chapter</span>
                <span className="t">
                  {chapter
                    ? (chapters.find(c => String(c.id) === chapter)?.name ??
                      `#${chapter}`)
                    : "—"}
                </span>
              </div>
            </div>
          )}

          <div
            className="eh-row eh-mt"
            style={{ justifyContent: "space-between" }}
          >
            <button
              className="eh-btn ghost sm"
              disabled={step === 0}
              onClick={() => setStep(s => Math.max(0, s - 1))}
            >
              ← Back
            </button>
            {step < 3 ? (
              <button
                className="eh-btn gold sm"
                disabled={!canNext}
                onClick={() => setStep(s => Math.min(3, s + 1))}
              >
                Next →
              </button>
            ) : (
              <button
                className="eh-btn green"
                disabled={admit.isPending}
                onClick={submit}
              >
                {admit.isPending ? "Admitting…" : "Admit member →"}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
