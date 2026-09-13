import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Empty, Pill, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

const KINDS = ["offer", "advisory", "event", "activation", "other"] as const;
type Kind = (typeof KINDS)[number];

function aed(n: number): string {
  return "AED " + n.toLocaleString("en-US");
}

/** Admin panel to log and review a member's benefit value ("used & saved"),
 *  which feeds the member's B5 value tracker. */
export function AdminValueLedger(props: { memberId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.admin.memberBenefits.useQuery(
    { memberId: props.memberId },
    { retry: false }
  );
  const [form, setForm] = useState<{
    kind: Kind;
    label: string;
    valueSavedAed: string;
  }>({ kind: "offer", label: "", valueSavedAed: "" });

  const log = trpc.admin.logBenefit.useMutation({
    onSuccess: () => {
      toast("Benefit logged");
      setForm({ kind: "offer", label: "", valueSavedAed: "" });
      utils.admin.memberBenefits.invalidate({ memberId: props.memberId });
    },
    onError: e => toast(e.message),
  });
  const del = trpc.admin.deleteBenefit.useMutation({
    onSuccess: () => {
      utils.admin.memberBenefits.invalidate({ memberId: props.memberId });
    },
    onError: e => toast(e.message),
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.totalSavedAed ?? 0;
  const canSubmit = form.label.trim().length >= 2 && !log.isPending;

  return (
    <div className="eh-card">
      <div className="eh-between" style={{ alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>Value ledger</h3>
        {total > 0 && <Pill color="green">{aed(total)} saved</Pill>}
      </div>
      <p className="eh-sm eh-muted" style={{ marginTop: ".35rem" }}>
        Log the value a member draws from membership — it powers their
        &ldquo;used &amp; saved this year&rdquo; view.
      </p>

      <form
        onSubmit={e => {
          e.preventDefault();
          if (!canSubmit) return;
          log.mutate({
            memberId: props.memberId,
            kind: form.kind,
            label: form.label.trim(),
            valueSavedAed: Math.max(
              0,
              Math.floor(Number(form.valueSavedAed) || 0)
            ),
          });
        }}
        style={{ display: "grid", gap: ".5rem", marginBottom: ".75rem" }}
      >
        <div style={{ display: "flex", gap: ".5rem" }}>
          <select
            className="eh-input"
            value={form.kind}
            onChange={e => setForm({ ...form, kind: e.target.value as Kind })}
            style={{ flex: "0 0 8rem" }}
          >
            {KINDS.map(k => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <input
            className="eh-input"
            placeholder="AED saved"
            inputMode="numeric"
            value={form.valueSavedAed}
            onChange={e =>
              setForm({
                ...form,
                valueSavedAed: e.target.value.replace(/[^0-9]/g, ""),
              })
            }
            style={{ flex: 1 }}
          />
        </div>
        <input
          className="eh-input"
          placeholder="What they used (e.g. Legal setup at member rate)"
          value={form.label}
          maxLength={255}
          onChange={e => setForm({ ...form, label: e.target.value })}
        />
        <button className="eh-btn sm gold" disabled={!canSubmit} type="submit">
          {log.isPending ? "Logging…" : "Log benefit"}
        </button>
      </form>

      {rows.length === 0 ? (
        <Empty big="Nothing logged yet." />
      ) : (
        <div className="eh-list">
          {rows.map(r => (
            <div className="row" key={r.id}>
              <div style={{ flex: 1 }}>
                <div
                  className="t"
                  style={{
                    display: "flex",
                    gap: ".4rem",
                    alignItems: "center",
                  }}
                >
                  <Pill color="grey">{r.kind}</Pill>
                  <span>{r.label}</span>
                </div>
                <div className="d">{fmtDate(r.occurredAt)}</div>
              </div>
              <span
                className="eh-sm eh-num"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {r.valueSavedAed > 0 ? aed(r.valueSavedAed) : "—"}
              </span>
              <button
                className="eh-btn ghost sm"
                title="Remove"
                style={{ marginLeft: ".5rem" }}
                disabled={del.isPending}
                onClick={() => del.mutate({ id: r.id })}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
