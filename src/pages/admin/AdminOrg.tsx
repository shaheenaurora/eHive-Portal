import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast, confirmDialog } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { healthBand, HEALTH_BAND_LABEL, HEALTH_BAND_COLOR } from "@contracts/constants";

type Leader = { role: string; name: string };
type Chapter = { id: number; name: string; members: number; status: string; zoneId: number | null; health: number | null };
type Zone = { id: number; name: string; code: string | null; chapters: Chapter[]; chapterCount: number; members: number; health: number | null; leaders: Leader[] };
type Region = { id: number; name: string; code: string | null; zones: Zone[]; chapterCount: number; members: number; health: number | null; leaders: Leader[] };
type Country = { id: number; name: string; code: string | null; regions: Region[]; chapterCount: number; members: number; health: number | null; leaders: Leader[] };

function Leaders({ leaders }: { leaders: Leader[] }) {
  if (!leaders?.length) return null;
  return (
    <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap", marginTop: ".3rem" }}>
      {leaders.map((l, i) => <Pill key={i} color="purple">{l.role}: {l.name}</Pill>)}
    </div>
  );
}

function HealthPill({ health }: { health: number | null }) {
  if (health == null) return null;
  const band = healthBand(health);
  return <Pill color={HEALTH_BAND_COLOR[band]}>Health {health} · {HEALTH_BAND_LABEL[band]}</Pill>;
}

function Roll({ chapters, members, health }: { chapters: number; members: number; health: number | null }) {
  return (
    <span className="eh-row" style={{ gap: ".4rem", flexWrap: "nowrap" }}>
      <Pill color="grey">{chapters} chapter{chapters === 1 ? "" : "s"}</Pill>
      <Pill color="blue">{members} member{members === 1 ? "" : "s"}</Pill>
      <HealthPill health={health} />
    </span>
  );
}

