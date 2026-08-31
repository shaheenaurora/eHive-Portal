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
  LoadError,
  toast,
} from "@/components/eh";
import {
  AWARD_CATEGORIES,
  AWARD_CATEGORY_LABEL,
  AWARD_LEVEL_LABEL,
} from "@contracts/constants";

export default function Awards() {
  useDocumentTitle("Awards & Recognition");
  const q = trpc.engage.awardsOpen.useQuery(undefined, { retry: false });
  const voting = trpc.engage.awardsVotingOpen.useQuery(undefined, { retry: false });
  const directory = trpc.engage.memberDirectory.useQuery(undefined, { retry: false });
  const chapters = trpc.circle.chaptersDirectory.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();

  const submit = trpc.engage.submitNomination.useMutation({
    onSuccess: () => {
      toast("Nomination submitted.");
      utils.engage.awardsOpen.invalidate();
    },
    onError: e => toast(e.message),
  });

  const castVote = trpc.engage.castAwardVote.useMutation({
    onSuccess: () => {
      toast("Vote recorded.");
      utils.engage.awardsVotingOpen.invalidate();
      utils.engage.awardShortlist.invalidate();
    },
    onError: e => toast(e.message),
  });


  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Recognition"
        title="Awards & honours"
        sub="Nominate peers, vote on the shortlist, and celebrate the members and chapters that embody Build · Belong · Become."
      />

      {q.isLoading && <Spinner />}
      {q.isError && (
        <LoadError what="awards" onRetry={() => q.refetch()} />
      )}
      {q.data && (
        <>
          {q.data.cycle ? (
            <div className="eh-card eh-mb">
              <div className="eh-between" style={{ alignItems: "flex-start" }}>
                <div>
                  <div className="eh-eyebrow">
                    Nominations open · {AWARD_LEVEL_LABEL[q.data.cycle.level] ?? q.data.cycle.level}
                  </div>
                  <h2 style={{ margin: ".2rem 0 0" }}>{q.data.cycle.name}</h2>
                  <p className="eh-sm eh-muted" style={{ margin: ".3rem 0 0" }}>
                    Pick a category below and nominate someone who deserves recognition.
                  </p>
                </div>
                <Pill color="green">Open</Pill>
              </div>

              <div
                className="eh-grid g2"
                style={{ marginTop: "1rem", alignItems: "stretch" }}
              >
                {AWARD_CATEGORIES.map(cat => (
                  <NominationCard
                    key={cat.key}
                    category={cat}
                    cycleId={q.data.cycle!.id}
                    members={directory.data ?? []}
                    chapters={chapters.data?.chapters ?? []}
                    pending={submit.isPending}
                    onSubmit={v => submit.mutate({ cycleId: q.data.cycle!.id, category: cat.key, ...v })}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="eh-card eh-mb">
              <Empty
                big="Nominations are closed"
                p="There is no award cycle open for nominations right now. Winners from announced cycles appear below."
              />
            </div>
          )}

          {voting.data && voting.data.length > 0 && (
            <div className="eh-card eh-mb">
              <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
                Voting open
              </div>
              <div className="eh-list">
                {voting.data.map(cycle => (
                  <VotingCycle
                    key={cycle.id}
                    cycle={cycle}
                    onVote={(nominationId) =>
                      castVote.mutate({ cycleId: cycle.id, nominationId })
                    }
                    pending={castVote.isPending}
                  />
                ))}
              </div>
            </div>
          )}

          {q.data.winners.length > 0 && (
            <div className="eh-card">
              <div className="eh-eyebrow" style={{ marginBottom: ".5rem" }}>
                Recent winners
              </div>
              <div className="eh-grid g2">
                {q.data.winners.map(w => (
                  <div className="eh-card" key={w.id} style={{ borderLeft: "3px solid var(--eh-gold, #b8862e)" }}>
                    <div className="eh-row" style={{ justifyContent: "space-between", gap: ".5rem" }}>
                      <b>{AWARD_CATEGORY_LABEL[w.category] ?? w.category}</b>
                      <Pill color="gold">Winner</Pill>
                    </div>
                    <div style={{ marginTop: ".35rem" }}>
                      {w.nomineeName ?? w.nomineeChapterName ?? "Unknown nominee"}
                    </div>
                    {w.citation && (
                      <div className="eh-sm eh-muted" style={{ marginTop: ".35rem" }}>
                        “{w.citation}”
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </EhShell>
  );
}

function NominationCard({
  category,
  members,
  chapters,
  pending,
  onSubmit,
}: {
  category: (typeof AWARD_CATEGORIES)[number];
  cycleId: number;
  members: { id: number; name: string; company: string | null; tier: string | null }[];
  chapters: { id: number; name: string }[];
  pending: boolean;
  onSubmit: (v: { nomineeMemberId?: number; nomineeChapterId?: number; citation?: string }) => void;
}) {
  const [memberId, setMemberId] = useState<number | null>(null);
  const [chapterId, setChapterId] = useState<number | null>(null);
  const [citation, setCitation] = useState("");
  const isMember = category.subject === "member";

  return (
    <div className="eh-card" style={{ display: "flex", flexDirection: "column", gap: ".75rem" }}>
      <div>
        <b>{category.label}</b>
        <div className="eh-sm eh-muted">{category.blurb}</div>
      </div>

      {isMember ? (
        <>
          <select
            className="eh-select"
            value={memberId ?? ""}
            onChange={e => setMemberId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="" disabled>
              Choose a member…
            </option>
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}{m.company ? ` · ${m.company}` : ""}
              </option>
            ))}
          </select>
          <textarea
            className="eh-input"
            rows={2}
            placeholder="Why do they deserve this award?"
            value={citation}
            onChange={e => setCitation(e.target.value)}
          />
          <button
            className="eh-btn gold sm"
            disabled={pending || memberId == null}
            onClick={() => {
              onSubmit({ nomineeMemberId: memberId ?? undefined, citation });
              setMemberId(null);
              setCitation("");
            }}
          >
            {pending ? "Submitting…" : "Nominate"}
          </button>
        </>
      ) : (
        <>
          <select
            className="eh-select"
            value={chapterId ?? ""}
            onChange={e => setChapterId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="" disabled>
              Choose a chapter…
            </option>
            {chapters.map(ch => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
          <textarea
            className="eh-input"
            rows={2}
            placeholder={`Why should this chapter win ${category.label}?`}
            value={citation}
            onChange={e => setCitation(e.target.value)}
          />
          <button
            className="eh-btn gold sm"
            disabled={pending || chapterId == null}
            onClick={() => {
              onSubmit({ nomineeChapterId: chapterId ?? undefined, citation });
              setChapterId(null);
              setCitation("");
            }}
          >
            {pending ? "Submitting…" : "Nominate chapter"}
          </button>
        </>
      )}
    </div>
  );
}

function VotingCycle({
  cycle,
  onVote,
  pending,
}: {
  cycle: { id: number; name: string; level: string };
  onVote: (nominationId: number) => void;
  pending: boolean;
}) {
  const shortlist = trpc.engage.awardShortlist.useQuery(
    { cycleId: cycle.id },
    { retry: false }
  );

  const options = shortlist.data?.options ?? [];
  const myVote = shortlist.data?.myVote;

  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <div className="t">{cycle.name}</div>
        <div className="eh-sm eh-muted">
          {AWARD_LEVEL_LABEL[cycle.level] ?? cycle.level}
        </div>
        {shortlist.isLoading && <Spinner />}
        {shortlist.data && options.length === 0 && (
          <p className="eh-sm eh-muted">No shortlisted nominees yet.</p>
        )}
        {shortlist.data && options.length > 0 && (
          <div className="eh-list" style={{ marginTop: ".5rem" }}>
            {options.map(n => {
              const voted = myVote === n.nominationId;
              return (
                <div className="row" key={n.nominationId}>
                  <span>
                    {n.nomineeName ?? n.nomineeChapterName ?? "Nominee"}
                    <span className="eh-muted eh-sm">
                      {" "}· {AWARD_CATEGORY_LABEL[n.category] ?? n.category}
                    </span>
                  </span>
                  <button
                    className="eh-btn gold sm"
                    disabled={pending || voted || myVote != null}
                    onClick={() => onVote(n.nominationId)}
                  >
                    {voted ? "Voted" : myVote != null ? "Already voted" : "Vote"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
