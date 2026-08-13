import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  StatusPill,
  TierPill,
  Empty,
  Spinner,
  RefCode,
  toast,
} from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";
import {
  TIERS,
  MEMBER_STATUSES,
  MEMBER_LIFECYCLE,
  MEMBER_LIFECYCLE_LABEL,
  MEMBER_LIFECYCLE_COLOR,
} from "@contracts/constants";

export default function AdminMembers() {
  const [q2, setQ2] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const utils = trpc.useUtils();
  const q = trpc.admin.members.useQuery(
    {
      q: q2 || undefined,
      tier: (tier || undefined) as never,
      status: (status || undefined) as never,
      lifecycle: lifecycle || undefined,
    },
    { retry: false }
  );
  const counts = trpc.admin.lifecycleCounts.useQuery(undefined, {
    retry: false,
  });
  const requests = trpc.admin.pendingTierRequests.useQuery(undefined, {
    retry: false,
  });
  const decide = trpc.admin.decideTierRequest.useMutation({
    onSuccess: (_r, v) => {
      toast(
        v.decision === "approve"
          ? "Approved — the member's tier has been updated."
          : "Request rejected."
      );
      utils.admin.pendingTierRequests.invalidate();
      utils.admin.members.invalidate();
    },
    onError: e => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Directory"
        title="Members"
        sub="Every membership, every tier. Click a row for the 360° view."
      />

      {/* Member Lifecycle — the CRM state machine (M1). Click a stage to filter. */}
      <div className="eh-card eh-mb">
        <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
          Member lifecycle · the CRM pipeline
        </div>
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <button
            className={"eh-btn sm" + (lifecycle === "" ? " gold" : " ghost")}
            onClick={() => setLifecycle("")}
          >
            All
          </button>
          {MEMBER_LIFECYCLE.map(s => (
            <button
              key={s.key}
              className={
                "eh-btn sm" + (lifecycle === s.key ? " gold" : " ghost")
              }
              onClick={() => setLifecycle(lifecycle === s.key ? "" : s.key)}
              title={s.desc}
            >
              {s.label} <b className="eh-num">{counts.data?.[s.key] ?? 0}</b>
            </button>
          ))}
        </div>
      </div>

      {(requests.data ?? []).length > 0 && (
        <div className="eh-card eh-mb">
          <div className="eh-between" style={{ marginBottom: ".6rem" }}>
            <h3 style={{ margin: 0 }}>Tier change requests</h3>
            <Pill color="gold">{requests.data!.length} awaiting approval</Pill>
          </div>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            Members request tier changes — a change takes effect only when you
            approve it.
          </p>
          <div className="eh-list">
            {requests.data!.map(({ req, member, userName, userEmail }) => (
              <div
                className="row"
                key={req.id}
                style={{ alignItems: "flex-start" }}
              >
                <div className="eh-row" style={{ flexWrap: "nowrap", flex: 1 }}>
                  <span className="eh-avatar">{initials(userName)}</span>
                  <div>
                    <div className="t">{userName ?? userEmail ?? "Member"}</div>
                    <div className="d">
                      {req.type === "upgrade" ? "Upgrade" : "Downgrade"}:{" "}
                      <TierPill tier={member.tier} /> →{" "}
                      <TierPill tier={(req.toTier as never) ?? member.tier} />
                    </div>
                    {req.note && (
                      <div className="d" style={{ marginTop: ".2rem" }}>
                        “{req.note}”
                      </div>
                    )}
                    <div className="d eh-muted">{fmtDate(req.createdAt)}</div>
                  </div>
                </div>
                <div className="eh-row">
                  <button
                    className="eh-btn gold sm"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ id: req.id, decision: "approve" })
                    }
                  >
                    Approve
                  </button>
                  <button
                    className="eh-btn ghost sm danger"
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({ id: req.id, decision: "reject" })
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="eh-row eh-mb">
        <input
          className="eh-input"
          style={{ maxWidth: 260 }}
          placeholder="Search name, email, company…"
          value={q2}
          onChange={e => setQ2(e.target.value)}
        />
        <select
          className="eh-select"
          style={{ maxWidth: 160 }}
          value={tier}
          onChange={e => setTier(e.target.value)}
        >
          <option value="">All tiers</option>
          {TIERS.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="eh-select"
          style={{ maxWidth: 160 }}
          value={status}
          onChange={e => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {MEMBER_STATUSES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty big="No members match." />
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Member</th>
                <th>Company</th>
                <th>Tier</th>
                <th>Lifecycle</th>
                <th>Status</th>
                <th>Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map(({ member, userName, userEmail }) => (
                <tr
                  key={member.id}
                  className="click"
                  onClick={() =>
                    (window.location.href = `/admin/members/${member.id}`)
                  }
                >
                  <td>
                    <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                      <span className="eh-avatar">{initials(userName)}</span>
                      <div>
                        <b>{userName ?? "—"}</b>
                        <div className="eh-muted eh-sm">{userEmail}</div>
                        <div
                          style={{ marginTop: ".2rem" }}
                          onClick={e => e.stopPropagation()}
                        >
                          <RefCode type="member" id={member.id} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="eh-sm" data-label="Company">
                    {member.company ?? "—"}
                  </td>
                  <td data-label="Tier">
                    <TierPill tier={member.tier} />
                  </td>
                  <td data-label="Lifecycle">
                    <Pill
                      color={
                        MEMBER_LIFECYCLE_COLOR[member.lifecycleState] ?? "grey"
                      }
                    >
                      {MEMBER_LIFECYCLE_LABEL[member.lifecycleState] ??
                        member.lifecycleState}
                    </Pill>
                  </td>
                  <td data-label="Status">
                    <StatusPill status={member.status} />
                  </td>
                  <td className="eh-num" data-label="Score">
                    <b>{member.hiveScore}</b>
                  </td>
                  <td>
                    <Link
                      className="eh-btn ghost sm"
                      to={`/admin/members/${member.id}`}
                      onClick={e => e.stopPropagation()}
                    >
                      360° →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </EhShell>
  );
}
