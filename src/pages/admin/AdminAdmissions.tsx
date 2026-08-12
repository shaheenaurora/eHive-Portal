import { useState } from "react";
import { trpc } from "@/providers/trpc";
import {
  EhShell,
  ADMIN_NAV,
  PageHead,
  Pill,
  Spinner,
  Modal,
  Field,
  Empty,
  toast,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";

type Tab = "zenith" | "investors" | "pdpl";

const ZENITH_STATUS_COLOR: Record<
  string,
  "blue" | "gold" | "green" | "grey" | "purple"
> = {
  nominated: "blue",
  endorsing: "gold",
  review: "purple",
  approved: "green",
  rejected: "grey",
};

export default function AdminAdmissions() {
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("zenith");
  const zen = trpc.adminEngage.zenithAdmin.useQuery(undefined, {
    retry: false,
  });
  const intros = trpc.adminEngage.investorIntros.useQuery(undefined, {
    retry: false,
  });
  const reqs = trpc.adminEngage.dataRequestsAdmin.useQuery(undefined, {
    retry: false,
  });

  const [decideFor, setDecideFor] = useState<{
    id: number;
    name: string;
    approve: boolean;
  } | null>(null);
  const [note, setNote] = useState("");
  const [introOpen, setIntroOpen] = useState(false);

  function refresh() {
    utils.adminEngage.zenithAdmin.invalidate();
    utils.adminEngage.investorIntros.invalidate();
    utils.adminEngage.dataRequestsAdmin.invalidate();
  }

  const decide = trpc.adminEngage.decideZenith.useMutation({
    onSuccess: r => {
      toast(
        r.inductionNo
          ? `Approved — induction №${r.inductionNo} issued.`
          : "Decision recorded."
      );
      setDecideFor(null);
      setNote("");
      refresh();
    },
    onError: e => toast(e.message),
  });
  const addIntro = trpc.adminEngage.addInvestorIntro.useMutation({
    onSuccess: () => {
      toast("Introduction logged — member notified.");
      setIntroOpen(false);
      refresh();
    },
    onError: e => toast(e.message),
  });
  const completeReq = trpc.adminEngage.completeDataRequest.useMutation({
    onSuccess: () => {
      toast("Request marked complete — member notified.");
      refresh();
    },
    onError: e => toast(e.message),
  });

  return (
    <EhShell groups={ADMIN_NAV} brandSub="Admin Portal" roleRequired="admin">
      <PageHead
        eyebrow="Admissions"
        title="Zenith & investor relations"
        sub="Nomination → endorsements (2 QC or 1 board) → leadership review → decision. Cap: 50 seats, induction numbers for life."
      />

      <div className="eh-tabs">
        <button
          className={tab === "zenith" ? "on" : ""}
          onClick={() => setTab("zenith")}
        >
          Zenith pipeline
          {zen.data ? ` (${zen.data.zenithCount}/${zen.data.cap} seated)` : ""}
        </button>
        <button
          className={tab === "investors" ? "on" : ""}
          onClick={() => setTab("investors")}
        >
          Investor tracker
        </button>
        <button
          className={tab === "pdpl" ? "on" : ""}
          onClick={() => setTab("pdpl")}
        >
          PDPL requests
          {reqs.data?.filter(r => r.status === "open").length
            ? ` (${reqs.data.filter(r => r.status === "open").length} open)`
            : ""}
        </button>
      </div>

      {tab === "zenith" && (
        <>
          {zen.isLoading && <Spinner />}
          {zen.data && zen.data.apps.length === 0 && (
            <div className="eh-card">
              <Empty
                big="Pipeline is empty."
                p="Zenith members nominate from their portal; candidates appear here."
              />
            </div>
          )}
          {(zen.data?.apps ?? []).map(a => (
            <div className="eh-card eh-mb" key={a.id}>
              <div className="eh-between">
                <div>
                  <h3 style={{ margin: 0 }}>
                    {a.name}{" "}
                    {a.company ? (
                      <span className="eh-muted eh-sm">· {a.company}</span>
                    ) : null}
                  </h3>
                  <div className="eh-muted eh-sm">
                    {a.email} · nominated {fmtDate(a.createdAt)}
                  </div>
                </div>
                <Pill color={ZENITH_STATUS_COLOR[a.status] ?? "grey"}>
                  {a.status}
                </Pill>
              </div>
              {a.proofPoint && (
                <p className="eh-sm eh-muted eh-mt" style={{ marginBottom: 0 }}>
                  {a.proofPoint}
                </p>
              )}
              <div className="eh-list eh-mt">
                {a.endorsements.map(
                  (e: { role: string; name: string }, i: number) => (
                    <div className="row" key={i}>
                      <span className="t eh-sm" style={{ flex: 1 }}>
                        {e.name}
                      </span>
                      <Pill color={e.role === "board" ? "purple" : "blue"}>
                        {e.role === "board" ? "board" : "QC"}
                      </Pill>
                    </div>
                  )
                )}
                {a.endorsements.length === 0 && (
                  <p className="eh-muted eh-sm">
                    No endorsements yet — needs 2 QC or 1 board.
                  </p>
                )}
              </div>
              {!["approved", "rejected"].includes(a.status) && (
                <div className="eh-row eh-mt">
                  <button
                    className="eh-btn sm gold"
                    disabled={a.status !== "review"}
                    title={
                      a.status !== "review"
                        ? "Opens once endorsement threshold is met"
                        : ""
                    }
                    onClick={() => {
                      setDecideFor({ id: a.id, name: a.name, approve: true });
                      setNote("");
                    }}
                  >
                    Approve (review)
                  </button>
                  <button
                    className="eh-btn ghost sm"
                    style={{ color: "var(--eh-red)" }}
                    onClick={() => {
                      setDecideFor({ id: a.id, name: a.name, approve: false });
                      setNote("");
                    }}
                  >
                    Decline
                  </button>
                </div>
              )}
              {a.note && (
                <p className="eh-muted eh-sm eh-mt">Decision note: {a.note}</p>
              )}
            </div>
          ))}
        </>
      )}

      {tab === "investors" && (
        <>
          <div className="eh-between eh-mb">
            <p className="eh-muted eh-sm" style={{ margin: 0 }}>
              Intro eligibility = FRP complete + Active engagement. Same
              investor + same member has a 90-day cool-down.
            </p>
            <button className="eh-btn gold" onClick={() => setIntroOpen(true)}>
              Log an intro →
            </button>
          </div>
          <div className="eh-card">
            {intros.isLoading && <Spinner />}
            {intros.data && intros.data.length === 0 && (
              <Empty big="No intros logged yet." />
            )}
            <div className="eh-list">
              {(intros.data ?? []).map(i => (
                <div className="row" key={i.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">
                      {i.investorName}
                      {i.firm ? (
                        <span className="eh-muted"> · {i.firm}</span>
                      ) : null}
                    </div>
                    <div className="d">
                      → {i.memberName} · by {i.introducedBy} ·{" "}
                      {fmtDate(i.createdAt)}
                      {i.note ? ` — ${i.note}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "pdpl" && (
        <div className="eh-card">
          {reqs.isLoading && <Spinner />}
          {reqs.data && reqs.data.length === 0 && (
            <Empty
              big="No data requests."
              p="PDPL export/deletion requests from members appear here."
            />
          )}
          <div className="eh-list">
            {(reqs.data ?? []).map(r => (
              <div className="row" key={r.id}>
                <div style={{ flex: 1 }}>
                  <div className="t">
                    Data {r.kind} — {r.memberName}
                  </div>
                  <div className="d">requested {fmtDate(r.createdAt)}</div>
                </div>
                {r.status === "open" ? (
                  <button
                    className="eh-btn sm gold"
                    disabled={completeReq.isPending}
                    onClick={() => completeReq.mutate({ id: r.id })}
                  >
                    Mark completed
                  </button>
                ) : (
                  <Pill color="green">done</Pill>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {decideFor && (
        <Modal
          title={`${decideFor.approve ? "Approve" : "Decline"} — ${decideFor.name}`}
          onClose={() => setDecideFor(null)}
        >
          <p className="eh-sm eh-muted">
            {decideFor.approve
              ? `Approving seats them as Zenith #${(zen.data?.zenithCount ?? 0) + 1} of ${zen.data?.cap ?? 50} and issues the next induction number.`
              : "The candidate is notified their nomination didn't make it this time."}
          </p>
          <Field label="Decision note (optional)">
            <textarea
              className="eh-textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              maxLength={1000}
            />
          </Field>
          <button
            className={"eh-btn" + (decideFor.approve ? " gold" : " danger")}
            style={{ width: "100%" }}
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({
                id: decideFor.id,
                approve: decideFor.approve,
                note: note || undefined,
              })
            }
          >
            {decide.isPending
              ? "Deciding…"
              : decideFor.approve
                ? "Approve & seat →"
                : "Decline"}
          </button>
        </Modal>
      )}

      {introOpen && (
        <Modal
          title="Log an investor intro"
          onClose={() => setIntroOpen(false)}
        >
          <IntroForm
            pending={addIntro.isPending}
            onSubmit={v => addIntro.mutate(v)}
          />
        </Modal>
      )}
    </EhShell>
  );
}

function IntroForm(props: {
  pending: boolean;
  onSubmit: (v: {
    investorName: string;
    firm?: string;
    memberId: number;
    note?: string;
  }) => void;
}) {
  const members = trpc.admin.members.useQuery(undefined, { retry: false });
  const [investor, setInvestor] = useState("");
  const [firm, setFirm] = useState("");
  const [memberId, setMemberId] = useState(0);
  const [note, setNote] = useState("");
  const elig = trpc.adminEngage.checkIntroEligibility.useQuery(
    { memberId },
    { retry: false, enabled: memberId > 0 }
  );
  return (
    <>
      <Field label="Investor">
        <input
          className="eh-input"
          value={investor}
          onChange={e => setInvestor(e.target.value)}
          minLength={2}
          placeholder="Investor name"
        />
      </Field>
      <Field label="Firm (optional)">
        <input
          className="eh-input"
          value={firm}
          onChange={e => setFirm(e.target.value)}
        />
      </Field>
      <Field label="Introduce to member">
        <select
          className="eh-select"
          value={memberId}
          onChange={e => setMemberId(Number(e.target.value))}
        >
          <option value={0}>Pick a member…</option>
          {(members.data ?? []).map(m => (
            <option key={m.member.id} value={m.member.id}>
              {m.userName ?? m.userEmail ?? `Member #${m.member.id}`}
            </option>
          ))}
        </select>
      </Field>
      {memberId > 0 && elig.data && !elig.data.eligible && (
        <div className="eh-banner eh-mb">
          <span className="eh-sm">
            <b>Not intro-eligible:</b> {elig.data.reasons.join("; ")}
          </span>
        </div>
      )}
      <Field label="Note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
        />
      </Field>
      <button
        className="eh-btn gold"
        style={{ width: "100%" }}
        disabled={
          props.pending ||
          investor.trim().length < 2 ||
          !memberId ||
          !elig.data?.eligible
        }
        onClick={() =>
          props.onSubmit({
            investorName: investor.trim(),
            firm: firm || undefined,
            memberId,
            note: note || undefined,
          })
        }
      >
        {props.pending ? "Logging…" : "Log intro →"}
      </button>
    </>
  );
}
