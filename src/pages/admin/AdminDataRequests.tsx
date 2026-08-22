import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Spinner,
  LoadError,
  Empty,
  StatusPill,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";

const KIND_LABEL: Record<string, string> = {
  export: "Export",
  deletion: "Deletion",
};

const KIND_COLOR: Record<string, "blue" | "red"> = {
  export: "blue",
  deletion: "red",
};

function downloadExport(payload: Record<string, unknown>, memberId: number) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `ehive-data-export-${memberId}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AdminDataRequests() {
  const utils = trpc.useUtils();
  const list = trpc.admin.dataRequests.list.useQuery(undefined, {
    retry: false,
  });

  const refresh = () => utils.admin.dataRequests.list.invalidate();

  const exportReq = trpc.admin.dataRequests.exportData.useMutation({
    onSuccess: r => {
      downloadExport(
        r.payload as Record<string, unknown>,
        r.payload.memberId as number
      );
      toast("Export downloaded and request marked done.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const deleteReq = trpc.admin.dataRequests.deleteData.useMutation({
    onSuccess: () => {
      toast("Member data deleted and anonymised.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const markDone = trpc.admin.dataRequests.markDone.useMutation({
    onSuccess: () => {
      toast("Request marked done.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const rows = [...(list.data ?? [])].sort((a, b) => {
    if (a.status === b.status)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    return a.status === "open" ? -1 : 1;
  });

  const openCount = rows.filter(r => r.status === "open").length;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Compliance"
        title="Data Subject Requests"
        sub="PDPL export and deletion requests from members. Export builds a JSON copy, deletion anonymises the member and removes personal content while keeping financial records."
      />

      <div className="eh-grid g4 eh-mb">
        <Metric
          k="Open requests"
          v={openCount}
          accent={openCount > 0 ? "#b8862e" : undefined}
        />
        <Metric k="Total requests" v={rows.length} />
      </div>

      {list.isLoading && <Spinner />}
      {list.isError && <LoadError onRetry={() => list.refetch()} />}
      {!list.isLoading && !list.isError && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No data requests."
            p="Members can request an export or deletion from their privacy settings. Requests appear here for fulfilment."
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Member</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Requested</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const exporting =
                  exportReq.isPending &&
                  exportReq.variables?.requestId === r.id;
                const deleting =
                  deleteReq.isPending &&
                  deleteReq.variables?.requestId === r.id;
                const marking =
                  markDone.isPending && markDone.variables?.requestId === r.id;
                return (
                  <tr key={r.id}>
                    <td data-label="Member">
                      <b>{r.memberName}</b>
                      <div className="eh-sm eh-muted">Member #{r.memberId}</div>
                    </td>
                    <td data-label="Kind">
                      <Pill color={KIND_COLOR[r.kind] ?? "grey"}>
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </Pill>
                    </td>
                    <td data-label="Status">
                      <StatusPill status={r.status} />
                    </td>
                    <td data-label="Requested" className="eh-sm eh-muted">
                      {fmtDateTime(r.createdAt)}
                    </td>
                    <td>
                      <div className="eh-row" style={{ gap: ".35rem" }}>
                        {r.kind === "export" && (
                          <button
                            className="eh-btn sm"
                            disabled={exporting || deleting || marking}
                            onClick={() =>
                              exportReq.mutate({ requestId: r.id })
                            }
                          >
                            {exporting ? "Exporting…" : "Export"}
                          </button>
                        )}
                        {r.kind === "deletion" && (
                          <button
                            className="eh-btn sm ghost danger"
                            disabled={exporting || deleting || marking}
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: "Delete and anonymise member data?",
                                  body: "This cannot be undone. Financial records are kept, but all personal content is removed and the member record is anonymised.",
                                  confirmLabel: "Delete & anonymise",
                                  danger: true,
                                })
                              )
                                deleteReq.mutate({ requestId: r.id });
                            }}
                          >
                            {deleting ? "Working…" : "Delete & anonymise"}
                          </button>
                        )}
                        {r.status === "open" && (
                          <button
                            className="eh-btn sm ghost"
                            disabled={exporting || deleting || marking}
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: "Mark this request done?",
                                  body: "The member will not be notified automatically.",
                                  confirmLabel: "Mark done",
                                })
                              )
                                markDone.mutate({ requestId: r.id });
                            }}
                          >
                            {marking ? "Working…" : "Mark done"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </EhShell>
  );
}

function Metric({
  k,
  v,
  accent,
}: {
  k: string;
  v: React.ReactNode;
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
          fontSize: "2rem",
          fontWeight: 800,
          lineHeight: 1,
          color: accent ?? "var(--eh-ink)",
        }}
      >
        {v}
      </div>
    </div>
  );
}
