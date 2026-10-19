/* AI narrative layer for the paid assessment reports.

   Prompt builder + Kimi (Moonshot AI) client for POST /api/report/compose.
   Kimi exposes an OpenAI-compatible chat.completions API, so the client below
   is a plain global fetch — no SDK. The composed narrative upgrades the
   template analysis/signals/executive-summary on the client; scores, bars,
   watch-outs and recommendations stay deterministic server/client-side and
   are never touched by the model.

   Failure contract: every failure mode throws AiComposeError with a stable
   `code`. The route maps those codes to 503/502 and the client keeps the
   template narrative on any non-ok response, so a broken/missing AI_API_KEY
   degrades the product silently rather than breaking it. */

import { z } from "zod";
import {
  REPORT_AI_ANSWER_CAP,
  REPORT_AI_CACHE_TTL_MS,
  REPORT_AI_FACTS_CAP,
  REPORT_AI_PRIVATE_KEYS,
  REPORT_AI_TIMEOUT_MS,
} from "@contracts/constants";
import { env } from "./env";

export type AiComposeErrorCode =
  | "ai_disabled"
  | "ai_timeout"
  | "ai_unavailable"
  | "ai_upstream_error"
  | "ai_bad_response";

export class AiComposeError extends Error {
  readonly code: AiComposeErrorCode;
  constructor(code: AiComposeErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AiComposeError";
    this.code = code;
  }
}

/** True when an API key is configured. When false the compose endpoint is a
 *  cheap 503 and the whole layer is inert. */
export function aiEnabled(): boolean {
  return env.aiApiKey.trim().length > 0;
}

/* ------------------------------------------------------------- facts ---- */

export type ComposeDim = { key: string; label: string | null; pct: number };

/** The PII-stripped ground truth embedded in the prompt. Contact fields are
 *  dropped here — only dimension scores plus the founder's own answer text
 *  (which they typed to personalise this report) leaves our servers. */
export type ComposeFacts = {
  tool: string;
  total: number;
  band: string | null;
  dims: ComposeDim[];
  answers: Record<string, string | number>;
};

/** Row shape from api/queries/assessment-reports (loosened for tests). */
export type ComposeReportRow = {
  tool: string;
  total: number;
  band: string | null;
  dims: unknown;
  answers: unknown;
};

const PRIVATE_KEY_SET = new Set<string>(REPORT_AI_PRIVATE_KEYS);

function isPrivateKey(key: string): boolean {
  return key.startsWith("_") || PRIVATE_KEY_SET.has(key.toLowerCase());
}

function cleanAnswerValue(value: unknown): string | number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.length > REPORT_AI_ANSWER_CAP
      ? trimmed.slice(0, REPORT_AI_ANSWER_CAP) + "…"
      : trimmed;
  }
  try {
    return JSON.stringify(value).slice(0, REPORT_AI_ANSWER_CAP);
  } catch {
    return null;
  }
}

/** Extract the prompt facts from a saved report row, stripping contact PII
 *  and bounding the payload (per-answer cap + whole-payload cap — longest
 *  answers are dropped first until the facts fit). */
export function buildComposeFacts(row: ComposeReportRow): ComposeFacts {
  const dims: ComposeDim[] = [];
  if (Array.isArray(row.dims)) {
    for (const item of row.dims) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const d = item as { key?: unknown; label?: unknown; pct?: unknown };
      if (typeof d.key !== "string" || !d.key.trim()) continue;
      const pct =
        typeof d.pct === "number" && Number.isFinite(d.pct) ? d.pct : null;
      if (pct === null) continue;
      dims.push({
        key: d.key.trim().slice(0, 64),
        label:
          typeof d.label === "string" && d.label.trim() ? d.label.trim() : null,
        pct: Math.min(100, Math.max(0, Math.round(pct))),
      });
    }
  }

  const answers: Record<string, string | number> = {};
  if (
    row.answers &&
    typeof row.answers === "object" &&
    !Array.isArray(row.answers)
  ) {
    for (const [key, value] of Object.entries(
      row.answers as Record<string, unknown>
    )) {
      if (isPrivateKey(key)) continue;
      const cleaned = cleanAnswerValue(value);
      if (cleaned !== null) answers[key] = cleaned;
    }
    // Whole-payload cap: drop the longest entries first (rare — a user pasting
    // essays into every box) rather than rejecting the compose outright.
    let serialized = JSON.stringify(answers);
    while (
      serialized.length > REPORT_AI_FACTS_CAP &&
      Object.keys(answers).length > 1
    ) {
      const longest = Object.entries(answers).sort(
        (a, b) => String(b[1]).length - String(a[1]).length
      )[0][0];
      delete answers[longest];
      serialized = JSON.stringify(answers);
    }
  }

  return {
    tool: row.tool,
    total: Math.min(100, Math.max(0, Math.round(row.total))),
    band:
      typeof row.band === "string" && row.band.trim() ? row.band.trim() : null,
    dims,
    answers,
  };
}

