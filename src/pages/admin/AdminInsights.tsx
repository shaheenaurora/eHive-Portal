import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Spinner,
  Modal,
  Field,
  Empty,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

type Draft = {
  id?: number;
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  tag: string;
};

export default function AdminInsights() {
  const utils = trpc.useUtils();
  const q = trpc.adminEngage.insightsAdmin.useQuery(undefined, {
    retry: false,
  });
  const [edit, setEdit] = useState<Draft | null>(null);

  const save = trpc.adminEngage.saveInsight.useMutation({
    onSuccess: () => {
      toast("Insight saved.");
      setEdit(null);
      utils.adminEngage.insightsAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });
  const publish = trpc.adminEngage.setInsightPublished.useMutation({
    onSuccess: () => {
      toast("Visibility updated — the public site reflects it immediately.");
      utils.adminEngage.insightsAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });
  const del = trpc.adminEngage.deleteInsight.useMutation({
    onSuccess: () => {
      toast("Deleted.");
      utils.adminEngage.insightsAdmin.invalidate();
    },
    onError: e => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead
        eyebrow="Insights"
        title="Insights CMS"
        sub="Staff publish straight to the public site — zero vendor involvement. Draft, publish, unpublish, done."
      />

      <div className="eh-between eh-mb">
        <span className="eh-muted eh-sm">{q.data?.length ?? 0} post(s)</span>
        <button
          className="eh-btn gold"
          onClick={() =>
            setEdit({ title: "", slug: "", excerpt: "", body: "", tag: "Note" })
          }
        >
          New post →
        </button>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="Nothing published yet."
            p="The public Insights page renders whatever is published here."
          />
        </div>
      )}

      <div className="eh-list">
        {(q.data ?? []).map(p => (
          <div className="eh-card eh-mb" key={p.id}>
            <div className="eh-between">
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>{p.title}</h3>
                <div className="eh-muted eh-sm">
                  /{p.slug} · {p.tag ?? "Note"} ·{" "}
                  {p.publishedAt
                    ? `published ${fmtDate(p.publishedAt)}`
                    : "draft"}
                </div>
              </div>
              {p.publishedAt ? (
                <Pill color="green">live</Pill>
              ) : (
                <Pill>draft</Pill>
              )}
            </div>
            {p.excerpt && <p className="eh-sm eh-muted">{p.excerpt}</p>}
            <div className="eh-row">
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({
                    id: p.id,
                    title: p.title,
                    slug: p.slug,
                    excerpt: p.excerpt ?? "",
                    body: p.body ?? "",
                    tag: p.tag ?? "Note",
                  })
                }
              >
                Edit
              </button>
              <button
                className="eh-btn sm"
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate({ id: p.id, publish: !p.publishedAt })
                }
              >
                {p.publishedAt ? "Unpublish" : "Publish"}
              </button>
              <button
                className="eh-btn ghost sm"
                style={{ color: "var(--eh-red)" }}
                disabled={del.isPending}
                onClick={async () => {
                  if (
                    await confirmDialog({
                      title: "Delete this insight?",
                      body: "This permanently removes the article, including if it's published.",
                      confirmLabel: "Delete insight",
                      danger: true,
                    })
                  )
                    del.mutate({ id: p.id });
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
          title={edit.id ? "Edit post" : "New post"}
          onClose={() => setEdit(null)}
          wide
        >
          <PostForm
            value={edit}
            onChange={setEdit}
            pending={save.isPending}
            onSave={publish =>
              save.mutate({
                id: edit.id,
                title: edit.title,
                slug: edit.slug,
                excerpt: edit.excerpt || undefined,
                body: edit.body || undefined,
                tag: edit.tag || "Note",
                publish,
              })
            }
          />
        </Modal>
      )}
    </EhShell>
  );
}

function PostForm(props: {
  value: Draft;
  onChange: (d: Draft) => void;
  pending: boolean;
  onSave: (publish: boolean) => void;
}) {
  const v = props.value;
  const valid = v.title.trim().length >= 3 && v.slug.trim().length >= 3;
  return (
    <>
      <Field label="Title">
        <input
          className="eh-input"
          value={v.title}
          minLength={3}
          onChange={e => props.onChange({ ...v, title: e.target.value })}
        />
      </Field>
      <div className="eh-grid g2">
        <Field label="Slug (URL)">
          <input
            className="eh-input"
            value={v.slug}
            placeholder="my-post-title"
            onChange={e =>
              props.onChange({
                ...v,
                slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
              })
            }
          />
        </Field>
        <Field label="Tag">
          <input
            className="eh-input"
            value={v.tag}
            maxLength={64}
            onChange={e => props.onChange({ ...v, tag: e.target.value })}
          />
        </Field>
      </div>
      <Field label="Excerpt">
        <textarea
          className="eh-textarea"
          value={v.excerpt}
          maxLength={500}
          onChange={e => props.onChange({ ...v, excerpt: e.target.value })}
        />
      </Field>
      <Field label="Body">
        <textarea
          className="eh-textarea"
          style={{ minHeight: 180 }}
          value={v.body}
          maxLength={50000}
          onChange={e => props.onChange({ ...v, body: e.target.value })}
        />
      </Field>
      <div className="eh-row">
        <button
          className="eh-btn gold"
          disabled={props.pending || !valid}
          onClick={() => props.onSave(true)}
        >
          {props.pending ? "Saving…" : "Save & publish →"}
        </button>
        <button
          className="eh-btn ghost"
          disabled={props.pending || !valid}
          onClick={() => props.onSave(false)}
        >
          Save as draft
        </button>
      </div>
    </>
  );
}
