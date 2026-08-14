/**
 * Anti-gaming detection primitives (Awards spec Part 8). Pure, deterministic
 * heuristics that the integrity scan runs over a cycle's data to surface gaming
 * concerns before a winner is conferred. Kept side-effect-free so the maths is
 * unit-testable without a database.
 */

/** A vote reduced to what the velocity check needs. */
export type VoteTime = { nominationId: number; atMs: number };

export type VelocityHit = {
  nominationId: number;
  burst: number; // max votes for this nominee inside any window
  windowMs: number;
};

/**
 * Vote-brigading detection. For each nominee, find the largest number of votes
 * that land inside any sliding `windowMs`; flag nominees whose peak burst is at
 * or above `burstThreshold`. A genuine peer vote trickles in; a brigade arrives
 * in a clump, which is exactly what this catches.
 */
export function detectVoteVelocity(
  votes: VoteTime[],
  opts: { windowMs: number; burstThreshold: number }
): VelocityHit[] {
  const byNom = new Map<number, number[]>();
  for (const v of votes) {
    const list = byNom.get(v.nominationId) ?? [];
    list.push(v.atMs);
    byNom.set(v.nominationId, list);
  }
  const hits: VelocityHit[] = [];
  for (const [nominationId, times] of byNom) {
    times.sort((a, b) => a - b);
    // Two-pointer max count within any window of length windowMs.
    let start = 0;
    let best = 0;
    for (let end = 0; end < times.length; end++) {
      while (times[end] - times[start] > opts.windowMs) start++;
      best = Math.max(best, end - start + 1);
    }
    if (best >= opts.burstThreshold)
      hits.push({ nominationId, burst: best, windowMs: opts.windowMs });
  }
  return hits.sort((a, b) => b.burst - a.burst);
}

/** Default vote-velocity thresholds: 5+ votes for one nominee within 2 minutes
 *  reads as a coordinated burst rather than organic peer support. */
export const VOTE_VELOCITY_WINDOW_MS = 2 * 60 * 1000;
export const VOTE_VELOCITY_BURST = 5;

/** Mutual-crediting (collusion) threshold: this many reciprocal confirmed
 *  1-2-1s between a nominee and their nominator reads as farming rather than
 *  genuine give-first activity. */
export const RECIPROCITY_THRESHOLD = 6;

/** Whether a nominee↔nominator mutual-crediting count is suspicious. */
export function isReciprocitySuspicious(
  mutualCount: number,
  threshold: number = RECIPROCITY_THRESHOLD
): boolean {
  return mutualCount >= threshold;
}
