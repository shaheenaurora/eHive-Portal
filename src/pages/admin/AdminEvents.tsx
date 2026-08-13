import { lazy, Suspense, useCallback, useState } from "react";
import type { FormEvent } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  StatusPill,
  Empty,
  TierPill,
  Spinner,
  Modal,
  Field,
  toast,
} from "@/components/eh";
import { fmtDateTime, fmtDay, initials } from "@/lib/ehf";
import {
  EVENT_KINDS,
  EVENT_KIND_LABEL,
  EVENT_KIND_COLOR,
  EVENT_AUDIENCES,
  EVENT_AUDIENCE_LABEL,
  TIERS,
  TIER_LABEL,
} from "@contracts/constants";

// Camera scanner (html5-qrcode) is heavy and admin-only — load it on demand
// so members never download it.
const QrScanner = lazy(() =>
  import("@/components/QrScanner").then(m => ({ default: m.QrScanner }))
);

export default function AdminEvents() {
  const utils = trpc.useUtils();
  const q = trpc.admin.eventsAdmin.useQuery(undefined, { retry: false });
  const [create, setCreate] = useState(false);
  const [regsFor, setRegsFor] = useState<number | null>(null);

  const invalidate = () => utils.admin.eventsAdmin.invalidate();

  const createEvent = trpc.admin.createEvent.useMutation({
    onSuccess: () => {
      toast("Activity published — visible to its audience at once.");
      invalidate();
      setCreate(false);
      setAudience("members");
      setAudTiers(new Set(["vanguard", "zenith"]));
    },
    onError: e => toast(e.message),
  });
  const markAtt = trpc.admin.markEventAttendance.useMutation({
    onSuccess: () => {
      toast("Updated — score adjusted where due.");
      invalidate();
      utils.admin.eventRegs.invalidate();
    },
    onError: e => toast(e.message),
  });
  const doorCheckin = trpc.adminEngage.eventCheckinByCode.useMutation({
    onSuccess: r => {
      toast(
        r.already
          ? "Already checked in."
          : "Checked in ✓ — score written in real time."
      );
      setDoorCode("");
      utils.admin.eventRegs.invalidate();
      invalidate();
    },
    onError: e => toast(e.message),
  });
  const noShow = trpc.adminEngage.markNoShow.useMutation({
    onSuccess: () => {
      toast("No-show recorded — points deducted per the rules.");
      utils.admin.eventRegs.invalidate();
    },
    onError: e => toast(e.message),
  });

  const [doorCode, setDoorCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [fbFor, setFbFor] = useState<number | null>(null);
  // Stable "now" for the attendance-window check (avoids impure Date.now in render).
  const [now] = useState(() => Date.now());
  // Activity-master audience picker (controlled — the rest of the form is FormData).
  const [audience, setAudience] = useState<"public" | "members" | "tiers">(
    "members"
  );
  const [audTiers, setAudTiers] = useState<Set<string>>(
    new Set(["vanguard", "zenith"])
  );

  // Stable callbacks so the scanner's camera isn't torn down on every render.
  const handleScan = useCallback(
    (code: string) => {
      if (code && code.trim().length >= 4)
        doorCheckin.mutate({ code: code.trim().toUpperCase() });
    },
    [doorCheckin]
  );
  const handleScanError = useCallback((msg: string) => {
    toast("Camera unavailable — use manual code entry. (" + msg + ")");
    setScanning(false);
  }, []);
  const regs = trpc.admin.eventRegs.useQuery(
    { id: regsFor! },
    { enabled: regsFor !== null, retry: false }
  );
  const fb = trpc.adminEngage.eventFeedbackAdmin.useQuery(
    { eventId: fbFor! },
    { enabled: fbFor !== null, retry: false }
  );

  // Attendance can only be recorded once the event is under way (opens 2h
  // before start) — the same rule the server enforces. Register/undo stay open.
  const selEvent =
    regsFor !== null ? (q.data ?? []).find(e => e.id === regsFor) : undefined;
  const attendanceOpen =
    !selEvent ||
    now >= new Date(selEvent.startsAt).getTime() - 2 * 60 * 60 * 1000;

  function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (audience === "tiers" && audTiers.size === 0) {
      toast("Pick at least one tier for this activity.");
      return;
    }
    const f = new FormData(e.currentTarget);
    createEvent.mutate({
      title: String(f.get("title")),
      kind: String(f.get("kind")) as never,
      description: String(f.get("description")) || undefined,
      startsAt: new Date(String(f.get("startsAt"))),
      location: String(f.get("location")) || undefined,
      audience,
      audienceTiers:
        audience === "tiers" ? ([...audTiers] as never) : undefined,
      capacity: Number(f.get("capacity")) || 40,
      cpdCredits: Number(f.get("cpdCredits")) || 0,
    });
  }

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Events"
        title="Calendar management"
        sub="Publish events, watch registrations, mark attendance — attendance feeds the Hive Score."
        actions={
          <button className="eh-btn gold" onClick={() => setCreate(true)}>
            + New event
          </button>
        }
      />

      <div
        className="eh-card eh-mb"
        style={{
          display: "flex",
          gap: ".75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <b>Door check-in</b>
        <button className="eh-btn gold sm" onClick={() => setScanning(true)}>
          📷 Scan QR
        </button>
        <span className="eh-muted eh-sm">or</span>
        <input
          className="eh-input"
          style={{ maxWidth: 160, letterSpacing: ".1em" }}
          placeholder="Door code"
          value={doorCode}
          onChange={e => setDoorCode(e.target.value.toUpperCase())}
          maxLength={12}
        />
        <button
          className="eh-btn sm"
          disabled={doorCheckin.isPending || doorCode.trim().length < 4}
          onClick={() => doorCheckin.mutate({ code: doorCode.trim() })}
        >
          {doorCheckin.isPending ? "Checking…" : "Check in →"}
        </button>
        <span className="eh-muted eh-sm">
          Members show their QR pass; score writes in real time.
        </span>
      </div>

      {scanning && (
        <Modal title="Scan member QR passes" onClose={() => setScanning(false)}>
          <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
            Point the camera at each member's check-in QR. They're checked in
            instantly — keep scanning the next person.
          </p>
          <Suspense
            fallback={
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <Spinner />
              </div>
            }
          >
            <QrScanner onScan={handleScan} onError={handleScanError} />
          </Suspense>
          <p
            className="eh-sm eh-muted"
            style={{ textAlign: "center", marginTop: ".8rem" }}
          >
            First use asks for camera permission. Nothing is stored from the
            camera — only the scanned code.
          </p>
        </Modal>
      )}

      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty big="No events yet." />
        </div>
      )}

      {q.data && q.data.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Event</th>
                <th>Kind</th>
                <th>When</th>
                <th>Audience</th>
                <th>Registered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.map(e => (
                <tr key={e.id}>
                  <td>
                    <b>{e.title}</b>
                    <div className="eh-muted eh-sm">{e.location ?? "TBA"}</div>
                  </td>
                  <td data-label="Kind">
                    <Pill
                      color={
                        EVENT_KIND_COLOR[
                          e.kind as keyof typeof EVENT_KIND_COLOR
                        ] ?? "grey"
                      }
                    >
                      {EVENT_KIND_LABEL[
                        e.kind as keyof typeof EVENT_KIND_LABEL
                      ] ?? e.kind}
                    </Pill>
                  </td>
                  <td className="eh-sm" data-label="When">
                    {fmtDay(e.startsAt)} {fmtDateTime(e.startsAt).split("·")[1]}
                  </td>
                  <td data-label="Audience">
                    {e.audience === "public" ? (
                      <Pill color="green">Public</Pill>
                    ) : e.audience === "tiers" ? (
                      <span className="eh-sm">
                        {(e.audienceTiers ?? "")
                          .split(",")
                          .filter(Boolean)
                          .map(
                            t => TIER_LABEL[t as keyof typeof TIER_LABEL] ?? t
                          )
                          .join(", ") || <TierPill tier={e.tierGate} />}
                      </span>
                    ) : (
                      <Pill color="blue">All members</Pill>
                    )}
                  </td>
                  <td className="eh-num" data-label="Registered">
                    {e.regCount}/{e.capacity}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="eh-btn ghost sm"
                      onClick={() => setRegsFor(e.id)}
                    >
                      Registrations →
                    </button>{" "}
                    <button
                      className="eh-btn ghost sm"
                      onClick={() => setFbFor(e.id)}
                    >
                      Feedback →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {create && (
        <Modal title="New activity" onClose={() => setCreate(false)}>
          <form onSubmit={onCreate}>
            <Field label="Title">
              <input
                className="eh-input"
                name="title"
                required
                minLength={2}
                placeholder="Spark Evening — …"
              />
            </Field>
            <div className="eh-grid g2">
              <Field label="Activity type">
                <select className="eh-select" name="kind" defaultValue="meetup">
                  {EVENT_KINDS.map(k => (
                    <option key={k} value={k}>
                      {EVENT_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Capacity">
                <input
                  className="eh-input"
                  name="capacity"
                  type="number"
                  min={1}
                  defaultValue={40}
                />
              </Field>
              <Field label="CPD credits">
                <input
                  className="eh-input"
                  name="cpdCredits"
                  type="number"
                  min={0}
                  defaultValue={0}
                />
              </Field>
            </div>
            <div className="eh-grid g2">
              <Field label="Starts at">
                <input
                  className="eh-input"
                  name="startsAt"
                  type="datetime-local"
                  required
                />
              </Field>
              <Field label="Location">
                <input
                  className="eh-input"
                  name="location"
                  placeholder="eHive Majlis, DIFC"
                />
              </Field>
            </div>

            <Field label="Who is this for?">
              <select
                className="eh-select"
                value={audience}
                onChange={e =>
                  setAudience(e.target.value as "public" | "members" | "tiers")
                }
              >
                {EVENT_AUDIENCES.map(a => (
                  <option key={a} value={a}>
                    {EVENT_AUDIENCE_LABEL[a]}
                  </option>
                ))}
              </select>
            </Field>
            {audience === "tiers" && (
              <div className="eh-banner" style={{ marginBottom: ".75rem" }}>
                <div className="eh-eyebrow" style={{ marginBottom: ".4rem" }}>
                  Eligible tiers
                </div>
                <div
                  className="eh-row"
                  style={{ gap: ".5rem", flexWrap: "wrap" }}
                >
                  {TIERS.map(t => {
                    const on = audTiers.has(t);
                    return (
                      <button
                        type="button"
                        key={t}
                        className={"eh-btn sm" + (on ? " gold" : " ghost")}
                        onClick={() => {
                          const next = new Set(audTiers);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          setAudTiers(next);
                        }}
                      >
                        {on ? "✓ " : ""}
                        {TIER_LABEL[t]}
                      </button>
                    );
                  })}
                </div>
                <p className="eh-sm eh-muted" style={{ margin: ".5rem 0 0" }}>
                  Only members in these tiers can see and register for this
                  activity.
                </p>
              </div>
            )}
            {audience === "public" && (
              <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
                Open to everyone — visible to prospects as well as all members.
              </p>
            )}

            <Field label="Description">
              <textarea className="eh-textarea" name="description" />
            </Field>
            <button
              className="eh-btn gold"
              type="submit"
              disabled={createEvent.isPending}
            >
              Publish activity →
            </button>
          </form>
        </Modal>
      )}

      {regsFor !== null && (
        <Modal title="Registrations" onClose={() => setRegsFor(null)} wide>
          {regs.isLoading && <Spinner />}
          {regs.data && regs.data.length === 0 && (
            <Empty big="No registrations yet." />
          )}
          <div className="eh-list">
            {regs.data?.map(({ reg, member, userName, userEmail }) => (
              <div className="row" key={reg.id}>
                <div className="eh-row" style={{ flexWrap: "nowrap" }}>
                  <span className="eh-avatar">{initials(userName)}</span>
                  <div>
                    <div className="t">{userName}</div>
                    <div className="d">{member.company ?? userEmail ?? ""}</div>
                  </div>
                </div>
                <div className="eh-row">
                  <StatusPill status={reg.status} />
                  {reg.checkinCode && reg.status === "registered" && (
                    <span className="eh-muted eh-sm eh-num">
                      {reg.checkinCode}
                    </span>
                  )}
                  {reg.status === "registered" &&
                    (attendanceOpen ? (
                      <>
                        <button
                          className="eh-btn gold sm"
                          onClick={() =>
                            markAtt.mutate({
                              eventId: regsFor,
                              memberId: member.id,
                              status: "attended",
                            })
                          }
                        >
                          Mark attended
                        </button>
                        <button
                          className="eh-btn ghost sm"
                          disabled={noShow.isPending}
                          onClick={() =>
                            noShow.mutate({ regId: reg.id, excused: false })
                          }
                        >
                          No-show
                        </button>
                        <button
                          className="eh-btn ghost sm"
                          disabled={noShow.isPending}
                          onClick={() =>
                            noShow.mutate({ regId: reg.id, excused: true })
                          }
                        >
                          Excused
                        </button>
                      </>
                    ) : (
                      <span className="eh-muted eh-sm">
                        Attendance opens when the event starts
                      </span>
                    ))}
                  {reg.status === "attended" && (
                    <button
                      className="eh-btn ghost sm"
                      onClick={() =>
                        markAtt.mutate({
                          eventId: regsFor,
                          memberId: member.id,
                          status: "registered",
                        })
                      }
                    >
                      Undo
                    </button>
                  )}
                  {reg.status === "waitlisted" && (
                    <Pill color="blue">auto-promotes</Pill>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {fbFor !== null && (
        <Modal title="Event feedback" onClose={() => setFbFor(null)} wide>
          {fb.isLoading && <Spinner />}
          {fb.data && (
            <>
              <div className="eh-between eh-mb">
                <span className="eh-muted eh-sm">
                  {fb.data.rows.length} response(s)
                </span>
                {fb.data.avg !== null && (
                  <Pill color="gold">avg {fb.data.avg.toFixed(1)}/5</Pill>
                )}
              </div>
              {fb.data.rows.length === 0 && (
                <Empty
                  big="No feedback yet."
                  p="Members can rate after attending."
                />
              )}
              <div className="eh-list">
                {fb.data.rows.map(r => (
                  <div
                    className="row"
                    key={r.id}
                    style={{ alignItems: "flex-start" }}
                  >
                    <div style={{ flex: 1 }}>
                      <div className="t">{r.memberName}</div>
                      {r.comment && <div className="d">{r.comment}</div>}
                    </div>
                    <Pill
                      color={
                        r.rating >= 4 ? "green" : r.rating >= 3 ? "gold" : "red"
                      }
                    >
                      {r.rating}/5
                    </Pill>
                  </div>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </EhShell>
  );
}
