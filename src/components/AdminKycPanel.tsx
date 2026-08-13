import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Pill, toast, confirmDialog } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import {
  KYC_ID_TYPE_LABEL,
  KYC_STATUS_LABEL,
  maskIdNumber,
} from "@contracts/constants";

const STATUS_COLOR: Record<string, "grey" | "gold" | "green" | "red"> = {
  not_submitted: "grey",
  submitted: "gold",
  verified: "green",
  rejected: "red",
};

/** Admin review of a member's KYC — verify or reject a submission. */
export function AdminKycPanel({ memberId }: { memberId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.admin.memberKyc.useQuery({ memberId }, { retry: false });
  const kyc = q.data;
  const [note, setNote] = useState("");
  const review = trpc.admin.reviewKyc.useMutation({
    onSuccess: () => {
      toast("KYC updated.");
      utils.admin.memberKyc.invalidate({ memberId });
      setNote("");
    },
    onError: e => toast(e.message),
  });
  const status = kyc?.status ?? "not_submitted";

  return (
    <div className="eh-card">
      <div className="eh-between">
        <h3 style={{ margin: 0 }}>Identity (KYC)</h3>
        <Pill color={STATUS_COLOR[status]}>{KYC_STATUS_LABEL[status]}</Pill>
      </div>
      {!kyc || kyc.status === "not_submitted" ? (
        <p className="eh-sm eh-muted" style={{ marginBottom: 0 }}>
          The member hasn't submitted identity details yet.
        </p>
      ) : (
        <>
          <div className="eh-sm" style={{ margin: ".5rem 0" }}>
            <div>
              <b>{kyc.idType ? KYC_ID_TYPE_LABEL[kyc.idType] : "ID"}</b> ·{" "}
              {maskIdNumber(kyc.idNumber)}
            </div>
            <div className="eh-muted">
              {kyc.nationality ? `${kyc.nationality} · ` : ""}
              {kyc.idExpiry ? `expires ${fmtDate(kyc.idExpiry)} · ` : ""}
              {kyc.submittedAt ? `submitted ${fmtDate(kyc.submittedAt)}` : ""}
            </div>
            {kyc.reviewNote && (
              <div className="eh-muted" style={{ marginTop: ".2rem" }}>
                Note: {kyc.reviewNote}
              </div>
            )}
          </div>
          {kyc.status === "submitted" && (
            <>
              <input
                className="eh-input"
                style={{ marginBottom: ".5rem" }}
                placeholder="Review note (required to reject)"
                value={note}
                onChange={e => setNote(e.target.value)}
              />
              <div className="eh-row" style={{ gap: ".4rem" }}>
                <button
                  className="eh-btn green sm"
                  disabled={review.isPending}
                  onClick={() =>
                    review.mutate({
                      memberId,
                      decision: "verified",
                      note: note || undefined,
                    })
                  }
                >
                  Verify
                </button>
                <button
                  className="eh-btn ghost sm danger"
                  disabled={review.isPending || note.trim().length < 2}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Reject this KYC submission?",
                        body: "The member will be asked to re-submit.",
                        confirmLabel: "Reject",
                      })
                    )
                      review.mutate({ memberId, decision: "rejected", note });
                  }}
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
