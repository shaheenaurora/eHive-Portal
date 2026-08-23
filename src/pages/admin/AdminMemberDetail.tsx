import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  EhShell,
  ADMIN_NAV,
  StatusPill,
  TierPill,
  Empty,
  Spinner,
  Modal,
  Field,
  Pill,
  RefCode,
  toast,
} from "@/components/eh";
import { AdminKycPanel } from "@/components/AdminKycPanel";
import { fmtDate, fmtDateTime, initials, relDay } from "@/lib/ehf";
import {
  SCORE_FACTORS,
  SCORE_FACTOR_LABEL,
  TIERS,
  TIER_LABEL,
  MEMBER_LIFECYCLE_LABEL,
  MEMBER_LIFECYCLE_COLOR,
  MEMBER_LIFECYCLE_DESC,
  MEMBER_LIFECYCLE_TRANSITIONS,
} from "@contracts/constants";

type ChangeCategory = "tier" | "status" | "lifecycle";
type Opt = { value: string; label: string };

const STATUS_OPTS: Opt[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "cancelled", label: "Terminated (cancel membership)" },
];
const CHANGE_REQ_COLOR: Record<
  string,
  "grey" | "blue" | "gold" | "green" | "red"
> = {
  pending: "gold",
  approved: "green",
  rejected: "red",
  applied: "blue",
  cancelled: "grey",
};

