import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Field, Pill, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import {
  KYC_ID_TYPES,
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

/** Member-facing identity verification (KYC): submit ID details and see status. */
export function KycCard() {
  const utils = trpc.useUtils();
  const q = trpc.circle.myKyc.useQuery(undefined, { retry: false });
  const kyc = q.data;
  const status = kyc?.status ?? "not_submitted";

  const [editing, setEditing] = useState(false);
  const [idType, setIdType] = useState<string>("emirates_id");
  const [idNumber, setIdNumber] = useState("");
  const [nationality, setNationality] = useState("");
  const [idExpiry, setIdExpiry] = useState("");

  const submit = trpc.circle.submitKyc.useMutation({
    onSuccess: () => {
      toast("Identity details submitted for review.");
      setEditing(false);
      setIdNumber("");
      utils.circle.myKyc.invalidate();
    },
    onError: e => toast(e.message),
  });

  const showForm = editing || status === "not_submitted";

  return (
    <div className="eh-card eh-mb">
      <div className="eh-between" style={{ flexWrap: "wrap", gap: ".6rem" }}>
        <div>
          <h3 style={{ margin: 0 }}>Identity verification (KYC)</h3>
          <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
            Verify your identity for compliance. Your ID number is stored
            securely and only the last digits are ever shown back.
          </p>
        </div>
        <Pill color={STATUS_COLOR[status]}>{KYC_STATUS_LABEL[status]}</Pill>
      </div>

      {kyc && kyc.status !== "not_submitted" && !editing && (
        <div className="eh-list" style={{ marginTop: ".8rem" }}>
          <div className="row">
            <div style={{ flex: 1 }}>
              <div className="t">
                {kyc.idType ? KYC_ID_TYPE_LABEL[kyc.idType] : "ID"} ·{" "}
                {maskIdNumber(kyc.idNumber)}
              </div>
              <div className="d eh-muted">
                {kyc.nationality ? `${kyc.nationality} · ` : ""}
                {kyc.idExpiry ? `expires ${fmtDate(kyc.idExpiry)} · ` : ""}
                {kyc.submittedAt ? `submitted ${fmtDate(kyc.submittedAt)}` : ""}
              </div>
              {kyc.status === "rejected" && kyc.reviewNote && (
                <div
                  className="d"
                  style={{ color: "var(--eh-red)", marginTop: ".2rem" }}
                >
                  Needs attention: {kyc.reviewNote}
                </div>
              )}
            </div>
            {kyc.status !== "verified" && (
              <button
                className="eh-btn ghost sm"
                onClick={() => setEditing(true)}
              >
                Update
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ marginTop: ".8rem" }}>
          <div className="eh-grid g2">
            <Field label="ID type">
              <select
                className="eh-select"
                value={idType}
                onChange={e => setIdType(e.target.value)}
              >
                {KYC_ID_TYPES.map(t => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ID number">
              <input
                className="eh-input"
                value={idNumber}
                onChange={e => setIdNumber(e.target.value)}
                placeholder="e.g. 784-XXXX-XXXXXXX-X"
              />
            </Field>
          </div>
          <div className="eh-grid g2">
            <Field label="Nationality (optional)">
              <input
                className="eh-input"
                value={nationality}
                onChange={e => setNationality(e.target.value)}
              />
            </Field>
            <Field label="ID expiry (optional)">
              <input
                className="eh-input"
                type="date"
                value={idExpiry}
                onChange={e => setIdExpiry(e.target.value)}
              />
            </Field>
          </div>
          <div className="eh-row" style={{ gap: ".5rem" }}>
            <button
              className="eh-btn gold sm"
              disabled={submit.isPending || idNumber.trim().length < 3}
              onClick={() =>
                submit.mutate({
                  idType: idType as never,
                  idNumber: idNumber.trim(),
                  nationality: nationality.trim() || undefined,
                  idExpiry: idExpiry || undefined,
                })
              }
            >
              {submit.isPending ? "Submitting…" : "Submit for verification"}
            </button>
            {editing && (
              <button
                className="eh-btn ghost sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
