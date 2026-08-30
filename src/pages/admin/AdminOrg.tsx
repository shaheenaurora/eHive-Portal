import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Modal,
  Field,
  toast,
  confirmDialog,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import {
  healthBand,
  HEALTH_BAND_LABEL,
  HEALTH_BAND_COLOR,
} from "@contracts/constants";

type Leader = { id: number; role: string; name: string };
type Unit = { id: number; name: string; level: "zone" | "region" | "country" };
type Chapter = {
  id: number;
  name: string;
  members: number;
  atRisk: number;
  status: string;
  zoneId: number | null;
  health: number | null;
};
type Zone = {
  id: number;
  name: string;
  code: string | null;
  chapters: Chapter[];
  chapterCount: number;
  members: number;
  atRisk: number;
  health: number | null;
  leaders: Leader[];
};
type Region = {
  id: number;
  name: string;
  code: string | null;
  zones: Zone[];
  chapterCount: number;
  members: number;
  atRisk: number;
  health: number | null;
  leaders: Leader[];
};
type Country = {
  id: number;
  name: string;
  code: string | null;
  regions: Region[];
  chapterCount: number;
  members: number;
  atRisk: number;
  health: number | null;
  leaders: Leader[];
};

function Leaders({
  leaders,
  onRemove,
}: {
  leaders: Leader[];
  onRemove: (id: number) => void;
}) {
  if (!leaders?.length) return null;
  return (
    <div
      className="eh-row"
      style={{ gap: ".4rem", flexWrap: "wrap", marginTop: ".3rem" }}
    >
      {leaders.map(l => (
        <span
          key={l.id}
          className="eh-pill purple"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: ".35rem",
          }}
        >
          {l.role}: {l.name}
          <button
            aria-label="Remove leader"
            onClick={() => onRemove(l.id)}
            style={{
              background: "none",
              border: 0,
              color: "inherit",
              cursor: "pointer",
              fontWeight: 700,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

function AtRisk({ n }: { n: number }) {
  if (!n) return null;
  return <Pill color="red">{n} at-risk</Pill>;
}

function HealthPill({ health }: { health: number | null }) {
  if (health == null) return null;
  const band = healthBand(health);
  return (
    <Pill color={HEALTH_BAND_COLOR[band]}>
      Health {health} · {HEALTH_BAND_LABEL[band]}
    </Pill>
  );
}

function Roll({
  chapters,
  members,
  atRisk,
  health,
}: {
  chapters: number;
  members: number;
  atRisk: number;
  health: number | null;
}) {
  return (
    <span className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
      <Pill color="grey">
        {chapters} chapter{chapters === 1 ? "" : "s"}
      </Pill>
      <Pill color="blue">
        {members} member{members === 1 ? "" : "s"}
      </Pill>
      <AtRisk n={atRisk} />
      <HealthPill health={health} />
    </span>
  );
}

export default function AdminOrg() {
  const q = trpc.adminEngage.orgTree.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.orgTree.invalidate();
  const [add, setAdd] = useState<{
    level: "zone" | "region" | "country";
    parentId?: number;
    parentName?: string;
  } | null>(null);
  const [council, setCouncil] = useState<{
    id: number;
    name: string;
    level: string;
  } | null>(null);
  const [leaderFor, setLeaderFor] = useState<Unit | null>(null);
  const [edit, setEdit] = useState<
    (Unit & { code: string | null }) | null
  >(null);
  const [move, setMove] = useState<
    (Unit & { code: string | null }) | null
  >(null);

  const create = trpc.adminEngage.createOrgUnit.useMutation({
    onSuccess: () => {
      toast("Unit created.");
      refresh();
      setAdd(null);
    },
    onError: e => toast(e.message),
  });
  const assign = trpc.adminEngage.setChapterZone.useMutation({
    onSuccess: () => {
      toast("Chapter assigned.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const updateUnit = trpc.adminEngage.updateOrgUnit.useMutation({
    onSuccess: () => {
      toast("Unit updated.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const moveUnit = trpc.adminEngage.moveOrgUnit.useMutation({
    onSuccess: () => {
      toast("Unit moved.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const deleteUnit = trpc.adminEngage.deleteOrgUnit.useMutation({
    onSuccess: () => {
      toast("Unit deleted.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const removeLeader = trpc.adminEngage.removeUnitLeader.useMutation({
    onSuccess: () => {
      toast("Leader removed.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const onRemoveLeader = async (id: number) => {
    if (
      await confirmDialog({
        title: "Remove this leader?",
        body: "They lose this unit leadership role. You can reassign anytime.",
        confirmLabel: "Remove",
        danger: true,
      })
    )
      removeLeader.mutate({ id });
  };

  const onDeleteUnit = async (u: Unit & { code: string | null }) => {
    if (
      await confirmDialog({
        title: `Delete ${u.level}: ${u.name}?`,
        body: "This removes the unit, its leaders and council history. Child units and assigned chapters must be moved first.",
        confirmLabel: "Delete",
        danger: true,
      })
    )
      deleteUnit.mutate({ id: u.id });
  };

  const zones = q.data?.zones ?? [];
  const s = q.data?.summary;

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Regional command · ZO/RE/NA"
        title="Regional & Organisation"
        sub="Chapter → Zone → Region → Country. Build the hierarchy, appoint leaders, and watch membership, health and at-risk roll up at every level."
      />

      {s && (
        <div className="eh-grid g4 eh-mb">
          <Metric
            k="Structure"
            v={`${s.countries}·${s.regions}·${s.zones}`}
            n="Countries · Regions · Zones"
          />
          <Metric
            k="Chapters"
            v={s.chapters}
            n={`${s.leaders} unit leader${s.leaders === 1 ? "" : "s"}`}
          />
          <Metric k="Active members" v={s.members} n="Across the network" />
          <Metric
            k="At-risk"
            v={s.atRisk}
            n={s.avgHealth != null ? `Avg health ${s.avgHealth}` : "—"}
            accent={s.atRisk > 0 ? "var(--eh-red, #b23a2e)" : undefined}
          />
        </div>
      )}

      <div className="eh-between eh-mb">
        <span className="eh-muted eh-sm">
          Roll-ups aggregate active members up the tree.
        </span>
        <button
          className="eh-btn gold sm"
          onClick={() => setAdd({ level: "country" })}
        >
          Add country →
        </button>
      </div>

      {q.isLoading && <Spinner />}
      {q.data &&
        q.data.countries.length === 0 &&
        q.data.unassigned.length === 0 && (
          <div className="eh-card">
            <Empty
              big="No hierarchy yet."
              p="Add a country, then regions and zones, then assign chapters to zones."
            />
          </div>
        )}

      {q.data?.countries.map((c: Country) => (
        <div className="eh-card eh-mb" key={c.id}>
          <div className="eh-between">
            <div>
              <span className="eh-eyebrow">Country</span>
              <h3 style={{ margin: ".1rem 0 0" }}>
                {c.name}{" "}
                {c.code ? (
                  <span className="eh-muted eh-sm">· {c.code}</span>
                ) : null}
              </h3>
            </div>
            <div className="eh-row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
              <Roll
                chapters={c.chapterCount}
                members={c.members}
                atRisk={c.atRisk}
                health={c.health}
              />
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setLeaderFor({ id: c.id, name: c.name, level: "country" })
                }
              >
                + Leader
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setCouncil({ id: c.id, name: c.name, level: "country" })
                }
              >
                Council
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setEdit({ id: c.id, name: c.name, code: c.code, level: "country" })
                }
              >
                Edit
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setMove({ id: c.id, name: c.name, code: c.code, level: "country" })
                }
              >
                Move
              </button>
              <button
                className="eh-btn ghost sm danger"
                onClick={() =>
                  onDeleteUnit({ id: c.id, name: c.name, code: c.code, level: "country" })
                }
              >
                Delete
              </button>
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  setAdd({
                    level: "region",
                    parentId: c.id,
                    parentName: c.name,
                  })
                }
              >
                + Region
              </button>
            </div>
          </div>
          <Leaders leaders={c.leaders} onRemove={onRemoveLeader} />
          {c.regions.map(r => (
            <div
              key={r.id}
              style={{
                margin: ".9rem 0 0",
                paddingLeft: "1rem",
                borderLeft: "2px solid var(--eh-border)",
              }}
            >
              <div className="eh-between">
                <div>
                  <span className="eh-eyebrow">Region</span> <b>{r.name}</b>
                </div>
                <div
                  className="eh-row"
                  style={{ gap: ".5rem", flexWrap: "wrap" }}
                >
                  <Roll
                    chapters={r.chapterCount}
                    members={r.members}
                    atRisk={r.atRisk}
                    health={r.health}
                  />
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setLeaderFor({ id: r.id, name: r.name, level: "region" })
                    }
                  >
                    + Leader
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setCouncil({ id: r.id, name: r.name, level: "region" })
                    }
                  >
                    Council
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setEdit({ id: r.id, name: r.name, code: r.code, level: "region" })
                    }
                  >
                    Edit
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setMove({ id: r.id, name: r.name, code: r.code, level: "region" })
                    }
                  >
                    Move
                  </button>
                  <button
                    className="eh-btn ghost sm danger"
                    onClick={() =>
                      onDeleteUnit({ id: r.id, name: r.name, code: r.code, level: "region" })
                    }
                  >
                    Delete
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    onClick={() =>
                      setAdd({
                        level: "zone",
                        parentId: r.id,
                        parentName: r.name,
                      })
                    }
                  >
                    + Zone
                  </button>
                </div>
              </div>
              <Leaders leaders={r.leaders} onRemove={onRemoveLeader} />
              {r.zones.map(z => (
                <div
                  key={z.id}
                  style={{
                    margin: ".7rem 0 0",
                    paddingLeft: "1rem",
                    borderLeft: "2px solid var(--eh-border)",
                  }}
                >
                  <div className="eh-between">
                    <div>
                      <span className="eh-eyebrow">Zone</span> <b>{z.name}</b>
                    </div>
                    <div
                      className="eh-row"
                      style={{ gap: ".5rem", flexWrap: "wrap" }}
                    >
                      <Roll
                        chapters={z.chapterCount}
                        members={z.members}
                        atRisk={z.atRisk}
                        health={z.health}
                      />
                      <button
                        className="eh-btn ghost sm"
                        onClick={() =>
                          setLeaderFor({
                            id: z.id,
                            name: z.name,
                            level: "zone",
                          })
                        }
                      >
                        + Leader
                      </button>
                      <button
                        className="eh-btn ghost sm"
                        onClick={() =>
                          setCouncil({ id: z.id, name: z.name, level: "zone" })
                        }
                      >
                        Council
                      </button>
                      <button
                        className="eh-btn ghost sm"
                        onClick={() =>
                          setEdit({ id: z.id, name: z.name, code: z.code, level: "zone" })
                        }
                      >
                        Edit
                      </button>
                      <button
                        className="eh-btn ghost sm"
                        onClick={() =>
                          setMove({ id: z.id, name: z.name, code: z.code, level: "zone" })
                        }
                      >
                        Move
                      </button>
                      <button
                        className="eh-btn ghost sm danger"
                        onClick={() =>
                          onDeleteUnit({ id: z.id, name: z.name, code: z.code, level: "zone" })
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <Leaders leaders={z.leaders} onRemove={onRemoveLeader} />
                  <div className="eh-list" style={{ marginTop: ".35rem" }}>
                    {z.chapters.map(ch => (
                      <div className="row" key={ch.id}>
                        <span className="t">{ch.name}</span>
                        <span
                          className="eh-row"
                          style={{ gap: ".4rem", flexWrap: "wrap" }}
                        >
                          <Pill color="blue">{ch.members} members</Pill>
                          <AtRisk n={ch.atRisk} />
                          <HealthPill health={ch.health} />
                        </span>
                      </div>
                    ))}
                    {z.chapters.length === 0 && (
                      <p className="eh-sm eh-muted">
                        No chapters in this zone yet.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {q.data && q.data.unassigned.length > 0 && (
        <div className="eh-card eh-mb">
          <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
            Chapters not yet in a zone
          </div>
          <div className="eh-list">
            {(q.data.unassigned as Chapter[]).map(ch => (
              <div className="row" key={ch.id}>
                <div style={{ flex: 1 }}>
                  <span className="t">{ch.name}</span>{" "}
                  <span className="eh-muted eh-sm">· {ch.members} members</span>
                </div>
                <select
                  className="eh-select"
                  style={{ maxWidth: 220 }}
                  defaultValue=""
                  onChange={e =>
                    e.target.value &&
                    assign.mutate({
                      chapterId: ch.id,
                      zoneId: Number(e.target.value),
                    })
                  }
                >
                  <option value="" disabled>
                    Assign to zone…
                  </option>
                  {zones.map((z: { id: number; name: string }) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {zones.length === 0 && (
            <p className="eh-sm eh-muted" style={{ marginTop: ".5rem" }}>
              Create a country → region → zone first, then assign chapters here.
            </p>
          )}
        </div>
      )}

      {add && (
        <Modal
          title={`Add ${add.level}${add.parentName ? ` in ${add.parentName}` : ""}`}
          onClose={() => setAdd(null)}
        >
          <AddUnit
            level={add.level}
            parentId={add.parentId}
            pending={create.isPending}
            onSubmit={(name, code) =>
              create.mutate({
                level: add.level,
                name,
                code,
                parentId: add.parentId,
              })
            }
          />
        </Modal>
      )}

      {council && (
        <CouncilModal unit={council} onClose={() => setCouncil(null)} />
      )}
      {leaderFor && (
        <LeaderModal
          unit={leaderFor}
          onClose={() => setLeaderFor(null)}
          onDone={() => {
            refresh();
            setLeaderFor(null);
          }}
        />
      )}
      {edit && (
        <Modal
          title={`Edit ${edit.level}: ${edit.name}`}
          onClose={() => setEdit(null)}
        >
          <AddUnit
            level={edit.level}
            initialName={edit.name}
            initialCode={edit.code ?? ""}
            pending={updateUnit.isPending}
            onSubmit={(name, code) =>
              updateUnit.mutate(
                { id: edit.id, name, code },
                { onSuccess: () => setEdit(null) }
              )
            }
          />
        </Modal>
      )}
      {move && (
        <MoveUnitModal
          unit={move}
          units={q.data?.countries ?? []}
          pending={moveUnit.isPending}
          onClose={() => setMove(null)}
          onSubmit={parentId =>
            moveUnit.mutate(
              { id: move.id, parentId },
              { onSuccess: () => setMove(null) }
            )
          }
        />
      )}
    </EhShell>
  );
}

function Metric({
  k,
  v,
  n,
  accent,
}: {
  k: string;
  v: React.ReactNode;
  n?: string;
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
          fontSize: "1.6rem",
          fontWeight: 800,
          lineHeight: 1.1,
          color: accent ?? "var(--eh-ink)",
        }}
      >
        {v}
      </div>
      {n && (
        <div className="eh-muted eh-sm" style={{ marginTop: ".25rem" }}>
          {n}
        </div>
      )}
    </div>
  );
}

const ROLE_SUGGESTIONS: Record<string, string[]> = {
  zone: ["Zone Director", "Zone Deputy"],
  region: ["Regional Director", "Regional Deputy"],
  country: ["National Director", "National Deputy"],
};

function LeaderModal({
  unit,
  onClose,
  onDone,
}: {
  unit: Unit;
  onClose: () => void;
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [memberId, setMemberId] = useState<number | null>(null);
  const [role, setRole] = useState(
    ROLE_SUGGESTIONS[unit.level]?.[0] ?? "Director"
  );
  const members = trpc.adminEngage.assignableMembers.useQuery(
    { q: q || undefined },
    { retry: false }
  );
  const chosen = (members.data ?? []).find(m => m.id === memberId);
  const assign = trpc.adminEngage.assignUnitLeader.useMutation({
    onSuccess: () => {
      toast("Leader appointed.");
      onDone();
    },
    onError: e => toast(e.message),
  });

  return (
    <Modal title={`Appoint a leader · ${unit.name}`} onClose={onClose} wide>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Give a member a leadership role at this {unit.level}. They appear on the{" "}
        {unit.level} council and roll-ups.
      </p>
      <Field label="Member">
        {chosen ? (
          <div
            className="eh-row"
            style={{ gap: ".5rem", alignItems: "center" }}
          >
            <span className="t">{chosen.name ?? chosen.email}</span>
            <button
              className="eh-btn ghost sm"
              onClick={() => setMemberId(null)}
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              className="eh-input"
              placeholder="Search member by name / email…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <div
              className="eh-list"
              style={{ maxHeight: 200, overflowY: "auto", marginTop: ".4rem" }}
            >
              {(members.data ?? []).map(m => (
                <button
                  key={m.id}
                  className="row"
                  style={{
                    background: "none",
                    border: 0,
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onClick={() => setMemberId(m.id)}
                >
                  <span className="t">{m.name ?? m.email}</span>
                  <span className="d">{m.chapterName ?? m.email}</span>
                </button>
              ))}
              {members.data && members.data.length === 0 && (
                <p className="eh-sm eh-muted">No members match.</p>
              )}
            </div>
          </>
        )}
      </Field>
      <Field label="Role title">
        <input
          className="eh-input"
          value={role}
          onChange={e => setRole(e.target.value)}
          list="role-suggest"
        />
        <datalist id="role-suggest">
          {(ROLE_SUGGESTIONS[unit.level] ?? []).map(r => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>
      <button
        className="eh-btn gold"
        disabled={assign.isPending || !memberId || role.trim().length < 2}
        onClick={() =>
          assign.mutate({
            unitId: unit.id,
            level: unit.level,
            memberId: memberId!,
            role,
          })
        }
      >
        {assign.isPending ? "Appointing…" : "Appoint leader"}
      </button>
    </Modal>
  );
}

const DECISION_COLOR: Record<string, "grey" | "green" | "red" | "gold"> = {
  proposed: "grey",
  carried: "green",
  failed: "red",
  deferred: "gold",
};

function CouncilModal({
  unit,
  onClose,
}: {
  unit: { id: number; name: string; level: string };
  onClose: () => void;
}) {
  const q = trpc.adminEngage.councilView.useQuery(
    { unitId: unit.id },
    { retry: false }
  );
  const utils = trpc.useUtils();
  const refresh = () =>
    utils.adminEngage.councilView.invalidate({ unitId: unit.id });
  const err = (e: { message: string }) => toast(e.message);

  const createMeeting = trpc.adminEngage.councilCreateMeeting.useMutation({
    onSuccess: () => {
      toast("Meeting scheduled.");
      refresh();
    },
    onError: err,
  });
  const updateMeeting = trpc.adminEngage.councilUpdateMeeting.useMutation({
    onSuccess: refresh,
    onError: err,
  });
  const logDecision = trpc.adminEngage.councilLogDecision.useMutation({
    onSuccess: () => {
      toast("Decision logged.");
      refresh();
    },
    onError: err,
  });
  const decide = trpc.adminEngage.councilDecide.useMutation({
    onSuccess: refresh,
    onError: err,
  });

  const [mTitle, setMTitle] = useState("");
  const [mDate, setMDate] = useState("");
  const [dTitle, setDTitle] = useState("");

  const meetings = q.data?.meetings ?? [];
  const decisions = q.data?.decisions ?? [];

  return (
    <Modal title={`${unit.name} Council`} onClose={onClose}>
      <p
        className="eh-sm eh-muted"
        style={{ marginTop: "-.4rem", marginBottom: "1rem" }}
      >
        The {unit.level}-level leadership body. Convene meetings, keep minutes,
        and record the decisions it carries.
      </p>
      {q.isLoading && <Spinner />}

      {/* schedule a meeting */}
      <Field label="Schedule a council meeting">
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <input
            className="eh-input"
            style={{ flex: "1 1 160px" }}
            placeholder="Title, e.g. Q3 Zone Council"
            value={mTitle}
            onChange={e => setMTitle(e.target.value)}
          />
          <input
            className="eh-input"
            style={{ maxWidth: 170 }}
            type="datetime-local"
            value={mDate}
            onChange={e => setMDate(e.target.value)}
          />
          <button
            className="eh-btn gold sm"
            disabled={createMeeting.isPending || mTitle.trim().length < 2}
            onClick={() =>
              createMeeting.mutate(
                {
                  unitId: unit.id,
                  title: mTitle,
                  scheduledAt: mDate ? new Date(mDate) : undefined,
                },
                {
                  onSuccess: () => {
                    setMTitle("");
                    setMDate("");
                  },
                }
              )
            }
          >
            Schedule
          </button>
        </div>
      </Field>

      <div className="eh-list" style={{ margin: ".4rem 0 1.2rem" }}>
        {meetings.length === 0 && (
          <p className="eh-sm eh-muted">No meetings yet.</p>
        )}
        {meetings.map(m => (
          <div className="row" key={m.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <span className="t">{m.title}</span>
              <span className="eh-muted eh-sm">
                {" "}
                · {m.scheduledAt ? fmtDate(m.scheduledAt) : "unscheduled"}
              </span>
              <Pill
                color={
                  m.status === "held"
                    ? "green"
                    : m.status === "cancelled"
                      ? "red"
                      : "blue"
                }
              >
                {m.status}
              </Pill>
              <textarea
                className="eh-input"
                rows={2}
                defaultValue={m.minutes ?? ""}
                placeholder="Minutes…"
                style={{
                  width: "100%",
                  marginTop: ".4rem",
                  resize: "vertical",
                }}
                onBlur={e => {
                  if (e.target.value !== (m.minutes ?? ""))
                    updateMeeting.mutate({ id: m.id, minutes: e.target.value });
                }}
              />
            </div>
            {m.status === "scheduled" && (
              <button
                className="eh-btn ghost sm"
                onClick={() =>
                  updateMeeting.mutate({ id: m.id, status: "held" })
                }
              >
                Mark held
              </button>
            )}
          </div>
        ))}
      </div>

      {/* decisions */}
      <Field label="Log a decision / motion">
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <input
            className="eh-input"
            style={{ flex: "1 1 200px" }}
            placeholder="Motion, e.g. Approve Dubai chapter charter"
            value={dTitle}
            onChange={e => setDTitle(e.target.value)}
          />
          <button
            className="eh-btn ghost sm"
            disabled={logDecision.isPending || dTitle.trim().length < 2}
            onClick={() =>
              logDecision.mutate(
                { unitId: unit.id, title: dTitle },
                { onSuccess: () => setDTitle("") }
              )
            }
          >
            Log
          </button>
        </div>
      </Field>
      <div className="eh-list" style={{ marginTop: ".4rem" }}>
        {decisions.length === 0 && (
          <p className="eh-sm eh-muted">No decisions recorded.</p>
        )}
        {decisions.map(d => (
          <div className="row" key={d.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <span className="t">{d.title}</span>{" "}
              <Pill color={DECISION_COLOR[d.status]}>{d.status}</Pill>
              {d.decidedAt && (
                <span className="eh-muted eh-sm">
                  {" "}
                  · {fmtDate(d.decidedAt)}
                </span>
              )}
            </div>
            {d.status === "proposed" && (
              <span className="eh-row" style={{ gap: ".3rem" }}>
                <button
                  className="eh-btn green sm"
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Record this motion as carried?",
                        body: d.title,
                        confirmLabel: "Carried",
                      })
                    )
                      decide.mutate({ id: d.id, status: "carried" });
                  }}
                >
                  Carried
                </button>
                <button
                  className="eh-btn ghost sm"
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Record this motion as failed?",
                        body: d.title,
                        confirmLabel: "Failed",
                        danger: true,
                      })
                    )
                      decide.mutate({ id: d.id, status: "failed" });
                  }}
                >
                  Failed
                </button>
                <button
                  className="eh-btn ghost sm"
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: "Defer this motion?",
                        confirmLabel: "Defer",
                      })
                    )
                      decide.mutate({ id: d.id, status: "deferred" });
                  }}
                >
                  Defer
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AddUnit({
  level,
  initialName,
  initialCode,
  pending,
  onSubmit,
}: {
  level: string;
  initialName?: string;
  initialCode?: string;
  parentId?: number;
  pending: boolean;
  onSubmit: (name: string, code?: string) => void;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [code, setCode] = useState(initialCode ?? "");
  const isEdit = initialName != null;
  return (
    <>
      <Field label={`${level[0].toUpperCase() + level.slice(1)} name`}>
        <input
          className="eh-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={`e.g. ${level === "country" ? "United Arab Emirates" : level === "region" ? "Gulf" : "Dubai Zone"}`}
        />
      </Field>
      <Field label="Code (optional)">
        <input
          className="eh-input"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="e.g. AE, GULF, DXB"
        />
      </Field>
      <button
        className="eh-btn gold"
        disabled={pending || name.trim().length < 2}
        onClick={() => onSubmit(name, code || undefined)}
      >
        {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : `Create ${level}`}
      </button>
    </>
  );
}

function MoveUnitModal({
  unit,
  units,
  pending,
  onClose,
  onSubmit,
}: {
  unit: Unit & { code: string | null };
  units: Country[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (parentId: number | null) => void;
}) {
  const validParents: { id: number; name: string; level: string }[] = [];
  if (unit.level === "region") {
    validParents.push(...units.map(c => ({ id: c.id, name: c.name, level: "country" })));
  } else if (unit.level === "zone") {
    for (const c of units) {
      for (const r of c.regions) {
        validParents.push({ id: r.id, name: `${c.name} → ${r.name}`, level: "region" });
      }
    }
  }
  const [parentId, setParentId] = useState<number | null>(null);
  return (
    <Modal title={`Move ${unit.level}: ${unit.name}`} onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Choose the new parent. Countries cannot be moved.
      </p>
      <Field label="New parent">
        <select
          className="eh-select"
          value={parentId ?? ""}
          onChange={e => setParentId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="" disabled>
            Select {unit.level === "region" ? "country" : "region"}…
          </option>
          {validParents.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="eh-btn gold"
        disabled={pending || parentId == null}
        onClick={() => onSubmit(parentId)}
      >
        {pending ? "Moving…" : "Move unit"}
      </button>
    </Modal>
  );
}
