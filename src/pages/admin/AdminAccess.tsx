import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Field,
  toast,
} from "@/components/eh";
import { ADMIN_SCOPES } from "@contracts/constants";

type ScopeKey = (typeof ADMIN_SCOPES)[number]["key"];

function scopeSet(csv: string | null): Set<string> {
  return new Set(
    (csv ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  );
}

export default function AdminAccess() {
  const { user } = useAuth();
  const roster = trpc.admin.adminRoster.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const refresh = () => utils.admin.adminRoster.invalidate();

  const setAccess = trpc.admin.setAdminAccess.useMutation({
    onSuccess: () => {
      toast("Access updated.");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const grant = trpc.admin.grantAdminByEmail.useMutation({
    onSuccess: r => {
      toast(`${r.name} is now an admin.`);
      refresh();
      setEmail("");
      setNewScopes(new Set());
    },
    onError: e => toast(e.message),
  });

  const iAmFull = !user?.adminScopes || user.adminScopes === "*";
  const [email, setEmail] = useState("");
  const [newScopes, setNewScopes] = useState<Set<string>>(new Set());

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Team & access"
        title="Admin roles & permissions"
        sub="Segregation of duties for the eHive Circle team. Give each staff member only the capabilities their role needs — mirroring the org structure."
      />

      {!iAmFull && (
        <div className="eh-locked eh-mb">
          <Pill>Read-only</Pill>
          <span className="eh-sm">
            Only a full administrator (Director eHive Circle / COO) can change
            team access. You can view the current setup below.
          </span>
        </div>
      )}

      {iAmFull && <MailSettings />}
      {iAmFull && <AutomationSettings />}
      {iAmFull && <DemoDataCard />}

      {roster.isLoading && <Spinner />}
      {roster.isError && (
        <div className="eh-card">
          <Empty
            big="Couldn't load the team."
            p="There was a problem reaching the server."
          />
          <div style={{ textAlign: "center" }}>
            <button className="eh-btn ghost" onClick={() => roster.refetch()}>
              Try again
            </button>
          </div>
        </div>
      )}

      {roster.data &&
        roster.data.map(a => {
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
                {isOwner ? (
                  <Pill color="gold">Owner · full access</Pill>
                ) : full ? (
                  <Pill color="gold">Full access</Pill>
                ) : (
                  <Pill color="blue">
                    {current.size} capabilit{current.size === 1 ? "y" : "ies"}
                  </Pill>
                )}
              </div>

              {isOwner ? (
                <p className="eh-sm eh-muted" style={{ margin: 0 }}>
                  The platform owner always holds every capability.
                </p>
              ) : (
                <ScopeEditor
                  disabled={!iAmFull || setAccess.isPending}
                  initial={current}
                  fullNote={
                    full
                      ? "This admin currently has full (legacy) access — pick specific capabilities to scope them down."
                      : undefined
                  }
                  onSave={scopes =>
                    setAccess.mutate({
                      userId: a.id,
                      makeAdmin: true,
                      scopes: scopes as ScopeKey[],
                    })
                  }
                  onRevoke={
                    a.id === user?.id
                      ? undefined
                      : () =>
                          setAccess.mutate({
                            userId: a.id,
                            makeAdmin: false,
                            scopes: [],
                          })
                  }
                />
              )}
            </div>
          );
        })}

      {iAmFull && (
        <div className="eh-card">
          <h3>Add a team member</h3>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            They must have registered an account first. Enter their email and
            choose their capabilities.
          </p>
          <Field label="Email address">
            <input
              className="eh-input"
              type="email"
              placeholder="name@ehiveglobal.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </Field>
          <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>
            Capabilities
          </div>
          <ScopeChecklist
            selected={newScopes}
            onToggle={k => {
              const next = new Set(newScopes);
              if (next.has(k)) next.delete(k);
              else next.add(k);
              setNewScopes(next);
            }}
          />
          <button
            className="eh-btn gold eh-mt"
            disabled={!email || grant.isPending}
            onClick={() =>
              grant.mutate({ email, scopes: [...newScopes] as ScopeKey[] })
            }
          >
            {grant.isPending ? "Granting…" : "Grant admin access"}
          </button>
        </div>
      )}
    </EhShell>
  );
}

function MailSettings() {
  const status = trpc.admin.mailStatus.useQuery(undefined, { retry: false });
  const { user } = useAuth();
  const [to, setTo] = useState(user?.email ?? "");
  const test = trpc.admin.sendTestEmail.useMutation({
    onSuccess: () =>
      toast(`Test email sent to ${to}. Check the inbox (and spam).`),
    onError: e => toast(e.message),
  });
  const s = status.data;

  return (
    <div className="eh-card eh-mb">
      <div className="eh-between" style={{ marginBottom: ".6rem" }}>
        <h3 style={{ margin: 0 }}>Email &amp; deliverability</h3>
        {s &&
          (s.configured ? (
            <Pill color="green">SMTP configured</Pill>
          ) : (
            <Pill color="gold">Not configured</Pill>
          ))}
      </div>

      {status.isLoading && <Spinner />}

      {s && !s.configured && (
        <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
          Outbound email is off — leads and applications are still saved, but no
          alerts, confirmations, verification or password-reset emails are sent.
          Set <code>ZEPTOMAIL_TOKEN</code> (recommended — works where hosts
          block SMTP), or <code>SMTP_HOST</code>/<code>SMTP_USER</code>/
          <code>SMTP_PASS</code>, in your Railway service variables to switch it
          on, then send a test below.
        </p>
      )}

      {s && s.configured && (
        <div className="eh-list eh-mb">
          <div className="row">
            <span className="d">Sending via</span>
            <span className="t">
              {s.provider === "zeptomail"
                ? "Zoho ZeptoMail (HTTPS API)"
                : `SMTP · ${s.host}:${s.port}${s.secure ? " · TLS" : " · STARTTLS"}`}
            </span>
          </div>
          <div className="row">
            <span className="d">From</span>
            <span className="t">{s.from ?? "—"}</span>
          </div>
          <div className="row">
            <span className="d">Lead alerts to</span>
            <span className="t">{s.notifyTo ?? "—"}</span>
          </div>
        </div>
      )}

      <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>
        Send a test email
      </div>
      <div
        className="eh-row"
        style={{ alignItems: "flex-end", flexWrap: "wrap", gap: ".6rem" }}
      >
        <Field label="Send to">
          <input
            className="eh-input"
            type="email"
            placeholder="you@ehiveglobal.com"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </Field>
        <button
          className="eh-btn gold"
          disabled={!to || test.isPending}
          onClick={() => test.mutate({ to })}
        >
          {test.isPending ? "Sending…" : "Send test"}
        </button>
      </div>
      <p className="eh-sm eh-muted" style={{ marginBottom: 0 }}>
        If it fails, the exact SMTP error (auth, port, DNS) shows here so you
        can fix the variables.
      </p>
    </div>
  );
}

function DemoDataCard() {
  const [removedN, setRemovedN] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<{
    members: number;
    chapters: number;
    admins: number;
    loaded: boolean;
  } | null>(null);
  const remove = trpc.admin.removeDemoData.useMutation({
    onSuccess: r => {
      setRemovedN(r.total);
      setLoaded(null);
      toast(`Removed ${r.total} demo rows.`);
    },
    onError: e => toast(e.message),
  });
  const load = trpc.admin.loadFullDemo.useMutation({
    onSuccess: r => {
      setLoaded(r);
      setRemovedN(null);
      toast(
        r.loaded
          ? `Loaded ${r.members} members across ${r.chapters} chapters.`
          : "Demo already loaded — remove it first to reload."
      );
    },
    onError: e => toast(e.message),
  });

  return (
    <div className="eh-card eh-mb" style={{ borderColor: "var(--eh-gold)" }}>
      <h3 style={{ margin: 0 }}>Demo &amp; simulation data</h3>
      <p className="eh-sm eh-muted" style={{ marginTop: ".3rem" }}>
        Populate the whole eHive Circle for a demo, or clear it out. Only
        seed-tagged rows are affected — your own accounts and anything you
        created by hand are never touched.
      </p>

      <div className="eh-eyebrow eh-mt" style={{ marginBottom: ".3rem" }}>
        Load full simulation
      </div>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Builds United Arab Emirates → 3 regions → zones → ~11 chapters with
        30–40 members each, chapter officers, zone/regional/national leaders,
        and a management team. All accounts use the password{" "}
        <code>ehive1234</code>.
      </p>
      {loaded ? (
        <Pill color="green">
          {loaded.loaded
            ? `Loaded — ${loaded.members} members · ${loaded.chapters} chapters · ${loaded.admins} admins`
            : "Already loaded"}
        </Pill>
      ) : (
        <button
          className="eh-btn gold"
          disabled={load.isPending}
          onClick={() => load.mutate({ confirm: "LOAD DEMO" })}
        >
          {load.isPending ? "Generating…" : "Load full demo"}
        </button>
      )}

      <div
        className="eh-eyebrow eh-mt"
        style={{ marginBottom: ".3rem", color: "var(--eh-red, #b23a2e)" }}
      >
        Remove demo data
      </div>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Deletes every seed-tagged account, chapter, hierarchy unit, pod and
        event. Can't be undone.
      </p>
      {removedN != null ? (
        <Pill color="green">Removed {removedN} demo rows</Pill>
      ) : (
        <button
          className="eh-btn ghost danger"
          disabled={remove.isPending}
          onClick={() => {
            if (
              !window.confirm(
                "Remove all seeded demo data (accounts, chapters, hierarchy, pods, events)? Your real data is kept. This cannot be undone."
              )
            )
              return;
            remove.mutate({ confirm: "REMOVE DEMO DATA" });
          }}
        >
          {remove.isPending ? "Removing…" : "Remove demo data"}
        </button>
      )}
    </div>
  );
}

function AutomationSettings() {
  const status = trpc.admin.schedulerStatus.useQuery(undefined, {
    retry: false,
  });
  const utils = trpc.useUtils();
  const run = trpc.admin.runScheduler.useMutation({
    onSuccess: r => {
      toast(r.ran ? "Scheduler run complete." : "Nothing due right now.");
      utils.admin.schedulerStatus.invalidate();
    },
    onError: e => toast(e.message),
  });
  const today = new Date().toISOString().slice(0, 10);
  const last = status.data?.lastDaily ?? null;
  const ranToday = last === today;

  return (
    <div className="eh-card eh-mb">
      <div className="eh-between" style={{ marginBottom: ".6rem" }}>
        <h3 style={{ margin: 0 }}>Automation</h3>
        {status.data &&
          (ranToday ? (
            <Pill color="green">Ran today</Pill>
          ) : (
            <Pill color="gold">Pending</Pill>
          ))}
      </div>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        The daily pass runs the timed operations the manual expects the platform
        to carry on its own — at-risk detection, the renewal window,
        onboarding-slip nudges, chapter-cadence reminders, officer-term
        retirement and chapter-health alerts. It runs automatically; use “Run
        now” to force it.
      </p>
      <div className="eh-list eh-mb">
        <div className="row">
          <span className="d">Last daily pass</span>
          <span className="t">{last ?? "not yet run"}</span>
        </div>
      </div>
      <button
        className="eh-btn gold"
        disabled={run.isPending}
        onClick={() => run.mutate()}
      >
        {run.isPending ? "Running…" : "Run now"}
      </button>
    </div>
  );
}

function ScopeChecklist({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (k: string) => void;
}) {
  return (
    <div className="eh-list">
      {ADMIN_SCOPES.map(s => (
        <label
          key={s.key}
          className="row"
          style={{ cursor: "pointer", alignItems: "flex-start" }}
        >
          <input
            type="checkbox"
            checked={selected.has(s.key)}
            onChange={() => onToggle(s.key)}
            style={{ marginTop: ".3rem", accentColor: "#b8862e" }}
          />
          <span className="t" style={{ flex: 1 }}>
            {s.label}
          </span>
        </label>
      ))}
    </div>
  );
}

function ScopeEditor({
  initial,
  onSave,
  onRevoke,
  disabled,
  fullNote,
}: {
  initial: Set<string>;
  onSave: (scopes: string[]) => void;
  onRevoke?: () => void;
  disabled?: boolean;
  fullNote?: string;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(initial));
  const [open, setOpen] = useState(false);
  const summary = ADMIN_SCOPES.filter(s => sel.has(s.key)).map(s =>
    s.label.split("—")[0].trim()
  );

  if (!open) {
    return (
      <div>
        {fullNote && (
          <p
            className="eh-sm"
            style={{
              color: "var(--eh-gold)",
              marginTop: 0,
              marginBottom: ".5rem",
            }}
          >
            {fullNote}
          </p>
        )}
        <div
          className="eh-between"
          style={{ gap: ".6rem", flexWrap: "wrap", alignItems: "center" }}
        >
          <span className="eh-sm eh-muted" style={{ flex: 1, minWidth: 0 }}>
            {summary.length
              ? summary.join(" · ")
              : "No capabilities assigned yet."}
          </span>
          {!disabled && (
            <button
              className="eh-btn ghost sm"
              style={{ flex: "none" }}
              onClick={() => setOpen(true)}
            >
              Edit capabilities
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {fullNote && (
        <p className="eh-sm" style={{ color: "var(--eh-gold)", marginTop: 0 }}>
          {fullNote}
        </p>
      )}
      <ScopeChecklist
        selected={sel}
        onToggle={k => {
          if (disabled) return;
          const next = new Set(sel);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          setSel(next);
        }}
      />
      {!disabled && (
        <div className="eh-row eh-mt">
          <button
            className="eh-btn sm"
            onClick={() => {
              onSave([...sel]);
              setOpen(false);
            }}
          >
            Save capabilities
          </button>
          <button
            className="eh-btn ghost sm"
            onClick={() => {
              setSel(new Set(initial));
              setOpen(false);
            }}
          >
            Cancel
          </button>
          {onRevoke && (
            <button className="eh-btn ghost sm danger" onClick={onRevoke}>
              Revoke admin
            </button>
          )}
        </div>
      )}
    </div>
  );
}
