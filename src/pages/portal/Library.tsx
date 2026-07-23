import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, Empty, TierPill, Spinner } from "@/components/eh";

const KIND_COLOR: Record<string, "blue" | "purple" | "green" | "gold" | "grey"> = {
  playbook: "blue", template: "green", recording: "purple", note: "grey",
};

export default function Library() {
  const q = trpc.circle.library.useQuery(undefined, { retry: false });
  const [filter, setFilter] = useState("all");
  const [q2, setQ2] = useState("");

  const list = (q.data ?? [])
    .filter((i) => filter === "all" || i.kind === filter)
    .filter((i) => !q2 || (i.title + " " + (i.description ?? "")).toLowerCase().includes(q2.toLowerCase()));

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead eyebrow="Resource library" title="Member-built, member-only"
                sub="Playbooks, templates and recordings from inside the circle. Nothing here is for sale, and nothing leaves the circle." />

      <div className="eh-between eh-mb">
        <div className="eh-tabs" style={{ margin: 0 }}>
          {["all", "playbook", "template", "recording", "note"].map((k) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
              {k === "all" ? "All" : k.charAt(0).toUpperCase() + k.slice(1) + "s"}
            </button>
          ))}
        </div>
        <input className="eh-input" style={{ maxWidth: 240 }} placeholder="Search the library…"
               value={q2} onChange={(e) => setQ2(e.target.value)} />
      </div>

      {q.isLoading && <Spinner />}
      {q.data && list.length === 0 && (
        <div className="eh-card"><Empty big="Nothing matches." p="Try a different filter or search." /></div>
      )}

      <div className="eh-grid g3">
        {list.map((i) => (
          <div className="eh-card" key={i.id} style={{ display: "flex", flexDirection: "column" }}>
            <div className="eh-between">
              <Pill color={KIND_COLOR[i.kind] ?? "grey"}>{i.kind}</Pill>
              <TierPill tier={i.tierGate} />
            </div>
            <h3 className="eh-mt">{i.title}</h3>
            <p className="eh-sm eh-muted" style={{ flex: 1 }}>{i.description}</p>
            <div className="eh-mt">
              {i.locked ? (
                <div className="eh-locked"><Pill>{i.tierGate}+</Pill><span className="eh-sm">Unlocks at {i.tierGate} tier.</span></div>
              ) : i.url ? (
                <a className="eh-btn ghost sm" href={i.url} target="_blank" rel="noreferrer">Open →</a>
              ) : (
                <Pill color="green">Available in sessions</Pill>
              )}
            </div>
          </div>
        ))}
      </div>
    </EhShell>
  );
}
