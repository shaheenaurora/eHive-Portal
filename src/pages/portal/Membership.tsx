import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, StatusPill, TierPill, Spinner, Modal, Field, Empty, toast } from "@/components/eh";
import { PushSettings } from "@/components/PushSettings";
import { TwoFactorSettings } from "@/components/TwoFactorSettings";
import { fmtDate } from "@/lib/ehf";
import { TIERS, TIER_LABEL, TIER_PRICE, tierRank, DORMANCY_LABEL } from "@contracts/constants";
import type { DormancyStage } from "@contracts/constants";

export default function Membership() {
  const utils = trpc.useUtils();
  const me = trpc.circle.me.useQuery(undefined, { retry: false });
  const hist = trpc.circle.membershipHistory.useQuery(undefined, { retry: false, enabled: !!me.data?.member });
  const eng = trpc.engage.myEngagement.useQuery(undefined, { retry: false, enabled: !!me.data?.member });
  const dataReqs = trpc.engage.myDataRequests.useQuery(undefined, { retry: false, enabled: !!me.data?.member });

  const updateProfile = trpc.circle.updateProfile.useMutation({
    onSuccess: () => { toast("Profile saved."); utils.circle.me.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const setVisible = trpc.engage.setDirectoryVisible.useMutation({
    onSuccess: () => { toast("Directory preference saved."); utils.circle.me.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const requestData = trpc.engage.requestData.useMutation({
    onSuccess: () => { toast("Request received — the team processes it within 30 days."); utils.engage.myDataRequests.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const change = trpc.circle.requestMembershipChange.useMutation({
    onSuccess: () => {
      toast("Done — your membership is updated.");
      utils.circle.me.invalidate();
      utils.circle.membershipHistory.invalidate();
      setConfirm(null);
    },
    onError: (e) => toast(e.message),
  });

  const [confirm, setConfirm] = useState<{ type: "upgrade" | "downgrade" | "pause" | "cancel" | "renew"; toTier?: string } | null>(null);
  const [note, setNote] = useState("");

  const member = me.data?.member;
  /* Profile form is seeded from the member record and becomes locally editable
     once the member types — derived here rather than synced via effect. */
  const serverForm = useMemo(
    () => ({ company: member?.company ?? "", title: member?.title ?? "", phone: member?.phone ?? "" }),
    [member],
  );
  const [edited, setEdited] = useState<{ company: string; title: string; phone: string } | null>(null);
  const form = edited ?? serverForm;
  const setForm = setEdited;

  if (me.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif><Spinner /></EhShell>;
  if (!member) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif><Empty big="No membership yet." /></EhShell>;

  function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    updateProfile.mutate({
      company: form.company || undefined,
      title: form.title || undefined,
      phone: form.phone || undefined,
    });
  }

  const CONFIRM_COPY: Record<string, { title: string; body: string; cta: string; danger?: boolean }> = {
    upgrade: { title: "Upgrade tier", body: "Your tier changes immediately — new events, library items and programme gates unlock now. Billing is adjusted pro-rata by the team.", cta: "Upgrade now →" },
    downgrade: { title: "Downgrade tier", body: "Your tier changes at once. Tier-gated events and library items above the new tier close.", cta: "Downgrade" },
    pause: { title: "Pause membership", body: "Your seat in every pod is held for 90 days. Billing pauses; the Hive Score freezes. Resume any time from this page.", cta: "Pause membership" },
    cancel: { title: "Cancel membership", body: "This ends your membership. Pod seats are released and portal access closes at month end. This is reversible only by reapplying.", cta: "Cancel membership", danger: true },
    renew: { title: "Renew for another year", body: "Extends your renewal date by 12 months at your current tier.", cta: "Renew →" },
  };

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead eyebrow="Membership" title="Your membership"
                sub="Tier, status, renewal and your profile — everything in one place, no emails required." />

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Current plan</h3>
              <StatusPill status={member.status} />
            </div>
            <div style={{ textAlign: "center", padding: "1rem 0 .4rem" }}>
              <TierPill tier={member.tier} />
              <div className="eh-serif" style={{ fontSize: "1.7rem", marginTop: ".5rem" }}>{TIER_LABEL[member.tier]}</div>
              <div className="eh-muted eh-sm eh-num">{TIER_PRICE[member.tier]}</div>
              <div className="eh-mt">
                <Pill color="gold">✓ verified {TIER_LABEL[member.tier]} badge</Pill>
                {member.inductionNo ? <Pill color="purple">induction №{member.inductionNo}</Pill> : null}
              </div>
            </div>
            <hr className="eh-divider" />
            <div className="eh-list">
              <div className="row"><span className="d">Member since</span><span className="t eh-sm">{fmtDate(member.joinedAt)}</span></div>
              <div className="row"><span className="d">Renews</span><span className="t eh-sm">{fmtDate(member.renewalAt)}</span></div>
              <div className="row">
                <span className="d">Engagement</span>
                <span className="t eh-sm">
                  {(() => {
                    const stage = (member.dormancyStage ?? "active") as DormancyStage;
                    const color = stage === "active" ? "green" : stage === "at_risk" ? "gold" : "red";
                    return <Pill color={color as "green" | "gold" | "red"}>{DORMANCY_LABEL[stage]}</Pill>;
                  })()}
                </span>
              </div>
            </div>
            <div className="eh-row eh-mt">
              <button className="eh-btn ghost sm" onClick={() => setConfirm({ type: "renew" })}>Renew +1 year</button>
              {member.status === "active" && (
                <button className="eh-btn ghost sm" onClick={() => setConfirm({ type: "pause" })}>Pause</button>
              )}
              {member.status !== "cancelled" && (
                <button className="eh-btn ghost sm" style={{ color: "var(--eh-red)", borderColor: "#e5c0b9" }}
                        onClick={() => setConfirm({ type: "cancel" })}>Cancel</button>
              )}
            </div>
          </div>

          <div className="eh-card">
            <h3>Change tier</h3>
            <div className="eh-list">
              {TIERS.map((t) => {
                const isCurrent = t === member.tier;
                const isUp = tierRank(t) > tierRank(member.tier);
                return (
                  <div className="row" key={t}>
                    <div>
                      <div className="t">{TIER_LABEL[t]} {isCurrent && <Pill color="green">current</Pill>}</div>
                      <div className="d eh-num">{TIER_PRICE[t]}</div>
                    </div>
                    {!isCurrent && member.status === "active" && (
                      <button className={"eh-btn sm" + (isUp ? " gold" : " ghost")}
                              onClick={() => setConfirm({ type: isUp ? "upgrade" : "downgrade", toTier: t })}>
                        {isUp ? "Upgrade" : "Downgrade"}
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
                <input className="eh-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </Field>
              <Field label="Your title">
                <input className="eh-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Phone (only the Circle team sees this)">
                <input className="eh-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <button className="eh-btn" type="submit" disabled={updateProfile.isPending}>Save profile</button>
            </form>
          </div>

          <PushSettings />

          <TwoFactorSettings />

          <div className="eh-card">
            <h3>Privacy & data (PDPL)</h3>
            <div className="eh-list">
              <div className="row">
                <div style={{ flex: 1 }}>
                  <div className="t">Member directory</div>
                  <div className="d">Other members can find you for 1-2-1s and mentoring</div>
                </div>
                <button className={"eh-btn sm" + (member.directoryVisible ? "" : " gold")}
                        disabled={setVisible.isPending}
                        onClick={() => setVisible.mutate({ visible: !member.directoryVisible })}>
                  {member.directoryVisible ? "Visible — hide me" : "Hidden — show me"}
                </button>
              </div>
            </div>
            <hr className="eh-divider" />
            <p className="eh-muted eh-sm">
              Under the UAE PDPL you can request an export or deletion of your personal data at any time.
            </p>
            <div className="eh-row">
              <button className="eh-btn ghost sm" disabled={requestData.isPending}
                      onClick={() => requestData.mutate({ kind: "export" })}>Request data export</button>
              <button className="eh-btn ghost sm" style={{ color: "var(--eh-red)", borderColor: "#e5c0b9" }}
                      disabled={requestData.isPending}
                      onClick={() => requestData.mutate({ kind: "deletion" })}>Request deletion</button>
            </div>
            {(dataReqs.data ?? []).length > 0 && (
              <div className="eh-list eh-mt">
                {dataReqs.data!.map((r) => (
                  <div className="row" key={r.id}>
                    <span className="d">{fmtDate(r.createdAt)}</span>
                    <span className="t eh-sm" style={{ flex: 1 }}>Data {r.kind}</span>
                    {r.status === "done" ? <Pill color="green">completed</Pill> : <Pill color="blue">open</Pill>}
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
                      {eng.data.counts.sessions} / {Math.max(1, Math.ceil(eng.data.config.sessionsRequired / 4))}
                      {eng.data.config.sessionsOffered ? ` (of ${eng.data.config.sessionsOffered}/yr offered)` : ""}
                    </span>
                  </div>
                )}
                {eng.data.config?.oneToOnesPerQuarter != null && (
                  <div className="row">
                    <span className="d">Confirmed 1-2-1s this quarter</span>
                    <span className="t eh-sm eh-num">{eng.data.counts.oneToOnes} / {eng.data.config.oneToOnesPerQuarter}</span>
                  </div>
                )}
                {eng.data.config?.giveBackPerYear != null && (
                  <div className="row">
                    <span className="d">Give-Back sessions this year</span>
                    <span className="t eh-sm eh-num">{eng.data.counts.giveBack} / {eng.data.config.giveBackPerYear}</span>
                  </div>
                )}
              </div>
              {member.exceptionPause > 0 && (
                <div className="eh-banner eh-mt"><span className="eh-sm">Exception pause active — your engagement review is paused ({member.exceptionPause} quarter{member.exceptionPause > 1 ? "s" : ""} left).</span></div>
              )}
              {eng.data.log.length > 0 && (
                <>
                  <hr className="eh-divider" />
                  <div className="eh-timeline">
                    {eng.data.log.map((l) => (
                      <div className="ev" key={l.id}>
                        <div className="w">{fmtDate(l.createdAt)}</div>
                        <div className="x">{DORMANCY_LABEL[l.fromStage as DormancyStage] ?? l.fromStage} → {DORMANCY_LABEL[l.toStage as DormancyStage] ?? l.toStage}</div>
                        {l.reason && <div className="n">{l.reason}{l.actor !== "system" ? ` (by ${l.actor})` : ""}</div>}
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
            {hist.data?.map((h) => (
              <div className="ev" key={h.id}>
                <div className="w">{fmtDate(h.createdAt)}</div>
                <div className="x">
                  {h.type.charAt(0).toUpperCase() + h.type.slice(1)}
                  {h.toTier && h.toTier !== h.fromTier ? ` → ${TIER_LABEL[h.toTier as never] ?? h.toTier}` : ""}
                </div>
                {h.note && <div className="n">{h.note}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {confirm && (
        <Modal title={CONFIRM_COPY[confirm.type].title} onClose={() => setConfirm(null)}>
          <p className="eh-sm eh-muted">{CONFIRM_COPY[confirm.type].body}</p>
          <Field label="A note for the team (optional)">
            <input className="eh-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                   placeholder="Context helps us help you." />
          </Field>
          <div className="eh-row">
            <button className={"eh-btn" + (CONFIRM_COPY[confirm.type].danger ? " danger" : " gold")}
                    disabled={change.isPending}
                    onClick={() => change.mutate({ type: confirm.type, toTier: confirm.toTier as never, note: note || undefined })}>
              {CONFIRM_COPY[confirm.type].cta}
            </button>
            <button className="eh-btn ghost" onClick={() => setConfirm(null)}>Keep as is</button>
          </div>
        </Modal>
      )}
    </EhShell>
  );
}
