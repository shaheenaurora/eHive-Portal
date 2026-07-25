import { useEffect, useState, useRef, useId } from "react";
import type { ReactNode } from "react";
import { NavLink, Link, useNavigate, useLocation } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { InstallPrompt } from "@/components/InstallPrompt";
import { initials } from "@/lib/ehf";
import { TIER_LABEL } from "@contracts/constants";
import { trpc } from "@/providers/trpc";

/* ------------------------------- toasts -------------------------------- */
let pushToastFn: ((msg: string) => void) | null = null;
export function toast(msg: string) {
  if (pushToastFn) pushToastFn(msg);
}
/** Dismissible nudge shown until a member confirms their email address.
 *  Hidden entirely when the server has no email configured (nothing to send). */
function VerifyBanner() {
  const [hidden, setHidden] = useState(false);
  const cfg = trpc.auth.config.useQuery(undefined, { retry: false, staleTime: 5 * 60 * 1000 });
  const resend = trpc.auth.resendVerification.useMutation({
    onSuccess: () => toast("Verification email sent — check your inbox."),
    onError: (e) => toast(e.message),
  });
  if (hidden || !cfg.data?.mailConfigured) return null;
  return (
    <div className="eh-verify" role="status">
      <span className="eh-verify-dot">✉</span>
      <span style={{ flex: 1 }}>
        <b>Confirm your email</b> to secure your account. We sent you a link — didn't get it?{" "}
        <button className="eh-linkbtn" disabled={resend.isPending} onClick={() => resend.mutate()}>
          {resend.isPending ? "Sending…" : "Resend it"}
        </button>
      </span>
      <button className="eh-verify-x" aria-label="Dismiss" onClick={() => setHidden(true)}>✕</button>
    </div>
  );
}

function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    pushToastFn = (m: string) => {
      setMsg(m);
      setTimeout(() => setMsg(null), 3200);
    };
    return () => {
      pushToastFn = null;
    };
  }, []);
  // aria-live region so screen readers announce toasts; always present so the
  // announcement fires when content changes.
  return <div className="eh-toast-live" role="status" aria-live="polite" aria-atomic="true">
    {msg ? <div className="eh-toast">{msg}</div> : null}
  </div>;
}

/* -------------------------------- atoms -------------------------------- */
export function Spinner() {
  return <div className="eh-spin" role="status" aria-label="Loading" />;
}

export function PageHead(props: { eyebrow: string; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="eh-page-head">
      <div>
        <div className="eh-eyebrow">{props.eyebrow}</div>
        <h1 className="eh-h1">{props.title}</h1>
        {props.sub && <p className="eh-sub">{props.sub}</p>}
      </div>
      {props.actions && <div className="eh-row">{props.actions}</div>}
    </div>
  );
}

export function Stat(props: { k: string; v: ReactNode; n?: string; gold?: boolean }) {
  return (
    <div className="eh-stat">
      <div className="k">{props.k}</div>
      <div className={"v" + (props.gold ? " gold" : "")}>{props.v}</div>
      {props.n && <div className="n">{props.n}</div>}
    </div>
  );
}

type PillColor = "gold" | "green" | "red" | "blue" | "purple" | "grey";
export function Pill(props: { color?: PillColor; children: ReactNode }) {
  return <span className={"eh-pill" + (props.color && props.color !== "gold" ? " " + props.color : "")}>{props.children}</span>;
}

export function TierPill(props: { tier: string }) {
  const map: Record<string, PillColor> = { horizon: "grey", ascent: "blue", vanguard: "purple", zenith: "gold" };
  return <Pill color={map[props.tier] ?? "grey"}>{TIER_LABEL[props.tier as keyof typeof TIER_LABEL] ?? props.tier}</Pill>;
}

export function StatusPill(props: { status: string }) {
  const map: Record<string, PillColor> = {
    active: "green", approved: "green", attended: "green", done: "green", completed: "green", reviewed: "green",
    received: "grey", screening: "blue", interview: "purple", scheduled: "blue", registered: "blue",
    in_progress: "blue", submitted: "purple", enrolled: "blue", running: "blue", open: "blue",
    paused: "gold", withdrawn: "gold", excused: "gold", not_started: "grey",
    cancelled: "red", rejected: "red", absent: "red", closed: "grey",
  };
  return <Pill color={map[props.status] ?? "grey"}>{props.status.replace(/_/g, " ")}</Pill>;
}

