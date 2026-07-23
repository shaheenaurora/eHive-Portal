import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, StatusPill, TierPill, Empty, Spinner } from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";
import { TIERS, MEMBER_STATUSES } from "@contracts/constants";

export default function AdminMembers() {
  const [q2, setQ2] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const q = trpc.admin.members.useQuery(
    { q: q2 || undefined, tier: (tier || undefined) as never, status: (status || undefined) as never },
    { retry: false },
  );

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Directory" title="Members"
                sub="Every membership, every tier. Click a row for the 360° view." />

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
          <table className="eh-table">
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
                  <td className="eh-sm">{member.company ?? "—"}</td>
                  <td><TierPill tier={member.tier} /></td>
                  <td><StatusPill status={member.status} /></td>
                  <td className="eh-num"><b>{member.hiveScore}</b></td>
                  <td className="eh-sm eh-muted">{fmtDate(member.joinedAt)}</td>
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