/* ------------------------------------------------------------- prompt --- */

const SYSTEM_PROMPT =
  "You are a senior strategy consultant writing the analysis layer of a " +
  "paid-grade business assessment report. The client is a founder-led " +
  "business in the Gulf market (UAE / GCC). You write in confident, plain, " +
  "consultative English — the register of a partner briefing a client, not " +
  "a chatbot.";

const OUTPUT_SHAPE = `{
  "executiveSummary": string,   // 2-4 sentences, the report opener
  "dimensions": { "<dim key>": { "analysis": string, "signals": string } },
  "crossInsights": string[],    // 2-4 patterns that span multiple dimensions
  "priorities": string          // 2-4 sentences: where to focus first
}`;

/** Build the two prompt messages. The deterministic scores are presented as
 *  ground truth the model must not contradict. */
export function buildComposePrompt(facts: ComposeFacts): {
  system: string;
  user: string;
} {
  const lines: string[] = [];
  lines.push(`Assessment tool: ${facts.tool}`);
  lines.push(
    `Overall score: ${facts.total}/100` +
      (facts.band ? ` — band "${facts.band}"` : "")
  );
  lines.push("");
  lines.push("Dimension scores (GROUND TRUTH — never contradict these):");
  for (const d of facts.dims) {
    lines.push(`- ${d.key}${d.label ? ` (${d.label})` : ""}: ${d.pct}/100`);
  }
  lines.push("");
  lines.push(
    "Per-question answers (contact fields removed; keys are question ids; " +
      "free-text entries are the founder's own words and carry the most weight):"
  );
  lines.push(JSON.stringify(facts.answers, null, 2));
  lines.push("");
  lines.push(`Write the report narrative as ONE JSON object with exactly this shape:
${OUTPUT_SHAPE}
Rules:
- Ground every claim in the scores and answers above. Never invent numbers and never contradict a dimension score.
- Exactly one "dimensions" entry per provided dimension key, keyed by the same key.
- 2-4 sentences per section. Confident and specific; no fluff, no marketing clichés.
- Plain text inside strings only: no markdown, no bullet characters, no line breaks, no code fences.
- Output the JSON object alone — nothing before or after it.`);
  return { system: SYSTEM_PROMPT, user: lines.join("\n") };
}

/* ---------------------------------------------------------- validation -- */

export const aiNarrativeSchema = z.object({
  executiveSummary: z.string().min(1).max(3000),
  dimensions: z.record(
    z.string(),
    z.object({
      analysis: z.string().min(1).max(3000),
      signals: z.string().min(1).max(3000),
    })
  ),
  crossInsights: z.array(z.string().min(1).max(1200)).min(2).max(4),
  priorities: z.string().min(1).max(3000),
});

export type AiNarrative = z.infer<typeof aiNarrativeSchema>;

/** Parse + validate a model response. Returns null on malformed JSON, schema
 *  violations, or a dimensions map that matches none of the report's real
 *  dimension keys (mismatched output). Unknown extra dim keys are dropped. */
