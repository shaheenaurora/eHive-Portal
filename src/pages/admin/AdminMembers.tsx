import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, StatusPill, TierPill, Empty, Spinner, toast } from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";
import { TIERS, MEMBER_STATUSES } from "@contracts/constants";

export default function AdminMembers() {
  const [q2, setQ2] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const utils = trpc.useUtils();
  const q = trpc.admin.members.useQuery(
    { q: q2 || undefined, tier: (tier || undefined) as never, status: (status || undefined) as never },
    { retry: false },
  );
  const requests = trpc.admin.pendingTierRequests.useQuery(undefined, { retry: false });
  const decide = trpc.admin.decideTierRequest.useMutation({
    onSuccess: (_r, v) => {
      toast(v.decision === "approve" ? "Approved — the member's tier has been updated." : "Request rejected.");
      utils.admin.pendingTierRequests.invalidate();
      utils.admin.members.invalidate();
    },
    onError: (e) => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Directory" title="Members"
                sub="Every membership, every tier. Click a row for the 360° view." />

      {(requests.data ?? []).length > 0 && (
        <div className="eh-card eh-mb">
          <div className="eh-between" style={{ marginBottom: ".6rem" }}>
            <h3 style={{ margin: 0 }}>Tier change requests</h3>
            <Pill color="gold">{requests.data!.length} awaiting approval</Pill>
          </div>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            Members request tier changes — a change takes effect only when you approve it.
          </p>
          <div className="eh-list">
            {requests.data!.map(({ req, member, userName, userEmail }) => (
              <div className="row" key={req.id} style={{ alignItems: "flex-start" }}>
                <div className="eh-row" style={{ flexWrap: "nowrap", flex: 1 }}>
                  <span className="eh-avatar">{initials(userName)}</span>
                  <div>
                    <div className="t">{userName ?? userEmail ?? "Member"}</div>
                    <div className="d">
                      {req.type === "upgrade" ? "Upgrade" : "Downgrade"}:{" "}
                      <TierPill tier={member.tier} /> → <TierPill tier={(req.toTier as never) ?? member.tier} />
                    </div>
                    {req.note && <div className="d" style={{ marginTop: ".2rem" }}>“{req.note}”</div>}
                    <div className="d eh-muted">{fmtDate(req.createdAt)}</div>
                  </div>
                </div>
                <div className="eh-row">
                  <button className="eh-btn gold sm" disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: req.id, decision: "approve" })}>Approve</button>
                  <button className="eh-btn ghost sm danger" disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: req.id, decision: "reject" })}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="eh-row eh-mb">
        <input className="eh-input" style={{ maxWidth: 260 }} placeholder="Search name, email, company…"
               value={q2} onChange={(e) => setQ2(e.target.value)} />
        <select className="eh-select" style={{ maxWidth: 160 }} value={tier} onChange={(e) => setTier(e.target.value)}>
          <option value="">All tiers</option>
          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="eh-select" style={{ maxWidth: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {MEMBER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <div className="eh-card"><Empty big="No members match." /></div>}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr><th>Member</th><th>Company</th><th>Tier</th><th>Status</th><th>Score</th><th>Joined</th><th></th></tr>
            </thead>
            <tbody>
              {q.data.map(({ member, userName, userEmail }) => (
                <tr key={member.id} className="click"
                    onClick={() => (window.location.href = `/admin/members/${member.id}`)}>
                  <td>
                    <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                      <span className="eh-avatar">{initials(userName)}</span>
                      <div><b>{userName ?? "—"}</b><div className="eh-muted eh-sm">{userEmail}</div></div>
                    </div>
                  </td>
                  <td className="eh-sm" data-label="Company">{member.company ?? "—"}</td>
                  <td data-label="Tier"><TierPill tier={member.tier} /></td>
                  <td data-label="Status"><StatusPill status={member.status} /></td>
                  <td className="eh-num" data-label="Score"><b>{member.hiveScore}</b></td>
                  <td className="eh-sm eh-muted" data-label="Joined">{fmtDate(member.joinedAt)}</td>
                  <td><Link className="eh-btn ghost sm" to={`/admin/members/${member.id}`}
                            onClick={(e) => e.stopPropagation()}>360° →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EhShell>
  );
}
