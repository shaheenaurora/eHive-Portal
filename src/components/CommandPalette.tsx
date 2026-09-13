import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import type { NavGroup } from "@/components/eh";

type Item = {
  key: string;
  title: string;
  subtitle?: string;
  section: string;
  to: string;
};

/** Back-office command palette. Cmd/Ctrl-K opens it from anywhere; type to jump
 *  to any admin page or to a member, pod or lead by name/email. Full keyboard
 *  control (↑/↓ to move, Enter to go, Esc to close). Admin-only. */
export function CommandPalette(props: { groups: NavGroup[] }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const openPalette = () => {
    setQ("");
    setActive(0);
    setOpen(true);
  };

  // Global open shortcut (Cmd/Ctrl-K), Esc to close, and a custom event so a
  // toolbar button elsewhere can open it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("ehive:cmdk", openPalette);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("ehive:cmdk", openPalette);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus the input when the palette opens (no state writes here).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  const trimmed = q.trim();
  const search = trpc.admin.globalSearch.useQuery(
    { q: trimmed },
    { enabled: open && trimmed.length >= 2, retry: false }
  );

  // Flattened nav pages, matched by label.
  const pages = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const g of props.groups)
      for (const it of g.items)
        out.push({
          key: "page:" + it.to,
          title: it.label,
          section: "Pages",
          to: it.to,
        });
    return out;
  }, [props.groups]);

  const items = useMemo<Item[]>(() => {
    const ql = trimmed.toLowerCase();
    const pageHits = ql
      ? pages.filter(p => p.title.toLowerCase().includes(ql)).slice(0, 6)
      : pages.slice(0, 8);
    const d = search.data;
    const entity: Item[] = d
      ? [
          ...d.members.map(m => ({
            key: "m:" + m.id,
            title: m.title,
            subtitle: m.subtitle || "Member",
            section: "Members",
            to: m.to,
          })),
          ...d.pods.map(p => ({
            key: "pod:" + p.id,
            title: p.title,
            subtitle: "Pod",
            section: "Pods",
            to: p.to,
          })),
          ...d.leads.map(l => ({
            key: "lead:" + l.id,
            title: l.title,
            subtitle: "Lead",
            section: "Leads",
            to: l.to,
          })),
        ]
      : [];
    return [...pageHits, ...entity];
  }, [pages, search.data, trimmed]);

  if (!open) return null;

  const go = (it?: Item) => {
    if (!it) return;
    setOpen(false);
    navigate(it.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(a => Math.min(items.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(a => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    }
  };

  // Group consecutive items by section for labelled rows.
  let lastSection = "";

  return (
    <div
      className="eh-cmdk-veil"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,18,14,.45)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onClick={e => e.stopPropagation()}
        style={{
          width: "min(620px, 92vw)",
          background: "var(--eh-card, #fff)",
          borderRadius: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,.28)",
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,.06)",
        }}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search pages, members, pods, leads…"
          aria-label="Search"
          style={{
            width: "100%",
            border: "none",
            outline: "none",
            padding: "1.05rem 1.25rem",
            fontSize: "1.05rem",
            background: "transparent",
            borderBottom: "1px solid rgba(0,0,0,.08)",
          }}
        />
        <div
          ref={listRef}
          style={{ maxHeight: "52vh", overflowY: "auto", padding: ".4rem" }}
        >
          {items.length === 0 && (
            <div
              className="eh-sm eh-muted"
              style={{ padding: "1.25rem", textAlign: "center" }}
            >
              {trimmed.length >= 2 && search.isFetching
                ? "Searching…"
                : trimmed.length >= 2
                  ? "No matches."
                  : "Type to search, or pick a page."}
            </div>
          )}
          {items.map((it, i) => {
            const showSection = it.section !== lastSection;
            lastSection = it.section;
            return (
              <div key={it.key}>
                {showSection && (
                  <div
                    className="eh-eyebrow"
                    style={{
                      padding: ".5rem .75rem .25rem",
                      opacity: 0.6,
                      fontSize: ".62rem",
                    }}
                  >
                    {it.section}
                  </div>
                )}
                <button
                  onClick={() => go(it)}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 1,
                    width: "100%",
                    textAlign: "left",
                    border: "none",
                    borderRadius: 9,
                    cursor: "pointer",
                    padding: ".55rem .75rem",
                    background:
                      i === active
                        ? "var(--eh-gold-soft, #f4ecd8)"
                        : "transparent",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: ".95rem" }}>
                    {it.title}
                  </span>
                  {it.subtitle && (
                    <span className="eh-sm eh-muted">{it.subtitle}</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <div
          className="eh-sm eh-muted"
          style={{
            display: "flex",
            gap: "1rem",
            padding: ".55rem .9rem",
            borderTop: "1px solid rgba(0,0,0,.06)",
            fontSize: ".72rem",
          }}
        >
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span style={{ marginLeft: "auto" }}>⌘K / Ctrl-K</span>
        </div>
      </div>
    </div>
  );
}
