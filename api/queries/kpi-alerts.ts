import { and, desc, eq, inArray, or } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";
import { networkKpis } from "./reports";
import { mailEnabled, sendMail } from "../lib/mailer";

type Actor = { id: number; email: string };

/** Full/owner admins — the owners of the network-level KPIs. */
async function fullAdminEmails(): Promise<string[]> {
  const rows = await getDb()
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.role, "admin"), or(eq(schema.users.adminScopes, ""), eq(schema.users.adminScopes, "*"))));
  return rows.map((r) => r.email).filter(Boolean);
}

/** Evaluate the network KPIs against their bars: open a (deduped) alert for each
 *  that has gone red, auto-resolve any that have recovered, and email the owners
 *  about newly-opened breaches. Run from the daily pass. */
export async function evaluateKpiAlerts(): Promise<{ opened: number; resolved: number }> {
  const db = getDb();
  const { kpis } = await networkKpis();

  const open = await db.select().from(schema.kpiAlerts)
    .where(and(eq(schema.kpiAlerts.scope, "network"), inArray(schema.kpiAlerts.status, ["open", "acknowledged"])));
  const openByMetric = new Map(open.map((a) => [a.metric, a]));

  const newLines: string[] = [];
  let resolved = 0;
  for (const k of kpis) {
    if (k.status === "red") {
      if (!openByMetric.has(k.key)) {
        const message = `${k.label} is ${k.display} (target ${k.target}).`;
        await db.insert(schema.kpiAlerts).values({ scope: "network", metric: k.key, severity: "red", message, status: "open" });
        newLines.push(message);
      }
    } else {
      const a = openByMetric.get(k.key);
      if (a) { await db.update(schema.kpiAlerts).set({ status: "resolved", resolvedAt: new Date() }).where(eq(schema.kpiAlerts.id, a.id)); resolved++; }
    }
  }

  if (newLines.length && mailEnabled()) {
    const to = await fullAdminEmails();
    if (to.length) {
      const html = `<p>The following eHive Circle KPIs have crossed their threshold and need attention:</p><ul>${newLines.map((l) => `<li>${l}</li>`).join("")}</ul><p>Open Reports &amp; KPIs in the admin portal to review.</p>`;
      await Promise.all(to.map((addr) => sendMail({ to: addr, subject: `eHive KPI alert — ${newLines.length} metric${newLines.length === 1 ? "" : "s"} below bar`, html }).catch(() => false)));
    }
  }
  return { opened: newLines.length, resolved };
}

/** Open + acknowledged (unresolved) alerts for the cockpit banners. */
export async function listKpiAlerts() {
  return getDb().select().from(schema.kpiAlerts)
    .where(inArray(schema.kpiAlerts.status, ["open", "acknowledged"]))
    .orderBy(desc(schema.kpiAlerts.createdAt)).limit(50);
}

/** Acknowledge an alert (it stays visible but marked seen until it resolves). */
export async function acknowledgeKpiAlert(actor: Actor, id: number): Promise<{ ok: true }> {
  await getDb().update(schema.kpiAlerts)
    .set({ status: "acknowledged", acknowledgedByEmail: actor.email, acknowledgedAt: new Date() })
    .where(and(eq(schema.kpiAlerts.id, id), eq(schema.kpiAlerts.status, "open")));
  return { ok: true };
}