export function parseAiNarrative(
  raw: string,
  validDimKeys?: string[]
): AiNarrative | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = aiNarrativeSchema.safeParse(parsed);
  if (!result.success) return null;
  const narrative = result.data;
  if (validDimKeys) {
    const known = new Set(validDimKeys);
    const dims = Object.fromEntries(
      Object.entries(narrative.dimensions).filter(([key]) => known.has(key))
    );
    if (Object.keys(dims).length === 0) return null;
    narrative.dimensions = dims;
  }
  return narrative;
}

/* -------------------------------------------------------------- client -- */

type KimiChatResponse = {
  choices?: { message?: { content?: unknown } }[];
};

async function postChatCompletion(
  system: string,
  user: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPORT_AI_TIMEOUT_MS);
  try {
    return await fetch(`${env.aiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.aiApiKey}`,
      },
      body: JSON.stringify({
        model: env.aiModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.4,
        // Kimi JSON mode — the prompt spells out the expected shape.
        response_format: { type: "json_object" },
        // Kimi K3 always reasons; "low" keeps a ~700-token narrative fast and
        // cheap. Ignored by models that don't know the field.
        ...(env.aiModel.startsWith("kimi-k3")
          ? { reasoning_effort: "low" }
          : {}),
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function isNetworkError(err: unknown): boolean {
  return err instanceof Error && !isAbort(err);
}

/** One Kimi call with the failure contract: exactly ONE retry, and only when
 *  the first attempt failed at the network layer (connection refused/reset,
 *  DNS) — never on timeout or an HTTP status. */
async function callKimi(system: string, user: string): Promise<string> {
  let res: Response;
  try {
    res = await postChatCompletion(system, user);
  } catch (err) {
    if (isAbort(err))
      throw new AiComposeError("ai_timeout", "kimi request timed out");
    if (isNetworkError(err)) {
      try {
        res = await postChatCompletion(system, user);
      } catch (retryErr) {
        if (isAbort(retryErr))
          throw new AiComposeError("ai_timeout", "kimi request timed out");
        throw new AiComposeError("ai_unavailable", "kimi network error");
      }
    } else {
      throw new AiComposeError("ai_unavailable", "kimi request failed");
    }
  }
  if (!res.ok) {
    throw new AiComposeError("ai_upstream_error", `kimi HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as KimiChatResponse | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiComposeError("ai_bad_response", "empty completion content");
  }
  return content;
}

/** Compose a narrative from prompt facts. Throws AiComposeError on any
 *  failure — callers map the code to an HTTP status. */
export async function composeNarrative(
  facts: ComposeFacts
): Promise<AiNarrative> {
  if (!aiEnabled()) throw new AiComposeError("ai_disabled");
  const { system, user } = buildComposePrompt(facts);
  const raw = await callKimi(system, user);
  const narrative = parseAiNarrative(
    raw,
    facts.dims.map(d => d.key)
  );
  if (!narrative) {
    throw new AiComposeError("ai_bad_response", "completion failed validation");
  }
  return narrative;
}

/* ----------------------------------------------------- memoize + cache -- */

type CacheEntry = { expiresAt: number; narrative: AiNarrative };

const narrativeCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<AiNarrative>>();

/** Test hook — clear both caches. */
export function clearAiComposeCache(): void {
  narrativeCache.clear();
  inflight.clear();
}

/** In-process memoization per report token: concurrent calls share one
 *  upstream request; successes are cached for REPORT_AI_CACHE_TTL_MS. */
export function composeNarrativeCached(
  token: string,
  facts: ComposeFacts
): Promise<AiNarrative> {
  const cached = narrativeCache.get(token);
  if (cached) {
    if (cached.expiresAt > Date.now()) return Promise.resolve(cached.narrative);
    narrativeCache.delete(token);
  }
  const pending = inflight.get(token);
  if (pending) return pending;

  const promise = composeNarrative(facts)
    .then(narrative => {
      narrativeCache.set(token, {
        expiresAt: Date.now() + REPORT_AI_CACHE_TTL_MS,
        narrative,
      });
      return narrative;
    })
    .finally(() => {
      if (inflight.get(token) === promise) inflight.delete(token);
    });
  inflight.set(token, promise);
  return promise;
}
