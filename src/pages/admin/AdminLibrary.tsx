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
import { LIBRARY_KINDS, TIERS, TIER_LABEL } from "@contracts/constants";

type Item = {
  id?: number;
  title: string;
  kind: string;
  tierGate: string;
  url: string;
  description: string;
};

export default function AdminLibrary() {
  const utils = trpc.useUtils();
  const q = trpc.admin.libraryAdmin.useQuery(undefined, { retry: false });
  const [edit, setEdit] = useState<Item | null>(null);

  const save = trpc.admin.saveLibraryItem.useMutation({
    onSuccess: () => {
      toast("Saved — live in the member library.");
      utils.admin.libraryAdmin.invalidate();
      setEdit(null);
    },
    onError: e => toast(e.message),
  });
  const del = trpc.admin.deleteLibraryItem.useMutation({
    onSuccess: () => {
      toast("Removed.");
      utils.admin.libraryAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    save.mutate({
      id: edit.id,
      title: edit.title,
      kind: edit.kind as never,
      tierGate: edit.tierGate as never,
      url: edit.url || undefined,
      description: edit.description || undefined,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Library"
        title="Resource management"
        sub="Playbooks, templates, recordings and notes — tier-gated, member-only."
        actions={
          <button
            className="eh-btn gold"
            onClick={() =>
              setEdit({
                title: "",
                kind: "playbook",
                tierGate: "horizon",
                url: "",
                description: "",
              })
            }
          >
            + New item
          </button>
        }
      />

      {q.isError && <LoadError onRetry={() => q.refetch()} />}
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty big="Library is empty." />
        </div>
      )}

      <div className="eh-grid g3">
        {q.data?.map(i => (
          <div className="eh-card" key={i.id}>
            <div className="eh-between">
              <Pill>{i.kind}</Pill>
              <TierPill tier={i.tierGate} />
            </div>
            <h3 className="eh-mt">{i.title}</h3>
            <p className="eh-sm eh-muted" style={{ flex: 1 }}>
              {i.description}
            </p>
            <div className="eh-row eh-mt">
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({
                    id: i.id,
                    title: i.title,
                    kind: i.kind,
                    tierGate: i.tierGate,
                    url: i.url ?? "",
                    description: i.description ?? "",
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
                      title: "Delete this item?",
                      body: "This removes the resource from the member library.",
                      confirmLabel: "Delete item",
                      danger: true,
                    })
                  )
                    del.mutate({ id: i.id });
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
          title={edit.id ? "Edit library item" : "New library item"}
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
              <Field label="Kind">
                <select
                  className="eh-select"
                  value={edit.kind}
                  onChange={e => setEdit({ ...edit, kind: e.target.value })}
                >
                  {LIBRARY_KINDS.map(k => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
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
            <Field label="URL (leave empty for “available in sessions”)">
              <input
                className="eh-input"
                value={edit.url}
                onChange={e => setEdit({ ...edit, url: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="eh-textarea"
                value={edit.description}
                onChange={e =>
                  setEdit({ ...edit, description: e.target.value })
                }
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
