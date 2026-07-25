import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { EhShell, ADMIN_NAV, PageHead, Pill, Empty, Spinner, Field, toast } from "@/components/eh";
import { ADMIN_SCOPES } from "@contracts/constants";

type ScopeKey = (typeof ADMIN_SCOPES)[number]["key"];

function scopeSet(csv: string | null): Set<string> {
  return new Set((csv ?? "").split(",").map((s) => s.trim()).filter(Boolean));
}

export default function AdminAccess() {
  const { user } = useAuth();
  const roster = trpc.admin.adminRoster.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.admin.adminRoster.invalidate();

  const setAccess = trpc.admin.setAdminAccess.useMutation({
    onSuccess: () => { toast("Access updated."); refresh(); },
    onError: (e) => toast(e.message),
  });
  const grant = trpc.admin.grantAdminByEmail.useMutation({
    onSuccess: (r) => { toast(`${r.name} is now an admin.`); refresh(); setEmail(""); setNewScopes(new Set()); },
    onError: (e) => toast(e.message),
  });

  const iAmFull = !user?.adminScopes || user.adminScopes === "*";
  const [email, setEmail] = useState("");
  const [newScopes, setNewScopes] = useState<Set<string>>(new Set());

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead eyebrow="Team & access" title="Admin roles & permissions"
        sub="Segregation of duties for the eHive Circle team. Give each staff member only the capabilities their role needs — mirroring the org structure." />

      {!iAmFull && (
        <div className="eh-locked eh-mb">
          <Pill>Read-only</Pill>
          <span className="eh-sm">Only a full administrator (Director eHive Circle / COO) can change team access. You can view the current setup below.</span>
        </div>
      )}

      {roster.isLoading && <Spinner />}
      {roster.isError && (
        <div className="eh-card"><Empty big="Couldn't load the team." p="There was a problem reaching the server." />
          <div style={{ textAlign: "center" }}><button className="eh-btn ghost" onClick={() => roster.refetch()}>Try again</button></div>
        </div>
      )}

      {roster.data && roster.data.map((a) => {
        const current = scopeSet(a.adminScopes);
        const isOwner = a.adminScopes === "*";
        const full = a.adminScopes === "" || isOwner;
        return (
          <div className="eh-card eh-mb" key={a.id}>
            <div className="eh-between" style={{ marginBottom: ".6rem" }}>
              <div>
                <b>{a.name ?? a.email}</b>
                <div className="eh-sm eh-muted">{a.email}</div>
              </div>
              {isOwner ? <Pill color="gold">Owner · full access</Pill>
                : full ? <Pill color="gold">Full access</Pill>
                : <Pill color="blue">{current.size} capabilit{current.size === 1 ? "y" : "ies"}</Pill>}
            </div>

            {isOwner ? (
              <p className="eh-sm eh-muted" style={{ margin: 0 }}>The platform owner always holds every capability.</p>
            ) : (
              <ScopeEditor
                disabled={!iAmFull || setAccess.isPending}
                initial={current}
                fullNote={full ? "This admin currently has full (legacy) access — pick specific capabilities to scope them down." : undefined}
                onSave={(scopes) => setAccess.mutate({ userId: a.id, makeAdmin: true, scopes: scopes as ScopeKey[] })}
                onRevoke={a.id === user?.id ? undefined : () => setAccess.mutate({ userId: a.id, makeAdmin: false, scopes: [] })}
              />
            )}
          </div>
        );
      })}

      {iAmFull && (
        <div className="eh-card">
          <h3>Add a team member</h3>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            They must have registered an account first. Enter their email and choose their capabilities.
          </p>
          <Field label="Email address">
            <input className="eh-input" type="email" placeholder="name@ehiveglobal.com"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>Capabilities</div>
          <ScopeChecklist selected={newScopes} onToggle={(k) => {
            const next = new Set(newScopes); if (next.has(k)) next.delete(k); else next.add(k); setNewScopes(next);
          }} />
          <button className="eh-btn gold eh-mt" disabled={!email || grant.isPending}
                  onClick={() => grant.mutate({ email, scopes: [...newScopes] as ScopeKey[] })}>
            {grant.isPending ? "Granting…" : "Grant admin access"}
          </button>
        </div>
      )}
    </EhShell>
  );
}

function ScopeChecklist({ selected, onToggle }: { selected: Set<string>; onToggle: (k: string) => void }) {
  return (
    <div className="eh-list">
      {ADMIN_SCOPES.map((s) => (
        <label key={s.key} className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
          <input type="checkbox" checked={selected.has(s.key)} onChange={() => onToggle(s.key)}
                 style={{ marginTop: ".3rem", accentColor: "#b8862e" }} />
          <span className="t" style={{ flex: 1 }}>{s.label}</span>
        </label>
      ))}
    </div>
  );
}

function ScopeEditor({ initial, onSave, onRevoke, disabled, fullNote }: {
  initial: Set<string>; onSave: (scopes: string[]) => void; onRevoke?: () => void; disabled?: boolean; fullNote?: string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  return (
    <div>
      {fullNote && <p className="eh-sm" style={{ color: "var(--eh-gold)", marginTop: 0 }}>{fullNote}</p>}
      <ScopeChecklist selected={sel} onToggle={(k) => {
        if (disabled) return; const next = new Set(sel); if (next.has(k)) next.delete(k); else next.add(k); setSel(next);
      }} />
      {!disabled && (
        <div className="eh-row eh-mt">
          <button className="eh-btn sm" onClick={() => onSave([...sel])}>Save capabilities</button>
          {onRevoke && <button className="eh-btn ghost sm danger" onClick={onRevoke}>Revoke admin</button>}
        </div>
      )}
    </div>
  );
}
