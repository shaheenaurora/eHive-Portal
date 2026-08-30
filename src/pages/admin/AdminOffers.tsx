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