export function Empty(props: { big: string; p?: string; children?: ReactNode }) {
  return (
    <div className="eh-empty">
      <div className="big">{props.big}</div>
      {props.p && <p>{props.p}</p>}
      {props.children && <div style={{ marginTop: "1rem" }}>{props.children}</div>}
    </div>
  );
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    // Move focus into the dialog and trap Tab within it (WCAG 2.4.3 / 2.1.2).
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { props.onClose(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="eh-modal-veil" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={ref} className="eh-modal" style={props.wide ? { maxWidth: 760 } : undefined}
           role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="eh-between eh-mb">
          <h3 id={titleId} style={{ margin: 0 }}>{props.title}</h3>
          <button className="eh-btn ghost sm" onClick={props.onClose} aria-label="Close">✕</button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="eh-field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}

export function Bar(props: { pct: number; green?: boolean }) {
  return (
    <div className={"eh-bar" + (props.green ? " green" : "")}>
      <i style={{ width: Math.min(100, Math.max(0, props.pct)) + "%" }} />
  </div>
  );
}

export function Ring(props: { value: number; max?: number; label?: string; size?: number }) {
  const size = props.size ?? 132;
  const max = props.max ?? 100;
  const r = 54;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, props.value / max));
  return (
    <div className="eh-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#ece6d9" strokeWidth="9" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="#b8862e" strokeWidth="9" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="lbl">
        <div>
          <b className="eh-num">{props.value}</b>
          <span>{props.label ?? "Hive Score"}</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------- shell -------------------------------- */
export type NavItem = { to: string; label: string; icon: string; end?: boolean };
export type NavGroup = { label?: string; items: NavItem[] };

export function EhShell(props: {
  groups: NavGroup[];
  brandSub: string;
  roleRequired?: "admin";
  notif?: boolean;
  children: ReactNode;
}) {
  const { user, isLoading, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) navigate("/login");
    if (!isLoading && user && props.roleRequired === "admin" && user.role !== "admin") navigate("/portal");
  }, [isLoading, user, navigate, props.roleRequired]);

  if (isLoading || !user) return <Spinner />;
  if (props.roleRequired === "admin" && user.role !== "admin") return <Spinner />;

  return (
    <div className="eh-shell">
      <a href="#eh-main" className="eh-skip">Skip to content</a>
      <header className="eh-mtop">
        <button className="eh-burger" aria-label="Menu" aria-expanded={menuOpen}
                onClick={() => setMenuOpen(true)}>☰</button>
        <img src="/assets/ehive-wordmark.png" alt="eHive" style={{ height: 22, width: "auto", display: "block" }} />
      </header>
      {menuOpen && <div className="eh-side-veil" onClick={() => setMenuOpen(false)} />}
      {/* Any tap on a nav link or the foot links closes the mobile drawer. */}
      <aside className={"eh-side" + (menuOpen ? " open" : "")} onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) setMenuOpen(false);
      }}>
        <div className="eh-side-brand">
          <img src="/assets/ehive-wordmark.png" alt="eHive" style={{ height: 24, width: "auto", display: "block" }} />
          <span style={{ display: "block", marginTop: 5, fontSize: ".68rem", letterSpacing: ".14em",
                         textTransform: "uppercase", opacity: 0.72 }}>{props.brandSub}</span>
        </div>
        <nav className="eh-nav">
          {props.groups.map((g, i) => (
            <div key={i}>
              {g.label && <div className="eh-nav-label">{g.label}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? "on" : "")}>
                  <span className="eh-ico">{it.icon}</span>
                  {it.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="eh-side-foot">
          {user.role === "admin" && (
            <Link
              to={location.pathname.startsWith("/admin") ? "/portal" : "/admin"}
              style={{ display: "block", textAlign: "center", padding: ".5rem", marginBottom: ".5rem",
                       borderRadius: 8, background: "var(--eh-gold-soft)", color: "var(--eh-ink)",
                       fontSize: ".82rem", fontWeight: 600, textDecoration: "none" }}
            >
              {location.pathname.startsWith("/admin") ? "← Member portal" : "⚙ Admin panel"}
            </Link>
          )}
          <div className="eh-side-user">
            <div className="eh-avatar">{initials(user.name)}</div>
            <div>
              <b>{user.name ?? "Member"}</b>
              <span>{user.email}</span>
            </div>
          </div>
          <button className="eh-signout" onClick={() => logout()}>Sign out</button>
        </div>
      </aside>
      <main className="eh-main" id="eh-main" tabIndex={-1}>
        {!user.emailVerifiedAt && <VerifyBanner />}
        {props.children}
      </main>
      {props.notif && <NotifBell />}
      <ToastHost />
      <InstallPrompt />
    </div>
  );
}

/* ------------------------- notifications bell --------------------------- */
function NotifBell() {
  const [open, setOpen] = useState(false);
  const q = trpc.engage.myNotifications.useQuery(undefined, { retry: false, refetchInterval: 30000 });
  const mark = trpc.engage.markNotificationsRead.useMutation({
    onSuccess: () => q.refetch(),
  });
  const rows = q.data?.rows ?? [];
  const unread = q.data?.unread ?? 0;
  return (
    <div style={{ position: "fixed", top: "1rem", right: "1.25rem", zIndex: 60 }}>
      <button className="eh-btn ghost sm" aria-label="Notifications"
              onClick={() => { setOpen(!open); if (!open && unread > 0) mark.mutate({}); }}
              style={{ position: "relative", background: "var(--eh-card, #fff)" }}>
        ⠇
        {unread > 0 && (
          <span style={{
            position: "absolute", top: -6, right: -6, background: "#b8862e", color: "#fff",
            borderRadius: 99, fontSize: ".68rem", padding: "0 .35rem", fontWeight: 700,
          }}>{unread}</span>
        )}
      </button>
      {open && (
        <div className="eh-card" style={{
          position: "absolute", right: 0, top: "2.5rem", width: 340, maxHeight: 420,
          overflowY: "auto", animation: "eh-pop .18s ease-out", zIndex: 61,
        }}>
          <div className="eh-between eh-mb">
            <b>Notifications</b>
            <button className="eh-btn ghost sm" onClick={() => setOpen(false)}>✕</button>
          </div>
          {rows.length === 0 && <p className="eh-muted eh-sm">Nothing yet — you're all caught up.</p>}
          <div className="eh-list">
            {rows.map((n) => (
              <div key={n.id} className="row" style={{ alignItems: "flex-start", opacity: n.readAt ? .65 : 1 }}>
                <div style={{ flex: 1 }}>
                  <div className="eh-sm">{n.text}</div>
                  <div className="d">{new Date(n.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>
                </div>
                {!n.readAt && <Pill color="gold">new</Pill>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const MEMBER_NAV: NavGroup[] = [
  {
    items: [
      { to: "/portal", label: "Dashboard", icon: "⬡", end: true },
      { to: "/portal/pods", label: "My Pods", icon: "◍" },
      { to: "/portal/events", label: "Events", icon: "◷" },
      { to: "/portal/connect", label: "Connect", icon: "⇄" },
      { to: "/portal/score", label: "Hive Score", icon: "✦" },
    ],
  },
  {
    label: "Grow",
    items: [
      { to: "/portal/frp", label: "Fundraising", icon: "↗" },
      { to: "/portal/library", label: "Library", icon: "▤" },
      { to: "/portal/offers", label: "Member Offers", icon: "◇" },
    ],
  },
  {
    label: "Circle",
    items: [
      { to: "/portal/chapter", label: "My Chapter", icon: "⌂" },
      { to: "/portal/governance", label: "Governance", icon: "§" },
      { to: "/portal/membership", label: "Membership", icon: "◈" },
    ],
  },
];

export const ADMIN_NAV: NavGroup[] = [
  {
    items: [
      { to: "/admin", label: "Dashboard", icon: "⬡", end: true },
      { to: "/admin/applications", label: "Applications", icon: "⇥" },
      { to: "/admin/admissions", label: "Zenith & Investors", icon: "✧" },
      { to: "/admin/members", label: "Members", icon: "◍" },
      { to: "/admin/leads", label: "Website Leads", icon: "✉" },
    ],
  },
  {
    label: "Community",
    items: [
      { to: "/admin/pods", label: "Pods & Sessions", icon: "◷" },
      { to: "/admin/events", label: "Events", icon: "◇" },
      { to: "/admin/engagement", label: "Engagement", icon: "♥" },
      { to: "/admin/connect", label: "Connect", icon: "⇄" },
      { to: "/admin/chapters", label: "Chapters", icon: "⌂" },
      { to: "/admin/score", label: "Hive Score", icon: "✦" },
    ],
  },
  {
    label: "Programmes",
    items: [
      { to: "/admin/frp", label: "FRP", icon: "↗" },
      { to: "/admin/governance", label: "Governance", icon: "§" },
      { to: "/admin/library", label: "Library", icon: "▤" },
      { to: "/admin/offers", label: "Offers", icon: "◈" },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/insights", label: "Insights", icon: "✎" },
      { to: "/admin/newsletters", label: "Newsletters", icon: "▤" },
    ],
  },
  {
    label: "Administration",
    items: [
      { to: "/admin/access", label: "Team & Access", icon: "⚿" },
      { to: "/admin/audit", label: "Audit Trail", icon: "❑" },
    ],
  },
];
