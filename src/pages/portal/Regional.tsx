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
  Modal,
  Bar,
} from "@/components/eh";
import {
  CHAPTER_STATUS_LABEL,
  CHAPTER_ROLE_LABEL,
  HEALTH_BAND_LABEL,
  HEALTH_BAND_COLOR,
  healthBand,
  type ChapterStatus,
} from "@contracts/constants";
import {
  FREQUENCY_LABEL,
  periodLabel,
  type Frequency,
} from "@contracts/cadence";

const ROLE_LABEL: Record<string, string> = {
  zone_director: "Zone Director",
  region_director: "Region Director",
  country_director: "Country Director",
  national_director: "National Director",
};

const CADENCE_STATUS_COLOR: Record<string, "green" | "gold" | "red" | "grey"> =
  {
    kept: "green",
    rescheduled: "gold",
    missed: "red",
    open: "grey",
  };

function roleLabel(role: string) {
  return ROLE_LABEL[role] ?? role.replace(/_/g, " ");
}

function levelLabel(level: string) {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export default function Regional() {
  useDocumentTitle("My Region");
  const [selectedChapterId, setSelectedChapterId] = useState<number | null>(
    null
  );

  const overview = trpc.officer.regionalOverview.useQuery(undefined, {
    retry: false,
  });

  const chapterDetail = trpc.officer.chapterDetail.useQuery(
    { chapterId: selectedChapterId! },
    { retry: false, enabled: selectedChapterId !== null }
  );

  const isForbidden = overview.error?.data?.code === "FORBIDDEN";
  const selectedChapter = overview.data?.chapters.find(
    c => c.id === selectedChapterId
  );

  const detail = chapterDetail.data;

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal" notif>
      <PageHead
        eyebrow="Regional"
        title="My Region"
        sub="Overview of the chapters, members and operating rhythm in your zone."
      />

      {overview.isLoading && <Spinner />}

      {!overview.isLoading && overview.error && !isForbidden && (
        <LoadError
          what="regional overview"
          onRetry={() => overview.refetch()}
        />
      )}

      {isForbidden && (
        <div className="eh-card">
          <Empty
            big="You don't hold a regional director role."
            p="This page is for zone, region and country directors. If you think you should have access, reach out to the Circle team."
          />
        </div>
      )}

      {overview.data && (
        <>
          <div className="eh-mb">
            <Pill color="gold">
              {roleLabel(overview.data.scope.role)} ·{" "}
              {levelLabel(overview.data.scope.level)}
            </Pill>
          </div>

          <div className="eh-grid g3 eh-mb">
            <div className="eh-card eh-stat">
              <div className="k">Chapters</div>
              <div className="v eh-num">{overview.data.chapterCount}</div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">Total Members</div>
              <div className="v eh-num">{overview.data.memberCount}</div>
            </div>
            <div className="eh-card eh-stat">
              <div className="k">At-Risk Members</div>
              <div className="v eh-num" style={{ color: "var(--eh-red)" }}>
                {overview.data.atRiskCount}
              </div>
            </div>
          </div>

          <div className="eh-card">
            <h3 style={{ margin: 0 }}>Chapters</h3>
            {overview.data.chapters.length === 0 ? (
              <Empty
                big="No chapters found."
                p="There are no chapters under your regional scope yet."
              />
            ) : (
              <table className="eh-table stack eh-mt">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>City</th>
                    <th>Members</th>
                    <th>At-Risk</th>
                    <th>Health</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.chapters.map(ch => (
                    <tr
                      key={ch.id}
                      className="click"
                      onClick={() => setSelectedChapterId(ch.id)}
                    >
                      <td data-label="Name">
                        <strong>{ch.name}</strong>
                        <div className="eh-sm eh-muted">
                          {CHAPTER_STATUS_LABEL[ch.status as ChapterStatus] ??
                            ch.status}
                        </div>
                      </td>
                      <td data-label="City">{ch.city ?? "—"}</td>
                      <td data-label="Members">{ch.members}</td>
                      <td data-label="At-Risk">
                        {ch.atRisk > 0 ? (
                          <span style={{ color: "var(--eh-red)" }}>
                            {ch.atRisk}
                          </span>
                        ) : (
                          0
                        )}
                      </td>
                      <td data-label="Health">
                        {ch.health !== null ? (
                          <span className="eh-row" style={{ gap: ".5rem" }}>
                            <span className="eh-num">{ch.health}</span>
                            <Pill
                              color={HEALTH_BAND_COLOR[healthBand(ch.health)]}
                            >
                              {HEALTH_BAND_LABEL[healthBand(ch.health)]}
                            </Pill>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {selectedChapterId !== null && (
        <Modal
          title={selectedChapter?.name ?? "Chapter detail"}
          onClose={() => setSelectedChapterId(null)}
          wide
        >
          {chapterDetail.isLoading ? (
            <Spinner />
          ) : chapterDetail.error || !detail ? (
            <LoadError
              what="chapter details"
              onRetry={() => chapterDetail.refetch()}
            />
          ) : (
            <>
              <div className="eh-grid g2 eh-mb" style={{ alignItems: "start" }}>
                <div>
                  <div className="eh-sm eh-muted">Location</div>
                  <div>
                    {[
                      detail.chapter.city,
                      detail.chapter.zone,
                      detail.chapter.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="eh-sm eh-muted">Health</div>
                  <div className="eh-row" style={{ gap: ".5rem" }}>
                    {detail.health ? (
                      <>
                        <span className="eh-num" style={{ fontSize: "1.3rem" }}>
                          {detail.health.total}
                        </span>
                        <Pill
                          color={
                            HEALTH_BAND_COLOR[healthBand(detail.health.total)]
                          }
                        >
                          {HEALTH_BAND_LABEL[healthBand(detail.health.total)]}
                        </Pill>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Board
              </h3>
              {detail.board.length === 0 ? (
                <p className="eh-sm eh-muted">No active board roles.</p>
              ) : (
                <div className="eh-list" style={{ marginBottom: "1.2rem" }}>
                  {detail.board.map(b => (
                    <div className="row" key={b.id}>
                      <div>
                        <div className="t">{b.memberName}</div>
                        <div className="d">
                          {CHAPTER_ROLE_LABEL[b.role] ?? b.title ?? b.role}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Roster · {detail.roster.length} member
                {detail.roster.length === 1 ? "" : "s"}
              </h3>
              {detail.roster.length === 0 ? (
                <p className="eh-sm eh-muted">No members in this chapter.</p>
              ) : (
                <div className="eh-list" style={{ marginBottom: "1.2rem" }}>
                  {detail.roster.map(m => (
                    <div className="row" key={m.id}>
                      <div>
                        <div className="t">{m.name}</div>
                        <div className="d">{m.status.replace(/_/g, " ")}</div>
                      </div>
                      <Pill
                        color={
                          m.lifecycleState === "at_risk"
                            ? "red"
                            : m.lifecycleState === "active"
                              ? "green"
                              : "grey"
                        }
                      >
                        {m.lifecycleState.replace(/_/g, " ")}
                      </Pill>
                    </div>
                  ))}
                </div>
              )}

              <h3 className="eh-h2" style={{ margin: "1.2rem 0 .6rem" }}>
                Operating rhythm
                {detail.cadence && detail.cadence.adherence !== undefined && (
                  <span
                    className="eh-sm eh-muted"
                    style={{ marginLeft: ".6rem" }}
                  >
                    {detail.cadence.adherence}% kept
                  </span>
                )}
              </h3>
              {(detail.cadence?.cadences ?? []).length === 0 ? (
                <p className="eh-sm eh-muted">No cadences set up yet.</p>
              ) : (
                <div className="eh-list">
                  {detail.cadence!.cadences.map(c => (
                    <div
                      className="row"
                      key={c.id}
                      style={{ alignItems: "flex-start" }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="t">{c.title}</div>
                        <div className="d">
                          {FREQUENCY_LABEL[c.frequency as Frequency]} · {c.kept}{" "}
                          kept
                          {c.missed ? `, ${c.missed} missed` : ""}
                        </div>
                        <div style={{ marginTop: ".35rem", maxWidth: 220 }}>
                          <Bar pct={c.adherence} />
                        </div>
                      </div>
                      <Pill
                        color={CADENCE_STATUS_COLOR[c.currentStatus] ?? "grey"}
                      >
                        {c.currentStatus === "open"
                          ? `due ${periodLabel(c.frequency as Frequency)}`
                          : c.currentStatus}
                      </Pill>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </EhShell>
  );
}
