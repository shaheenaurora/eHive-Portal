import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, PageHead, Pill, StatusPill, Empty, Spinner, Modal, toast } from "@/components/eh";
import { fmtDate, initials } from "@/lib/ehf";

export default function Governance() {
  const utils = trpc.useUtils();
  const q = trpc.circle.governance.useQuery(undefined, { retry: false });
  const ack = trpc.circle.ackPolicy.useMutation({
    onSuccess: () => { toast("Acknowledged — thank you."); utils.circle.governance.invalidate(); },
    onError: (e) => toast(e.message),
  });
  const [readPolicy, setReadPolicy] = useState<{ id: number; title: string; body: string | null; acknowledged: boolean } | null>(null);
  const [readMinutes, setReadMinutes] = useState<{ title: string; text: string | null } | null>(null);

  if (q.isLoading) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Spinner /></EhShell>;
  if (!q.data) return <EhShell groups={MEMBER_NAV} brandSub="Member Portal"><Empty big="Governance unavailable." /></EhShell>;

  const { bodies, roles, minutes, policies, myRoles } = q.data;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead eyebrow="Governance" title="Who steers the circle"
                sub="Members steer eHive — through the elected Circle Council, published minutes and policies you can actually read." />

      {myRoles.length > 0 && (
        <div className="eh-card" style={{ borderColor: "#e8d5ac", background: "#fdfaf3" }}>
          <h3>Your seats</h3>
          <div className="eh-row">
            {myRoles.map(({ body, role }) => (
              <Pill key={role.id} color="purple">{role.seat} · {body.name}</Pill>
            ))}
          </div>
        </div>
      )}

      <div className="eh-grid g2 eh-mt" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {bodies.map((b) => (
            <div className="eh-card" key={b.id}>
              <h3>{b.name}</h3>
              <p className="eh-sm eh-muted">{b.description}</p>
              <div className="eh-list">
                {roles.filter((r) => r.body.id === b.id).map(({ role, user }) => (
                  <div className="row" key={role.id}>
                    <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                      <span className="eh-avatar">{initials(user.name)}</span>
                      <div>
                        <div className="t">{user.name ?? "Member"}</div>
                        <div className="d">Term ends {fmtDate(role.termEnd)}</div>
                      </div>
                    </div>
                    <Pill>{role.seat}</Pill>
                  </div>
                ))}
                {roles.filter((r) => r.body.id === b.id).length === 0 && (
                  <p className="eh-sm eh-muted">Seats fill at the next election cycle.</p>
                )}
              </div>
            </div>
          ))}

          <div className="eh-card">
            <h3>Minutes</h3>
            {minutes.length === 0 && <Empty big="No minutes published yet." />}
            <div className="eh-list">
              {minutes.map(({ minute, body }) => (
                <div className="row" key={minute.id}>
                  <div>
                    <div className="t">{minute.title}</div>
                    <div className="d">{body.name} · {fmtDate(minute.date)}</div>
                  </div>
                  <button className="eh-btn ghost sm" onClick={() => setReadMinutes({ title: minute.title, text: minute.text })}>
                    Read →
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="eh-card">
          <h3>Policies</h3>
          <p className="eh-sm eh-muted">Short, plain-language, version-numbered. Acknowledge each version once.</p>
          <div className="eh-list">
            {policies.map((p) => (
              <div className="row" key={p.id}>
                <div>
                  <div className="t">{p.title}</div>
                  <div className="d">Version {p.version} · {fmtDate(p.createdAt)}</div>
                </div>
                <div className="eh-row">
                  {p.acknowledged
                    ? <StatusPill status="done" />
                    : (
                      <>
                        <button className="eh-btn ghost sm" onClick={() => setReadPolicy(p)}>Read</button>
                        <button className="eh-btn gold sm" disabled={ack.isPending}
                                onClick={() => ack.mutate({ policyId: p.id })}>Acknowledge</button>
                      </>
                    )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {readPolicy && (
        <Modal title={readPolicy.title} onClose={() => setReadPolicy(null)}>
          <p className="eh-sm" style={{ whiteSpace: "pre-line", lineHeight: 1.7 }}>{readPolicy.body}</p>
          {!readPolicy.acknowledged && (
            <button className="eh-btn gold" disabled={ack.isPending}
                    onClick={() => ack.mutate({ policyId: readPolicy.id }, { onSuccess: () => setReadPolicy(null) })}>
              Acknowledge this version →
            </button>
          )}
        </Modal>
      )}

      {readMinutes && (
        <Modal title={readMinutes.title} onClose={() => setReadMinutes(null)} wide>
          <p className="eh-sm" style={{ whiteSpace: "pre-line", lineHeight: 1.75 }}>{readMinutes.text}</p>
        </Modal>
      )}
    </EhShell>
  );
}
