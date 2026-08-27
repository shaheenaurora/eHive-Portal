import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Spinner,
  LoadError,
  Modal,
  Field,
  Empty,
  toast,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

export default function AdminNewsletters() {
  const utils = trpc.useUtils();
  const q = trpc.adminEngage.newslettersAdmin.useQuery(undefined, {
    retry: false,
  });
  const [edit, setEdit] = useState<{
    id?: number;
    title: string;
    issue: string;
    url: string;
  } | null>(null);

  const save = trpc.adminEngage.saveNewsletter.useMutation({
    onSuccess: () => {
      toast("Newsletter saved to the archive.");
      setEdit(null);
      utils.adminEngage.newslettersAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });
  const del = trpc.adminEngage.deleteNewsletter.useMutation({
    onSuccess: () => {
      toast("Removed.");
      utils.adminEngage.newslettersAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead
        eyebrow="Newsletters"
        title="Newsletter archive"
        sub="Every issue, archived and linked from the public site the moment you add it."
      />

      <div className="eh-between eh-mb">
        <span className="eh-muted eh-sm">{q.data?.length ?? 0} issue(s)</span>
        <button
          className="eh-btn gold"
          onClick={() => setEdit({ title: "", issue: "", url: "" })}
        >
          Add issue →
        </button>
      </div>

      {q.isError && <LoadError onRetry={() => q.refetch()} />}
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="Archive is empty."
            p="Add past issues with a link to the PDF or web version."
          />
        </div>
      )}

      <div className="eh-card">
        <div className="eh-list">
          {(q.data ?? []).map(n => (
            <div className="row" key={n.id}>
              <div style={{ flex: 1 }}>
                <div className="t">{n.title}</div>
                <div className="d">
                  {n.issue ? `Issue ${n.issue} · ` : ""}
                  {fmtDate(n.publishedAt)}
                </div>
              </div>
              {n.url && (
                <a
                  className="eh-btn ghost sm"
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open ↗
                </a>
              )}
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({
                    id: n.id,
                    title: n.title,
                    issue: n.issue ?? "",
                    url: n.url ?? "",
                  })
                }
              >
                Edit
              </button>
              <button
                className="eh-btn ghost sm"
                style={{ color: "var(--eh-red)" }}
                disabled={del.isPending}
                onClick={() => del.mutate({ id: n.id })}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {edit && (
        <Modal
          title={edit.id ? "Edit issue" : "Add issue"}
          onClose={() => setEdit(null)}
        >
          <Field label="Title">
            <input
              className="eh-input"
              value={edit.title}
              minLength={3}
              onChange={e => setEdit({ ...edit, title: e.target.value })}
              placeholder="The Hive — March 2026"
            />
          </Field>
          <div className="eh-grid g2">
            <Field label="Issue № (optional)">
              <input
                className="eh-input"
                value={edit.issue}
                onChange={e => setEdit({ ...edit, issue: e.target.value })}
                placeholder="14"
              />
            </Field>
            <Field label="Link (PDF / web)">
              <input
                className="eh-input"
                value={edit.url}
                onChange={e => setEdit({ ...edit, url: e.target.value })}
                placeholder="https://…"
              />
            </Field>
          </div>
          <button
            className="eh-btn gold"
            style={{ width: "100%" }}
            disabled={save.isPending || edit.title.trim().length < 3}
            onClick={() =>
              save.mutate({
                id: edit.id,
                title: edit.title,
                issue: edit.issue || undefined,
                url: edit.url || undefined,
              })
            }
          >
            {save.isPending ? "Saving…" : "Save issue →"}
          </button>
        </Modal>
      )}
    </EhShell>
  );
}
