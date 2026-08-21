import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  TierPill,
  Spinner,
  LoadError,
  Modal,
  Field,
  toast,
} from "@/components/eh";
import { fmtDateTime, fmtDay } from "@/lib/ehf";
import { TIERS, TIER_LABEL } from "@contracts/constants";

export default function AdminPods() {
  const utils = trpc.useUtils();
  const q = trpc.admin.pods.useQuery(undefined, { retry: false });
  const [create, setCreate] = useState(false);

  const createPod = trpc.admin.createPod.useMutation({
    onSuccess: () => {
      toast("Pod created.");
      utils.admin.pods.invalidate();
      setCreate(false);
    },
    onError: e => toast(e.message),
  });

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createPod.mutate({
      name: String(f.get("name")),
      kind: String(f.get("kind")) as never,
      facilitator: String(f.get("facilitator")) || undefined,
      capacity: Number(f.get("capacity")) || 8,
      cadence: String(f.get("cadence")) || undefined,
      tierGate: String(f.get("tierGate")) as never,
      description: String(f.get("description")) || undefined,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Pods & masterminds"
        title="Rooms and rosters"
        sub="Create pods, manage rosters, schedule sessions, mark attendance and publish notes."
        actions={
          <button className="eh-btn gold" onClick={() => setCreate(true)}>
            + New pod
          </button>
        }
      />

      {q.isLoading && <Spinner />}
      {q.isError && <LoadError onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No pods yet."
            p="Create the first one — Founders Pod 1 is a good name to start with."
          />
        </div>
      )}

      <div className="eh-grid g3">
        {q.data?.map(p => (
          <div className="eh-card" key={p.id}>
            <div className="eh-between">
              <Pill color={p.kind === "mastermind" ? "purple" : "blue"}>
                {p.kind}
              </Pill>
              <TierPill tier={p.tierGate} />
            </div>
            <h3 className="eh-mt">{p.name}</h3>
            <div className="eh-list">
              <div className="row">
                <span className="d">Facilitator</span>
                <span className="t eh-sm">{p.facilitator ?? "—"}</span>
              </div>
              <div className="row">
                <span className="d">Roster</span>
                <span className="t eh-sm eh-num">
                  {p.memberCount}/{p.capacity}
                </span>
              </div>
              <div className="row">
                <span className="d">Next session</span>
                <span className="t eh-sm">
                  {p.nextSession
                    ? `${fmtDay(p.nextSession.startsAt)} ${fmtDateTime(p.nextSession.startsAt).split("·")[1]}`
                    : "—"}
                </span>
              </div>
            </div>
            <Link className="eh-btn sm eh-mt" to={`/admin/pods/${p.id}`}>
              Manage pod →
            </Link>
          </div>
        ))}
      </div>

      {create && (
        <Modal title="New pod" onClose={() => setCreate(false)}>
          <form onSubmit={onCreate}>
            <Field label="Name">
              <input
                className="eh-input"
                name="name"
                required
                minLength={2}
                placeholder="Founders Pod 3 — Product"
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Kind">
                <select className="eh-select" name="kind">
                  <option value="pod">pod</option>
                  <option value="mastermind">mastermind</option>
                </select>
              </Field>
              <Field label="Tier gate">
                <select
                  className="eh-select"
                  name="tierGate"
                  defaultValue="horizon"
                >
                  {TIERS.map(t => (
                    <option key={t} value={t}>
                      {TIER_LABEL[t]}+
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="eh-grid g2">
              <Field label="Facilitator">
                <input
                  className="eh-input"
                  name="facilitator"
                  placeholder="Name"
                />
              </Field>
              <Field label="Capacity">
                <input
                  className="eh-input"
                  name="capacity"
                  type="number"
                  min={2}
                  max={50}
                  defaultValue={8}
                />
              </Field>
            </div>
            <Field label="Cadence">
              <input
                className="eh-input"
                name="cadence"
                placeholder="Weekly, Thursdays 18:30 GST"
              />
            </Field>
            <Field label="Description">
              <textarea
                className="eh-textarea"
                name="description"
                placeholder="Who sits here and why."
              />
            </Field>
            <button
              className="eh-btn gold"
              type="submit"
              disabled={createPod.isPending}
            >
              Create pod →
            </button>
          </form>
        </Modal>
      )}
    </EhShell>
  );
}
