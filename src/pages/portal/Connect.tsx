import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  Empty,
  Spinner,
  Modal,
  Field,
  TierPill,
  toast,
} from "@/components/eh";
import { fmtDate } from "@/lib/ehf";
import {
  TIER_LABEL,
  AWARD_CATEGORIES,
  AWARD_CATEGORY_LABEL,
} from "@contracts/constants";

type Tab = "121" | "referrals" | "deals";

export default function Connect() {
  useDocumentTitle("Connect");
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<Tab>("121");
  const [logOpen, setLogOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);

  const oneToOnes = trpc.engage.myOneToOnes.useQuery(undefined, {
    retry: false,
  });
  const buddy = trpc.engage.myBuddy.useQuery(undefined, { retry: false });
  const directory = trpc.engage.memberDirectory.useQuery(undefined, {
    retry: false,
  });
  const referrals = trpc.engage.myReferrals.useQuery(undefined, {
    retry: false,
  });
  const deals = trpc.engage.deals.useQuery(undefined, { retry: false });
  const awards = trpc.engage.awardsOpen.useQuery(undefined, { retry: false });
  const votingOpen = trpc.engage.awardsVotingOpen.useQuery(undefined, {
    retry: false,
  });
  const hallOfFame = trpc.engage.hallOfFame.useQuery(undefined, {
    retry: false,
  });
  const nominate = trpc.engage.submitNomination.useMutation({
    onSuccess: () => {
      toast("Nomination submitted — thank you for recognising a peer.");
      utils.engage.awardsOpen.invalidate();
    },
    onError: e => toast(e.message),
  });
  function refresh() {
    utils.engage.myOneToOnes.invalidate();
    utils.engage.myBuddy.invalidate();
    utils.engage.myReferrals.invalidate();
    utils.engage.deals.invalidate();
    utils.circle.myScore.invalidate();
    utils.circle.dashboard.invalidate();
  }

  const log = trpc.engage.logOneToOne.useMutation({
    onSuccess: () => {
      toast("Logged — your counterpart confirms it.");
      setLogOpen(false);
      refresh();
    },
    onError: e => toast(e.message),
  });
  const respond = trpc.engage.respondOneToOne.useMutation({
    onSuccess: r => {
      toast(
        r.score !== undefined
          ? `Confirmed — Hive Score now ${r.score}`
          : "Response recorded."
      );
      refresh();
    },
    onError: e => toast(e.message),
  });
  const checkin = trpc.engage.buddyCheckin.useMutation({
    onSuccess: () => {
      toast(
        "30-day check-in recorded — thank you for looking after new members."
      );
      refresh();
    },
    onError: e => toast(e.message),
  });
  const submitRef = trpc.engage.submitReferral.useMutation({
    onSuccess: r => {
      toast(`Referral submitted — Hive Score now ${r.score}`);
      setRefOpen(false);
      refresh();
    },
    onError: e => toast(e.message),
  });
  const postDeal = trpc.engage.postDeal.useMutation({
    onSuccess: () => {
      toast("Deal posted to the board.");
      setDealOpen(false);
      refresh();
    },
    onError: e => toast(e.message),
  });

  const pendingForMe = (oneToOnes.data ?? []).filter(
    r => r.status === "pending" && !r.mine
  );
  const myLog = (oneToOnes.data ?? []).filter(
    r => !(r.status === "pending" && !r.mine)
  );

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Connect"
        title="Give first"
        sub="1-2-1s, mentoring, referrals and the Deal Flow board. The Circle runs on members showing up for each other."
      />

      {/* buddy strip */}
      {(buddy.data?.pairedWith || (buddy.data?.buddyFor.length ?? 0) > 0) && (
        <div
          className="eh-banner eh-mb"
          style={{
            display: "flex",
            gap: "1.5rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {buddy.data?.pairedWith && (
            <span className="eh-sm">
              ⬡ Your buddy: <b>{buddy.data.pairedWith.name}</b> — reach out,
              they're expecting you.
            </span>
          )}
          {buddy.data?.buddyFor.map(b => (
            <span
              key={b.id}
              className="eh-sm"
              style={{
                display: "inline-flex",
                gap: ".5rem",
                alignItems: "center",
              }}
            >
              ◍ You're buddy to <b>{b.name}</b>
              {b.checkinAt ? (
                <Pill color="green">check-in done</Pill>
              ) : (
                <button
                  className="eh-btn sm"
                  disabled={checkin.isPending}
                  onClick={() => checkin.mutate({ id: b.id })}
                >
                  30-day check-in
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* NA-03 Recognition — winners wall + open nominations */}
      {((awards.data?.winners.length ?? 0) > 0 || awards.data?.cycle) && (
        <div className="eh-card eh-mb">
          <div
            className="eh-row"
            style={{
              gap: ".5rem",
              alignItems: "center",
              marginBottom: ".6rem",
            }}
          >
            <h3 style={{ margin: 0 }}>Recognition</h3>
            {awards.data?.cycle && <Pill color="gold">Nominations open</Pill>}
          </div>

          {(awards.data?.winners.length ?? 0) > 0 && (
            <div
              className="eh-list"
              style={{ marginBottom: awards.data?.cycle ? "1rem" : 0 }}
            >
              {awards.data!.winners.map(w => (
                <div className="row" key={w.id}>
                  <span className="t">
                    ✵ {AWARD_CATEGORY_LABEL[w.category] ?? w.category}
                  </span>
                  <b>{w.nomineeName ?? w.nomineeChapterName ?? "—"}</b>
                </div>
              ))}
            </div>
          )}

          {awards.data?.cycle && (
            <div
              style={{
                borderTop:
                  (awards.data?.winners.length ?? 0) > 0
                    ? "1px solid var(--eh-border)"
                    : undefined,
                paddingTop: (awards.data?.winners.length ?? 0) > 0 ? "1rem" : 0,
              }}
            >
              <p className="eh-sm eh-muted" style={{ marginBottom: ".6rem" }}>
                <b>{awards.data.cycle.name}</b> — nominate a peer or chapter
                that's made the Circle better. One nomination per category.
              </p>
              <AwardsNominationForm
                cycleId={awards.data.cycle.id}
                directory={directory.data ?? []}
                nominate={nominate}
              />
            </div>
          )}
        </div>
      )}

      {/* NA-03 Recognition — constrained shortlist voting (member-vote) */}
      {(votingOpen.data ?? []).map(c => (
        <AwardVoteCard key={c.id} cycleId={c.id} cycleName={c.name} />
      ))}

      {/* Hall of Fame — the lifetime-honours wall */}
      {(hallOfFame.data?.length ?? 0) > 0 && (
        <div className="eh-card eh-mb">
          <div
            className="eh-row"
            style={{
              gap: ".5rem",
              alignItems: "center",
              marginBottom: ".6rem",
            }}
          >
            <h3 style={{ margin: 0 }}>Hall of Fame</h3>
            <Pill color="gold">Lifetime honour</Pill>
          </div>
          <p className="eh-sm eh-muted" style={{ marginBottom: ".6rem" }}>
            Permanent recognition for members of sustained, multi-year
            excellence.
          </p>
          <div className="eh-list">
            {hallOfFame.data!.map(h => (
              <div className="row" key={`${h.memberId}-${h.conferredAt}`}>
                <span className="t">🏛️ {h.name ?? "—"}</span>
                <span className="eh-sm eh-muted">{fmtDate(h.conferredAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="eh-tabs">
        <button
          className={tab === "121" ? "on" : ""}
          onClick={() => setTab("121")}
        >
          1-2-1s & Mentoring
        </button>
        <button
          className={tab === "referrals" ? "on" : ""}
          onClick={() => setTab("referrals")}
        >
          Referrals
        </button>
        <button
          className={tab === "deals" ? "on" : ""}
          onClick={() => setTab("deals")}
        >
          Deal Flow
        </button>
      </div>

      {tab === "121" && (
        <>
          <div className="eh-between eh-mb">
            <h2 className="eh-h2" style={{ margin: 0 }}>
              1-2-1s
            </h2>
            <button className="eh-btn gold" onClick={() => setLogOpen(true)}>
              Log a 1-2-1 →
            </button>
          </div>
          <p className="eh-muted eh-sm eh-mb">
            Log it, your counterpart confirms it, you both earn points.
            Mentoring sessions earn Give-Back credit for the mentor.
          </p>

          {pendingForMe.length > 0 && (
            <div className="eh-card eh-mb" style={{ borderColor: "#b8862e" }}>
              <h3>Awaiting your confirmation</h3>
              <div className="eh-list">
                {pendingForMe.map(r => (
                  <div className="row" key={r.id}>
                    <div style={{ flex: 1 }}>
                      <div className="t">
                        {r.kind === "mentoring" ? "Mentoring" : "1-2-1"} with{" "}
                        {r.aName}
                      </div>
                      <div className="d">
                        {fmtDate(r.createdAt)}
                        {r.note ? ` — ${r.note}` : ""}
                      </div>
                    </div>
                    <button
                      className="eh-btn sm gold"
                      disabled={respond.isPending}
                      onClick={() => respond.mutate({ id: r.id, accept: true })}
                    >
                      Confirm
                    </button>
                    <button
                      className="eh-btn ghost sm"
                      disabled={respond.isPending}
                      onClick={() =>
                        respond.mutate({ id: r.id, accept: false })
                      }
                    >
                      Decline
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="eh-card">
            {oneToOnes.isLoading && <Spinner />}
            {oneToOnes.data && myLog.length === 0 && (
              <Empty
                big="No 1-2-1s yet."
                p="Pick someone from the directory and book twenty minutes — it's how the Circle works."
              />
            )}
            <div className="eh-list">
              {myLog.map(r => (
                <div className="row" key={r.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">
                      {r.kind === "mentoring" ? "Mentoring" : "1-2-1"} —{" "}
                      {r.mine ? r.bName : r.aName}
                    </div>
                    <div className="d">
                      {fmtDate(r.createdAt)}
                      {r.note ? ` — ${r.note}` : ""}
                    </div>
                  </div>
                  {r.status === "confirmed" && (
                    <Pill color="green">confirmed</Pill>
                  )}
                  {r.status === "pending" && (
                    <Pill color="blue">awaiting confirm</Pill>
                  )}
                  {r.status === "declined" && <Pill>declined</Pill>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "referrals" && (
        <>
          <div className="eh-between eh-mb">
            <h2 className="eh-h2" style={{ margin: 0 }}>
              Referrals
            </h2>
            <button className="eh-btn gold" onClick={() => setRefOpen(true)}>
              Submit a referral →
            </button>
          </div>
          <p className="eh-muted eh-sm eh-mb">
            Know someone who belongs in the Circle? Submit them — conversions
            earn double. One referral per quarter unlocks Deal Flow posting.
          </p>
          <div className="eh-card">
            {referrals.data && referrals.data.length === 0 && (
              <Empty
                big="No referrals yet."
                p="Give-to-get: your first referral opens the Deal Flow board for posting."
              />
            )}
            <div className="eh-list">
              {(referrals.data ?? []).map(r => (
                <div className="row" key={r.id}>
                  <div style={{ flex: 1 }}>
                    <div className="t">{r.prospectName}</div>
                    <div className="d">
                      {fmtDate(r.createdAt)}
                      {r.note ? ` — ${r.note}` : ""}
                    </div>
                  </div>
                  {r.status === "converted" && (
                    <Pill color="green">converted</Pill>
                  )}
                  {r.status === "submitted" && (
                    <Pill color="blue">in review</Pill>
                  )}
                  {r.status === "rejected" && <Pill>not a fit</Pill>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "deals" && (
        <>
          <div className="eh-between eh-mb">
            <h2 className="eh-h2" style={{ margin: 0 }}>
              Deal Flow
            </h2>
            <button
              className="eh-btn gold"
              onClick={() => setDealOpen(true)}
              disabled={!deals.data?.canPost}
              title={
                deals.data?.canPost
                  ? ""
                  : "Submit 1 referral this quarter to unlock posting"
              }
            >
              Post a deal →
            </button>
          </div>
          {deals.data && !deals.data.canPost && (
            <div className="eh-banner eh-mb">
              <span className="eh-sm">
                <b>Give-to-get:</b> submit at least 1 referral this quarter to
                post on the board (you have {deals.data.referralsThisQuarter}).
                Vanguard+ members post freely.
              </span>
            </div>
          )}
          <div className="eh-grid g2">
            {(deals.data?.deals ?? []).map(d => (
              <div className="eh-card" key={d.id}>
                <div className="eh-between">
                  <TierPill tier={d.tierGate} />
                  <span className="eh-muted eh-sm">{fmtDate(d.createdAt)}</span>
                </div>
                <h3 className="eh-mt">{d.title}</h3>
                <p className="eh-sm eh-muted">{d.description}</p>
              </div>
            ))}
          </div>
          {deals.data && deals.data.deals.length === 0 && (
            <div className="eh-card">
              <Empty
                big="The board is quiet."
                p="Deals, asks and offers from members and staff land here."
              />
            </div>
          )}
          {deals.data?.gated && (
            <p className="eh-muted eh-sm eh-mt">
              Some deals are gated to higher tiers — upgrade to see them.
            </p>
          )}
        </>
      )}

      {logOpen && (
        <Modal title="Log a 1-2-1" onClose={() => setLogOpen(false)}>
          <LogForm
            directory={directory.data ?? []}
            pending={log.isPending}
            onSubmit={(counterpartId, kind, note) =>
              log.mutate({ counterpartId, kind, note })
            }
          />
        </Modal>
      )}

      {refOpen && (
        <Modal title="Submit a referral" onClose={() => setRefOpen(false)}>
          <RefForm
            pending={submitRef.isPending}
            onSubmit={(prospectName, prospectContact, note) =>
              submitRef.mutate({ prospectName, prospectContact, note })
            }
          />
        </Modal>
      )}

      {dealOpen && (
        <Modal title="Post a deal" onClose={() => setDealOpen(false)}>
          <DealForm
            pending={postDeal.isPending}
            onSubmit={(title, description, tierGate) =>
              postDeal.mutate({ title, description, tierGate })
            }
          />
        </Modal>
      )}
    </EhShell>
  );
}

function LogForm(props: {
  directory: {
    id: number;
    name: string;
    company: string | null;
    tier: string;
  }[];
  pending: boolean;
  onSubmit: (
    counterpartId: number,
    kind: "one_to_one" | "mentoring",
    note?: string
  ) => void;
}) {
  const [who, setWho] = useState(0);
  const [kind, setKind] = useState<"one_to_one" | "mentoring">("one_to_one");
  const [note, setNote] = useState("");
  return (
    <>
      <Field label="With whom">
        <select
          className="eh-select"
          value={who}
          onChange={e => setWho(Number(e.target.value))}
        >
          <option value={0}>Pick a member…</option>
          {props.directory.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.company ? ` — ${m.company}` : ""} (
              {TIER_LABEL[m.tier as keyof typeof TIER_LABEL] ?? m.tier})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Kind">
        <select
          className="eh-select"
          value={kind}
          onChange={e => setKind(e.target.value as "one_to_one" | "mentoring")}
        >
          <option value="one_to_one">1-2-1 (peer catch-up)</option>
          <option value="mentoring">Mentoring (they mentored me)</option>
        </select>
      </Field>
      <Field label="Note (optional)">
        <input
          className="eh-input"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
          placeholder="What did you work on?"
        />
      </Field>
      <button
        className="eh-btn gold"
        style={{ width: "100%" }}
        disabled={props.pending || !who}
        onClick={() => props.onSubmit(who, kind, note || undefined)}
      >
        {props.pending ? "Logging…" : "Log it — they'll confirm →"}
      </button>
    </>
  );
}

function RefForm(props: {
  pending: boolean;
  onSubmit: (name: string, contact?: string, note?: string) => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  return (
    <>
      <Field label="Who should join the Circle?">
        <input
          className="eh-input"
          value={name}
          onChange={e => setName(e.target.value)}
          minLength={2}
          placeholder="Founder name"
        />
      </Field>
      <Field label="Contact (email / phone — optional)">
        <input
          className="eh-input"
          value={contact}
          onChange={e => setContact(e.target.value)}
        />
      </Field>
      <Field label="Why them? (optional)">
        <textarea
          className="eh-textarea"
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={500}
        />
      </Field>
      <button
        className="eh-btn gold"
        style={{ width: "100%" }}
        disabled={props.pending || name.trim().length < 2}
        onClick={() =>
          props.onSubmit(name.trim(), contact || undefined, note || undefined)
        }
      >
        {props.pending ? "Submitting…" : "Submit referral →"}
      </button>
    </>
  );
}

function DealForm(props: {
  pending: boolean;
  onSubmit: (
    title: string,
    description?: string,
    tierGate?: "horizon" | "ascent" | "vanguard" | "zenith"
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [gate, setGate] = useState<
    "horizon" | "ascent" | "vanguard" | "zenith"
  >("ascent");
  return (
    <>
      <Field label="Deal title">
        <input
          className="eh-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          minLength={4}
          placeholder="e.g. Seeking co-lead for $500k bridge"
        />
      </Field>
      <Field label="Details">
        <textarea
          className="eh-textarea"
          value={desc}
          onChange={e => setDesc(e.target.value)}
          maxLength={4000}
          placeholder="Terms, timing, who to contact."
        />
      </Field>
      <Field label="Visible from tier">
        <select
          className="eh-select"
          value={gate}
          onChange={e => setGate(e.target.value as typeof gate)}
        >
          {(["ascent", "vanguard", "zenith"] as const).map(t => (
            <option key={t} value={t}>
              {TIER_LABEL[t]} and above
            </option>
          ))}
        </select>
      </Field>
      <button
        className="eh-btn gold"
        style={{ width: "100%" }}
        disabled={props.pending || title.trim().length < 4}
        onClick={() => props.onSubmit(title.trim(), desc || undefined, gate)}
      >
        {props.pending ? "Posting…" : "Post to the board →"}
      </button>
    </>
  );
}

function AwardVoteCard({
  cycleId,
  cycleName,
}: {
  cycleId: number;
  cycleName: string;
}) {
  const utils = trpc.useUtils();
  const shortlist = trpc.engage.awardShortlist.useQuery(
    { cycleId },
    { retry: false }
  );
  const [choice, setChoice] = useState<number | null>(null);
  const vote = trpc.engage.castAwardVote.useMutation({
    onSuccess: () => {
      toast("Vote cast — thank you. Each member gets one equal vote.");
      utils.engage.awardShortlist.invalidate({ cycleId });
    },
    onError: e => toast(e.message),
  });

  const data = shortlist.data;
  if (!data || !data.open || data.options.length === 0) return null;
  const votedFor = data.myVote;

  return (
    <div className="eh-card eh-mb">
      <div
        className="eh-row"
        style={{ gap: ".5rem", alignItems: "center", marginBottom: ".6rem" }}
      >
        <h3 style={{ margin: 0 }}>Cast your vote</h3>
        <Pill color="gold">Voting open</Pill>
      </div>
      <p className="eh-sm eh-muted" style={{ marginBottom: ".6rem" }}>
        <b>{cycleName}</b> — one equal vote from a pre-qualified shortlist. Your
        vote is confidential and tallies aren't shown until results are
        announced.
      </p>
      <div className="eh-list">
        {data.options.map(o => {
          const mine = votedFor === o.nominationId;
          return (
            <label
              key={o.nominationId}
              className="row"
              style={{
                cursor: votedFor ? "default" : "pointer",
                alignItems: "center",
                gap: ".5rem",
              }}
            >
              {!votedFor && (
                <input
                  type="radio"
                  name={`vote-${cycleId}`}
                  checked={choice === o.nominationId}
                  onChange={() => setChoice(o.nominationId)}
                />
              )}
              <span className="t" style={{ flex: 1 }}>
                {o.nomineeName ?? o.nomineeChapterName ?? "—"}
                <span className="eh-sm eh-muted">
                  {" "}
                  · {AWARD_CATEGORY_LABEL[o.category] ?? o.category}
                </span>
              </span>
              {mine && <Pill color="green">your vote</Pill>}
            </label>
          );
        })}
      </div>
      {!votedFor && (
        <button
          className="eh-btn gold sm"
          style={{ marginTop: ".6rem" }}
          disabled={vote.isPending || choice === null}
          onClick={() =>
            choice !== null && vote.mutate({ cycleId, nominationId: choice })
          }
        >
          Cast vote
        </button>
      )}
    </div>
  );
}

function AwardsNominationForm({
  cycleId,
  directory,
  nominate,
}: {
  cycleId: number;
  directory: { id: number; name: string | null }[];
  nominate: ReturnType<typeof trpc.engage.submitNomination.useMutation>;
}) {
  const [category, setCategory] = useState("");
  const [memberId, setMemberId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [citation, setCitation] = useState("");
  const chapters = trpc.circle.chaptersDirectory.useQuery(undefined, {
    retry: false,
  });

  const selected = AWARD_CATEGORIES.find(c => c.key === category);
  const canSubmit =
    category &&
    ((selected?.subject === "member" && memberId) ||
      (selected?.subject === "chapter" && chapterId));

  const submit = () => {
    if (!selected || !canSubmit) return;
    nominate.mutate({
      cycleId,
      category,
      nomineeMemberId:
        selected.subject === "member" ? Number(memberId) : undefined,
      nomineeChapterId:
        selected.subject === "chapter" ? Number(chapterId) : undefined,
      citation: citation || undefined,
    });
  };

  return (
    <div>
      <div
        className="eh-row"
        style={{ gap: ".4rem", flexWrap: "wrap", alignItems: "flex-start" }}
      >
        <div style={{ flex: "1 1 240px" }}>
          <select
            className="eh-select"
            style={{ width: "100%" }}
            value={category}
            onChange={e => {
              setCategory(e.target.value);
              setMemberId("");
              setChapterId("");
            }}
          >
            <option value="">Category…</option>
            {AWARD_CATEGORIES.map(c => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          {selected && (
            <p className="eh-sm eh-muted" style={{ margin: ".35rem 0 0" }}>
              {selected.blurb}
            </p>
          )}
        </div>
        {selected?.subject === "member" && (
          <select
            className="eh-select"
            style={{ flex: "1 1 200px" }}
            value={memberId}
            onChange={e => setMemberId(e.target.value)}
          >
            <option value="">Nominate a member…</option>
            {directory.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {selected?.subject === "chapter" && (
          <select
            className="eh-select"
            style={{ flex: "1 1 200px" }}
            value={chapterId}
            onChange={e => setChapterId(e.target.value)}
          >
            <option value="">Nominate a chapter…</option>
            {(chapters.data?.chapters ?? []).map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <input
        className="eh-input"
        style={{ marginTop: ".4rem", width: "100%" }}
        placeholder="Why them? (optional citation)"
        value={citation}
        onChange={e => setCitation(e.target.value)}
      />
      <button
        className="eh-btn gold sm"
        style={{ marginTop: ".5rem" }}
        disabled={nominate.isPending || !canSubmit}
        onClick={submit}
      >
        Submit nomination
      </button>
    </div>
  );
}
