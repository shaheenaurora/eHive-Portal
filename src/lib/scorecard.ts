/* Turns a stored clarity-scorecard lead payload into a readable report — the
   same bands + routing the public scorecard shows the visitor, so admins see
   exactly what the prospect saw, plus which product they were pointed to. */

export type DomainScore = { key: string; raw: number; pct: number };

const BANDS = [
  { min: 82, name: "Well built", copy: "A genuinely well-run business — fundamentals in place and documented. The job is to protect what works and keep the discipline while scaling." },
  { min: 64, name: "Solid, with specific gaps", copy: "Sound foundations, but one or two areas lag the rest — the quiet ceiling on growth. Worth fixing deliberately." },
  { min: 45, name: "Working hard against friction", copy: "A real business, but too much depends on the founder holding it together. The pattern is common and fixable — usually structural, not effort." },
  { min: 0, name: "Foundations need attention", copy: "Several core areas are unclear or undocumented. Most founders reach this point before anyone helps them build the structure underneath." },
];

const ROUTES: Record<string, { product: string; why: string }> = {
  "Strategy": { product: "Clarity Sprint", why: "Weakest area is direction itself — get clear on the one thing this business should be best at before building anything else." },
  "Business Model": { product: "Strategy Sprint", why: "The model underneath the business scored lowest — re-engineer how it makes money into a documented 90-day plan." },
  "Revenue Engine": { product: "Strategy Sprint", why: "Revenue predictability is weakest, which usually traces back to the model and the plan." },
  "Marketing": { product: "Brand 3D", why: "Marketing scored lowest — rarely an advertising problem, usually positioning. Fix the engine so demand compounds." },
  "Operations": { product: "OpsBlueprint", why: "Operations is weakest — engineer the operating system so the same fires stop repeating." },
  "People & Culture": { product: "OpsBlueprint", why: "Ownership and decision-making scored lowest — put named owners, roles and decision rights in place." },
  "Systems": { product: "OpsBlueprint", why: "Systems and data scored lowest — map what's actually needed before spending on software." },
  "Finance": { product: "GapNavigator", why: "Financial visibility is weakest and often masks issues elsewhere — score the whole business on evidence first." },
};

export type ScorecardReport = {
  total: number;
  band: { name: string; copy: string };
  domains: DomainScore[];
  strongest: DomainScore[];
  weakest: DomainScore[];
  recommendation: { product: string; why: string };
};

/** Build the report from the numbers the scorecard posted. Returns null if the
 *  payload isn't a scorecard submission. */
export function buildScorecardReport(payload: Record<string, unknown>): ScorecardReport | null {
  const total = typeof payload.total === "number" ? payload.total : null;
  const domains = Array.isArray(payload.domains) ? (payload.domains as DomainScore[]) : null;
  if (total === null || !domains || !domains.length) return null;

  const band = BANDS.find((b) => total >= b.min) ?? BANDS[BANDS.length - 1];
  const min = Math.min(...domains.map((d) => d.raw));
  const max = Math.max(...domains.map((d) => d.raw));
  const weakest = domains.filter((d) => d.raw === min);
  const strongest = domains.filter((d) => d.raw === max);
  const spread = max - min;

  // Mirror the scorecard's routing: uniformly-low or many-tied → full diagnostic.
  let recommendation: { product: string; why: string };
  if (total < 45 && spread <= 3) {
    recommendation = { product: "GapNavigator", why: "Scores are low across the board rather than in one place — a full diagnostic ranks the 3–7 moves that actually matter." };
  } else if (weakest.length >= 3) {
    recommendation = { product: "GapNavigator", why: "Several areas tie at the bottom — the real bottleneck isn't obvious from a short questionnaire; a diagnostic goes deeper." };
  } else {
    recommendation = ROUTES[weakest[0].key] ?? { product: "GapNavigator", why: "A full diagnostic will rank what to fix first." };
  }

  return { total, band, domains, strongest, weakest, recommendation };
}
