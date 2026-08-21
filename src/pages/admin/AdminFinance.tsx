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
  LoadError,
} from "@/components/eh";
import { fmtDate, fmtDateTime } from "@/lib/ehf";
import {
  TIER_LABEL,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
} from "@contracts/constants";

/* Payments store minor units (fils); budgets store whole AED. */
const aed = (fils: number) =>
  "AED " +
  (fils / 100).toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(fils / 100) ? 0 : 2,
    maximumFractionDigits: 2,
  });
const aedWhole = (n: number) => "AED " + n.toLocaleString("en-AE");

const PAY_COLOR: Record<
  string,
  "grey" | "blue" | "green" | "red" | "gold" | "amber"
> = {
  paid: "green",
  pending: "gold",
  failed: "red",
  refunded: "red",
  partially_refunded: "amber",
};
type Tab =
  | "payments"
  | "invoices"
  | "creditNotes"
  | "renewals"
  | "budgets"
  | "expenses"
  | "reports";

export default function AdminFinance() {
  const utils = trpc.useUtils();
  const summary = trpc.admin.financeSummary.useQuery(undefined, {
    retry: false,
  });
  const [tab, setTab] = useState<Tab>("payments");
  const [receipt, setReceipt] = useState<number | null>(null);
  const [refund, setRefund] = useState<{
    id: number;
    label: string;
    amount: number;
    refunded: number;
  } | null>(null);
  const [manual, setManual] = useState(false);
  const [expense, setExpense] = useState(false);

  const refreshAll = () => {
    utils.admin.financeSummary.invalidate();
    utils.admin.payments.invalidate();
    utils.admin.invoices.invalidate();
    utils.admin.creditNotes.invalidate();
    utils.admin.renewalsDue.invalidate();
    utils.admin.expenses.invalidate();
    utils.admin.budgetRollup.invalidate();
  };

  const s = summary.data;
  const byTier = s ? Object.entries(s.byTier) : [];

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Finance · revenue & renewals"
        title="Finance"
        sub="Membership revenue, renewals due, refunds and chapter budgets — the operational money view. Statutory books are kept in your accounting tool."
      />

      {summary.isLoading && <Spinner />}
      {s && (
        <>
          <div className="eh-grid g4 eh-mb">
            <Metric
              k="Revenue (paid)"
              v={aed(s.revenuePaid)}
              n={`${s.paidCount} payment${s.paidCount === 1 ? "" : "s"}`}
              accent="var(--eh-good, #2e7d5b)"
            />
            <Metric
              k="This month"
              v={aed(s.revenueThisMonth)}
              n="Paid since the 1st"
            />
            <Metric
              k="Renewals due"
              v={aedWhole(s.renewals.valueAed)}
              n={`${s.renewals.count} member${s.renewals.count === 1 ? "" : "s"} · next 30 days`}
              accent={s.renewals.count > 0 ? "#b8862e" : undefined}
            />
            <Metric
              k="Refunded"
              v={aed(s.refundedTotal)}
              n={s.pendingTotal ? `${aed(s.pendingTotal)} pending` : "—"}
              accent={
                s.refundedTotal > 0 ? "var(--eh-red, #b23a2e)" : undefined
              }
            />
          </div>
          {byTier.length > 0 && (
            <div className="eh-card eh-mb">
              <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
                Revenue by tier
              </div>
              <div
                className="eh-row"
                style={{ gap: "1.4rem", flexWrap: "wrap" }}
              >
                {byTier.map(([t, v]) => (
                  <div key={t}>
                    <div
                      className="eh-num eh-strong"
                      style={{ fontSize: "1.15rem" }}
                    >
                      {aed(v.amount)}
                    </div>
                    <div className="eh-muted eh-sm">
                      {TIER_LABEL[t as keyof typeof TIER_LABEL] ?? t} · {v.n}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="eh-tabs eh-mb">
        <button
          className={tab === "payments" ? "on" : ""}
          onClick={() => setTab("payments")}
        >
          Payments
        </button>
        <button
          className={tab === "invoices" ? "on" : ""}
          onClick={() => setTab("invoices")}
        >
          Invoices
        </button>
        <button
          className={tab === "creditNotes" ? "on" : ""}
          onClick={() => setTab("creditNotes")}
        >
          Credit notes
        </button>
        <button
          className={tab === "renewals" ? "on" : ""}
          onClick={() => setTab("renewals")}
        >
          Renewals due
        </button>
        <button
          className={tab === "budgets" ? "on" : ""}
          onClick={() => setTab("budgets")}
        >
          Chapter budgets
        </button>
        <button
          className={tab === "expenses" ? "on" : ""}
          onClick={() => setTab("expenses")}
        >
          Expenses
        </button>
        <button
          className={tab === "reports" ? "on" : ""}
          onClick={() => setTab("reports")}
        >
          Reports
        </button>
      </div>

      {tab === "payments" && (
        <PaymentsTab
          onReceipt={setReceipt}
          onRefund={setRefund}
          onManual={() => setManual(true)}
        />
      )}
      {tab === "invoices" && <InvoicesTab />}
      {tab === "creditNotes" && <CreditNotesTab />}
      {tab === "renewals" && <RenewalsTab />}
      {tab === "budgets" && <BudgetsTab />}
      {tab === "expenses" && <ExpensesTab onRecord={() => setExpense(true)} />}
      {tab === "reports" && <ReportsTab />}

      {receipt != null && (
        <ReceiptModal id={receipt} onClose={() => setReceipt(null)} />
      )}
      {refund && (
        <RefundModal
          spec={refund}
          onClose={() => setRefund(null)}
          onDone={() => {
            refreshAll();
            setRefund(null);
          }}
        />
      )}
      {manual && (
        <ManualPaymentModal
          onClose={() => setManual(false)}
          onDone={() => {
            refreshAll();
            setManual(false);
          }}
        />
      )}
      {expense && (
        <RecordExpenseModal
          onClose={() => setExpense(false)}
          onDone={() => {
            refreshAll();
            setExpense(false);
          }}
        />
      )}
    </EhShell>
  );
}

function Metric({
  k,
  v,
  n,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  n?: string;
  accent?: string;
}) {
  return (
    <div
      className="eh-card"
      style={{
        padding: "1rem 1.1rem",
        borderLeft: accent ? `3px solid ${accent}` : undefined,
      }}
    >
      <div className="eh-eyebrow" style={{ marginBottom: ".2rem" }}>
        {k}
      </div>
      <div
        className="eh-num"
        style={{
          fontSize: "1.5rem",
          fontWeight: 800,
          lineHeight: 1.1,
          color: accent ?? "var(--eh-ink)",
        }}
      >
        {v}
      </div>
      {n && (
        <div className="eh-muted eh-sm" style={{ marginTop: ".25rem" }}>
          {n}
        </div>
      )}
    </div>
  );
}

function PaymentsTab({
  onReceipt,
  onRefund,
  onManual,
}: {
  onReceipt: (id: number) => void;
  onRefund: (s: {
    id: number;
    label: string;
    amount: number;
    refunded: number;
  }) => void;
  onManual: () => void;
}) {
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const list = trpc.admin.payments.useQuery(
    { status: (status || undefined) as never, q: q || undefined },
    { retry: false }
  );
  const rows = list.data ?? [];

  return (
    <div>
      <div
        className="eh-between eh-mb"
        style={{ flexWrap: "wrap", gap: ".6rem" }}
      >
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          {[
            "",
            "paid",
            "pending",
            "refunded",
            "partially_refunded",
            "failed",
          ].map(s => (
            <button
              key={s || "all"}
              className={`eh-btn sm ${status === s ? "gold" : "ghost"}`}
              onClick={() => setStatus(s)}
            >
              {s ? s.replace(/_/g, " ") : "All"}
            </button>
          ))}
        </div>
        <div className="eh-row" style={{ gap: ".4rem" }}>
          <input
            className="eh-input"
            style={{ minWidth: 180 }}
            placeholder="Search payer / ref…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          <button className="eh-btn gold sm" onClick={onManual}>
            Record payment
          </button>
        </div>
      </div>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No payments."
            p="Membership checkouts and manually-recorded payments appear here."
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Payer</th>
                <th>For</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Method</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>
                    <b>{p.payerName ?? "—"}</b>
                    <div className="eh-sm eh-muted">{p.payerEmail}</div>
                  </td>
                  <td data-label="For" className="eh-sm">
                    {p.purpose}
                    {p.tier
                      ? ` · ${TIER_LABEL[p.tier as keyof typeof TIER_LABEL] ?? p.tier}`
                      : ""}
                  </td>
                  <td data-label="Amount" className="eh-num">
                    {aed(p.amount)}
                  </td>
                  <td data-label="Status">
                    <Pill color={PAY_COLOR[p.status] ?? "grey"}>
                      {p.status}
                    </Pill>
                  </td>
                  <td data-label="Method" className="eh-sm eh-muted">
                    {p.provider}
                  </td>
                  <td data-label="Date" className="eh-sm eh-muted">
                    {fmtDate(p.createdAt)}
                  </td>
                  <td>
                    <span
                      className="eh-row"
                      style={{ gap: ".3rem", justifyContent: "flex-end" }}
                    >
                      <button
                        className="eh-btn ghost sm"
                        onClick={() => onReceipt(p.id)}
                      >
                        Receipt
                      </button>
                      {(p.status === "paid" ||
                        p.status === "partially_refunded") && (
                        <button
                          className="eh-btn ghost sm danger"
                          onClick={() =>
                            onRefund({
                              id: p.id,
                              label: `${p.payerName ?? "member"} · ${aed(p.amount)}`,
                              amount: p.amount,
                              refunded: p.refundedAmount ?? 0,
                            })
                          }
                        >
                          Refund
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InvoicesTab() {
  const [status, setStatus] = useState<string>("");
  const list = trpc.admin.invoices.useQuery(
    { status: (status || undefined) as never },
    { retry: false }
  );
  const rows = list.data ?? [];

  return (
    <div>
      <div
        className="eh-between eh-mb"
        style={{ flexWrap: "wrap", gap: ".6rem" }}
      >
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          {["", "open", "paid", "void"].map(s => (
            <button
              key={s || "all"}
              className={`eh-btn sm ${status === s ? "gold" : "ghost"}`}
              onClick={() => setStatus(s)}
            >
              {s ? s : "All"}
            </button>
          ))}
        </div>
      </div>

      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No invoices yet."
            p="Invoices are created automatically when a payment is settled."
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Member</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Billed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(inv => (
                <tr key={inv.id}>
                  <td data-label="Invoice" className="eh-num">
                    {inv.invoiceNumber}
                  </td>
                  <td data-label="Member">
                    <b>{inv.payerName ?? "—"}</b>
                    <div className="eh-sm eh-muted">{inv.payerEmail}</div>
                  </td>
                  <td data-label="Amount" className="eh-num">
                    {aed(inv.amount)}
                  </td>
                  <td data-label="Status">
                    <Pill color={INV_COLOR[inv.status] ?? "grey"}>
                      {inv.status}
                    </Pill>
                  </td>
                  <td data-label="Billed" className="eh-sm eh-muted">
                    {fmtDate(inv.billedAt)}
                  </td>
                  <td>
                    <a
                      className="eh-btn ghost sm"
                      href={`/api/admin/invoice-html?id=${inv.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CreditNotesTab() {
  const list = trpc.admin.creditNotes.useQuery(undefined, { retry: false });
  const rows = list.data ?? [];

  return (
    <div>
      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No credit notes yet."
            p="Credit notes are created automatically when a payment is refunded."
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Credit note</th>
                <th>Member</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(cn => (
                <tr key={cn.id}>
                  <td data-label="Credit note" className="eh-num">
                    {cn.creditNoteNumber}
                  </td>
                  <td data-label="Member">
                    <b>{cn.payerName ?? "—"}</b>
                    <div className="eh-sm eh-muted">{cn.payerEmail}</div>
                  </td>
                  <td data-label="Amount" className="eh-num">
                    {aed(cn.amount)}
                  </td>
                  <td data-label="Reason" className="eh-sm">
                    {cn.reason}
                  </td>
                  <td data-label="Date" className="eh-sm eh-muted">
                    {fmtDate(cn.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const INV_COLOR: Record<
  string,
  "grey" | "blue" | "green" | "red" | "gold" | "amber"
> = {
  open: "gold",
  paid: "green",
  void: "grey",
};

function RenewalsTab() {
  const q = trpc.admin.renewalsDue.useQuery(
    { withinDays: 30 },
    { retry: false }
  );
  const rows = q.data ?? [];
  return (
    <div>
      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No renewals due."
            p="Active members due to renew in the next 30 days (or overdue) show here."
          />
        </div>
      )}
      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Member</th>
                <th>Chapter</th>
                <th>Tier</th>
                <th>Value</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.memberId}>
                  <td>
                    <b>{r.name ?? "—"}</b>
                    <div className="eh-sm eh-muted">{r.email}</div>
                  </td>
                  <td data-label="Chapter" className="eh-sm">
                    {r.chapterName ?? "—"}
                  </td>
                  <td data-label="Tier" className="eh-sm">
                    {TIER_LABEL[r.tier as keyof typeof TIER_LABEL] ?? r.tier}
                  </td>
                  <td data-label="Value" className="eh-num">
                    {aedWhole(r.valueAed)}
                  </td>
                  <td data-label="Due">
                    {r.overdue ? (
                      <Pill color="red">Overdue · {fmtDate(r.renewalAt)}</Pill>
                    ) : (
                      <span className="eh-sm eh-muted">
                        {fmtDate(r.renewalAt)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BudgetsTab() {
  const q = trpc.admin.budgetRollup.useQuery(undefined, { retry: false });
  const rows = q.data ?? [];
  return (
    <div>
      {q.isLoading && <Spinner />}
      {q.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No budgets yet."
            p="Chapter allocations, sponsorships and spend appear here as they're proposed and approved."
          />
        </div>
      )}
      <div style={{ display: "grid", gap: ".7rem" }}>
        {rows.map(r => (
          <div className="eh-card" key={r.chapterId}>
            <div
              className="eh-between"
              style={{ flexWrap: "wrap", gap: ".6rem" }}
            >
              <b>{r.chapterName ?? `Chapter #${r.chapterId}`}</b>
              {r.pendingApprovals > 0 && (
                <Pill color="amber">
                  {r.pendingApprovals} pending approval
                  {r.pendingApprovals === 1 ? "" : "s"}
                </Pill>
              )}
            </div>
            <div
              className="eh-row"
              style={{ gap: "1.6rem", flexWrap: "wrap", marginTop: ".5rem" }}
            >
              <div>
                <div className="eh-num eh-strong">{aedWhole(r.allocated)}</div>
                <div className="eh-muted eh-sm">Allocated</div>
              </div>
              <div>
                <div className="eh-num eh-strong">{aedWhole(r.spent)}</div>
                <div className="eh-muted eh-sm">Spent</div>
              </div>
              <div>
                <div
                  className="eh-num eh-strong"
                  style={{
                    color:
                      r.remaining < 0
                        ? "var(--eh-red, #b23a2e)"
                        : "var(--eh-good, #2e7d5b)",
                  }}
                >
                  {aedWhole(r.remaining)}
                </div>
                <div className="eh-muted eh-sm">Remaining</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReceiptModal({ id, onClose }: { id: number; onClose: () => void }) {
  const q = trpc.admin.paymentReceipt.useQuery({ id }, { retry: false });
  const p = q.data;
  return (
    <Modal title="Receipt" onClose={onClose} wide>
      {q.isLoading && <Spinner />}
      {p && (
        <div>
          <div
            className="eh-between"
            style={{ alignItems: "flex-start", marginBottom: "1rem" }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: "1.2rem" }}>eHive</div>
              <div className="eh-muted eh-sm">Payment receipt</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="eh-sm eh-muted">Receipt #</div>
              <b className="eh-num">{String(p.id).padStart(6, "0")}</b>
            </div>
          </div>
          <div className="eh-list eh-mb">
            <div className="row">
              <span className="d">Payer</span>
              <span className="t">
                {p.payerName ?? "—"}
                {p.payerEmail ? ` · ${p.payerEmail}` : ""}
              </span>
            </div>
            <div className="row">
              <span className="d">For</span>
              <span className="t">
                {p.purpose}
                {p.tier
                  ? ` · ${TIER_LABEL[p.tier as keyof typeof TIER_LABEL] ?? p.tier}`
                  : ""}
              </span>
            </div>
            <div className="row">
              <span className="d">Amount</span>
              <span className="t eh-num" style={{ fontWeight: 800 }}>
                {aed(p.amount)}
              </span>
            </div>
            <div className="row">
              <span className="d">Status</span>
              <span className="t">
                <Pill color={PAY_COLOR[p.status] ?? "grey"}>{p.status}</Pill>
              </span>
            </div>
            <div className="row">
              <span className="d">Method</span>
              <span className="t">
                {p.provider}
                {p.providerRef ? ` · ${p.providerRef}` : ""}
              </span>
            </div>
            <div className="row">
              <span className="d">Date</span>
              <span className="t">{fmtDateTime(p.createdAt)}</span>
            </div>
            {p.note && (
              <div className="row">
                <span className="d">Note</span>
                <span className="t">{p.note}</span>
              </div>
            )}
            {p.refundedAt && (
              <div className="row">
                <span className="d">Refunded</span>
                <span className="t">
                  {fmtDate(p.refundedAt)}
                  {p.refundReason ? ` — ${p.refundReason}` : ""}
                </span>
              </div>
            )}
          </div>
          <button className="eh-btn ghost" onClick={() => window.print()}>
            Print / save PDF
          </button>
        </div>
      )}
    </Modal>
  );
}

function RefundModal({
  spec,
  onClose,
  onDone,
}: {
  spec: { id: number; label: string; amount: number; refunded: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const remaining = spec.amount - spec.refunded; // fils
  const [reason, setReason] = useState("");
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState(""); // AED string
  const amountAed = Number(amount);
  const amountValid =
    !partial ||
    (amount !== "" &&
      amountAed > 0 &&
      Math.round(amountAed * 100) <= remaining);
  const m = trpc.admin.refundPayment.useMutation({
    onSuccess: () => {
      toast("Refund processed.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title="Refund payment" onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Refunding <b>{spec.label}</b>. The charge is refunded through the
        payment gateway, the record is updated and the member is notified.
        {spec.refunded > 0 && (
          <>
            {" "}
            Already refunded: <b>{aed(spec.refunded)}</b>; remaining refundable:{" "}
            <b>{aed(remaining)}</b>.
          </>
        )}
      </p>
      <label
        className="eh-row"
        style={{ gap: ".5rem", margin: "0 0 .6rem", cursor: "pointer" }}
      >
        <input
          type="checkbox"
          checked={partial}
          onChange={e => setPartial(e.target.checked)}
        />
        <span className="eh-sm">Partial refund</span>
      </label>
      {partial && (
        <Field
          label={`Amount to refund (AED, up to ${(remaining / 100).toFixed(2)})`}
        >
          <input
            className="eh-input"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 250"
          />
        </Field>
      )}
      <Field label="Reason (required)">
        <input
          className="eh-input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Duplicate charge / goodwill"
        />
      </Field>
      <button
        className="eh-btn danger"
        disabled={m.isPending || reason.trim().length < 2 || !amountValid}
        onClick={() =>
          m.mutate({
            id: spec.id,
            reason,
            amountAed: partial ? amountAed : undefined,
          })
        }
      >
        {m.isPending
          ? "Working…"
          : partial
            ? "Refund this amount"
            : `Refund ${aed(remaining)}`}
      </button>
    </Modal>
  );
}

function ManualPaymentModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [purpose, setPurpose] = useState<
    "membership" | "renewal" | "event" | "donation" | "other"
  >("renewal");
  const [tier, setTier] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [extend, setExtend] = useState(true);
  const members = trpc.admin.payableMembers.useQuery(
    { q: q || undefined },
    { retry: false }
  );
  const m = trpc.admin.recordManualPayment.useMutation({
    onSuccess: () => {
      toast("Payment recorded.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  const chosen = (members.data ?? []).find(x => x.userId === userId);

  return (
    <Modal title="Record a manual payment" onClose={onClose} wide>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Log an offline payment (bank transfer, cash) as paid revenue. It appears
        in the ledger and totals immediately.
      </p>
      <Field label="Member">
        {chosen ? (
          <div
            className="eh-row"
            style={{ gap: ".5rem", alignItems: "center" }}
          >
            <span className="t">
              {chosen.name} · {chosen.email}
            </span>
            <button className="eh-btn ghost sm" onClick={() => setUserId(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              className="eh-input"
              placeholder="Search member by name / email…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <div
              className="eh-list"
              style={{ maxHeight: 180, overflowY: "auto", marginTop: ".4rem" }}
            >
              {(members.data ?? []).map(x => (
                <button
                  key={x.userId}
                  className="row"
                  style={{
                    background: "none",
                    border: 0,
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setUserId(x.userId);
                    if (x.tier) setTier(x.tier);
                  }}
                >
                  <span className="t">{x.name ?? x.email}</span>
                  <span className="d">{x.email}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </Field>
      <div className="eh-grid g2">
        <Field label="Purpose">
          <select
            className="eh-select"
            value={purpose}
            onChange={e => setPurpose(e.target.value as never)}
          >
            {["renewal", "membership", "event", "donation", "other"].map(p => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount (AED)">
          <input
            className="eh-input"
            type="number"
            min={1}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 5999"
          />
        </Field>
      </div>
      {(purpose === "membership" || purpose === "renewal") && (
        <Field label="Tier (optional)">
          <select
            className="eh-select"
            value={tier}
            onChange={e => setTier(e.target.value)}
          >
            <option value="">—</option>
            {["horizon", "ascent", "vanguard", "zenith"].map(t => (
              <option key={t} value={t}>
                {TIER_LABEL[t as keyof typeof TIER_LABEL]}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Bank ref / context"
        />
      </Field>
      {purpose === "renewal" && (
        <label
          className="eh-row"
          style={{
            gap: ".5rem",
            alignItems: "center",
            cursor: "pointer",
            margin: ".2rem 0 .8rem",
          }}
        >
          <input
            type="checkbox"
            checked={extend}
            onChange={e => setExtend(e.target.checked)}
            style={{ accentColor: "#b8862e" }}
          />
          <span className="eh-sm">
            Roll this member's renewal date forward one year
          </span>
        </label>
      )}
      <button
        className="eh-btn gold"
        disabled={m.isPending || !userId || !(Number(amount) > 0)}
        onClick={() =>
          m.mutate({
            userId: userId!,
            purpose,
            tier: (tier || null) as never,
            amountAed: Number(amount),
            note: note || undefined,
            extendRenewal: purpose === "renewal" ? extend : false,
          })
        }
      >
        {m.isPending ? "Recording…" : "Record payment"}
      </button>
    </Modal>
  );
}

function ExpensesTab({ onRecord }: { onRecord: () => void }) {
  const [chapterId, setChapterId] = useState<string>("");
  const list = trpc.admin.expenses.useQuery(
    { chapterId: chapterId ? Number(chapterId) : undefined },
    { retry: false }
  );
  const chapters = trpc.admin.financeChapters.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const rows = list.data ?? [];

  const openReceipt = async (id: number) => {
    try {
      const r = await utils.admin.expenseReceipt.fetch({ id });
      if (!r) {
        toast("No receipt on file.");
        return;
      }
      const win = window.open();
      if (win)
        win.document.write(
          `<title>${r.name}</title><iframe src="${r.data}" style="border:0;width:100vw;height:100vh"></iframe>`
        );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't open the receipt.");
    }
  };

  return (
    <div>
      <div
        className="eh-between eh-mb"
        style={{ flexWrap: "wrap", gap: ".6rem" }}
      >
        <select
          className="eh-select"
          value={chapterId}
          onChange={e => setChapterId(e.target.value)}
          style={{ minWidth: 200 }}
        >
          <option value="">All chapters</option>
          {(chapters.data ?? []).map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="eh-btn gold sm" onClick={onRecord}>
          Record expense
        </button>
      </div>
      {list.isLoading && <Spinner />}
      {list.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No expenses yet."
            p="Record chapter spend against approved budgets here."
          />
        </div>
      )}
      {rows.length > 0 &&
        (() => {
          const byCat = new Map<string, number>();
          for (const e of rows)
            byCat.set(
              e.category ?? "other",
              (byCat.get(e.category ?? "other") ?? 0) + e.amount
            );
          const ordered = EXPENSE_CATEGORIES.map(
            c => [c.label, byCat.get(c.key) ?? 0] as const
          ).filter(([, v]) => v > 0);
          return (
            <div className="eh-card eh-mb">
              <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
                Spend by category
              </div>
              <div
                className="eh-row"
                style={{ gap: "1.4rem", flexWrap: "wrap" }}
              >
                {ordered.map(([label, v]) => (
                  <div key={label}>
                    <div
                      className="eh-num eh-strong"
                      style={{ fontSize: "1.1rem" }}
                    >
                      {aedWhole(v)}
                    </div>
                    <div className="eh-muted eh-sm">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Chapter</th>
                <th>Item</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Receipt</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(e => (
                <tr key={e.id}>
                  <td data-label="Chapter">
                    {e.chapterName ?? `Chapter #${e.chapterId}`}
                  </td>
                  <td data-label="Item">
                    <b>{e.label}</b>
                    {e.note ? (
                      <div className="eh-sm eh-muted">{e.note}</div>
                    ) : null}
                  </td>
                  <td data-label="Category" className="eh-sm">
                    {e.category
                      ? (EXPENSE_CATEGORY_LABEL[e.category] ?? e.category)
                      : "—"}
                  </td>
                  <td data-label="Amount" className="eh-num">
                    {aedWhole(e.amount)}
                  </td>
                  <td data-label="Status">
                    <Pill color={e.status === "approved" ? "green" : "grey"}>
                      {e.status}
                    </Pill>
                  </td>
                  <td data-label="Receipt" className="eh-sm">
                    {e.receiptName ? (
                      <button
                        className="eh-btn ghost sm"
                        onClick={() => openReceipt(e.id)}
                      >
                        View
                      </button>
                    ) : (
                      <span className="eh-muted">—</span>
                    )}
                  </td>
                  <td data-label="Date" className="eh-sm eh-muted">
                    {fmtDate(e.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecordExpenseModal({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [chapterId, setChapterId] = useState<string>("");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<{ data: string; name: string } | null>(
    null
  );
  const chapters = trpc.admin.financeChapters.useQuery(undefined, {
    retry: false,
  });
  const m = trpc.admin.recordExpense.useMutation({
    onSuccess: r => {
      toast(
        r?.pending
          ? "Expense submitted for approval (over the spend threshold)."
          : "Expense recorded."
      );
      onDone();
    },
    onError: e => toast(e.message),
  });

  return (
    <Modal title="Record chapter expense" onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Log spend against a chapter's approved budget. This reduces the
        remaining budget immediately.
      </p>
      <Field label="Chapter">
        <select
          className="eh-select"
          value={chapterId}
          onChange={e => setChapterId(e.target.value)}
        >
          <option value="">Choose a chapter…</option>
          {(chapters.data ?? []).map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Item / vendor">
        <input
          className="eh-input"
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="e.g. Venue deposit · Q2 offsite"
        />
      </Field>
      <div className="eh-grid g2">
        <Field label="Amount (AED)">
          <input
            className="eh-input"
            type="number"
            min={1}
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="e.g. 1200"
          />
        </Field>
        <Field label="Category">
          <select
            className="eh-select"
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            {EXPENSE_CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Receipt ref / budget line"
        />
      </Field>
      <Field label="Receipt (optional — image or PDF, max ~4 MB)">
        <input
          type="file"
          accept="image/*,application/pdf"
          className="eh-input"
          onChange={e => {
            const file = e.target.files?.[0];
            if (!file) {
              setReceipt(null);
              return;
            }
            if (file.size > 4 * 1024 * 1024) {
              toast("Receipt is too large — keep it under 4 MB.");
              e.target.value = "";
              return;
            }
            const reader = new FileReader();
            reader.onload = () =>
              setReceipt({ data: String(reader.result), name: file.name });
            reader.onerror = () => toast("Couldn't read that file.");
            reader.readAsDataURL(file);
          }}
        />
        {receipt && (
          <span className="eh-sm eh-muted">Attached: {receipt.name}</span>
        )}
      </Field>
      <button
        className="eh-btn gold"
        disabled={
          m.isPending || !chapterId || !label.trim() || !(Number(amount) > 0)
        }
        onClick={() =>
          m.mutate({
            chapterId: Number(chapterId),
            label: label.trim(),
            amountAed: Number(amount),
            category: category as never,
            note: note || undefined,
            receiptData: receipt?.data,
            receiptName: receipt?.name,
          })
        }
      >
        {m.isPending ? "Recording…" : "Record expense"}
      </button>
    </Modal>
  );
}

/* Finance → Reports: revenue by month/tier, expenses by category, and a CSV
   export of the whole report. */
const money = (aedNum: number) =>
  "AED " +
  aedNum.toLocaleString("en-AE", {
    minimumFractionDigits: Number.isInteger(aedNum) ? 0 : 2,
    maximumFractionDigits: 2,
  });

function ReportsTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range =
    from || to ? { from: from || undefined, to: to || undefined } : undefined;
  const q = trpc.admin.financeReport.useQuery(range, { retry: false });
  const utils = trpc.useUtils();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const { filename, csv } = await utils.admin.financeReportCsv.fetch(range);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setDownloading(false);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.isError) return <LoadError onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r) return null;
  const t = r.totals;

  return (
    <>
      <div className="eh-row eh-mb" style={{ justifyContent: "space-between" }}>
        <div className="eh-grid g4" style={{ flex: 1 }}>
          <Metric k="Gross revenue" v={money(t.grossAed)} />
          <Metric k="Refunds" v={money(t.refundsAed)} />
          <Metric
            k="Net revenue"
            v={money(t.netRevenueAed)}
            accent="var(--eh-good, #2e7d5b)"
          />
          <Metric k="Chapter expenses" v={money(t.expensesAed)} />
        </div>
      </div>
      <div
        className="eh-row eh-mb"
        style={{
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: ".5rem",
        }}
      >
        <div
          className="eh-row"
          style={{ gap: ".5rem", alignItems: "center", flexWrap: "wrap" }}
        >
          <label className="eh-sm eh-muted" htmlFor="fin-from">
            From
          </label>
          <input
            id="fin-from"
            type="date"
            className="eh-input sm"
            value={from}
            max={to || undefined}
            onChange={e => setFrom(e.target.value)}
          />
          <label className="eh-sm eh-muted" htmlFor="fin-to">
            To
          </label>
          <input
            id="fin-to"
            type="date"
            className="eh-input sm"
            value={to}
            min={from || undefined}
            onChange={e => setTo(e.target.value)}
          />
          {(from || to) && (
            <button
              className="eh-btn ghost sm"
              onClick={() => {
                setFrom("");
                setTo("");
              }}
            >
              Clear
            </button>
          )}
        </div>
        <button
          className="eh-btn gold sm"
          onClick={download}
          disabled={downloading}
        >
          {downloading ? "Preparing…" : "Download CSV"}
        </button>
      </div>

      <div className="eh-card eh-mb" style={{ padding: ".4rem 1.25rem" }}>
        <h3 className="eh-h4" style={{ margin: ".8rem 0 .3rem" }}>
          Revenue by month
        </h3>
        {r.revenueByMonth.length === 0 ? (
          <Empty
            big="No settled revenue yet."
            p="Paid memberships will appear here by month."
          />
        ) : (
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Month</th>
                <th>Gross</th>
                <th>Refunds</th>
                <th>Net</th>
              </tr>
            </thead>
            <tbody>
              {r.revenueByMonth.map(m => (
                <tr key={m.month}>
                  <td data-label="Month">{m.month}</td>
                  <td data-label="Gross">{money(m.grossAed)}</td>
                  <td data-label="Refunds">{money(m.refundsAed)}</td>
                  <td data-label="Net">
                    <b>{money(m.netAed)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="eh-grid g2">
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <h3 className="eh-h4" style={{ margin: ".8rem 0 .3rem" }}>
            Revenue by tier
          </h3>
          {r.byTier.length === 0 ? (
            <Empty big="—" p="No paid memberships yet." />
          ) : (
            <table className="eh-table stack">
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Gross</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {r.byTier.map(row => (
                  <tr key={row.tier}>
                    <td data-label="Tier">
                      {TIER_LABEL[row.tier as keyof typeof TIER_LABEL] ??
                        row.tier}
                    </td>
                    <td data-label="Gross">{money(row.grossAed)}</td>
                    <td data-label="Payments">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <h3 className="eh-h4" style={{ margin: ".8rem 0 .3rem" }}>
            Expenses by category
          </h3>
          {r.expenseByCategory.length === 0 ? (
            <Empty big="—" p="No chapter spend recorded yet." />
          ) : (
            <table className="eh-table stack">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Spend</th>
                </tr>
              </thead>
              <tbody>
                {r.expenseByCategory.map(row => (
                  <tr key={row.category}>
                    <td data-label="Category">
                      {EXPENSE_CATEGORY_LABEL[row.category] ?? row.category}
                    </td>
                    <td data-label="Spend">{money(row.aed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
