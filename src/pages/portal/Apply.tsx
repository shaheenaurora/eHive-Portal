import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { EhShell, MEMBER_NAV, Field, Pill, toast } from "@/components/eh";
import {
  TIERS,
  TIER_LABEL,
  TIER_PRICE,
  SELF_SERVE_TIERS,
} from "@contracts/constants";

const STAGES = [
  "Idea",
  "Pre-seed",
  "Seed",
  "Series A",
  "Series B+",
  "Established business",
  "Family business",
];
const REVENUES = [
  "Pre-revenue",
  "< $10k MRR",
  "$10k–$50k MRR",
  "$50k–$200k MRR",
  "$200k+ MRR",
  "$2M+ annual",
];

export default function Apply() {
  const navigate = useNavigate();
  const me = trpc.circle.me.useQuery(undefined, { retry: false });
  const apply = trpc.circle.submitApplication.useMutation({
    onSuccess: () => {
      toast("Application received — the screening begins.");
      navigate("/portal/status");
    },
    onError: e => toast(e.message),
  });

  const pay = trpc.circle.paymentsEnabled.useQuery(undefined, { retry: false });
  const checkout = trpc.circle.startCheckout.useMutation({
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: e => toast(e.message),
  });

  const gate = trpc.circle.membershipGateMode.useQuery(undefined, {
    retry: false,
  });

  const [tier, setTier] = useState<string>("ascent");
  const [consent, setConsent] = useState(false);
  const [muslimIdentity, setMuslimIdentity] = useState(false);
  const [valuesAligned, setValuesAligned] = useState(false);
  const [affirmationNote, setAffirmationNote] = useState("");
  const wantsProof = tier === "vanguard" || tier === "zenith";
  const canPayNow =
    !!pay.data?.enabled &&
    (SELF_SERVE_TIERS as readonly string[]).includes(tier) &&
    !me.data?.member;

  const gateMode = gate.data?.mode ?? "open";
  const gateRequired = gateMode !== "open";

  function onPayNow() {
    if (!consent) {
      toast("Please tick the consent box first.");
      return;
    }
    checkout.mutate({ tier: tier as never });
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    apply.mutate({
      name: String(f.get("name") ?? ""),
      company: String(f.get("company") ?? "") || undefined,
      stage: String(f.get("stage") ?? "") || undefined,
      revenue: String(f.get("revenue") ?? "") || undefined,
      why: String(f.get("why") ?? "") || undefined,
      proofPoint: String(f.get("proofPoint") ?? "") || undefined,
      tierRequested: tier as never,
      consent,
      muslimIdentity,
      valuesAligned,
      affirmationNote: affirmationNote || undefined,
    });
  }

  return (
    <EhShell groups={MEMBER_NAV} brandSub="Member Portal">
      <div className="eh-page-head">
        <div>
          <div className="eh-eyebrow">Membership application</div>
          <h1 className="eh-h1">Join eHive Circle</h1>
          <p className="eh-sub">
            Applications are screened by the Circle team: a short review, then a
            conversation. We reply within five working days.
          </p>
        </div>
      </div>

      <div className="eh-grid g3" style={{ alignItems: "start" }}>
        <form className="eh-card eh-span2" onSubmit={onSubmit}>
          <h3>Your application</h3>
          <Field label="Full name">
            <input
              className="eh-input"
              name="name"
              required
              minLength={2}
              defaultValue={me.data?.user.name ?? ""}
              placeholder="Your name"
            />
          </Field>
          <div className="eh-grid g2">
            <Field label="Company">
              <input
                className="eh-input"
                name="company"
                placeholder="Company or project"
              />
            </Field>
            <Field label="Stage">
              <select className="eh-select" name="stage" defaultValue="">
                <option value="">Select stage…</option>
                {STAGES.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Revenue band">
            <select className="eh-select" name="revenue" defaultValue="">
              <option value="">Select band…</option>
              {REVENUES.map(r => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Why eHive Circle? (a few honest sentences beat a polished paragraph)">
            <textarea
              className="eh-textarea"
              name="why"
              maxLength={2000}
              placeholder="What you're building, where you're stuck, and what you'd bring to the room."
            />
          </Field>
          {wantsProof && (
            <Field
              label={
                tier === "vanguard"
                  ? "Vanguard proof point — revenue, funding or scale evidence"
                  : "Proof point — revenue, funding or scale evidence"
              }
            >
              <textarea
                className="eh-textarea"
                name="proofPoint"
                maxLength={4000}
                required
                placeholder="e.g. $1.2M ARR, 40 staff, Series A closed 2025 — links welcome."
              />
            </Field>
          )}
          <label
            className="row eh-sm"
            style={{
              cursor: "pointer",
              alignItems: "flex-start",
              margin: ".25rem 0 1rem",
            }}
          >
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              style={{ marginTop: ".2rem", accentColor: "#b8862e" }}
            />
            <span className="eh-muted">
              I consent to eHive collecting and processing my application data
              under the UAE Personal Data Protection Law (PDPL). I can request
              export or deletion of my data at any time from the portal.
            </span>
          </label>

          {gate.isLoading && (
            <p className="eh-muted eh-sm">Loading membership settings…</p>
          )}
          {gateRequired && !gate.isLoading && (
            <div
              style={{
                border: "1px solid var(--eh-gold, #b8862e)",
                borderRadius: 8,
                padding: ".75rem 1rem",
                marginBottom: "1rem",
                background: "rgba(184,134,46,0.08)",
              }}
            >
              {gateMode === "muslim_only" && (
                <label
                  className="row eh-sm"
                  style={{ cursor: "pointer", alignItems: "flex-start" }}
                >
                  <input
                    type="checkbox"
                    checked={muslimIdentity}
                    onChange={e => setMuslimIdentity(e.target.checked)}
                    style={{ marginTop: ".2rem", accentColor: "#b8862e" }}
                    required
                  />
                  <span>
                    I identify as a Muslim entrepreneur and wish to join a
                    community founded on Islamic principles of integrity,
                    generosity and accountability.
                  </span>
                </label>
              )}
              {gateMode === "values_gated" && (
                <>
                  <label
                    className="row eh-sm"
                    style={{ cursor: "pointer", alignItems: "flex-start" }}
                  >
                    <input
                      type="checkbox"
                      checked={valuesAligned}
                      onChange={e => setValuesAligned(e.target.checked)}
                      style={{ marginTop: ".2rem", accentColor: "#b8862e" }}
                      required
                    />
                    <span>
                      I affirm that I share and will uphold eHive&apos;s Code of
                      Integrity, Generosity and Accountability in my dealings
                      with the community.
                    </span>
                  </label>
                  <Field label="Optional: tell us how you live these values">
                    <textarea
                      className="eh-textarea"
                      maxLength={500}
                      value={affirmationNote}
                      onChange={e => setAffirmationNote(e.target.value)}
                      placeholder="A sentence or two is enough."
                      style={{ minHeight: 70, marginTop: ".5rem" }}
                    />
                  </Field>
                </>
              )}
            </div>
          )}

          <button
            className="eh-btn gold"
            type="submit"
            disabled={
              apply.isPending ||
              !consent ||
              gate.isLoading ||
              (gateMode === "muslim_only" && !muslimIdentity) ||
              (gateMode === "values_gated" && !valuesAligned)
            }
          >
            {apply.isPending ? "Submitting…" : "Submit application →"}
          </button>
        </form>

        <div className="eh-card">
          <h3>Pick the tier you're applying for</h3>
          <p
            className="eh-muted eh-sm"
            style={{ marginTop: "-.35rem", marginBottom: ".75rem" }}
          >
            You're not on any tier yet — this is the tier you'd like to be
            considered for. Membership begins only after the Circle team
            approves your application (or you join &amp; pay).
          </p>
          <div className="eh-list">
            {TIERS.map(t => (
              <label
                key={t}
                className="row"
                style={{ cursor: "pointer", alignItems: "flex-start" }}
              >
                <input
                  type="radio"
                  name="tier"
                  checked={tier === t}
                  onChange={() => setTier(t)}
                  style={{ marginTop: ".35rem", accentColor: "#b8862e" }}
                />
                <div style={{ flex: 1 }}>
                  <div className="eh-between">
                    <span className="t">
                      {TIER_LABEL[t]}
                      {t === "ascent" && (
                        <span style={{ marginLeft: ".4rem" }}>
                          <Pill>Recommended</Pill>
                        </span>
                      )}
                    </span>
                    <span className="eh-muted eh-sm eh-num">
                      {TIER_PRICE[t]}
                    </span>
                  </div>
                  <div className="d">
                    {t === "horizon" &&
                      "Early founders. Community events, the library and one pod."}
                    {t === "ascent" &&
                      "Growing teams. Pods, Circle Dinners, the full library."}
                    {t === "vanguard" &&
                      "Scaling operators. Masterminds, retreats, the FRP."}
                    {t === "zenith" &&
                      "Invitation-only. Council seats and first call on everything."}
                  </div>
                </div>
              </label>
            ))}
          </div>
          {tier === "zenith" && (
            <div className="eh-locked eh-mt">
              <Pill>Invitation-only</Pill>
              <span className="eh-sm">
                Zenith applications need two member sponsors. Apply anyway — the
                council reviews every request.
              </span>
            </div>
          )}
          {canPayNow && (
            <div
              className="eh-mt"
              style={{
                borderTop: "1px solid var(--eh-border, #2a2a2a)",
                paddingTop: "1rem",
              }}
            >
              <div className="eh-between" style={{ marginBottom: ".5rem" }}>
                <span className="t">Join instantly</span>
                <span className="eh-muted eh-sm eh-num">
                  {TIER_PRICE[tier as never]}
                </span>
              </div>
              <p className="eh-muted eh-sm" style={{ marginBottom: ".75rem" }}>
                Skip the queue — pay online now and your{" "}
                {TIER_LABEL[tier as never]} membership activates the moment
                payment clears. Secure checkout, cancel anytime.
              </p>
              <button
                className="eh-btn gold"
                type="button"
                style={{ width: "100%" }}
                disabled={checkout.isPending || !consent}
                onClick={onPayNow}
              >
                {checkout.isPending
                  ? "Redirecting…"
                  : `Join & pay — ${TIER_PRICE[tier as never]}`}
              </button>
              {!consent && (
                <div className="eh-muted eh-sm eh-mt">
                  Tick the consent box in the form to continue.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </EhShell>
  );
}
