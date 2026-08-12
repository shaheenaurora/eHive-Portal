/* Minimal in-process fixed-window rate limiter. No external store — sufficient
   for a single-instance deployment. For multi-instance deployments (Railway
   with more than one replica, Fly, Kubernetes), back this with Redis or another
   shared store so per-IP/account limits cannot be bypassed by hitting a
   different instance. Guards credential-stuffing / brute-force on auth endpoints. */

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

/** Returns true if the action is allowed, false if the caller is over the limit.
 *  `key` scopes the window (e.g. `login:<ip>` or `login:<email>`). */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now > b.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/** Clear a key's window (e.g. after a successful login). */
export function rateLimitReset(key: string): void {
  store.delete(key);
}

// Opportunistic cleanup so the map can't grow unbounded.
setInterval(
  () => {
    const now = Date.now();
    for (const [k, b] of store) if (now > b.resetAt) store.delete(k);
  },
  10 * 60 * 1000
).unref?.();