export default function AdminOrg() {
  const q = trpc.adminEngage.orgTree.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.orgTree.invalidate();
  const [add, setAdd] = useState<{ level: "zone" | "region" | "country"; parentId?: number; parentName?: string } | null>(null);
  const [council, setCouncil] = useState<{ id: number; name: string; level: string } | null>(null);

  const create = trpc.adminEngage.createOrgUnit.useMutation({
    onSuccess: () => { toast("Unit created."); refresh(); setAdd(null); },
    onError: (e) => toast(e.message),
  });
  const assign = trpc.adminEngage.setChapterZone.useMutation({
    onSuccess: () => { toast("Chapter assigned."); refresh(); },
    onError: (e) => toast(e.message),
  });

  const zones = q.data?.zones ?? [];

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Governance hierarchy" title="Organisation"
        sub="Chapter → Zone → Region → Country. Build the hierarchy and see membership roll up at every level (ZO/RE/NA · M11)." />

      <div className="eh-between eh-mb">
        <span className="eh-muted eh-sm">Roll-ups aggregate active members up the tree.</span>
        <button className="eh-btn gold sm" onClick={() => setAdd({ level: "country" })}>Add country →</button>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && q.data.countries.length === 0 && (q.data.unassigned.length === 0) &&
        <div className="eh-card"><Empty big="No hierarchy yet." p="Add a country, then regions and zones, then assign chapters to zones." /></div>}

      {q.data?.countries.map((c: Country) => (
        <div className="eh-card eh-mb" key={c.id}>
          <div className="eh-between">
            <div><span className="eh-eyebrow">Country</span><h3 style={{ margin: ".1rem 0 0" }}>{c.name} {c.code ? <span className="eh-muted eh-sm">· {c.code}</span> : null}</h3></div>
            <div className="eh-row" style={{ gap: ".5rem" }}><Roll chapters={c.chapterCount} members={c.members} health={c.health} />
              <button className="eh-btn ghost sm" onClick={() => setCouncil({ id: c.id, name: c.name, level: "country" })}>Council</button>
              <button className="eh-btn ghost sm" onClick={() => setAdd({ level: "region", parentId: c.id, parentName: c.name })}>+ Region</button></div>
          </div>
          <Leaders leaders={c.leaders} />
          {c.regions.map((r) => (
            <div key={r.id} style={{ margin: ".9rem 0 0", paddingLeft: "1rem", borderLeft: "2px solid var(--eh-border)" }}>
              <div className="eh-between">
                <div><span className="eh-eyebrow">Region</span> <b>{r.name}</b></div>
                <div className="eh-row" style={{ gap: ".5rem" }}><Roll chapters={r.chapterCount} members={r.members} health={r.health} />
                  <button className="eh-btn ghost sm" onClick={() => setCouncil({ id: r.id, name: r.name, level: "region" })}>Council</button>
                  <button className="eh-btn ghost sm" onClick={() => setAdd({ level: "zone", parentId: r.id, parentName: r.name })}>+ Zone</button></div>
              </div>
              <Leaders leaders={r.leaders} />
              {r.zones.map((z) => (
                <div key={z.id} style={{ margin: ".7rem 0 0", paddingLeft: "1rem", borderLeft: "2px solid var(--eh-border)" }}>
                  <div className="eh-between">
                    <div><span className="eh-eyebrow">Zone</span> <b>{z.name}</b></div>
                    <div className="eh-row" style={{ gap: ".5rem" }}>
                      <Roll chapters={z.chapterCount} members={z.members} health={z.health} />
                      <button className="eh-btn ghost sm" onClick={() => setCouncil({ id: z.id, name: z.name, level: "zone" })}>Council</button>
                    </div>
                  </div>
                  <Leaders leaders={z.leaders} />
                  <div className="eh-list" style={{ marginTop: ".35rem" }}>
                    {z.chapters.map((ch) => (
                      <div className="row" key={ch.id}>
                        <span className="t">{ch.name}</span>
                        <span className="eh-row" style={{ gap: ".4rem" }}><Pill color="blue">{ch.members} members</Pill><HealthPill health={ch.health} /></span>
                      </div>
                    ))}
                    {z.chapters.length === 0 && <p className="eh-sm eh-muted">No chapters in this zone yet.</p>}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}

      {q.data && q.data.unassigned.length > 0 && (
        <div className="eh-card eh-mb">
          <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>Chapters not yet in a zone</div>
          <div className="eh-list">
            {(q.data.unassigned as Chapter[]).map((ch) => (
              <div className="row" key={ch.id}>
                <div style={{ flex: 1 }}><span className="t">{ch.name}</span> <span className="eh-muted eh-sm">· {ch.members} members</span></div>
                <select className="eh-select" style={{ maxWidth: 220 }} defaultValue=""
                        onChange={(e) => e.target.value && assign.mutate({ chapterId: ch.id, zoneId: Number(e.target.value) })}>
                  <option value="" disabled>Assign to zone…</option>
                  {zones.map((z: { id: number; name: string }) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          {zones.length === 0 && <p className="eh-sm eh-muted" style={{ marginTop: ".5rem" }}>Create a country → region → zone first, then assign chapters here.</p>}
        </div>
      )}

      {add && (
        <Modal title={`Add ${add.level}${add.parentName ? ` in ${add.parentName}` : ""}`} onClose={() => setAdd(null)}>
          <AddUnit level={add.level} parentId={add.parentId} pending={create.isPending}
                   onSubmit={(name, code) => create.mutate({ level: add.level, name, code, parentId: add.parentId })} />
        </Modal>
      )}

      {council && <CouncilModal unit={council} onClose={() => setCouncil(null)} />}
    </EhShell>
  );
}

const DECISION_COLOR: Record<string, "grey" | "green" | "red" | "gold"> = {
  proposed: "grey", carried: "green", failed: "red", deferred: "gold",
};

function CouncilModal({ unit, onClose }: { unit: { id: number; name: string; level: string }; onClose: () => void }) {
  const q = trpc.adminEngage.councilView.useQuery({ unitId: unit.id }, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.councilView.invalidate({ unitId: unit.id });
  const err = (e: { message: string }) => toast(e.message);

  const createMeeting = trpc.adminEngage.councilCreateMeeting.useMutation({ onSuccess: () => { toast("Meeting scheduled."); refresh(); }, onError: err });
  const updateMeeting = trpc.adminEngage.councilUpdateMeeting.useMutation({ onSuccess: refresh, onError: err });
  const logDecision = trpc.adminEngage.councilLogDecision.useMutation({ onSuccess: () => { toast("Decision logged."); refresh(); }, onError: err });
  const decide = trpc.adminEngage.councilDecide.useMutation({ onSuccess: refresh, onError: err });

  const [mTitle, setMTitle] = useState("");
  const [mDate, setMDate] = useState("");
  const [dTitle, setDTitle] = useState("");

  const meetings = q.data?.meetings ?? [];
  const decisions = q.data?.decisions ?? [];

  return (
    <Modal title={`${unit.name} Council`} onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: "-.4rem", marginBottom: "1rem" }}>
        The {unit.level}-level leadership body. Convene meetings, keep minutes, and record the decisions it carries.
      </p>
      {q.isLoading && <Spinner />}

      {/* schedule a meeting */}
      <Field label="Schedule a council meeting">
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <input className="eh-input" style={{ flex: "1 1 160px" }} placeholder="Title, e.g. Q3 Zone Council" value={mTitle} onChange={(e) => setMTitle(e.target.value)} />
          <input className="eh-input" style={{ maxWidth: 170 }} type="datetime-local" value={mDate} onChange={(e) => setMDate(e.target.value)} />
          <button className="eh-btn gold sm" disabled={createMeeting.isPending || mTitle.trim().length < 2}
            onClick={() => createMeeting.mutate({ unitId: unit.id, title: mTitle, scheduledAt: mDate ? new Date(mDate) : undefined }, { onSuccess: () => { setMTitle(""); setMDate(""); } })}>
            Schedule
          </button>
        </div>
      </Field>

      <div className="eh-list" style={{ margin: ".4rem 0 1.2rem" }}>
        {meetings.length === 0 && <p className="eh-sm eh-muted">No meetings yet.</p>}
        {meetings.map((m) => (
          <div className="row" key={m.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <span className="t">{m.title}</span>
              <span className="eh-muted eh-sm"> · {m.scheduledAt ? fmtDate(m.scheduledAt) : "unscheduled"}</span>
              <Pill color={m.status === "held" ? "green" : m.status === "cancelled" ? "red" : "blue"}>{m.status}</Pill>
              <textarea className="eh-input" rows={2} defaultValue={m.minutes ?? ""} placeholder="Minutes…"
                style={{ width: "100%", marginTop: ".4rem", resize: "vertical" }}
                onBlur={(e) => { if (e.target.value !== (m.minutes ?? "")) updateMeeting.mutate({ id: m.id, minutes: e.target.value }); }} />
            </div>
            {m.status === "scheduled" && (
              <button className="eh-btn ghost sm" onClick={() => updateMeeting.mutate({ id: m.id, status: "held" })}>Mark held</button>
            )}
          </div>
        ))}
      </div>

      {/* decisions */}
      <Field label="Log a decision / motion">
        <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
          <input className="eh-input" style={{ flex: "1 1 200px" }} placeholder="Motion, e.g. Approve Dubai chapter charter" value={dTitle} onChange={(e) => setDTitle(e.target.value)} />
          <button className="eh-btn ghost sm" disabled={logDecision.isPending || dTitle.trim().length < 2}
            onClick={() => logDecision.mutate({ unitId: unit.id, title: dTitle }, { onSuccess: () => setDTitle("") })}>Log</button>
        </div>
      </Field>
      <div className="eh-list" style={{ marginTop: ".4rem" }}>
        {decisions.length === 0 && <p className="eh-sm eh-muted">No decisions recorded.</p>}
        {decisions.map((d) => (
          <div className="row" key={d.id} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <span className="t">{d.title}</span> <Pill color={DECISION_COLOR[d.status]}>{d.status}</Pill>
              {d.decidedAt && <span className="eh-muted eh-sm"> · {fmtDate(d.decidedAt)}</span>}
            </div>
            {d.status === "proposed" && (
              <span className="eh-row" style={{ gap: ".3rem" }}>
                <button className="eh-btn green sm" onClick={async () => { if (await confirmDialog({ title: "Record this motion as carried?", body: d.title, confirmLabel: "Carried" })) decide.mutate({ id: d.id, status: "carried" }); }}>Carried</button>
                <button className="eh-btn ghost sm" onClick={async () => { if (await confirmDialog({ title: "Record this motion as failed?", body: d.title, confirmLabel: "Failed", danger: true })) decide.mutate({ id: d.id, status: "failed" }); }}>Failed</button>
                <button className="eh-btn ghost sm" onClick={async () => { if (await confirmDialog({ title: "Defer this motion?", confirmLabel: "Defer" })) decide.mutate({ id: d.id, status: "deferred" }); }}>Defer</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AddUnit({ level, pending, onSubmit }: {
  level: string; parentId?: number; pending: boolean; onSubmit: (name: string, code?: string) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <>
      <Field label={`${level[0].toUpperCase() + level.slice(1)} name`}>
        <input className="eh-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`e.g. ${level === "country" ? "United Arab Emirates" : level === "region" ? "Gulf" : "Dubai Zone"}`} />
      </Field>
      <Field label="Code (optional)">
        <input className="eh-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. AE, GULF, DXB" />
      </Field>
      <button className="eh-btn gold" disabled={pending || name.trim().length < 2}
              onClick={() => onSubmit(name, code || undefined)}>
        {pending ? "Creating…" : `Create ${level}`}
      </button>
    </>
  );
}
