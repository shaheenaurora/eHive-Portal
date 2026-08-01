import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Field, toast } from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import { AWARD_CATEGORIES, type AwardCycleStatus } from "@contracts/constants";

const CYCLE_COLOR: Record<AwardCycleStatus, "grey" | "blue" | "gold" | "green" | "red"> = {
  draft: "grey", open: "blue", judging: "gold", announced: "green", closed: "red",
};
const NEXT: Record<AwardCycleStatus, { to: AwardCycleStatus; label: string }[]> = {
  draft: [{ to: "open", label: "Open nominations" }],
  open: [{ to: "judging", label: "Close & judge" }],
  judging: [{ to: "announced", label: "Announce winners" }],
  announced: [{ to: "closed", label: "Archive" }],
  closed: [],
};
const NOM_COLOR: Record<string, "grey" | "gold" | "green" | "red"> = {
  nominated: "grey", shortlisted: "gold", winner: "green", declined: "red",
};

export default function AdminAwards() {
  const q = trpc.adminEngage.awardsCycles.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.adminEngage.awardsCycles.invalidate();
  const err = (e: { message: string }) => toast(e.message);

  const createCycle = trpc.adminEngage.awardsCreateCycle.useMutation({ onSuccess: () => { toast("Cycle created."); refresh(); setName(""); }, onError: err });
  const setStatus = trpc.adminEngage.awardsSetCycleStatus.useMutation({ onSuccess: refresh, onError: err });

  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const cycles = q.data ?? [];

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Recognition · NA-03" title="Awards"
        sub="Run recognition cycles: open nominations to members, shortlist and name winners, then announce them to the whole Circle." />

      <div className="eh-card eh-mb">
        <Field label="New award cycle">
          <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
            <input className="eh-input" style={{ flex: "1 1 200px" }} placeholder="e.g. 2026 Annual eHive Awards" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="eh-btn gold sm" disabled={createCycle.isPending || name.trim().length < 2}
              onClick={() => createCycle.mutate({ name })}>Create cycle</button>
          </div>
        </Field>
      </div>

      {q.isLoading && <Spinner />}
      {q.data && cycles.length === 0 && <div className="eh-card"><Empty big="No award cycles yet." p="Create a cycle, open nominations, and let the Circle recognise its own." /></div>}

      {cycles.map((c) => (
        <div className="eh-card eh-mb" key={c.id}>
          <div className="eh-between" style={{ flexWrap: "wrap", gap: ".6rem" }}>
            <div>
              <div className="eh-row" style={{ gap: ".5rem", alignItems: "center" }}>
                <b style={{ fontSize: "1.05rem" }}>{c.name}</b>
                <Pill color={CYCLE_COLOR[c.status]}>{c.status}</Pill>
                <span className="eh-muted eh-sm">{c.nominations} nomination{c.nominations === 1 ? "" : "s"}</span>
              </div>
              <p className="eh-sm eh-muted" style={{ margin: ".25rem 0 0" }}>Created {fmtDate(c.createdAt)}</p>
            </div>
            <div className="eh-row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
              {NEXT[c.status].map((n) => (
                <button key={n.to} className="eh-btn gold sm" disabled={setStatus.isPending}
                  onClick={() => setStatus.mutate({ id: c.id, status: n.to })}>{n.label}</button>
              ))}
              <button className="eh-btn ghost sm" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                {openId === c.id ? "Hide nominations" : "Manage nominations"}
              </button>
            </div>
          </div>
          {openId === c.id && <Nominations cycleId={c.id} />}
        </div>
      ))}
    </EhShell>
  );
}

function Nominations({ cycleId }: { cycleId: number }) {
  const q = trpc.adminEngage.awardsNominations.useQuery({ cycleId }, { retry: false });
  const utils = trpc.useUtils();
  const setStatus = trpc.adminEngage.awardsSetNominationStatus.useMutation({
    onSuccess: () => utils.adminEngage.awardsNominations.invalidate({ cycleId }),
    onError: (e) => toast(e.message),
  });
  const noms = q.data ?? [];

  return (
    <div style={{ marginTop: "1rem", borderTop: "1px solid var(--eh-border)", paddingTop: "1rem" }}>
      {q.isLoading && <Spinner />}
      {q.data && noms.length === 0 && <p className="eh-sm eh-muted">No nominations yet in this cycle.</p>}
      {AWARD_CATEGORIES.map((cat) => {
        const inCat = noms.filter((n) => n.category === cat.key);
        if (!inCat.length) return null;
        return (
          <div key={cat.key} style={{ marginBottom: "1rem" }}>
            <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>{cat.label}</div>
            <div className="eh-list">
              {inCat.map((n) => (
                <div className="row" key={n.id} style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <span className="t">{n.nomineeName ?? n.nomineeChapterName ?? "—"}</span>
                    <Pill color={NOM_COLOR[n.status]}>{n.status}</Pill>
                    {n.nominatedByName && <span className="eh-muted eh-sm"> · by {n.nominatedByName}</span>}
                    {n.citation && <div className="d">{n.citation}</div>}
                  </div>
                  <span className="eh-row" style={{ gap: ".3rem" }}>
                    <button className="eh-btn ghost sm" disabled={n.status === "shortlisted"} onClick={() => setStatus.mutate({ id: n.id, status: "shortlisted" })}>Shortlist</button>
                    <button className="eh-btn green sm" disabled={n.status === "winner"} onClick={() => setStatus.mutate({ id: n.id, status: "winner" })}>Winner</button>
                    <button className="eh-btn ghost sm" disabled={n.status === "declined"} onClick={() => setStatus.mutate({ id: n.id, status: "declined" })}>Decline</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
