import { useState } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  LoadError,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDateTime, initials } from "@/lib/ehf";
import { TIER_LABEL } from "@contracts/constants";

const CAT_LABEL: Record<string, string> = {
  profile: "Profile",
  tier: "Tier",
  status: "Status",
  lifecycle: "Lifecycle",
  chapter: "Chapter",
};

export default function AdminRequests() {
  const { user } = useAuth();
  const meId = user?.id ?? null;
  const utils = trpc.useUtils();

  const changes = trpc.admin.memberChangeRequests.useQuery(undefined, {
    retry: false,
  });
  const tiers = trpc.admin.pendingTierRequests.useQuery(undefined, {
    retry: false,
  });

  const refresh = () => {
    utils.admin.memberChangeRequests.invalidate();
    utils.admin.pendingTierRequests.invalidate();
  };
  const decide = trpc.admin.decideMemberChange.useMutation({
    onSuccess: () => {
      toast("Decision recorded.");
      refresh();
      setReject(null);
    },
    onError: e => toast(e.message),
  });
  const decideTier = trpc.admin.decideTierRequest.useMutation({
    onSuccess: () => {
      toast("Decision recorded.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  const [reject, setReject] = useState<number | null>(null);

  const rows = changes.data ?? [];
  const tierRows = tiers.data ?? [];
  const total = rows.length + tierRows.length;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Governance · maker-checker"
        title="Change Requests"
        sub="Proposed changes to member records await a second person here. Approve or reject — the requester and member are notified, and every decision is logged."
      />

      <div className="eh-grid g4 eh-mb">
        <Metric
          k="Awaiting approval"
          v={total}
          accent={total > 0 ? "#b8862e" : undefined}
        />
        <Metric k="Record changes" v={rows.length} />
        <Metric k="Tier requests" v={tierRows.length} />
      </div>

      {changes.isError && <LoadError onRetry={() => changes.refetch()} />}
      {tiers.isError && <LoadError onRetry={() => tiers.refetch()} />}
      {(changes.isLoading || tiers.isLoading) && <Spinner />}
      {!changes.isLoading && !tiers.isLoading && total === 0 && (
        <div className="eh-card">
          <Empty
            big="Nothing to approve."
            p="Proposed member changes and tier requests land here for a second pair of eyes."
          />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="eh-eyebrow" style={{ margin: ".4rem 0 .6rem" }}>
            Member record changes
          </div>
          <div style={{ display: "grid", gap: ".7rem" }}>
            {rows.map(r => {
              const mine = meId != null && r.requestedByUserId === meId;
              return (
                <div
                  className="eh-card"
                  key={r.id}
                  style={{ borderLeft: "3px solid #b8862e" }}
                >
                  <div
                    className="eh-between"
                    style={{
                      alignItems: "flex-start",
                      gap: "1rem",
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      className="eh-row"
                      style={{
                        gap: ".75rem",
                        alignItems: "flex-start",
                        flex: "1 1 16rem",
                        minWidth: 0,
                      }}
                    >
                      <span className="eh-avatar" style={{ flex: "none" }}>
                        {initials(r.memberName)}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div
                          className="eh-row"
                          style={{
                            gap: ".5rem",
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          <Link to={`/admin/members/${r.memberId}`}>
                            <b>{r.memberName ?? `Member #${r.memberId}`}</b>
                          </Link>
                          <Pill color="gold">
                            {CAT_LABEL[r.category] ?? r.category}
                          </Pill>
                          {r.chapterName && (
                            <span className="eh-muted eh-sm">
                              {r.chapterName}
                            </span>
                          )}
                        </div>
                        <div className="eh-sm" style={{ marginTop: ".3rem" }}>
                          {r.changes.map(c => (
                            <span key={c.field}>
                              <b>{c.label}:</b> {c.from || "—"} →{" "}
                              <b>{c.to || "—"}</b>
                              {"  "}
                            </span>
                          ))}
                        </div>
                        {r.reason && (
                          <div
                            className="eh-sm eh-muted"
                            style={{ marginTop: ".2rem" }}
                          >
                            Reason: {r.reason}
                          </div>
                        )}
                        <div
                          className="eh-sm eh-muted"
                          style={{ marginTop: ".2rem" }}
                        >
                          Requested by {r.requesterName ?? "—"} ·{" "}
                          {fmtDateTime(r.createdAt)} · via {r.source}
                        </div>
                      </div>
                    </div>
                    <div
                      className="eh-row"
                      style={{ gap: ".4rem", flex: "none" }}
                    >
                      {mine ? (
                        <span
                          className="eh-sm eh-muted"
                          style={{ maxWidth: 200 }}
                        >
                          You requested this — it needs a different approver.
                        </span>
                      ) : (
                        <>
                          <button
                            className="eh-btn green sm"
                            disabled={decide.isPending}
                            onClick={async () => {
                              if (
                                await confirmDialog({
                                  title: "Approve this change?",
                                  body: "The change is applied and the member is notified.",
                                  confirmLabel: "Approve",
                                })
                              )
                                decide.mutate({
                                  id: r.id,
                                  decision: "approve",
                                });
                            }}
                          >
                            Approve
                          </button>
                          <button
                            className="eh-btn ghost sm danger"
                            disabled={decide.isPending}
                            onClick={() => setReject(r.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tierRows.length > 0 && (
        <>
          <div className="eh-eyebrow" style={{ margin: "1.2rem 0 .6rem" }}>
            Member-requested tier changes
          </div>
          <div style={{ display: "grid", gap: ".7rem" }}>
            {tierRows.map(t => (
              <div
                className="eh-card"
                key={t.req.id}
                style={{ borderLeft: "3px solid #b8862e" }}
              >
                <div
                  className="eh-between"
                  style={{
                    alignItems: "flex-start",
                    gap: "1rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    className="eh-row"
                    style={{
                      gap: ".75rem",
                      alignItems: "flex-start",
                      flex: "1 1 16rem",
                      minWidth: 0,
                    }}
                  >
                    <span className="eh-avatar" style={{ flex: "none" }}>
                      {initials(t.userName)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="eh-row"
                        style={{
                          gap: ".5rem",
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <Link to={`/admin/members/${t.member.id}`}>
                          <b>{t.userName ?? t.userEmail}</b>
                        </Link>
                        <Pill color="gold">{t.req.type}</Pill>
                      </div>
                      <div className="eh-sm" style={{ marginTop: ".3rem" }}>
                        <b>
                          {TIER_LABEL[
                            t.req.fromTier as keyof typeof TIER_LABEL
                          ] ?? t.req.fromTier}
                        </b>{" "}
                        →{" "}
                        <b>
                          {TIER_LABEL[
                            t.req.toTier as keyof typeof TIER_LABEL
                          ] ?? t.req.toTier}
                        </b>
                      </div>
                      {t.req.note && (
                        <div
                          className="eh-sm eh-muted"
                          style={{ marginTop: ".2rem" }}
                        >
                          {t.req.note}
                        </div>
                      )}
                      <div
                        className="eh-sm eh-muted"
                        style={{ marginTop: ".2rem" }}
                      >
                        {fmtDateTime(t.req.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div
                    className="eh-row"
                    style={{ gap: ".4rem", flex: "none" }}
                  >
                    <button
                      className="eh-btn green sm"
                      disabled={decideTier.isPending}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: "Approve tier change?",
                            body: "The member's tier is updated and they're notified.",
                            confirmLabel: "Approve",
                          })
                        )
                          decideTier.mutate({
                            id: t.req.id,
                            decision: "approve",
                          });
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="eh-btn ghost sm danger"
                      disabled={decideTier.isPending}
                      onClick={async () => {
                        if (
                          await confirmDialog({
                            title: "Reject tier change?",
                            confirmLabel: "Reject",
                            danger: true,
                          })
                        )
                          decideTier.mutate({
                            id: t.req.id,
                            decision: "reject",
                          });
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {reject != null && (
        <RejectModal
          pending={decide.isPending}
          onClose={() => setReject(null)}
          onConfirm={note =>
            decide.mutate({ id: reject, decision: "reject", note })
          }
        />
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

function RejectModal({
  pending,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  onClose: () => void;
  onConfirm: (note?: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <Modal title="Reject this change" onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        The requester is notified. A short reason helps them understand why.
      </p>
      <Field label="Reason (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Needs finance sign-off first"
        />
      </Field>
      <button
        className="eh-btn ghost danger"
        disabled={pending}
        onClick={() => onConfirm(note || undefined)}
      >
        {pending ? "Working…" : "Reject request"}
      </button>
    </Modal>
  );
}