export default function AdminMemberDetail() {
  const { id } = useParams<{ id: string }>();
  const mid = Number(id);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isFullAdmin = !user?.adminScopes || user.adminScopes === "*";

  const q = trpc.admin.memberDetail.useQuery({ id: mid }, { retry: false });
  const activity = trpc.admin.memberActivity.useQuery(
    { id: mid },
    { retry: false }
  );
  const pending = trpc.admin.memberChangeRequests.useQuery(
    { memberId: mid, includeDecided: true },
    { retry: false }
  );

  const [adjust, setAdjust] = useState(false);
  const [adjForm, setAdjForm] = useState({
    factor: "contribution",
    points: 5,
    note: "",
  });
  const [editProfile, setEditProfile] = useState(false);
  const [change, setChange] = useState<{
    category: ChangeCategory;
    title: string;
    current: string;
    options: Opt[];
  } | null>(null);

  const invalidate = () => {
    utils.admin.memberDetail.invalidate({ id: mid });
    utils.admin.members.invalidate();
    utils.admin.memberActivity.invalidate({ id: mid });
    utils.admin.memberChangeRequests.invalidate({
      memberId: mid,
      includeDecided: true,
    });
  };

  const adjustScore = trpc.admin.adjustScore.useMutation({
    onSuccess: () => {
      toast("Score adjusted.");
      invalidate();
      setAdjust(false);
    },
    onError: e => toast(e.message),
  });
  const chapters = trpc.adminEngage.chaptersAdmin.useQuery(undefined, {
    retry: false,
  });
  const setChapter = trpc.adminEngage.setHomeChapter.useMutation({
    onSuccess: () => {
      toast("Home chapter updated.");
      invalidate();
    },
    onError: e => toast(e.message),
  });
  const suggest = trpc.admin.suggestPodPlacement.useQuery(
    { id: mid },
    { retry: false }
  );
  const addToPod = trpc.admin.addToPod.useMutation({
    onSuccess: () => {
      toast("Added to the pod.");
      invalidate();
      utils.admin.suggestPodPlacement.invalidate({ id: mid });
    },
    onError: e => toast(e.message),
  });

  if (q.isLoading)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Spinner />
      </EhShell>
    );
  if (!q.data)
    return (
      <EhShell groups={ADMIN_NAV} brandSub="Admin">
        <Empty big="Member not found." />
      </EhShell>
    );

  const {
    member,
    userName,
    userEmail,
    pods,
    applications,
    actionItems,
    scoreHistory,
    eventRegs,
  } = q.data;
  const openRequests = (pending.data ?? []).filter(r => r.status === "pending");

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      {isMobile && (
        <button
          className="eh-btn ghost sm eh-mb"
          onClick={() => navigate(-1)}
          style={{ background: "var(--eh-card, #fff)" }}
        >
          ← Back
        </button>
      )}
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">
            <Link to="/admin/members" style={{ color: "inherit" }}>
              ← Members
            </Link>
          </div>
          <h1 className="eh-h1">
            <span
              className="eh-avatar"
              style={{
                display: "inline-grid",
                marginRight: ".6rem",
                verticalAlign: "-.3rem",
              }}
            >
              {initials(userName)}
            </span>
            {userName ?? "Member"}
          </h1>
          <p className="eh-sub">
            {userEmail} · {member.title ?? ""}
            {member.title && member.company ? " at " : ""}
            {member.company ?? ""}
          </p>
          <div
            className="eh-row"
            style={{ gap: ".4rem", marginTop: ".4rem", flexWrap: "wrap" }}
          >
            <RefCode
              type="member"
              id={member.id}
              title="Member ID — click to copy"
            />
            {member.homeChapterId && (
              <RefCode
                type="chapter"
                id={member.homeChapterId}
                title="Home chapter ID"
              />
            )}
          </div>
        </div>
        <div
          className="eh-row"
          style={{ gap: ".5rem", flexWrap: "wrap", alignItems: "center" }}
        >
          <TierPill tier={member.tier} />
          <Pill color={MEMBER_LIFECYCLE_COLOR[member.lifecycleState] ?? "grey"}>
            {MEMBER_LIFECYCLE_LABEL[member.lifecycleState] ??
              member.lifecycleState}
          </Pill>
          <StatusPill status={member.status} />
          <Pill color="gold">Score {member.hiveScore}</Pill>
          <button
            className="eh-btn ghost sm"
            onClick={() => setEditProfile(true)}
          >
            Edit profile
          </button>
        </div>
      </div>

      {openRequests.length > 0 && (
        <div
          className="eh-card eh-mb"
          style={{ borderColor: "#e8d5ac", background: "#fdfaf3" }}
        >
          <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
            Pending change requests · awaiting approval
          </div>
          <div className="eh-list">
            {openRequests.map(r => (
              <div
                className="row"
                key={r.id}
                style={{ alignItems: "flex-start" }}
              >
                <div style={{ flex: 1 }}>
                  <b>{r.category}</b>{" "}
                  <span className="eh-muted eh-sm">
                    · requested by {r.requesterName ?? "—"}
                  </span>
                  <div className="d">
                    {r.changes
                      .map(c => `${c.label}: ${c.from || "—"} → ${c.to || "—"}`)
                      .join("; ")}
                    {r.reason ? ` — ${r.reason}` : ""}
                  </div>
                </div>
                <Link className="eh-btn ghost sm" to="/admin/requests">
                  Review →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Lifecycle</h3>
            <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
              {MEMBER_LIFECYCLE_DESC[member.lifecycleState] ?? ""}
            </p>
            <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
              {(MEMBER_LIFECYCLE_TRANSITIONS[member.lifecycleState] ?? []).map(
                t => (
                  <button
                    key={t.to}
                    className="eh-btn sm ghost"
                    onClick={() =>
                      setChange({
                        category: "lifecycle",
                        title: `Move to ${MEMBER_LIFECYCLE_LABEL[t.to] ?? t.to}`,
                        current: member.lifecycleState,
                        options: [
                          {
                            value: t.to,
                            label: MEMBER_LIFECYCLE_LABEL[t.to] ?? t.to,
                          },
                        ],
                      })
                    }
                  >
                    {t.label} →
                  </button>
                )
              )}
              {(MEMBER_LIFECYCLE_TRANSITIONS[member.lifecycleState] ?? [])
                .length === 0 && (
                <span className="eh-sm eh-muted">No onward transitions.</span>
              )}
            </div>
            <p
              className="eh-sm eh-muted"
              style={{ marginBottom: 0, marginTop: ".7rem" }}
            >
              Lifecycle moves are logged and routed for approval (a full admin
              can apply immediately).
            </p>
          </div>

          <AdminKycPanel memberId={member.id} />

          <div className="eh-card">
            <h3>Controls</h3>
            <div className="eh-list eh-mb">
              <div className="row">
                <span className="d">Tier</span>
                <span className="t eh-row" style={{ gap: ".5rem" }}>
                  <TierPill tier={member.tier} />
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setChange({
                        category: "tier",
                        title: "Change tier",
                        current: member.tier,
                        options: TIERS.map(t => ({
                          value: t,
                          label: TIER_LABEL[t],
                        })),
                      })
                    }
                  >
                    Change
                  </button>
                </span>
              </div>
              <div className="row">
                <span className="d">Status</span>
                <span className="t eh-row" style={{ gap: ".5rem" }}>
                  <StatusPill status={member.status} />
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setChange({
                        category: "status",
                        title: "Change status",
                        current: member.status,
                        options: STATUS_OPTS,
                      })
                    }
                  >
                    Change
                  </button>
                </span>
              </div>
            </div>
            <Field label="Home chapter">
              <select
                className="eh-select"
                value={member.homeChapterId ?? ""}
                onChange={e =>
                  setChapter.mutate({
                    memberId: mid,
                    chapterId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">Unassigned</option>
                {(chapters.data ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.city ? ` — ${c.city}` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <button className="eh-btn ghost sm" onClick={() => setAdjust(true)}>
              Adjust Hive Score →
            </button>
            <hr className="eh-divider" />
            <div className="eh-list">
              <div className="row">
                <span className="d">Joined</span>
                <span className="t eh-sm">{fmtDate(member.joinedAt)}</span>
              </div>
              <div className="row">
                <span className="d">Renews</span>
                <span className="t eh-sm">{fmtDate(member.renewalAt)}</span>
              </div>
              <div className="row">
                <span className="d">Phone</span>
                <span className="t eh-sm">{member.phone ?? "—"}</span>
              </div>
            </div>
          </div>

          <div className="eh-card">
            <h3>Applications ({applications.length})</h3>
            <div className="eh-list">
              {applications.map(a => (
                <div className="row" key={a.id}>
                  <div>
                    <div className="t">{TIER_LABEL[a.tierRequested]}</div>
                    <div className="d">{fmtDate(a.createdAt)}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
              {applications.length === 0 && <Empty big="No applications." />}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Activity</h3>
            <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
              Everything this member has done and everything done to their
              record — one ledger.
            </p>
            {activity.isLoading && <Spinner />}
            {activity.data && activity.data.length === 0 && (
              <Empty big="No activity yet." />
            )}
            <div className="eh-timeline">
              {(activity.data ?? []).map((a, i) => (
                <div className="ev" key={i}>
                  <div className="w">{fmtDateTime(a.at)}</div>
                  <div className="x">
                    <span aria-hidden style={{ marginRight: ".4rem" }}>
                      {a.icon}
                    </span>
                    {a.title}
                  </div>
                  {a.detail && <div className="n">{a.detail}</div>}
                  {a.actor && (
                    <div className="n eh-muted" style={{ fontSize: ".75rem" }}>
                      by {a.actor}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Pods ({pods.length})</h3>
            {pods.length === 0 && <Empty big="Not in any pod." />}
            <div className="eh-list">
              {pods.map(({ pod, role }) => (
                <div className="row" key={pod.id}>
                  <div>
                    <div className="t">{pod.name}</div>
                    <div className="d">
                      {pod.kind} · {role}
                    </div>
                  </div>
                  <Link
                    className="eh-btn ghost sm"
                    to={`/admin/pods/${pod.id}`}
                  >
                    Manage →
                  </Link>
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Suggested PODs</h3>
            <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
              Matched on sector mix, peer tier and non-competition (PD-01).
            </p>
            {(() => {
              const fits = (suggest.data ?? [])
                .filter(s => !s.blocked)
                .slice(0, 3);
              if (suggest.data && fits.length === 0)
                return (
                  <Empty
                    big="No suitable pod."
                    p="Pods are full, tier-mismatched, or would create a conflict of interest."
                  />
                );
              return (
                <div className="eh-list">
                  {fits.map(s => (
                    <div className="row" key={s.podId}>
                      <div style={{ flex: 1 }}>
                        <div className="t">
                          {s.name}{" "}
                          <Pill color={s.score >= 70 ? "green" : "gold"}>
                            match {s.score}
                          </Pill>
                        </div>
                        <div className="d">{s.reason}</div>
                      </div>
                      <button
                        className="eh-btn sm gold"
                        disabled={addToPod.isPending}
                        onClick={() =>
                          addToPod.mutate({ podId: s.podId, memberId: mid })
                        }
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          <div className="eh-card">
            <h3>Action items ({actionItems.length})</h3>
            {actionItems.length === 0 && <Empty big="No commitments." />}
            <div className="eh-list">
              {actionItems.map(a => (
                <div className="row" key={a.id}>
                  <div>
                    <div className="t">{a.text}</div>
                    <div className="d">Due {relDay(a.dueAt)}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Event registrations ({eventRegs.length})</h3>
            <div className="eh-list">
              {eventRegs.map(({ ev, status }) => (
                <div className="row" key={ev.id}>
                  <div>
                    <div className="t">{ev.title}</div>
                    <div className="d">{fmtDateTime(ev.startsAt)}</div>
                  </div>
                  <StatusPill status={status} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="eh-card">
            <h3>Change history</h3>
            {(pending.data ?? []).length === 0 && (
              <Empty big="No changes recorded." />
            )}
            <div className="eh-list">
              {(pending.data ?? []).map(r => (
                <div
                  className="row"
                  key={r.id}
                  style={{ alignItems: "flex-start" }}
                >
                  <div style={{ flex: 1 }}>
                    <div className="t">
                      {r.category}{" "}
                      <Pill color={CHANGE_REQ_COLOR[r.status]}>{r.status}</Pill>
                    </div>
                    <div className="d">
                      {r.changes
                        .map(c => `${c.label}: ${c.to || "—"}`)
                        .join("; ")}
                    </div>
                    <div className="d eh-muted">
                      {fmtDate(r.decidedAt ?? r.createdAt)} ·{" "}
                      {r.requesterName ?? "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="eh-card">
            <h3>Score history</h3>
            {scoreHistory.length === 0 && <Empty big="No snapshots yet." />}
            <div className="eh-timeline">
              {scoreHistory.map(h => (
                <div className="ev" key={h.id}>
                  <div className="w">{fmtDateTime(h.computedAt)}</div>
                  <div className="x">Score {h.score}</div>
                  {h.breakdown && (
                    <div className="n">
                      {Object.entries(
                        JSON.parse(h.breakdown) as Record<string, number>
                      )
                        .filter(([, v]) => v > 0)
                        .map(
                          ([k, v]) =>
                            `${SCORE_FACTOR_LABEL[k as keyof typeof SCORE_FACTOR_LABEL] ?? k} ${v}`
                        )
                        .join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {adjust && (
        <Modal title="Adjust Hive Score" onClose={() => setAdjust(false)}>
          <div className="eh-grid g2">
            <Field label="Factor">
              <select
                className="eh-select"
                value={adjForm.factor}
                onChange={e =>
                  setAdjForm({ ...adjForm, factor: e.target.value })
                }
              >
                {SCORE_FACTORS.map(f => (
                  <option key={f} value={f}>
                    {SCORE_FACTOR_LABEL[f]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Points (−50 … +50)">
              <input
                className="eh-input"
                type="number"
                min={-50}
                max={50}
                value={adjForm.points}
                onChange={e =>
                  setAdjForm({ ...adjForm, points: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <Field label="Reason (shown in the member's ledger)">
            <input
              className="eh-input"
              value={adjForm.note}
              onChange={e => setAdjForm({ ...adjForm, note: e.target.value })}
            />
          </Field>
          <button
            className="eh-btn gold"
            disabled={adjustScore.isPending}
            onClick={() =>
              adjustScore.mutate({
                memberId: mid,
                factor: adjForm.factor,
                points: adjForm.points,
                note: adjForm.note || undefined,
              })
            }
          >
            Apply adjustment →
          </button>
        </Modal>
      )}

      {editProfile && (
        <EditProfileModal
          memberId={mid}
          initial={{
            name: userName ?? "",
            email: userEmail ?? "",
            phone: member.phone ?? "",
            title: member.title ?? "",
            company: member.company ?? "",
            sector: member.sector ?? "",
            stage: member.stage ?? "",
            goals: member.goals ?? "",
          }}
          onClose={() => setEditProfile(false)}
          onSaved={() => {
            invalidate();
            setEditProfile(false);
          }}
        />
      )}

      {change && (
        <ChangeModal
          memberId={mid}
          isFullAdmin={isFullAdmin}
          spec={change}
          onClose={() => setChange(null)}
          onDone={() => {
            invalidate();
            setChange(null);
          }}
        />
      )}
    </EhShell>
  );
}

function EditProfileModal({
  memberId,
  initial,
  onClose,
  onSaved,
}: {
  memberId: number;
  initial: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState(initial);
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));
  const save = trpc.admin.editMemberProfile.useMutation({
    onSuccess: r => {
      toast(r.changed ? "Profile updated." : "No changes.");
      onSaved();
    },
    onError: e => toast(e.message),
  });
  return (
    <Modal title="Edit member profile" onClose={onClose} wide>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Profile edits apply immediately and are written to the member's activity
        ledger.
      </p>
      <div className="eh-grid g2">
        <Field label="Name">
          <input
            className="eh-input"
            value={f.name}
            onChange={e => set("name", e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            className="eh-input"
            type="email"
            value={f.email}
            onChange={e => set("email", e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className="eh-input"
            value={f.phone}
            onChange={e => set("phone", e.target.value)}
          />
        </Field>
        <Field label="Title">
          <input
            className="eh-input"
            value={f.title}
            onChange={e => set("title", e.target.value)}
          />
        </Field>
        <Field label="Company">
          <input
            className="eh-input"
            value={f.company}
            onChange={e => set("company", e.target.value)}
          />
        </Field>
        <Field label="Sector">
          <input
            className="eh-input"
            value={f.sector}
            onChange={e => set("sector", e.target.value)}
          />
        </Field>
        <Field label="Stage">
          <input
            className="eh-input"
            value={f.stage}
            onChange={e => set("stage", e.target.value)}
          />
        </Field>
        <Field label="Goals">
          <input
            className="eh-input"
            value={f.goals}
            onChange={e => set("goals", e.target.value)}
          />
        </Field>
      </div>
      <button
        className="eh-btn gold"
        disabled={save.isPending}
        onClick={() =>
          save.mutate({
            memberId,
            name: f.name,
            email: f.email,
            phone: f.phone,
            title: f.title,
            company: f.company,
            sector: f.sector,
            stage: f.stage,
            goals: f.goals,
          })
        }
      >
        {save.isPending ? "Saving…" : "Save changes"}
      </button>
    </Modal>
  );
}

function ChangeModal({
  memberId,
  isFullAdmin,
  spec,
  onClose,
  onDone,
}: {
  memberId: number;
  isFullAdmin: boolean;
  spec: {
    category: ChangeCategory;
    title: string;
    current: string;
    options: Opt[];
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const first =
    spec.options.find(o => o.value !== spec.current) ?? spec.options[0];
  const [to, setTo] = useState(first?.value ?? "");
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(false);
  const toLabel = spec.options.find(o => o.value === to)?.label ?? to;
  const changes = [
    {
      field: spec.category,
      label: spec.category[0].toUpperCase() + spec.category.slice(1),
      from: spec.current,
      to,
    },
  ];

  const propose = trpc.admin.proposeMemberChange.useMutation({
    onSuccess: () => {
      toast("Change requested — awaiting approval.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  const applyNow = trpc.admin.applyMemberChangeNow.useMutation({
    onSuccess: () => {
      toast("Change applied.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  const pending = propose.isPending || applyNow.isPending;
  const submit = () => {
    if (!reason.trim()) {
      toast("A reason is required.");
      return;
    }
    if (now && isFullAdmin)
      applyNow.mutate({ memberId, category: spec.category, changes, reason });
    else propose.mutate({ memberId, category: spec.category, changes, reason });
  };

  return (
    <Modal title={spec.title} onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        This is a high-impact change. It's routed for approval and the member is
        notified
        {isFullAdmin ? ", or you can apply it immediately as a full admin" : ""}
        .
      </p>
      <Field label="Change to">
        <select
          className="eh-select"
          value={to}
          onChange={e => setTo(e.target.value)}
        >
          {spec.options.map(o => (
            <option
              key={o.value}
              value={o.value}
              disabled={o.value === spec.current}
            >
              {o.label}
              {o.value === spec.current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason (required — recorded and shown to the member)">
        <input
          className="eh-input"
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Why this change is being made…"
        />
      </Field>
      {isFullAdmin && (
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
            checked={now}
            onChange={e => setNow(e.target.checked)}
            style={{ accentColor: "#b8862e" }}
          />
          <span className="eh-sm">
            Apply immediately (management discretion) — skip approval
          </span>
        </label>
      )}
      <button
        className={`eh-btn ${now && isFullAdmin ? "gold" : ""}`}
        disabled={pending || to === spec.current}
        onClick={submit}
      >
        {pending
          ? "Working…"
          : now && isFullAdmin
            ? `Apply now → ${toLabel}`
            : `Request change → ${toLabel}`}
      </button>
    </Modal>
  );
}
