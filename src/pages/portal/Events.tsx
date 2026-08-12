import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  Empty,
  TierPill,
  Spinner,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { QrCode } from "@/components/QrCode";
import { useAuth } from "@/hooks/useAuth";
import { fmtDateTime, fmtDay } from "@/lib/ehf";
import {
  EVENT_KIND_COLOR,
  EVENT_KIND_LABEL,
  TIER_LABEL,
} from "@contracts/constants";

export default function Events() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const q = trpc.circle.events.useQuery(undefined, { retry: false });
  const past = trpc.engage.myPastEvents.useQuery(undefined, { retry: false });
  const [filter, setFilter] = useState<string>("all");
  const [checkinFor, setCheckinFor] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [feedbackFor, setFeedbackFor] = useState<number | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  function refresh() {
    utils.circle.events.invalidate();
    utils.circle.dashboard.invalidate();
    utils.engage.myPastEvents.invalidate();
    utils.circle.myScore.invalidate();
  }

  const reg = trpc.circle.registerEvent.useMutation({
    onSuccess: r => {
      toast(
        r.waitlisted
          ? "Event is full — you're on the waitlist. We'll promote you automatically if a seat opens."
          : "Seat reserved — your check-in code is on the card."
      );
      refresh();
    },
    onError: e => toast(e.message),
  });
  const cancel = trpc.circle.cancelEventReg.useMutation({
    onSuccess: () => {
      toast("Registration cancelled.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const checkin = trpc.engage.checkinEvent.useMutation({
    onSuccess: r => {
      toast(
        r.already
          ? "Already checked in."
          : `Checked in — Hive Score now ${r.score}`
      );
      setCheckinFor(null);
      setCode("");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const feedback = trpc.engage.submitEventFeedback.useMutation({
    onSuccess: () => {
      toast("Thank you — feedback recorded.");
      setFeedbackFor(null);
      setComment("");
      setRating(5);
      refresh();
    },
    onError: e => toast(e.message),
  });

  const list = (q.data ?? []).filter(
    e => filter === "all" || e.kind === filter
  );

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Events"
        title="The calendar"
        sub="Spark Evenings are working sessions. Circle Dinners are off the record. Retreats are for going deep."
      />

      <div className="eh-tabs">
        {["all", "spark", "circle", "meetup", "retreat", "summit"].map(k => (
          <button
            key={k}
            className={filter === k ? "on" : ""}
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1) + "s"}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.data && list.length === 0 && (
        <div className="eh-card">
          <Empty
            big="Nothing in this bucket right now."
            p="New events publish monthly — the next batch lands on the 1st."
          />
        </div>
      )}

      <div className="eh-grid g3">
        {list.map(e => {
          const full = e.seatsLeft <= 0;
          return (
            <div
              className="eh-card"
              key={e.id}
              style={{ display: "flex", flexDirection: "column" }}
            >
              <div className="eh-between">
                <Pill
                  color={
                    EVENT_KIND_COLOR[e.kind as keyof typeof EVENT_KIND_COLOR] ??
                    "grey"
                  }
                >
                  {EVENT_KIND_LABEL[e.kind as keyof typeof EVENT_KIND_LABEL] ??
                    e.kind}
                </Pill>
                {e.audience === "public" ? (
                  <Pill color="green">Public</Pill>
                ) : (
                  <TierPill tier={e.tierGate} />
                )}
              </div>
              <h3 className="eh-mt">{e.title}</h3>
              <p className="eh-sm eh-muted" style={{ flex: 1 }}>
                {e.description}
              </p>
              <hr className="eh-divider" />
              <div className="eh-list">
                <div className="row">
                  <span className="d">When</span>
                  <span className="t eh-sm">
                    {fmtDay(e.startsAt)},{" "}
                    {fmtDateTime(e.startsAt).split("·")[1]}
                  </span>
                </div>
                <div className="row">
                  <span className="d">Where</span>
                  <span className="t eh-sm">{e.location ?? "TBA"}</span>
                </div>
                <div className="row">
                  <span className="d">Seats left</span>
                  <span className="t eh-sm eh-num">
                    {Math.max(0, e.seatsLeft)}
                  </span>
                </div>
              </div>
              <div className="eh-mt">
                {!e.allowed ? (
                  <div className="eh-locked">
                    <Pill>invite</Pill>
                    <span className="eh-sm">
                      {e.audience === "tiers"
                        ? `For ${(e.eligibleTiers ?? []).map(t => TIER_LABEL[t as keyof typeof TIER_LABEL] ?? t).join(", ")} members — see Membership to upgrade.`
                        : `Opens at ${TIER_LABEL[e.tierGate as keyof typeof TIER_LABEL] ?? e.tierGate} tier — see Membership to upgrade.`}
                    </span>
                  </div>
                ) : e.regStatus === "attended" ? (
                  <Pill color="green">Attended ✓</Pill>
                ) : e.regStatus === "waitlisted" ? (
                  <div className="eh-between">
                    <Pill color="blue">On the waitlist</Pill>
                    <button
                      className="eh-btn ghost sm"
                      disabled={cancel.isPending}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: "Leave waitlist?",
                            body: "You'll lose your place if the event fills up.",
                            danger: true,
                            confirmLabel: "Leave",
                          })
                        ) {
                          cancel.mutate({ eventId: e.id });
                        }
                      }}
                    >
                      Leave
                    </button>
                  </div>
                ) : e.regStatus === "registered" ? (
                  <div>
                    <div className="eh-between">
                      <Pill color="green">You're registered ✓</Pill>
                      <button
                        className="eh-btn ghost sm"
                        disabled={cancel.isPending}
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              title: "Cancel registration?",
                              body: `Your seat for "${e.title}" will be released.`,
                              danger: true,
                              confirmLabel: "Cancel",
                            })
                          ) {
                            cancel.mutate({ eventId: e.id });
                          }
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {e.checkinCode && (
                      <div
                        className="eh-banner eh-mt"
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: ".5rem",
                        }}
                      >
                        <span className="eh-sm">
                          Door code{" "}
                          <b
                            className="eh-num"
                            style={{ letterSpacing: ".08em" }}
                          >
                            {e.checkinCode}
                          </b>
                        </span>
                        <button
                          className="eh-btn sm"
                          onClick={() => {
                            setCheckinFor(e.id);
                            setCode("");
                          }}
                        >
                          Check in
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    className="eh-btn gold"
                    style={{ width: "100%" }}
                    disabled={reg.isPending}
                    onClick={() => reg.mutate({ eventId: e.id })}
                  >
                    {full ? "Join the waitlist" : "Reserve my seat →"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(past.data ?? []).length > 0 && (
        <>
          <h2 className="eh-h2" style={{ margin: "2rem 0 .75rem" }}>
            Past events
          </h2>
          <div className="eh-card">
            <div className="eh-list">
              {past.data!.map(r => (
                <div className="row" key={r.event.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{r.event.title}</div>
                    <div className="d">{fmtDay(r.event.startsAt)}</div>
                  </div>
                  {r.reg.status === "attended" ? (
                    <Pill color="green">Attended</Pill>
                  ) : (
                    <Pill>Registered</Pill>
                  )}
                  {r.reg.status === "attended" && !r.feedbackGiven && (
                    <button
                      className="eh-btn sm"
                      onClick={() => {
                        setFeedbackFor(r.event.id);
                        setRating(5);
                        setComment("");
                      }}
                    >
                      Give feedback
                    </button>
                  )}
                  {r.feedbackGiven && (
                    <span className="eh-muted eh-sm">Feedback sent ✓</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {checkinFor !== null &&
        (() => {
          const ev = (q.data ?? []).find(e => e.id === checkinFor);
          return (
            <Modal
              onClose={() => setCheckinFor(null)}
              title="Your check-in pass"
            >
              <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                <p className="eh-sm eh-muted" style={{ margin: 0 }}>
                  {ev?.title}
                </p>
                {ev?.checkinCode && (
                  <div
                    style={{
                      display: "inline-block",
                      padding: 14,
                      background: "#fff",
                      borderRadius: 14,
                      margin: ".8rem 0 .4rem",
                      boxShadow: "0 2px 10px rgba(0,0,0,.06)",
                    }}
                  >
                    <QrCode value={ev.checkinCode} size={230} />
                  </div>
                )}
                {user?.name && (
                  <div className="t" style={{ fontWeight: 600 }}>
                    {user.name}
                  </div>
                )}
                <div
                  className="eh-num"
                  style={{
                    fontSize: "1.35rem",
                    letterSpacing: ".16em",
                    marginTop: ".2rem",
                  }}
                >
                  {ev?.checkinCode}
                </div>
                <p className="eh-sm eh-muted" style={{ marginTop: ".4rem" }}>
                  Show this at the door to be scanned — your Hive Score updates
                  the moment you're checked in.
                </p>
              </div>
              <hr className="eh-divider" />
              <Field label="No scanner at the door? Enter the code yourself">
                <input
                  className="eh-input"
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="Door code"
                  maxLength={12}
                  style={{ letterSpacing: ".1em" }}
                />
              </Field>
              <button
                className="eh-btn gold"
                style={{ width: "100%" }}
                disabled={checkin.isPending || code.trim().length < 4}
                onClick={() =>
                  checkin.mutate({ eventId: checkinFor, code: code.trim() })
                }
              >
                {checkin.isPending ? "Checking in…" : "Check in →"}
              </button>
            </Modal>
          );
        })()}

      {feedbackFor !== null && (
        <Modal onClose={() => setFeedbackFor(null)} title="Event feedback">
          <Field label={`Rating — ${rating}/5`}>
            <input
              type="range"
              min={1}
              max={5}
              value={rating}
              onChange={e => setRating(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#b8862e" }}
            />
          </Field>
          <Field label="What should we keep or change? (optional)">
            <textarea
              className="eh-textarea"
              value={comment}
              onChange={e => setComment(e.target.value)}
              maxLength={1000}
            />
          </Field>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={feedback.isPending}
            onClick={() =>
              feedback.mutate({
                eventId: feedbackFor,
                rating,
                comment: comment || undefined,
              })
            }
          >
            {feedback.isPending ? "Sending…" : "Submit feedback →"}
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
