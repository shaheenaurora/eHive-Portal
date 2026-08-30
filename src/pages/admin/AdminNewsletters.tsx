import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Spinner,
  LoadError,
  Modal,
  Field,
  Empty,
  toast,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

type Tab = "archive" | "subscribers";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function subscribersCsv(rows: { email: string; name: string | null; status: string; createdAt: Date }[]): string {
  const lines = ["Email,Name,Status,Subscribed"];
  for (const r of rows) {
    lines.push(
      [csvCell(r.email), csvCell(r.name ?? ""), csvCell(r.status), csvCell(fmtDate(r.createdAt))].join(",")
    );
  }
  return lines.join("\n");
}

export default function AdminNewsletters() {
  const [tab, setTab] = useState<Tab>("archive");
  const utils = trpc.useUtils();
  const q = trpc.adminEngage.newslettersAdmin.useQuery(undefined, {
    retry: false,
  });
  const subs = trpc.adminEngage.newsletterSubscribers.useQuery(undefined, {
    retry: false,
    enabled: tab === "subscribers",
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
  const updateSub = trpc.adminEngage.updateNewsletterSubscriber.useMutation({
    onSuccess: () => {
      toast("Subscriber updated.");
      utils.adminEngage.newsletterSubscribers.invalidate();
    },
    onError: e => toast(e.message),
  });

  function exportCsv() {
    if (!subs.data?.length) return;
    const blob = new Blob([subscribersCsv(subs.data)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ehive-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead
        eyebrow="Newsletters"
        title="Newsletter archive & subscribers"
        sub="Archive every issue and manage the real subscriber list that the public site feeds into."
      />

      <div className="eh-tabs eh-mb" role="tablist">
        <button
          className={tab === "archive" ? "on" : ""}
          role="tab"
          aria-selected={tab === "archive"}
          onClick={() => setTab("archive")}
        >
          Archive
        </button>
        <button
          className={tab === "subscribers" ? "on" : ""}
          role="tab"
          aria-selected={tab === "subscribers"}
          onClick={() => setTab("subscribers")}
        >
          Subscribers
        </button>
      </div>

      {tab === "archive" && (
        <>
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
        </>
      )}

      {tab === "subscribers" && (
        <>
          <div className="eh-between eh-mb">
            <span className="eh-muted eh-sm">
              {subs.data?.length ?? 0} subscriber(s)
            </span>
            <button
              className="eh-btn gold"
              disabled={!subs.data?.length}
              onClick={exportCsv}
            >
              Export CSV ↓
            </button>
          </div>

          {subs.isError && <LoadError onRetry={() => subs.refetch()} />}
          {subs.isLoading && <Spinner />}
          {subs.data && subs.data.length === 0 && (
            <div className="eh-card">
              <Empty
                big="No subscribers yet."
                p="Public-site newsletter signups will appear here automatically."
              />
            </div>
          )}

          {subs.data && subs.data.length > 0 && (
            <div className="eh-card">
              <div className="eh-list">
                {subs.data.map(s => (
                  <div className="row" key={s.id}>
                    <div style={{ flex: 1 }}>
                      <div className="t">{s.email}</div>
                      <div className="d">
                        {s.name ? `${s.name} · ` : ""}
                        {s.sourcePage ? `${s.sourcePage} · ` : ""}
                        {fmtDate(s.createdAt)}
                      </div>
                    </div>
                    <div className="eh-row" style={{ gap: ".5rem" }}>
                      <Pill color={s.status === "subscribed" ? "green" : "grey"}>
                        {s.status}
                      </Pill>
                      <button
                        className="eh-btn ghost sm"
                        disabled={updateSub.isPending}
                        onClick={() =>
                          updateSub.mutate({
                            id: s.id,
                            status:
                              s.status === "subscribed"
                                ? "unsubscribed"
                                : "subscribed",
                          })
                        }
                      >
                        {s.status === "subscribed" ? "Unsubscribe" : "Resubscribe"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

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
