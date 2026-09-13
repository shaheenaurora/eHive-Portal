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

      <TestimonialsPanel />
    </EhShell>
  );
}

/** Member testimonials — published rows rotate on the public homepage. */
function TestimonialsPanel() {
  const utils = trpc.useUtils();
  const q = trpc.admin.testimonialsAdmin.useQuery(undefined, { retry: false });
  const [edit, setEdit] = useState<{
    id?: number;
    quote: string;
    authorName: string;
    authorRole: string;
    authorChapter: string;
    published: boolean;
    sortOrder: number;
  } | null>(null);

  const save = trpc.admin.saveTestimonial.useMutation({
    onSuccess: () => {
      toast("Testimonial saved.");
      utils.admin.testimonialsAdmin.invalidate();
      setEdit(null);
    },
    onError: e => toast(e.message),
  });
  const del = trpc.admin.deleteTestimonial.useMutation({
    onSuccess: () => {
      toast("Deleted.");
      utils.admin.testimonialsAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });

  function onSave(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    save.mutate({
      id: edit.id,
      quote: edit.quote,
      authorName: edit.authorName,
      authorRole: edit.authorRole || undefined,
      authorChapter: edit.authorChapter || undefined,
      published: edit.published,
      sortOrder: edit.sortOrder,
    });
  }

  return (
    <div className="eh-card eh-mt">
      <div className="eh-between">
        <div>
          <h3 style={{ margin: 0 }}>Member testimonials</h3>
          <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>
            Published quotes rotate on the public homepage (“What members say”).
            Get written consent before publishing.
          </p>
        </div>
        <button
          className="eh-btn ghost sm"
          onClick={() =>
            setEdit({
              quote: "",
              authorName: "",
              authorRole: "",
              authorChapter: "",
              published: false,
              sortOrder: 0,
            })
          }
        >
          + New testimonial
        </button>
      </div>

      {q.data && q.data.length > 0 && (
        <div className="eh-list eh-mt">
          {q.data.map(t => (
            <div
              className="row"
              key={t.id}
              style={{ alignItems: "flex-start" }}
            >
              <div style={{ flex: 1 }}>
                <div className="t">“{t.quote}”</div>
                <div className="d eh-sm">
                  {t.authorName}
                  {t.authorRole ? ` · ${t.authorRole}` : ""}
                  {t.authorChapter ? ` · ${t.authorChapter}` : ""}
                </div>
              </div>
              <Pill color={t.published ? "green" : "grey"}>
                {t.published ? "live" : "draft"}
              </Pill>
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({
                    id: t.id,
                    quote: t.quote,
                    authorName: t.authorName,
                    authorRole: t.authorRole ?? "",
                    authorChapter: t.authorChapter ?? "",
                    published: t.published,
                    sortOrder: t.sortOrder,
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
                      title: "Delete this testimonial?",
                      body: "It disappears from the homepage rotation at once.",
                      confirmLabel: "Delete",
                      danger: true,
                    })
                  )
                    del.mutate({ id: t.id });
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
      {q.data && q.data.length === 0 && !edit && (
        <Empty big="No testimonials yet." />
      )}

      {edit && (
        <Modal
          title={edit.id ? "Edit testimonial" : "New testimonial"}
          onClose={() => setEdit(null)}
        >
          <form onSubmit={onSave}>
            <Field label="Quote">
              <textarea
                className="eh-textarea"
                required
                minLength={10}
                rows={4}
                value={edit.quote}
                onChange={e => setEdit({ ...edit, quote: e.target.value })}
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Author name">
                <input
                  className="eh-input"
                  required
                  value={edit.authorName}
                  onChange={e =>
                    setEdit({ ...edit, authorName: e.target.value })
                  }
                />
              </Field>
              <Field label="Role / title">
                <input
                  className="eh-input"
                  value={edit.authorRole}
                  onChange={e =>
                    setEdit({ ...edit, authorRole: e.target.value })
                  }
                />
              </Field>
              <Field label="Chapter / company">
                <input
                  className="eh-input"
                  value={edit.authorChapter}
                  onChange={e =>
                    setEdit({ ...edit, authorChapter: e.target.value })
                  }
                />
              </Field>
              <Field label="Sort order (higher first)">
                <input
                  className="eh-input"
                  type="number"
                  inputMode="numeric"
                  value={edit.sortOrder}
                  onChange={e =>
                    setEdit({ ...edit, sortOrder: Number(e.target.value) || 0 })
                  }
                />
              </Field>
            </div>
            <label className="eh-check">
              <input
                type="checkbox"
                checked={edit.published}
                onChange={e =>
                  setEdit({ ...edit, published: e.target.checked })
                }
              />
              Published (show on the homepage)
            </label>
            <button
              className="eh-btn gold eh-mt"
              type="submit"
              disabled={save.isPending}
            >
              Save →
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
