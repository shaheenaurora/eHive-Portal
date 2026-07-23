import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, Field, Pill, toast } from "@/components/eh";
import { TIERS, TIER_LABEL, TIER_PRICE } from "@contracts/constants";

const STAGES = ["Idea", "Pre-seed", "Seed", "Series A", "Series B+", "Established business", "Family business"];
const REVENUES = ["Pre-revenue", "< $10k MRR", "$10k–$50k MRR", "$50k–$200k MRR", "$200k+ MRR", "$2M+ annual"];

export default function Apply() {
  const navigate = useNavigate();
  const me = trpc.circle.me.useQuery(undefined, { retry: false });
  const apply = trpc.circle.submitApplication.useMutation({
    onSuccess: () => {
      toast("Application received — the screening begins.");
      navigate("/portal/status");
    },
    onError: (e) => toast(e.message),
  });

  const [tier, setTier] = useState<string>("ascent");

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    apply.mutate({
      name: String(f.get("name") ?? ""),
      company: String(f.get("company") ?? "") || undefined,
      stage: String(f.get("stage") ?? "") || undefined,
      revenue: String(f.get("revenue") ?? "") || undefined,
      why: String(f.get("why") ?? "") || undefined,
      tierRequested: tier as never,
    });
  }

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">Membership application</div>
          <h1 className="eh-h1">Join eHive Circle</h1>
          <p className="eh-sub">
            Applications are screened by the Circle team: a short review, then a conversation.
            We reply within five working days.
          </p>
        </div>
      </div>

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <form className="eh-card" style={{ gridColumn: "span 2" }} onSubmit={onSubmit}>
          <h3>Your application</h3>
          <Field label="Full name">
            <input className="eh-input" name="name" required minLength={2}
                   defaultValue={me.data?.user.name ?? ""} placeholder="Your name" />
          </Field>
          <div className="eh-grid g2">
            <Field label="Company">
              <input className="eh-input" name="company" placeholder="Company or project" />
            </Field>
            <Field label="Stage">
              <select className="eh-select" name="stage" defaultValue="">
                <option value="">Select stage…</option>
                {STAGES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Revenue band">
            <select className="eh-select" name="revenue" defaultValue="">
              <option value="">Select band…</option>
              {REVENUES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Why eHive Circle? (a few honest sentences beat a polished paragraph)">
            <textarea className="eh-textarea" name="why" maxLength={2000}
                      placeholder="What you're building, where you're stuck, and what you'd bring to the room." />
          </Field>
          <button className="eh-btn gold" type="submit" disabled={apply.isPending}>
            {apply.isPending ? "Submitting…" : "Submit application →"}
          </button>
        </form>

        <div className="eh-card">
          <h3>Pick your tier</h3>
          <div className="eh-list">
            {TIERS.map((t) => (
              <label key={t} className="row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
                <input type="radio" name="tier" checked={tier === t} onChange={() => setTier(t)}
                       style={{ marginTop: ".35rem", accentColor: "#b8862e" }} />
                <div style={{ flex: 1 }}>
                  <div className="eh-between">
                    <span className="t">{TIER_LABEL[t]}</span>
                    <span className="eh-muted eh-sm eh-num">{TIER_PRICE[t]}</span>
                  </div>
                  <div className="d">
                    {t === "horizon" && "Early founders. Community events, the library and one pod."}
                    {t === "ascent" && "Growing teams. Pods, Circle Dinners, the full library."}
                    {t === "vanguard" && "Scaling operators. Masterminds, retreats, the FRP."}
                    {t === "zenith" && "Invitation-only. Council seats and first call on everything."}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {tier === "zenith" && (
            <div className="eh-locked eh-mt">
              <Pill>Invitation-only</Pill>
              <span className="eh-sm">Zenith applications need two member sponsors. Apply anyway — the council reviews every request.</span>
            </div>
          )}
        </div>
      </div>
    </EhShell>
  );
}
