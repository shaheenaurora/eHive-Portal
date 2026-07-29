import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Modal, Field, toast } from "@/components/eh";

type Chapter = { id: number; name: string; members: number; status: string; zoneId: number | null };
type Zone = { id: number; name: string; code: string | null; chapters: Chapter[]; chapterCount: number; members: number };
type Region = { id: number; name: string; code: string | null; zones: Zone[]; chapterCount: number; members: number };
type Country = { id: number; name: string; code: string | null; regions: Region[]; chapterCount: number; members: number };

function Roll({ chapters, members }: { chapters: number; members: number }) {
  return (
    <span className="eh-row" style={{ gap: ".4rem", flexWrap: "nowrap" }}>
      <Pill color="grey">{chapters} chapter{chapters === 1 ? "" : "s"}</Pill>
      <Pill color="blue">{members} member{members === 1 ? "" : "s"}</Pill>
    </span>
  );
}

export default function AdminOrg() {
  const q = trpc.adminEngage.orgTree.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.orgTree.invalidate();
  const [add, setAdd] = useState<{ level: "zone" | "region" | "country"; parentId?: number; parentName?: string } | null>(null);

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
            <div className="eh-row" style={{ gap: ".5rem" }}><Roll chapters={c.chapterCount} members={c.members} />
              <button className="eh-btn ghost sm" onClick={() => setAdd({ level: "region", parentId: c.id, parentName: c.name })}>+ Region</button></div>
          </div>
          {c.regions.map((r) => (
            <div key={r.id} style={{ margin: ".9rem 0 0", paddingLeft: "1rem", borderLeft: "2px solid var(--eh-border)" }}>
              <div className="eh-between">
                <div><span className="eh-eyebrow">Region</span> <b>{r.name}</b></div>
                <div className="eh-row" style={{ gap: ".5rem" }}><Roll chapters={r.chapterCount} members={r.members} />
                  <button className="eh-btn ghost sm" onClick={() => setAdd({ level: "zone", parentId: r.id, parentName: r.name })}>+ Zone</button></div>
              </div>
              {r.zones.map((z) => (
                <div key={z.id} style={{ margin: ".7rem 0 0", paddingLeft: "1rem", borderLeft: "2px solid var(--eh-border)" }}>
                  <div className="eh-between">
                    <div><span className="eh-eyebrow">Zone</span> <b>{z.name}</b></div>
                    <Roll chapters={z.chapterCount} members={z.members} />
                  </div>
                  <div className="eh-list" style={{ marginTop: ".35rem" }}>
                    {z.chapters.map((ch) => (
                      <div className="row" key={ch.id}>
                        <span className="t">{ch.name}</span>
                        <Pill color="blue">{ch.members} members</Pill>
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
    </EhShell>
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
