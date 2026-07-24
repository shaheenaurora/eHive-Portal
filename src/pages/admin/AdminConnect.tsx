import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Spinner, Modal, Field, Empty, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { TIER_LABEL } from "@contracts/constants";
import type { Tier } from "@contracts/constants";

type Tab = "buddies" | "referrals" | "deals" | "121";

export default function AdminConnect() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("buddies");
  const buddy = trpc.adminEngage.buddyBoard.useQuery(undefined, { retry: false });
  const refs = trpc.adminEngage.referralsAdmin.useQuery(undefined, { retry: false });
  const deals = trpc.adminEngage.dealsAdmin.useQuery(undefined, { retry: false });
  const oneToOnes = trpc.adminEngage.oneToOnesAdmin.useQuery(undefined, { retry: false });

  const [pairOpen, setPairOpen] = useState(false);
  const [newId, setNewId] = useState(0);
  const [buddyId, setBuddyId] = useState(0);
  const [dealOpen, setDealOpen] = useState(false);

  function refresh() {
    utils.adminEngage.buddyBoard.invalidate();
    utils.adminEngage.referralsAdmin.invalidate();
    utils.adminEngage.dealsAdmin.invalidate();
    utils.adminEngage.oneToOnesAdmin.invalidate();
  }

  const pair = trpc.adminEngage.pairBuddy.useMutation({
    onSuccess: () => { toast("Buddy paired — both members notified."); setPairOpen(false); setNewId(0); setBuddyId(0); refresh(); },
    onError: (e) => toast(e.message),
  });
  const setRefStatus = trpc.adminEngage.setReferralStatus.useMutation({
    onSuccess: () => { toast("Referral updated."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const saveDeal = trpc.adminEngage.saveDeal.useMutation({
    onSuccess: () => { toast("Deal posted as staff."); setDealOpen(false); refresh(); },
    onError: (e) => toast(e.message),
  });
  const delDeal = trpc.adminEngage.deleteDeal.useMutation({
    onSuccess: () => { toast("Deal removed."); refresh(); },
    onError: (e) => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead eyebrow="Connect" title="Buddy, referrals & Deal Flow"
                sub="Pair new members within five days, convert referrals, and moderate the deal board." />

      <div className="eh-tabs">
        <button className={tab === "buddies" ? "on" : ""} onClick={() => setTab("buddies")}>
          Buddies{buddy.data?.unpaired.length ? ` (${buddy.data.unpaired.length} unpaired)` : ""}
        </button>
        <button className={tab === "referrals" ? "on" : ""} onClick={() => setTab("referrals")}>Referrals</button>
        <button className={tab === "deals" ? "on" : ""} onClick={() => setTab("deals")}>Deal Flow</button>
        <button className={tab === "121" ? "on" : ""} onClick={() => setTab("121")}>1-2-1s</button>
      </div>

      {tab === "buddies" && (
        <>
          {(buddy.data?.unpaired.length ?? 0) > 0 && (
            <div className="eh-card eh-mb" style={{ borderColor: "#b8862e" }}>
              <div className="eh-between">
                <h3 style={{ margin: 0 }}>New members awaiting a buddy</h3>
                <button className="eh-btn gold sm" onClick={() => setPairOpen(true)}>Pair now →</button>
              </div>
              <p className="eh-muted eh-sm">BRD rule: every new member is paired within 5 days of joining.</p>
              <div className="eh-list">
                {buddy.data!.unpaired.map((u) => (
                  <div className="row" key={u.id}>
                    <span className="t" style={{ flex: 1 }}>{u.name}</span>
                    <span className="d">joined {fmtDate(u.since)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="eh-card">
            <div className="eh-between">
              <h3 style={{ margin: 0 }}>Pairs</h3>
              <button className="eh-btn ghost sm" onClick={() => setPairOpen(true)}>New pair</button>
            </div>
            {buddy.isLoading && <Spinner />}
            {buddy.data && buddy.data.pairs.length === 0 && <Empty big="No pairs yet." />}
            <div className="eh-list">
              {(buddy.data?.pairs ?? []).map((p) => (
                <div className="row" key={p.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{p.newName} ⇄ {p.buddyName}</div>
                    <div className="d">paired {fmtDate(p.pairedAt)}</div>
                  </div>
                  {p.checkinAt
                    ? <Pill color="green">30-day check-in done</Pill>
                    : <Pill color="blue">check-in pending</Pill>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "referrals" && (
        <div className="eh-card">
          {refs.isLoading && <Spinner />}
          {refs.data && refs.data.length === 0 && <Empty big="No referrals yet." p="Member-submitted referrals land here for review." />}
          <div className="eh-list">
            {(refs.data ?? []).map((r) => (
              <div className="row" key={r.id}>
                <div style={{ flex: 1 }}>
                  <div className="t">{r.prospectName} <span className="eh-muted eh-sm">via {r.memberName}</span></div>
                  <div className="d">{fmtDate(r.createdAt)}{r.prospectContact ? ` · ${r.prospectContact}` : ""}{r.note ? ` — ${r.note}` : ""}</div>
                </div>
                {r.status === "submitted" && (
                  <>
                    <button className="eh-btn sm gold" disabled={setRefStatus.isPending}
                            onClick={() => setRefStatus.mutate({ id: r.id, status: "converted" })}>Mark converted</button>
                    <button className="eh-btn ghost sm" disabled={setRefStatus.isPending}
                            onClick={() => setRefStatus.mutate({ id: r.id, status: "rejected" })}>Not a fit</button>
                  </>
                )}
                {r.status === "converted" && <Pill color="green">converted</Pill>}
                {r.status === "rejected" && <Pill>rejected</Pill>}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "deals" && (
        <>
          <div className="eh-between eh-mb">
            <p className="eh-muted eh-sm" style={{ margin: 0 }}>Staff posts and moderation. Member posts respect the give-to-get rule automatically.</p>
            <button className="eh-btn gold" onClick={() => setDealOpen(true)}>Post as staff →</button>
          </div>
          <div className="eh-grid g2">
            {(deals.data ?? []).map((d) => (
              <div className="eh-card" key={d.id}>
                <div className="eh-between">
                  <Pill>{TIER_LABEL[d.tierGate as Tier]}+</Pill>
                  <span className="eh-muted eh-sm">{fmtDate(d.createdAt)} · {d.postedBy ? `member #${d.postedBy}` : "staff"}</span>
                </div>
                <h3 className="eh-mt">{d.title}</h3>
                <p className="eh-sm eh-muted">{d.description}</p>
                <button className="eh-btn ghost sm" style={{ color: "var(--eh-red)" }} disabled={delDeal.isPending}
                        onClick={() => delDeal.mutate({ id: d.id })}>Remove</button>
              </div>
            ))}
          </div>
          {deals.data && deals.data.length === 0 && <div className="eh-card"><Empty big="Board is empty." /></div>}
        </>
      )}

      {tab === "121" && (
        <div className="eh-card">
          {oneToOnes.isLoading && <Spinner />}
          {oneToOnes.data && oneToOnes.data.length === 0 && <Empty big="No 1-2-1s logged yet." />}
          <div className="eh-list">
            {(oneToOnes.data ?? []).map((r) => (
              <div className="row" key={r.id}>
                <div style={{ flex: 1 }}>
                  <div className="t">{r.kind === "mentoring" ? "Mentoring" : "1-2-1"} — {r.aName} ⇄ {r.bName}</div>
                  <div className="d">{fmtDate(r.createdAt)}{r.note ? ` — ${r.note}` : ""}</div>
                </div>
                {r.status === "confirmed" && <Pill color="green">confirmed</Pill>}
                {r.status === "pending" && <Pill color="blue">pending</Pill>}
                {r.status === "declined" && <Pill>declined</Pill>}
              </div>
            ))}
          </div>
        </div>
      )}

      {pairOpen && (
        <Modal title="Pair a buddy" onClose={() => setPairOpen(false)}>
          <Field label="New member">
            <select className="eh-select" value={newId} onChange={(e) => setNewId(Number(e.target.value))}>
              <option value={0}>Pick…</option>
              {(buddy.data?.unpaired ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              {(buddy.data?.candidates ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Buddy (active member)">
            <select className="eh-select" value={buddyId} onChange={(e) => setBuddyId(Number(e.target.value))}>
              <option value={0}>Pick…</option>
              {(buddy.data?.candidates ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <button className="eh-btn gold" style={{ width: "100%" }} disabled={pair.isPending || !newId || !buddyId || newId === buddyId}
                  onClick={() => pair.mutate({ newMemberId: newId, buddyMemberId: buddyId })}>
            {pair.isPending ? "Pairing…" : "Pair them →"}
          </button>
        </Modal>
      )}

      {dealOpen && (
        <Modal title="Post a deal (staff)" onClose={() => setDealOpen(false)}>
          <StaffDealForm pending={saveDeal.isPending}
                         onSubmit={(title, description, tierGate) => saveDeal.mutate({ title, description, tierGate })} />
        </Modal>
      )}
    </EhShell>
  );
}

function StaffDealForm(props: {
  pending: boolean;
  onSubmit: (title: string, description?: string, tierGate?: "horizon" | "ascent" | "vanguard" | "zenith") => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [gate, setGate] = useState<"horizon" | "ascent" | "vanguard" | "zenith">("ascent");
  return (
    <>
      <Field label="Title">
        <input className="eh-input" value={title} onChange={(e) => setTitle(e.target.value)} minLength={4} />
      </Field>
      <Field label="Details">
        <textarea className="eh-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={4000} />
      </Field>
      <Field label="Visible from tier">
        <select className="eh-select" value={gate} onChange={(e) => setGate(e.target.value as typeof gate)}>
          {(["horizon", "ascent", "vanguard", "zenith"] as const).map((t) => <option key={t} value={t}>{TIER_LABEL[t]}+</option>)}
        </select>
      </Field>
      <button className="eh-btn gold" style={{ width: "100%" }} disabled={props.pending || title.trim().length < 4}
              onClick={() => props.onSubmit(title.trim(), desc || undefined, gate)}>
        {props.pending ? "Posting…" : "Post deal →"}
      </button>
    </>
  );
}
