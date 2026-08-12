import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";
import {
  CONDUCT_STATUSES,
  CONDUCT_STATUS_LABEL,
  CONDUCT_SEVERITIES,
  CONDUCT_SEVERITY_LABEL,
} from "@contracts/constants";
import type { ConductStatus, ConductSeverity } from "@contracts/constants";

type CaseRow = {
  id: number;
  category: string;
  severity: ConductSeverity;
  status: ConductStatus;
  summary: string;
  detail: string | null;
  resolution: string | null;
  reporterMemberId: number | null;
  subjectMemberId: number | null;
  reporterName: string;
  subjectName: string | null;
  createdAt: string | Date;
};

const SEV_COLOR: Record<ConductSeverity, "grey" | "blue" | "gold" | "red"> = {
  low: "grey",
  moderate: "blue",
  high: "gold",
  safeguarding: "red",
};
const STATUS_COLOR: Record<
  ConductStatus,
  "grey" | "blue" | "gold" | "green" | "red"
> = {
  open: "red",
  reviewing: "gold",
  actioned: "green",
  escalated: "red",
  closed: "grey",
};

export default function AdminConduct() {
  const [status, setStatus] = useState<ConductStatus | "">("");
  const q = trpc.conduct.cases.useQuery(
    { status: (status || undefined) as never },
    { retry: false }
  );
  const [sel, setSel] = useState<CaseRow | null>(null);
  const appeals = trpc.conduct.appeals.useQuery(undefined, { retry: false });
  const decideAppeal = trpc.conduct.decideAppeal.useMutation({
    onSuccess: () => {
      toast("Appeal decided.");
      appeals.refetch();
      q.refetch();
    },
    onError: e => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Standards & safeguarding"
        title="Conduct & Safeguarding"
        sub="Confidential incident reports and the case process (XC-04). Reports come from members; only Conduct & Safeguarding admins can see and act on them."
      />

      {(appeals.data?.length ?? 0) > 0 && (
        <div
          className="eh-card eh-mb"
          style={{ borderColor: "#e8d5ac", background: "#fdfaf3" }}
        >
          <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
            Appeals awaiting review (MOD-04) · must not be the original decider
          </div>
          <div className="eh-list">
            {(appeals.data ?? []).map(a => (
              <div
                className="row"
                key={a.id}
                style={{ alignItems: "flex-start" }}
              >
                <div style={{ flex: 1 }}>
                  <b>{a.summary}</b>{" "}
                  <span className="eh-muted eh-sm">
                    · {a.subjectName ?? "member"}
                  </span>
                  <div className="d">Appeal: {a.appealReason}</div>
                </div>
                <span className="eh-row" style={{ gap: ".3rem" }}>
                  <button
                    className="eh-btn ghost sm"
                    disabled={decideAppeal.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Uphold the original decision?",
                          body: "The member is told the decision stands.",
                          confirmLabel: "Uphold",
                        })
                      )
                        decideAppeal.mutate({
                          caseId: a.id,
                          outcome: "upheld",
                        });
                    }}
                  >
                    Uphold
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    disabled={decideAppeal.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Reduce the action?",
                          confirmLabel: "Reduce",
                        })
                      )
                        decideAppeal.mutate({
                          caseId: a.id,
                          outcome: "reduced",
                        });
                    }}
                  >
                    Reduce
                  </button>
                  <button
                    className="eh-btn gold sm"
                    disabled={decideAppeal.isPending}
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: "Reverse the action?",
                          body: "This reopens the case for the original team to unwind the action.",
                          confirmLabel: "Reverse",
                          danger: true,
                        })
                      )
                        decideAppeal.mutate({
                          caseId: a.id,
                          outcome: "reversed",
                        });
                    }}
                  >
                    Reverse
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="eh-tabs">
        <button
          className={status === "" ? "on" : ""}
          onClick={() => setStatus("")}
        >
          All
        </button>
        {CONDUCT_STATUSES.map(s => (
          <button
            key={s}
            className={status === s ? "on" : ""}
            onClick={() => setStatus(s)}
          >
            {CONDUCT_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.isError && (
        <div className="eh-card">
          <Empty
            big="Couldn't load cases."
            p="You may not have the Conduct & Safeguarding capability."
          >
            <button className="eh-btn ghost" onClick={() => q.refetch()}>
              Retry
            </button>
          </Empty>
        </div>
      )}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No cases here."
            p="Confidential reports from members appear here the moment they're raised."
          />
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Summary</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Subject</th>
                <th>Raised</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(q.data as CaseRow[]).map(c => (
                <tr key={c.id} className="click" onClick={() => setSel(c)}>
                  <td>
                    <b>{c.summary}</b>
                  </td>
                  <td data-label="Category" className="eh-sm">
                    {c.category}
                  </td>
                  <td data-label="Severity">
                    <Pill color={SEV_COLOR[c.severity]}>
                      {CONDUCT_SEVERITY_LABEL[c.severity]}
                    </Pill>
                  </td>
                  <td data-label="Status">
                    <Pill color={STATUS_COLOR[c.status]}>
                      {CONDUCT_STATUS_LABEL[c.status]}
                    </Pill>
                  </td>
                  <td data-label="Subject" className="eh-sm">
                    {c.subjectName ?? "—"}
                  </td>
                  <td data-label="Raised" className="eh-sm eh-muted">
                    {fmtDateTime(c.createdAt)}
                  </td>
                  <td>
                    <span className="eh-btn ghost sm">Open →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && (
        <CaseDetail
          c={sel}
          onClose={() => setSel(null)}
          onSaved={() => q.refetch()}
        />
      )}
    </EhShell>
  );
}

function CaseDetail({
  c,
  onClose,
  onSaved,
}: {
  c: CaseRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<ConductStatus>(c.status);
  const [severity, setSeverity] = useState<ConductSeverity>(c.severity);
  const [resolution, setResolution] = useState(c.resolution ?? "");

  const update = trpc.conduct.updateCase.useMutation({
    onSuccess: () => {
      toast("Case updated.");
      onSaved();
    },
    onError: e => toast(e.message),
  });
  const act = trpc.conduct.actionMember.useMutation({
    onSuccess: r => {
      toast(`Member set to ${r.lifecycleState}.`);
      onSaved();
      onClose();
    },
    onError: e => toast(e.message),
  });

  return (
    <Modal title={`Case #${c.id}`} onClose={onClose} wide>
      <div className="eh-eyebrow">Report</div>
      <div className="eh-list eh-mb">
        <div className="row">
          <span className="d">Summary</span>
          <span className="t">{c.summary}</span>
        </div>
        <div className="row">
          <span className="d">Category</span>
          <span className="t">{c.category}</span>
        </div>
        <div className="row">
          <span className="d">Reported by</span>
          <span className="t">{c.reporterName}</span>
        </div>
        <div className="row">
          <span className="d">Subject</span>
          <span className="t">{c.subjectName ?? "—"}</span>
        </div>
        {c.detail && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className="d">Detail</span>
            <span
              className="t eh-sm"
              style={{ textAlign: "right", whiteSpace: "pre-wrap" }}
            >
              {c.detail}
            </span>
          </div>
        )}
      </div>

      <div className="eh-eyebrow">Handle the case</div>
      <div className="eh-grid g2 eh-mb" style={{ marginTop: ".4rem" }}>
        <Field label="Status">
          <select
            className="eh-select"
            value={status}
            onChange={e => setStatus(e.target.value as ConductStatus)}
          >
            {CONDUCT_STATUSES.map(s => (
              <option key={s} value={s}>
                {CONDUCT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Severity">
          <select
            className="eh-select"
            value={severity}
            onChange={e => setSeverity(e.target.value as ConductSeverity)}
          >
            {CONDUCT_SEVERITIES.map(s => (
              <option key={s} value={s}>
                {CONDUCT_SEVERITY_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Resolution / process notes">
        <textarea
          className="eh-textarea"
          value={resolution}
          onChange={e => setResolution(e.target.value)}
          placeholder="What was decided, who was consulted, the outcome…"
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={update.isPending}
        onClick={() =>
          update.mutate({ id: c.id, status, severity, resolution })
        }
      >
        {update.isPending ? "Saving…" : "Save case"}
      </button>

      {c.subjectMemberId && (
        <>
          <div className="eh-eyebrow eh-mt">
            Action the member{" "}
            <span className="eh-muted">· {c.subjectName}</span>
          </div>
          <p className="eh-sm eh-muted" style={{ margin: ".3rem 0 .6rem" }}>
            Changes the member's lifecycle state and notifies them
            confidentially. Use with care — every action is written to the audit
            trail.
          </p>
          <div className="eh-row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
            <button
              className="eh-btn sm"
              disabled={act.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Suspend this member?",
                    body: "Access is paused pending review and they're notified. You can reinstate afterwards.",
                    confirmLabel: "Suspend",
                    danger: true,
                  })
                )
                  act.mutate({
                    caseId: c.id,
                    memberId: c.subjectMemberId!,
                    action: "suspend",
                  });
              }}
            >
              Suspend
            </button>
            <button
              className="eh-btn ghost sm"
              disabled={act.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Reinstate this member?",
                    body: "Membership returns to Active and they're notified.",
                    confirmLabel: "Reinstate",
                  })
                )
                  act.mutate({
                    caseId: c.id,
                    memberId: c.subjectMemberId!,
                    action: "reinstate",
                  });
              }}
            >
              Reinstate
            </button>
            <button
              className="eh-btn ghost sm danger"
              disabled={act.isPending}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: "Remove this member from the Circle?",
                    body: "They move to Alumni and membership is cancelled. This is a serious, logged action.",
                    confirmLabel: "Remove from Circle",
                    danger: true,
                  })
                )
                  act.mutate({
                    caseId: c.id,
                    memberId: c.subjectMemberId!,
                    action: "remove",
                  });
              }}
            >
              Remove from Circle
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
