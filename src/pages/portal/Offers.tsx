import { trpc } from "@/providers/trpc";
import {
  EhShell,
  MEMBER_NAV,
  PageHead,
  Pill,
  Empty,
  TierPill,
  Spinner,
  LoadError,
} from "@/components/eh";

export default function Offers() {
  const q = trpc.circle.offers.useQuery(undefined, { retry: false });
  const setup = (q.data ?? []).filter(o => o.vertical === "setup");
  const consulting = (q.data ?? []).filter(o => o.vertical === "consulting");

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <PageHead
        eyebrow="Member offers"
        title="Your tier, working for you"
        sub="Member rates and priority access across eHive's two practices — business setup and consulting."
      />

      {q.isLoading && <Spinner />}
      {q.isError && (
        <LoadError what="member offers" onRetry={() => q.refetch()} />
      )}
      {q.data && q.data.length === 0 && (
        <div className="eh-card">
          <Empty
            big="No offers at your tier yet."
            p="New member offers publish with each quarter's programme."
          />
        </div>
      )}

      {[
        ["Business Setup", setup],
        ["Consulting", consulting],
      ].map(
        ([label, list]) =>
          (list as typeof setup).length > 0 && (
            <div key={label as string} className="eh-mb">
              <div className="eh-eyebrow" style={{ marginBottom: ".7rem" }}>
                {label as string}
              </div>
              <div className="eh-grid g3">
                {(list as typeof setup).map(o => (
                  <div
                    className="eh-card"
                    key={o.id}
                    style={{ display: "flex", flexDirection: "column" }}
                  >
                    <div className="eh-between">
                      <Pill color={o.vertical === "setup" ? "blue" : "purple"}>
                        {o.vertical === "setup" ? "Setup" : "Consulting"}
                      </Pill>
                      <TierPill tier={o.tierGate} />
                    </div>
                    <h3 className="eh-mt">{o.title}</h3>
                    <p className="eh-sm eh-muted" style={{ flex: 1 }}>
                      {o.description}
                    </p>
                    {o.ctaUrl && (
                      <a
                        className="eh-btn gold sm eh-mt"
                        href={o.ctaUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Claim this offer →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
      )}
    </EhShell>
  );
}
