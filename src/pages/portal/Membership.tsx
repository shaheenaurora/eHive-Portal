import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  StatusPill,
  TierPill,
  Spinner,
  Modal,
  Field,
  Empty,
  toast,
} from "@/components/eh";
import { PushSettings } from "@/components/PushSettings";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";
import { KycCard } from "@/components/KycCard";
import { fmtDate } from "@/lib/ehf";
import {
  TIERS,
  TIER_LABEL,
  TIER_PRICE,
  tierRank,
  DORMANCY_LABEL,
  memberBadges,
  renewalStage,
} from "@contracts/constants";
import type { DormancyStage } from "@contracts/constants";

export default function Membership() {
  useDocumentTitle("Membership");
  const utils = trpc.useUtils();
  const me = trpc.circle.me.useQuery(undefined, { retry: false });
  const hist = trpc.circle.membershipHistory.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const pendingReq = trpc.circle.pendingTierRequest.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const eng = trpc.engage.myEngagement.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const dataReqs = trpc.engage.myDataRequests.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const yir = trpc.circle.yearInReview.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const renew = trpc.circle.startRenewal.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast(e.message),
  });

  const updateProfile = trpc.circle.updateProfile.useMutation({
    onSuccess: () => {
      toast("Profile saved.");
      utils.circle.me.invalidate();
    },
    onError: e => toast(e.message),
  });
  const myReqs = trpc.circle.myChangeRequests.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const requestCorrection = trpc.circle.requestProfileCorrection.useMutation({
    onSuccess: () => {
      toast("Correction requested — the Circle team will review it.");
      myReqs.refetch();
      setCorr(null);
    },
    onError: e => toast(e.message),
  });
  const [corr, setCorr] = useState<{
    name: string;
    email: string;
    note: string;
  } | null>(null);
  const setVisible = trpc.engage.setDirectoryVisible.useMutation({
    onSuccess: () => {
      toast("Directory preference saved.");
      utils.circle.me.invalidate();
    },
    onError: e => toast(e.message),
  });
  const setEmailNotify = trpc.engage.setEmailNotify.useMutation({
    onSuccess: () => {
      toast("Email preference saved.");
      utils.circle.me.invalidate();
    },
    onError: e => toast(e.message),
  });
  const myActions = trpc.conduct.myActions.useQuery(undefined, {
    retry: false,
    enabled: !!me.data?.member,
  });
  const appeal = trpc.conduct.appeal.useMutation({
    onSuccess: () => {
      toast("Appeal submitted — it's reviewed independently, one level up.");
      utils.conduct.myActions.invalidate();
      setAppealFor(null);
      setAppealText("");
    },
    onError: e => toast(e.message),
  });
  const [appealFor, setAppealFor] = useState<number | null>(null);
  const [appealText, setAppealText] = useState("");
  const requestData = trpc.engage.requestData.useMutation({
    onSuccess: () => {
      toast("Request received — the team processes it within 30 days.");
      utils.engage.myDataRequests.invalidate();
    },
    onError: e => toast(e.message),
  });
  const change = trpc.circle.requestMembershipChange.useMutation({
    onSuccess: r => {
      toast(
        r.pending
          ? "Request submitted — management will review your tier change and confirm."
          : "Done — your membership is updated."
      );
      utils.circle.me.invalidate();
      utils.circle.membershipHistory.invalidate();
      utils.circle.pendingTierRequest.invalidate();
      setConfirm(null);
    },
    onError: e => toast(e.message),
  });

  const [confirm, setConfirm] = useState<{
    type: "upgrade" | "downgrade" | "pause" | "cancel" | "renew";
    toTier?: string;
  } | null>(null);
  const [note, setNote] = useState("");

  const member = me.data?.member;
  /* Profile form is seeded from the member record and becomes locally editable
     once the member types — derived here rather than synced via effect. */
  const serverForm = useMemo(
    () => ({
      company: member?.company ?? "",
      title: member?.title ?? "",
      phone: member?.phone ?? "",
      sector: member?.sector ?? "",
      stage: member?.stage ?? "",
      goals: member?.goals ?? "",
    }),
    [member]
  );
  const [edited, setEdited] = useState<{
    company: string;
    title: string;
    phone: string;
    sector: string;
    stage: string;
    goals: string;
  } | null>(null);
  const form = edited ?? serverForm;
  const setForm = setEdited;

  if (me.isLoading)
    return (
      <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
        <Spinner />
      </EhShell>
    );
  if (!member)
    return (
      <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
        <Empty big="No membership yet." />
      </EhShell>
    );

  function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    updateProfile.mutate({
      company: form.company || undefined,
      title: form.title || undefined,
      phone: form.phone || undefined,
      sector: form.sector || undefined,
      stage: form.stage || undefined,
      goals: form.goals || undefined,
    });
  }

  const CONFIRM_COPY: Record<
    string,
    { title: string; body: string; cta: string; danger?: boolean }
  > = {
    upgrade: {
      title: "Request an upgrade",
      body: "Tier changes are reviewed by the eHive Circle team. We'll confirm your new tier and adjust billing pro-rata — you'll see it here once it's approved.",
      cta: "Submit request →",
    },
    downgrade: {
      title: "Request a downgrade",
      body: "Tier changes are reviewed by the eHive Circle team before they take effect. We'll be in touch to confirm and adjust your plan.",
      cta: "Submit request →",
    },
    pause: {
      title: "Pause membership",
      body: "Your seat in every pod is held for 90 days. Billing pauses; the Hive Score freezes. Resume any time from this page.",
      cta: "Pause membership",
    },
    cancel: {
      title: "Cancel membership",
      body: "This ends your membership. Pod seats are released and portal access closes at month end. This is reversible only by reapplying.",
      cta: "Cancel membership",
      danger: true,
    },
    renew: {
      title: "Renew for another year",
      body: "Extends your renewal date by 12 months at your current tier.",
      cta: "Renew →",
    },
  };

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Membership"
        title="Your membership"
        sub="Tier, status, renewal and your profile — everything in one place, no emails required."
      />

      {(() => {
        const badges = memberBadges({
          createdAt: member.createdAt,
          hiveScore: member.hiveScore,
        });
        if (!badges.length) return null;
        return (
          <div
            className="eh-card eh-mb"
            style={{
              display: "flex",
              alignItems: "center",
              gap: ".75rem",
              flexWrap: "wrap",
            }}
          >
            <span className="eh-eyebrow" style={{ color: "var(--eh-gold)" }}>
              Recognition
            </span>
            {badges.map(b => (
              <Pill key={b} color="gold">
                {b}
              </Pill>
            ))}
          </div>
        );
      })()}

      {(member as { lifecycleState?: string }).lifecycleState === "renewal" && (
        <div
          className="eh-card eh-mb"
          style={{ borderColor: "#e8d5ac", background: "#fdfaf3" }}
        >
          <div
            className="eh-between"
            style={{ alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}
          >
            <div style={{ flex: "1 1 340px" }}>
              <div className="eh-eyebrow" style={{ color: "var(--eh-gold)" }}>
                Renewal window open
              </div>
              <h3 style={{ margin: ".1rem 0 .4rem" }}>
                It's time to renew — here's your year.
              </h3>
              {yir.data && (
                <div
                  className="eh-row"
                  style={{
                    gap: ".5rem",
                    flexWrap: "wrap",
                    margin: ".2rem 0 .6rem",
                  }}
                >
                  <Pill>Hive Score {yir.data.hiveScore}</Pill>
                  <Pill>{yir.data.sessions} sessions</Pill>
                  <Pill>{yir.data.oneToOnes} 1-2-1s</Pill>
                  <Pill>{yir.data.giveBack} mentoring</Pill>
                  <Pill>
                    {yir.data.pods} pod{yir.data.pods === 1 ? "" : "s"}
                  </Pill>
                </div>
              )}
              <p
                className="eh-sm eh-muted"
                style={{ margin: 0, maxWidth: "56ch" }}
              >
                Renewing keeps your {TIER_LABEL[member.tier]} membership and
                chapter access for another year
                {member.renewalAt ? (
                  <>
                    {" "}
                    — your date moves to{" "}
                    {fmtDate(
                      new Date(
                        new Date(member.renewalAt).setFullYear(
                          new Date(member.renewalAt).getFullYear() + 1
                        )
                      )
                    )}
                  </>
                ) : null}
                .
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div
                className="eh-num"
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: "1.4rem",
                  fontWeight: 700,
                }}
              >
                {TIER_PRICE[member.tier]}
              </div>
              <button
                className="eh-btn gold eh-mt"
                disabled={renew.isPending}
                onClick={() => renew.mutate()}
              >
                {renew.isPending ? "Redirecting…" : "Renew & pay →"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Current plan</h3>
              <StatusPill status={member.status} />
            </div>
            <div style={{ textAlign: "center", padding: "1rem 0 .4rem" }}>
              <TierPill tier={member.tier} />
              <div
                className="eh-serif"
                style={{ fontSize: "1.7rem", marginTop: ".5rem" }}
              >
                {TIER_LABEL[member.tier]}
              </div>
              <div className="eh-muted eh-sm eh-num">
                {TIER_PRICE[member.tier]}
              </div>
              <div className="eh-mt">
                <Pill color="gold">
                  ✓ verified {TIER_LABEL[member.tier]} badge
                </Pill>
                {member.inductionNo ? (
                  <Pill color="purple">induction №{member.inductionNo}</Pill>
                ) : null}
              </div>
            </div>
            <hr className="eh-divider" />
            <div className="eh-list">
              <div className="row">
                <span className="d">Member since</span>
                <span className="t eh-sm">{fmtDate(member.joinedAt)}</span>
              </div>
              <div className="row">
                <span className="d">Renews</span>
                <span className="t eh-sm">{fmtDate(member.renewalAt)}</span>
              </div>
              <div className="row">
                <span className="d">Engagement</span>
                <span className="t eh-sm">
                  {(() => {
                    const stage = (member.dormancyStage ??
                      "active") as DormancyStage;
                    const color =
                      stage === "active"
                        ? "green"
                        : stage === "at_risk"
                          ? "gold"
                          : "red";
                    return (
                      <Pill color={color as "green" | "gold" | "red"}>
                        {DORMANCY_LABEL[stage]}
                      </Pill>
                    );
                  })()}
                </span>
              </div>
            </div>
            <div className="eh-row eh-mt">
              {member.renewalAt &&
                renewalStage(new Date(member.renewalAt), new Date()) !==
                  "none" && (
                  <button
                    className="eh-btn ghost sm"
                    onClick={() => setConfirm({ type: "renew" })}
                  >
                    Renew +1 year
                  </button>
                )}
              {member.status === "active" && (
                <button
                  className="eh-btn ghost sm"
                  onClick={() => setConfirm({ type: "pause" })}
                >
                  Pause
                </button>
              )}
              {member.status !== "cancelled" && (
                <button
                  className="eh-btn ghost sm"
                  style={{ color: "var(--eh-red)", borderColor: "#e5c0b9" }}
                  onClick={() => setConfirm({ type: "cancel" })}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="eh-card">
            <h3>Change tier</h3>
            <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
              Request a change and the eHive Circle team reviews it — tiers move
              once approved.
            </p>
            {pendingReq.data && (
              <div className="eh-banner eh-mb">
                <span className="eh-sm">
                  <b>
                    {pendingReq.data.type === "upgrade"
                      ? "Upgrade"
                      : "Downgrade"}{" "}
                    to{" "}
                    {TIER_LABEL[pendingReq.data.toTier as never] ??
                      pendingReq.data.toTier}
                  </b>{" "}
                  is awaiting management approval.
                </span>
              </div>
            )}
            <div className="eh-list">
              {TIERS.map(t => {
                const isCurrent = t === member.tier;
                const isUp = tierRank(t) > tierRank(member.tier);
                const blocked = !!pendingReq.data;
                return (
                  <div className="row" key={t}>
                    <div>
                      <div className="t">
                        {TIER_LABEL[t]}{" "}
                        {isCurrent && <Pill color="green">current</Pill>}
                      </div>
                      <div className="d eh-num">{TIER_PRICE[t]}</div>
                    </div>
                    {!isCurrent && member.status === "active" && (
                      <button
                        className={"eh-btn sm" + (isUp ? " gold" : " ghost")}
                        disabled={blocked}
                        title={
                          blocked
                            ? "You already have a tier change pending approval."
                            : undefined
                        }
                        onClick={() =>
                          setConfirm({
                            type: isUp ? "upgrade" : "downgrade",
                            toTier: t,
                          })
                        }
                      >
                        {isUp ? "Request upgrade" : "Request downgrade"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Your profile</h3>
            <form onSubmit={onSaveProfile}>
              <Field label="Company">
                <input
                  className="eh-input"
                  type="text"
                  autoComplete="organization"
                  value={form.company}
                  onChange={e => setForm({ ...form, company: e.target.value })}
                />
              </Field>
              <Field label="Your title">
                <input
                  className="eh-input"
                  type="text"
                  autoComplete="organization-title"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                />
              </Field>
              <Field label="Phone (only the Circle team sees this)">
                <input
                  className="eh-input"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value })}
                />
              </Field>
              <div className="eh-eyebrow" style={{ margin: ".3rem 0 .1rem" }}>
                POD profile · helps us match you
              </div>
              <div className="eh-grid g2">
                <Field label="Sector">
                  <input
                    className="eh-input"
                    value={form.sector}
                    onChange={e => setForm({ ...form, sector: e.target.value })}
                    placeholder="e.g. FinTech"
                  />
                </Field>
                <Field label="Business stage">
                  <input
                    className="eh-input"
                    value={form.stage}
                    onChange={e => setForm({ ...form, stage: e.target.value })}
                    placeholder="e.g. Scaling"
                  />
                </Field>
              </div>
              <Field label="Your goals for a POD">
                <input
                  className="eh-input"
                  value={form.goals}
                  onChange={e => setForm({ ...form, goals: e.target.value })}
                  placeholder="What you want from a peer group"
                />
              </Field>
              <button
                className="eh-btn"
                type="submit"
                disabled={updateProfile.isPending}
              >
                Save profile
              </button>
            </form>
            <hr className="eh-divider" />
            <div className="eh-eyebrow" style={{ marginBottom: ".3rem" }}>
              Name or email correction
            </div>
            <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
              Your name and email are identity details — request a correction
              and the Circle team (or your chapter lead) will review it.
            </p>
            {(myReqs.data ?? [])
              .filter(r => r.category === "profile" && r.status === "pending")
              .map(r => (
                <div
                  className="row"
                  key={r.id}
                  style={{ alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="d">
                      {r.changes.map(c => `${c.label} → ${c.to}`).join("; ")}
                    </div>
                  </div>
                  <Pill color="gold">pending</Pill>
                </div>
              ))}
            <button
              className="eh-btn ghost sm"
              style={{ marginTop: ".4rem" }}
              onClick={() =>
                setCorr({
                  name: me.data?.user?.name ?? "",
                  email: me.data?.user?.email ?? "",
                  note: "",
                })
              }
            >
              Request a correction →
            </button>
          </div>

          <KycCard />

          <PushSettings />

          <TwoFactorSettings />

          {(myActions.data ?? []).length > 0 && (
            <div className="eh-card eh-mb">
              <h3>Conduct actions & appeals</h3>
              <p className="eh-muted eh-sm">
                If an action has been taken about your conduct, you can appeal
                it. Appeals are reviewed independently, one level above the
                original decision.
              </p>
              <div className="eh-list eh-mt">
                {myActions.data!.map(a => (
                  <div
                    className="row"
                    key={a.id}
                    style={{
                      alignItems: "flex-start",
                      flexDirection: "column",
                      gap: ".5rem",
                    }}
                  >
                    <div style={{ width: "100%" }}>
                      <div className="t">{a.summary}</div>
                      {a.resolution && <div className="d">{a.resolution}</div>}
                      {a.appealStatus !== "none" && (
                        <Pill
                          color={
                            a.appealStatus === "open"
                              ? "gold"
                              : a.appealStatus === "reversed"
                                ? "green"
                                : a.appealStatus === "reduced"
                                  ? "blue"
                                  : "grey"
                          }
                        >
                          Appeal {a.appealStatus}
                        </Pill>
                      )}
                    </div>
                    {a.appealStatus === "none" && appealFor !== a.id && (
                      <button
                        className="eh-btn ghost sm"
                        onClick={() => setAppealFor(a.id)}
                      >
                        Appeal this
                      </button>
                    )}
                    {a.appealStatus === "none" && appealFor === a.id && (
                      <div style={{ width: "100%" }}>
                        <textarea
                          className="eh-input"
                          rows={3}
                          style={{ width: "100%", resize: "vertical" }}
                          placeholder="Why should this be reconsidered? (min 10 characters)"
                          value={appealText}
                          onChange={e => setAppealText(e.target.value)}
                        />
                        <div
                          className="eh-row"
                          style={{ gap: ".4rem", marginTop: ".4rem" }}
                        >
                          <button
                            className="eh-btn gold sm"
                            disabled={
                              appeal.isPending || appealText.trim().length < 10
                            }
                            onClick={() =>
                              appeal.mutate({
                                caseId: a.id,
                                reason: appealText,
                              })
                            }
                          >
                            Submit appeal
                          </button>
                          <button
                            className="eh-btn ghost sm"
                            onClick={() => {
                              setAppealFor(null);
                              setAppealText("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="eh-card">
            <h3>Privacy & data (PDPL)</h3>
            <div className="eh-list">
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div className="t">Member directory</div>
                  <div className="d">
                    Other members can find you for 1-2-1s and mentoring
                  </div>
                </div>
                <button
                  className={
                    "eh-btn sm" + (member.directoryVisible ? "" : " gold")
                  }
                  disabled={setVisible.isPending}
                  onClick={() =>
                    setVisible.mutate({ visible: !member.directoryVisible })
                  }
                >
                  {member.directoryVisible
                    ? "Visible — hide me"
                    : "Hidden — show me"}
                </button>
              </div>
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div className="t">Email notifications</div>
                  <div className="d">
                    Get a copy of your portal notifications by email — 1-2-1s,
                    membership, events and more
                  </div>
                </div>
                <button
                  className={"eh-btn sm" + (member.emailNotify ? "" : " gold")}
                  disabled={setEmailNotify.isPending}
                  onClick={() =>
                    setEmailNotify.mutate({ enabled: !member.emailNotify })
                  }
                >
                  {member.emailNotify ? "On — turn off" : "Off — turn on"}
                </button>
              </div>
            </div>
            <hr className="eh-divider" />
            <p className="eh-muted eh-sm">
              Under the UAE PDPL you can request an export or deletion of your
              personal data at any time.
            </p>
            <div className="eh-row">
              <button
                className="eh-btn ghost sm"
                disabled={requestData.isPending}
                onClick={() => requestData.mutate({ kind: "export" })}
              >
                Request data export
              </button>
              <button
                className="eh-btn ghost sm"
                style={{ color: "var(--eh-red)", borderColor: "#e5c0b9" }}
                disabled={requestData.isPending}
                onClick={() => requestData.mutate({ kind: "deletion" })}
              >
                Request deletion
              </button>
            </div>
            {(dataReqs.data ?? []).length > 0 && (
              <div className="eh-list eh-mt">
                {dataReqs.data!.map(r => (
                  <div className="row" key={r.id}>
                    <span className="d">{fmtDate(r.createdAt)}</span>
                    <span className="t eh-sm" style={{ flex: 1 }}>
                      Data {r.kind}
                    </span>
                    {r.status === "done" ? (
                      <Pill color="green">completed</Pill>
                    ) : (
                      <Pill color="blue">open</Pill>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {eng.data && (
            <div className="eh-card">
              <h3>Engagement Standard — {TIER_LABEL[member.tier]}</h3>
              <div className="eh-list">
                {eng.data.config?.sessionsRequired != null && (
                  <div className="row">
                    <span className="d">Pod sessions this quarter</span>
                    <span className="t eh-sm eh-num">
                      {eng.data.counts.sessions} /{" "}
                      {Math.max(
                        1,
                        Math.ceil(eng.data.config.sessionsRequired / 4)
                      )}
                      {eng.data.config.sessionsOffered
                        ? ` (of ${eng.data.config.sessionsOffered}/yr offered)`
                        : ""}
                    </span>
                  </div>
                )}
                {eng.data.config?.oneToOnesPerQuarter != null && (
                  <div className="row">
                    <span className="d">Confirmed 1-2-1s this quarter</span>
                    <span className="t eh-sm eh-num">
                      {eng.data.counts.oneToOnes} /{" "}
                      {eng.data.config.oneToOnesPerQuarter}
                    </span>
                  </div>
                )}
                {eng.data.config?.giveBackPerYear != null && (
                  <div className="row">
                    <span className="d">Give-Back sessions this year</span>
                    <span className="t eh-sm eh-num">
                      {eng.data.counts.giveBack} /{" "}
                      {eng.data.config.giveBackPerYear}
                    </span>
                  </div>
                )}
              </div>
              {member.exceptionPause > 0 && (
                <div className="eh-banner eh-mt">
                  <span className="eh-sm">
                    Exception pause active — your engagement review is paused (
                    {member.exceptionPause} quarter
                    {member.exceptionPause > 1 ? "s" : ""} left).
                  </span>
                </div>
              )}
              {eng.data.log.length > 0 && (
                <>
                  <hr className="eh-divider" />
                  <div className="eh-timeline">
                    {eng.data.log.map(l => (
                      <div className="ev" key={l.id}>
                        <div className="w">{fmtDate(l.createdAt)}</div>
                        <div className="x">
                          {DORMANCY_LABEL[l.fromStage as DormancyStage] ??
                            l.fromStage}{" "}
                          →{" "}
                          {DORMANCY_LABEL[l.toStage as DormancyStage] ??
                            l.toStage}
                        </div>
                        {l.reason && (
                          <div className="n">
                            {l.reason}
                            {l.actor !== "system" ? ` (by ${l.actor})` : ""}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="eh-card">
          <h3>Membership history</h3>
          {!hist.data?.length && <Empty big="No events yet." />}
          <div className="eh-timeline">
            {hist.data?.map(h => (
              <div className="ev" key={h.id}>
                <div className="w">{fmtDate(h.createdAt)}</div>
                <div className="x">
                  {h.type.charAt(0).toUpperCase() + h.type.slice(1)}
                  {h.toTier && h.toTier !== h.fromTier
                    ? ` → ${TIER_LABEL[h.toTier as never] ?? h.toTier}`
                    : ""}{" "}
                  {h.status === "pending" && (
                    <Pill color="gold">pending approval</Pill>
                  )}
                  {h.status === "rejected" && <Pill color="red">rejected</Pill>}
                </div>
                {h.note && <div className="n">{h.note}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirm && (
        <Modal
          title={CONFIRM_COPY[confirm.type].title}
          onClose={() => setConfirm(null)}
        >
          <p className="eh-sm eh-muted">{CONFIRM_COPY[confirm.type].body}</p>
          <Field label="A note for the team (optional)">
            <input
              className="eh-input"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={500}
              placeholder="Context helps us help you."
            />
          </Field>
          <div className="eh-row">
            <button
              className={
                "eh-btn" +
                (CONFIRM_COPY[confirm.type].danger ? " danger" : " gold")
              }
              disabled={
                confirm.type === "renew" ? renew.isPending : change.isPending
              }
              onClick={() => {
                if (confirm.type === "renew") {
                  renew.mutate();
                } else {
                  change.mutate({
                    type: confirm.type,
                    toTier: confirm.toTier as never,
                    note: note || undefined,
                  });
                }
              }}
            >
              {CONFIRM_COPY[confirm.type].cta}
            </button>
            <button className="eh-btn ghost" onClick={() => setConfirm(null)}>
              Keep as is
            </button>
          </div>
        </Modal>
      )}

      {corr && (
        <Modal
          title="Request a name / email correction"
          onClose={() => setCorr(null)}
        >
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            Tell us what it should be. Nothing changes until the team approves.
          </p>
          <Field label="Full name">
            <input
              className="eh-input"
              value={corr.name}
              onChange={e => setCorr({ ...corr, name: e.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="eh-input"
              type="email"
              value={corr.email}
              onChange={e => setCorr({ ...corr, email: e.target.value })}
            />
          </Field>
          <Field label="Why (optional)">
            <input
              className="eh-input"
              value={corr.note}
              onChange={e => setCorr({ ...corr, note: e.target.value })}
              placeholder="e.g. Legal name change / typo at sign-up"
            />
          </Field>
          <button
            className="eh-btn gold"
            disabled={requestCorrection.isPending}
            onClick={() =>
              requestCorrection.mutate({
                name: corr.name || undefined,
                email: corr.email || undefined,
                note: corr.note || undefined,
              })
            }
          >
            {requestCorrection.isPending ? "Submitting…" : "Submit request"}
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
