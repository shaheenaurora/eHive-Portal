import { getDb } from "../queries/connection";

let requestCount = 0;
let errorCount = 0;

export function incrementRequests(): void {
  requestCount++;
}

export function incrementErrors(): void {
  errorCount++;
}

/** Render a minimal Prometheus-compatible metrics page. Avoids adding a heavy
 *  client library; covers the basics: process, http counters, db health. */
export async function renderMetrics(): Promise<string> {
  const mem = process.memoryUsage();
  let dbHealthy = false;
  try {
    await getDb().execute("select 1");
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }

  const lines = [
    "# HELP process_uptime_seconds Node process uptime",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime().toFixed(2)}`,
    "",
    "# HELP process_memory_usage_bytes Memory usage by category",
    "# TYPE process_memory_usage_bytes gauge",
    `process_memory_usage_bytes{category="rss"} ${mem.rss}`,
    `process_memory_usage_bytes{category="heapTotal"} ${mem.heapTotal}`,
    `process_memory_usage_bytes{category="heapUsed"} ${mem.heapUsed}`,
    `process_memory_usage_bytes{category="external"} ${mem.external ?? 0}`,
    "",
    "# HELP http_requests_total Total HTTP requests served by this process",
    "# TYPE http_requests_total counter",
    `http_requests_total ${requestCount}`,
    "",
    "# HELP http_errors_total Total HTTP 5xx responses served by this process",
    "# TYPE http_errors_total counter",
    `http_errors_total ${errorCount}`,
    "",
    "# HELP db_up Whether the database is reachable",
    "# TYPE db_up gauge",
    `db_up ${dbHealthy ? 1 : 0}`,
  ];
  return lines.join("\n") + "\n";
}
