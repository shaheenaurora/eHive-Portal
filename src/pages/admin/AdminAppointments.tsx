import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Modal,
  Field,
  LoadError,
  toast,
  StatusPill,
  confirmDialog,
} from "@/components/eh";
import { fmtDateTime } from "@/lib/ehf";
import { BOOKING_SLOTS } from "../../../api/lib/booking";

type Appointment = {
  id: number;
  product: string;
  status: string;
  name: string;
  email: string;
  phone: string | null;
  notes: string | null;
  scheduledAt: Date | string;
  durationMin: number;
};

const STATUSES = ["requested", "confirmed", "cancelled", "no_show"] as const;

export default function AdminAppointments() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<string>("");
  const [reschedule, setReschedule] = useState<Appointment | null>(null);

  const q = trpc.appointmentsAdmin.useQuery(undefined, { retry: false });
  const rows = q.data?.filter(a => (status ? a.status === status : true)) ?? [];

  const refresh = () => {
    utils.appointmentsAdmin.invalidate();
  };

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin">
      <PageHead
        eyebrow="Bookings"
        title="Appointments"
        sub="Website booking requests — confirm, reschedule, cancel or mark no-show."
      />

      <div className="eh-tabs eh-mb">
        <button
          className={status === "" ? "on" : ""}
          onClick={() => setStatus("")}
        >
          All
        </button>
        {STATUSES.map(s => (
          <button
            key={s}
            className={status === s ? "on" : ""}
            onClick={() => setStatus(s)}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {q.isLoading && <Spinner />}
      {q.isError && (
        <LoadError what="appointments" onRetry={() => q.refetch()} />
      )}
      {q.data && rows.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No appointments here."
            p="Booking requests from the website land here automatically."
          />
        </div>
      )}

      {q.data && rows.length > 0 && (
        <div className="eh-card" style={{ padding: ".4rem 1.25rem" }}>
          <table className="eh-table stack">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Product</th>
                <th>Date & time</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td data-label="Name">
                    <b>{a.name}</b>
                    {a.phone ? (
                      <div className="eh-sm eh-muted">{a.phone}</div>
                    ) : null}
                  </td>
                  <td data-label="Email" className="eh-sm">
                    {a.email}
                  </td>
                  <td data-label="Product" className="eh-sm">
                    <Pill>{a.product}</Pill>
                  </td>
                  <td data-label="Date & time" className="eh-sm eh-muted">
                    {fmtDateTime(a.scheduledAt)}
                    <div>{a.durationMin}-minute session</div>
                  </td>
                  <td data-label="Status">
                    <StatusPill status={a.status} />
                  </td>
                  <td>
                    <span
                      className="eh-row"
                      style={{ gap: ".3rem", justifyContent: "flex-end" }}
                    >
                      {a.status !== "confirmed" && a.status !== "cancelled" && (
                        <ConfirmButton id={a.id} onDone={refresh} />
                      )}
                      {a.status !== "cancelled" && a.status !== "no_show" && (
                        <CancelButton id={a.id} onDone={refresh} />
                      )}
                      {a.status !== "cancelled" && (
                        <button
                          className="eh-btn ghost sm"
                          onClick={() => setReschedule(a)}
                        >
                          Reschedule
                        </button>
                      )}
                      {a.status === "confirmed" && (
                        <NoShowButton id={a.id} onDone={refresh} />
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reschedule && (
        <RescheduleModal
          appointment={reschedule}
          onClose={() => setReschedule(null)}
          onDone={() => {
            setReschedule(null);
            refresh();
          }}
        />
      )}
    </EhShell>
  );
}

function ConfirmButton({ id, onDone }: { id: number; onDone: () => void }) {
  const m = trpc.confirmAppointment.useMutation({
    onSuccess: () => {
      toast("Appointment confirmed.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  return (
    <button
      className="eh-btn ghost sm gold"
      disabled={m.isPending}
      onClick={() => m.mutate({ id })}
    >
      Confirm
    </button>
  );
}

function CancelButton({ id, onDone }: { id: number; onDone: () => void }) {
  const m = trpc.cancelAppointment.useMutation({
    onSuccess: r => {
      toast(
        r.emailSent
          ? "Appointment cancelled — visitor notified."
          : "Appointment cancelled — visitor notification failed."
      );
      onDone();
    },
    onError: e => toast(e.message),
  });
  return (
    <button
      className="eh-btn ghost sm danger"
      disabled={m.isPending}
      onClick={async () => {
        if (
          await confirmDialog({
            title: "Cancel appointment?",
            body: "The visitor will be notified by email.",
            danger: true,
          })
        ) {
          m.mutate({ id });
        }
      }}
    >
      Cancel
    </button>
  );
}

function NoShowButton({ id, onDone }: { id: number; onDone: () => void }) {
  const m = trpc.markNoShow.useMutation({
    onSuccess: () => {
      toast("Marked as no-show.");
      onDone();
    },
    onError: e => toast(e.message),
  });
  return (
    <button
      className="eh-btn ghost sm"
      disabled={m.isPending}
      onClick={async () => {
        if (
          await confirmDialog({
            title: "Mark as no-show?",
            body: "This records that the visitor did not attend the scheduled session.",
          })
        ) {
          m.mutate({ id });
        }
      }}
    >
      No-show
    </button>
  );
}

function RescheduleModal({
  appointment,
  onClose,
  onDone,
}: {
  appointment: Appointment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState<string>(BOOKING_SLOTS[0]);
  const m = trpc.rescheduleAppointment.useMutation({
    onSuccess: data => {
      toast(data.emailSent ? "Rescheduled and emailed." : "Rescheduled.");
      onDone();
    },
    onError: e => toast(e.message),
  });

  return (
    <Modal title="Reschedule appointment" onClose={onClose}>
      <p className="eh-sm eh-muted" style={{ marginTop: 0 }}>
        Pick a new weekday slot for <b>{appointment.name}</b>. An updated
        confirmation email will be sent.
      </p>
      <div className="eh-grid g2 eh-mb">
        <Field label="Date">
          <input
            className="eh-input"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </Field>
        <Field label="Time">
          <select
            className="eh-select"
            value={time}
            onChange={e => setTime(e.target.value)}
          >
            {BOOKING_SLOTS.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <button
        className="eh-btn gold"
        disabled={m.isPending || !date}
        onClick={() =>
          m.mutate({
            id: appointment.id,
            date,
            time: time as (typeof BOOKING_SLOTS)[number],
          })
        }
      >
        {m.isPending ? "Saving…" : "Reschedule and confirm"}
      </button>
    </Modal>
  );
}
