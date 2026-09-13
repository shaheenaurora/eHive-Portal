import { useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  TierPill,
  Spinner,
  LoadError,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { TIERS, TIER_LABEL } from "@contracts/constants";

type Offer = {
  id?: number;
  vertical: string;
  title: string;
  description: string;
  ctaUrl: string;
  tierGate: string;
};

export default function AdminOffers() {
  const utils = trpc.useUtils();
  const q = trpc.admin.offersAdmin.useQuery(undefined, { retry: false });
  const [edit, setEdit] = useState<Offer | null>(null);

  const save = trpc.admin.saveOffer.useMutation({
    onSuccess: () => {
      toast("Offer saved.");
      utils.admin.offersAdmin.invalidate();
      setEdit(null);
    },
    onError: e => toast(e.message),
  });
  const del = trpc.admin.deleteOffer.useMutation({
    onSuccess: () => {
      toast("Deleted.");
      utils.admin.offersAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    save.mutate({
      id: edit.id,
      vertical: edit.vertical as never,
      title: edit.title,
      description: edit.description || undefined,
      ctaUrl: edit.ctaUrl || undefined,
      tierGate: edit.tierGate as never,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Member offers"
        title="Offers management"
        sub="Cross-sell the two practices — members see only what their tier unlocks."
        actions={
          <button
            className="eh-btn gold"
            onClick={() =>
              setEdit({
                vertical: "setup",
                title: "",
                description: "",
                ctaUrl: "",
                tierGate: "horizon",
              })
            }
          >
            + New offer
          </button>
        }
      />

      {q.isError && <LoadError onRetry={() => q.refetch()} />}
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty big="No offers yet." />
        </div>
      )}

      <div className="eh-grid g3">
        {q.data?.map(o => (
          <div className="eh-card" key={o.id}>
            <div className="eh-between">
              <Pill color={o.vertical === "setup" ? "blue" : "purple"}>
                {o.vertical}
              </Pill>
              <TierPill tier={o.tierGate} />
            </div>
            <h3 className="eh-mt">{o.title}</h3>
            <p className="eh-sm eh-muted" style={{ flex: 1 }}>
              {o.description}
            </p>
            {o.ctaUrl && (
              <p
                className="eh-sm eh-muted eh-num"
                style={{ wordBreak: "break-all" }}
              >
                {o.ctaUrl}
              </p>
            )}
            <div className="eh-row eh-mt">
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({
                    id: o.id,
                    vertical: o.vertical,
                    title: o.title,
                    description: o.description ?? "",
                    ctaUrl: o.ctaUrl ?? "",
                    tierGate: o.tierGate,
                  })
                }
              >
                Edit
              </button>
              <button
                className="eh-btn ghost sm"
                style={{ color: "var(--eh-red)" }}
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: "Delete this offer?",
                      body: "This removes the offer from the member benefits list.",
                      confirmLabel: "Delete offer",
                      danger: true,
                    })
                  )
                    del.mutate({ id: o.id });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <PromoCodes />

      {edit && (
        <Modal
          title={edit.id ? "Edit offer" : "New offer"}
          onClose={() => setEdit(null)}
        >
          <form onSubmit={onSave}>
            <Field label="Title">
              <input
                className="eh-input"
                value={edit.title}
                required
                minLength={2}
                onChange={e => setEdit({ ...edit, title: e.target.value })}
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Vertical">
                <select
                  className="eh-select"
                  value={edit.vertical}
                  onChange={e => setEdit({ ...edit, vertical: e.target.value })}
                >
                  <option value="setup">Business Setup</option>
                  <option value="consulting">Consulting</option>
                </select>
              </Field>
              <Field label="Tier gate">
                <select
                  className="eh-select"
                  value={edit.tierGate}
                  onChange={e => setEdit({ ...edit, tierGate: e.target.value })}
                >
                  {TIERS.map(t => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}+
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea
                className="eh-textarea"
                value={edit.description}
                onChange={e =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
            </Field>
            <Field label="CTA URL">
              <input
                className="eh-input"
                value={edit.ctaUrl}
                onChange={e => setEdit({ ...edit, ctaUrl: e.target.value })}
                placeholder="/consulting.html"
              />
            </Field>
            <button
              className="eh-btn gold"
              type="submit"
              disabled={save.isPending}
            >
              Save →
            </button>
          </form>
        </Modal>
      )}
    </EhShell>
  );
}

/** Promo codes for membership checkout — launch campaigns, partner and
 *  chapter-founder pricing. Create, monitor usage, disable. */
function PromoCodes() {
  const utils = trpc.useUtils();
  const q = trpc.admin.promoCodesAdmin.useQuery(undefined, { retry: false });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    code: "",
    kind: "percent",
    value: "10",
    tierScope: "",
    maxUses: "",
    endsAt: "",
    note: "",
  });

  const create = trpc.admin.createPromoCode.useMutation({
    onSuccess: () => {
      toast("Promo code created.");
      utils.admin.promoCodesAdmin.invalidate();
      setShowNew(false);
      setForm({
        code: "",
        kind: "percent",
        value: "10",
        tierScope: "",
        maxUses: "",
        endsAt: "",
        note: "",
      });
    },
    onError: e => toast(e.message),
  });
  const toggle = trpc.admin.setPromoActive.useMutation({
    onSuccess: () => utils.admin.promoCodesAdmin.invalidate(),
    onError: e => toast(e.message),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    const value = Math.round(Number(form.value));
    if (!value || value <= 0) {
      toast("Enter a valid value.");
      return;
    }
    create.mutate({
      code: form.code,
      kind: form.kind as never,
      value:
        form.kind === "fixed"
          ? Math.round(value * 100) // AED → fils
          : Math.min(value, 100),
      tierScope: form.tierScope
        ? form.tierScope
            .split(",")
            .map(s => s.trim())
            .filter(Boolean)
        : undefined,
      maxUses: form.maxUses ? Math.round(Number(form.maxUses)) : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
      note: form.note || undefined,
    });
  }

  return (
    <div className="eh-card eh-mt">
      <div className="eh-between">
        <div>
          <h3 style={{ margin: 0 }}>Promo codes</h3>
          <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
            Discounts on membership checkout & renewal. Codes are claimed
            atomically — a usage cap can't be oversold.
          </p>
        </div>
        <button className="eh-btn ghost sm" onClick={() => setShowNew(v => !v)}>
          {showNew ? "Close" : "+ New code"}
        </button>
      </div>

      {showNew && (
        <form onSubmit={onCreate} className="eh-mt">
          <div className="eh-grid g3">
            <Field label="Code">
              <input
                className="eh-input"
                value={form.code}
                required
                minLength={3}
                maxLength={32}
                placeholder="FOUNDERS499"
                onChange={e => setForm({ ...form, code: e.target.value })}
              />
            </Field>
            <Field label="Kind">
              <select
                className="eh-select"
                value={form.kind}
                onChange={e => setForm({ ...form, kind: e.target.value })}
              >
                <option value="percent">Percent off</option>
                <option value="fixed">Fixed AED off</option>
              </select>
            </Field>
            <Field
              label={form.kind === "percent" ? "Percent (1–100)" : "AED off"}
            >
              <input
                className="eh-input"
                value={form.value}
                required
                inputMode="numeric"
                onChange={e => setForm({ ...form, value: e.target.value })}
              />
            </Field>
            <Field label="Tier scope (CSV, empty = all)">
              <input
                className="eh-input"
                value={form.tierScope}
                placeholder="vanguard,zenith"
                onChange={e => setForm({ ...form, tierScope: e.target.value })}
              />
            </Field>
            <Field label="Max uses (empty = unlimited)">
              <input
                className="eh-input"
                value={form.maxUses}
                inputMode="numeric"
                onChange={e => setForm({ ...form, maxUses: e.target.value })}
              />
            </Field>
            <Field label="Expires (empty = never)">
              <input
                className="eh-input"
                type="date"
                value={form.endsAt}
                onChange={e => setForm({ ...form, endsAt: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Note (internal)">
            <input
              className="eh-input"
              value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })}
            />
          </Field>
          <button
            className="eh-btn gold"
            type="submit"
            disabled={create.isPending}
          >
            Create code →
          </button>
        </form>
      )}

      {q.data && q.data.length > 0 && (
        <table className="eh-table eh-mt">
          <thead>
            <tr>
              <th>Code</th>
              <th>Discount</th>
              <th>Scope</th>
              <th>Used</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map(p => (
              <tr key={p.id}>
                <td>
                  <b>{p.code}</b>
                  {p.note && <div className="eh-muted eh-sm">{p.note}</div>}
                </td>
                <td>
                  {p.kind === "percent"
                    ? `${p.value}% off`
                    : `AED ${(p.value / 100).toLocaleString()} off`}
                </td>
                <td className="eh-sm">{p.tierScope ?? "All tiers"}</td>
                <td className="eh-num">
                  {p.usedCount}
                  {p.maxUses != null ? ` / ${p.maxUses}` : ""}
                </td>
                <td className="eh-sm">
                  {p.endsAt ? new Date(p.endsAt).toLocaleDateString() : "—"}
                </td>
                <td>
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      toggle.mutate({ id: p.id, active: !p.active })
                    }
                  >
                    {p.active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.data && q.data.length === 0 && !showNew && (
        <Empty big="No promo codes yet." />
      )}
    </div>
  );
}
