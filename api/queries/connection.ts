import { drizzle } from "drizzle-orm/mysql2";
import { createPool } from "mysql2";
import { env } from "../lib/env";
import * as schema from "@db/schema";

let instance: ReturnType<typeof drizzle<typeof schema>>;

export function getDb() {
  if (!instance) {
    const pool = createPool({
      uri: env.databaseUrl,
      // TLS is only needed for external managed databases. Railway's
      // private-network MySQL doesn't require it, so it's off unless the
      // provider needs it (set DATABASE_SSL=true, e.g. for PlanetScale/RDS).
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { minVersion: "TLSv1.2" }
          : undefined,
      connectionLimit: 20,
      queueLimit: 0,
      waitForConnections: true,
    });
    instance = drizzle(pool, { schema, mode: "default" });
  }
  return instance;
}
