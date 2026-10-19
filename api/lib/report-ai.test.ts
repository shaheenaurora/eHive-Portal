import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildComposeFacts,
  buildComposePrompt,
  parseAiNarrative,
} from "./report-ai";
import {
  REPORT_AI_ANSWER_CAP,
  REPORT_AI_PRIVATE_KEYS,
} from "@contracts/constants";

/* Fresh module instances for the env-dependent cases (aiEnabled, the Kimi
   client, the memo cache) — env.ts snapshots process.env at import time. */
async function importFresh(aiApiKey = "test-key", aiModel = "kimi-k3") {
  vi.resetModules();
  vi.stubEnv("AI_API_KEY", aiApiKey);
  vi.stubEnv("AI_MODEL", aiModel);
  return await import("./report-ai");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const GOOD_NARRATIVE = {
  executiveSummary: "The business shows real strength in positioning.",
  dimensions: {
    positioning: {
      analysis: "Clear and differentiated.",
      signals: "Buyers repeat the same phrase.",
    },
    offer: {
      analysis: "The offer is solid but narrow.",
      signals: "Revenue concentrates in one line.",
    },
  },
  crossInsights: [
    "Strength in one dimension is masking gaps in another.",
    "The metrics lag the ambition.",
  ],
  priorities: "Fix the offer breadth first, then instrument marketing.",
};

function kimiResponse(content: string, status = 200) {
  return new Response(
    status === 200
      ? JSON.stringify({
          id: "cmpl-test",
          object: "chat.completion",
          created: 1,
          model: "kimi-k3",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      : JSON.stringify({ error: "upstream" }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function abortError() {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}

describe("buildComposeFacts (PII stripping)", () => {
  const row = {
    tool: "brand-check",
    total: 72,
    band: "distinct",
    dims: [
      {
        key: "positioning",
        label: "Positioning & Differentiation",
        score: 13,
        max: 20,
        pct: 65,
        weight: 20,
      },
      {
        key: "offer",
        label: "Offer & Value",
        score: 16,
        max: 20,
        pct: 80,
        weight: 15,
      },
    ],
    answers: {
      name: "Jane Founder",
      role: "CEO",
      email: "jane@acme.com",
      phone: "+971 50 123 4567",
      company: "Acme LLC",
      website: "acme.com",
      industry: "F&B",
      years: "4",
      team_size: "12",
      company_website: "",
      _consent: true,
      q_pos_1: 4,
      q_pos_2: "We compete on freshness and speed",
      q_offer_1: 5,
      ctx_challenges: "Cash flow is tight between catering seasons.",
    },
  };

  it("never lets contact fields into the facts or the prompt", () => {
    const facts = buildComposeFacts(row);
    expect(facts.answers).toEqual({
      q_pos_1: 4,
      q_pos_2: "We compete on freshness and speed",
      q_offer_1: 5,
      ctx_challenges: "Cash flow is tight between catering seasons.",
    });
    const { user, system } = buildComposePrompt(facts);
    const prompt = system + "\n" + user;
    for (const leaked of [
      "jane@acme.com",
      "+971 50 123 4567",
      "Jane Founder",
      "Acme LLC",
      "acme.com",
    ]) {
      expect(prompt).not.toContain(leaked);
    }
    for (const key of REPORT_AI_PRIVATE_KEYS) {
      expect(prompt).not.toContain(`"${key}"`);
    }
  });

  it("keeps the open-text context answers — the personalisation signal", () => {
    const facts = buildComposeFacts(row);
    expect(facts.answers.ctx_challenges).toContain("Cash flow");
    expect(facts.answers.q_pos_2).toContain("freshness");
  });

  it("includes band facts as ground truth", () => {
    const facts = buildComposeFacts(row);
    expect(facts.total).toBe(72);
    expect(facts.band).toBe("distinct");
    expect(facts.dims).toEqual([
      { key: "positioning", label: "Positioning & Differentiation", pct: 65 },
      { key: "offer", label: "Offer & Value", pct: 80 },
    ]);
    const { user } = buildComposePrompt(facts);
    expect(user).toContain("Overall score: 72/100");
    expect(user).toContain('band "distinct"');
    expect(user).toContain(
      "positioning (Positioning & Differentiation): 65/100"
    );
  });

  it("drops every private/underscore key even when filled", () => {
    const facts = buildComposeFacts({
      ...row,
      answers: {
        _consent: true,
        _internal: "x",
        email: "a@b.co",
        phone: "+971500000000",
        company_website: "http://spam",
        company: "Co",
        website: "w.co",
        industry: "i",
        years: "1",
        team_size: "2",
        name: "n",
        role: "r",
        real_answer: "keep me",
      },
    });
    expect(facts.answers).toEqual({ real_answer: "keep me" });
  });

  it("truncates over-long answers", () => {
    const facts = buildComposeFacts({
      ...row,
      answers: { essay: "x".repeat(REPORT_AI_ANSWER_CAP * 3), q1: 4 },
    });
    expect(String(facts.answers.essay).length).toBeLessThanOrEqual(
      REPORT_AI_ANSWER_CAP + 1
    );
    expect(String(facts.answers.essay)).toMatch(/…$/);
  });

  it("clamps garbage dims and totals instead of failing", () => {
    const facts = buildComposeFacts({
      ...row,
      total: 240,
      dims: [{ key: "ok", pct: 65 }, "junk", { key: "no-pct" }, { pct: 40 }],
    });
    expect(facts.total).toBe(100);
    expect(facts.dims).toEqual([{ key: "ok", label: null, pct: 65 }]);
  });
});

describe("parseAiNarrative (response validation)", () => {
  it("accepts a good JSON payload", () => {
    expect(
      parseAiNarrative(JSON.stringify(GOOD_NARRATIVE), ["positioning", "offer"])
    ).toEqual(GOOD_NARRATIVE);
  });

  it("rejects malformed JSON", () => {
    expect(parseAiNarrative("not json at all", ["positioning"])).toBeNull();
    expect(
      parseAiNarrative('{"executiveSummary": ', ["positioning"])
    ).toBeNull();
  });

  it("rejects markdown-wrapped JSON", () => {
    expect(
      parseAiNarrative("```json\n" + JSON.stringify(GOOD_NARRATIVE) + "\n```", [
        "positioning",
        "offer",
      ])
    ).toBeNull();
  });

  it("rejects schema mismatches", () => {
    const missing = { ...GOOD_NARRATIVE } as Record<string, unknown>;
    delete missing.priorities;
    expect(parseAiNarrative(JSON.stringify(missing))).toBeNull();

    const wrongType = { ...GOOD_NARRATIVE, crossInsights: "one string" };
    expect(parseAiNarrative(JSON.stringify(wrongType))).toBeNull();

    const tooManyInsights = {
      ...GOOD_NARRATIVE,
      crossInsights: ["a", "b", "c", "d", "e"],
    };
    expect(parseAiNarrative(JSON.stringify(tooManyInsights))).toBeNull();

    const emptySection = {
      ...GOOD_NARRATIVE,
      dimensions: { positioning: { analysis: "", signals: "x" } },
    };
    expect(parseAiNarrative(JSON.stringify(emptySection))).toBeNull();
  });

  it("rejects when no dimension key matches the report (mismatched output)", () => {
    const swapped = {
      ...GOOD_NARRATIVE,
      dimensions: { finance: { analysis: "A", signals: "S" } },
    };
    expect(
      parseAiNarrative(JSON.stringify(swapped), ["positioning", "offer"])
    ).toBeNull();
  });

  it("drops unknown dim keys but keeps matching ones", () => {
    const extra = {
      ...GOOD_NARRATIVE,
      dimensions: {
        positioning: GOOD_NARRATIVE.dimensions.positioning,
        hallucinated_dim: { analysis: "A", signals: "S" },
      },
    };
    const parsed = parseAiNarrative(JSON.stringify(extra), [
      "positioning",
      "offer",
    ]);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed!.dimensions)).toEqual(["positioning"]);
  });
});

describe("fallback decision matrix", () => {
  it("no key → aiEnabled false, compose throws ai_disabled without calling fetch", async () => {
    const mod = await importFresh("");
    expect(mod.aiEnabled()).toBe(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mod.composeNarrative({
        tool: "brand-check",
        total: 50,
        band: "b",
        dims: [],
        answers: {},
      })
    ).rejects.toMatchObject({ code: "ai_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("key set → aiEnabled true", async () => {
    const mod = await importFresh("sk-test");
    expect(mod.aiEnabled()).toBe(true);
  });

  it("timeout (AbortError) → ai_timeout, NO retry", async () => {
    const mod = await importFresh();
    const fetchMock = vi.fn().mockRejectedValue(abortError());
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mod.composeNarrative({
        tool: "t",
        total: 1,
        band: null,
        dims: [],
        answers: {},
      })
    ).rejects.toMatchObject({ code: "ai_timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("one network error → exactly one retry; success on the retry", async () => {
    const mod = await importFresh();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(() =>
        Promise.resolve(kimiResponse(JSON.stringify(GOOD_NARRATIVE)))
      );
    vi.stubGlobal("fetch", fetchMock);
    const narrative = await mod.composeNarrative({
      tool: "t",
      total: 72,
      band: "distinct",
      dims: [
        { key: "positioning", label: null, pct: 65 },
        { key: "offer", label: null, pct: 80 },
      ],
      answers: { q1: 4 },
    });
    expect(narrative.executiveSummary).toBe(GOOD_NARRATIVE.executiveSummary);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("persistent network errors → ai_unavailable after the single retry", async () => {
    const mod = await importFresh();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mod.composeNarrative({
        tool: "t",
        total: 1,
        band: null,
        dims: [],
        answers: {},
      })
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("upstream HTTP error → ai_upstream_error, NO retry", async () => {
    const mod = await importFresh();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(kimiResponse("", 500)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mod.composeNarrative({
        tool: "t",
        total: 1,
        band: null,
        dims: [],
        answers: {},
      })
    ).rejects.toMatchObject({ code: "ai_upstream_error" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bad JSON payload → ai_bad_response (fallback flag for the client)", async () => {
    const mod = await importFresh();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(kimiResponse("{not valid")));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      mod.composeNarrative({
        tool: "t",
        total: 1,
        band: null,
        dims: [],
        answers: {},
      })
    ).rejects.toMatchObject({ code: "ai_bad_response" });
  });

  it("sends an OpenAI-compatible JSON-mode request", async () => {
    const mod = await importFresh();
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(kimiResponse(JSON.stringify(GOOD_NARRATIVE)))
      );
    vi.stubGlobal("fetch", fetchMock);
    await mod.composeNarrative({
      tool: "brand-check",
      total: 72,
      band: "distinct",
      dims: [
        { key: "positioning", label: null, pct: 65 },
        { key: "offer", label: null, pct: 80 },
      ],
      answers: { q1: 4 },
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.moonshot.ai/v1/chat/completions");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.model).toBe("kimi-k3");
    expect(sent.response_format).toEqual({ type: "json_object" });
    expect(sent.temperature).toBe(0.4);
    expect(Array.isArray(sent.messages)).toBe(true);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  it("respects AI_BASE_URL and AI_MODEL overrides", async () => {
    vi.resetModules();
    vi.stubEnv("AI_API_KEY", "k");
    vi.stubEnv("AI_BASE_URL", "https://api.moonshot.cn/v1/");
    vi.stubEnv("AI_MODEL", "kimi-k2.6");
    const mod = await import("./report-ai");
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(kimiResponse(JSON.stringify(GOOD_NARRATIVE)))
      );
    vi.stubGlobal("fetch", fetchMock);
    await mod.composeNarrative({
      tool: "t",
      total: 72,
      band: "distinct",
      dims: [
        { key: "positioning", label: null, pct: 65 },
        { key: "offer", label: null, pct: 80 },
      ],
      answers: {},
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.moonshot.cn/v1/chat/completions"); // trailing slash stripped
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent.model).toBe("kimi-k2.6");
    expect("reasoning_effort" in sent).toBe(false); // only for kimi-k3
  });
});

describe("composeNarrativeCached (per-token memoize)", () => {
  it("serves concurrent + repeat calls from one upstream request, until cleared", async () => {
    const mod = await importFresh();
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(kimiResponse(JSON.stringify(GOOD_NARRATIVE)))
      );
    vi.stubGlobal("fetch", fetchMock);
    const facts = {
      tool: "t",
      total: 72,
      band: "distinct" as const,
      dims: [
        { key: "positioning", label: null, pct: 65 },
        { key: "offer", label: null, pct: 80 },
      ],
      answers: {},
    };
    const [a, b] = await Promise.all([
      mod.composeNarrativeCached("tok1", facts),
      mod.composeNarrativeCached("tok1", facts),
    ]);
    expect(a).toEqual(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await mod.composeNarrativeCached("tok1", facts);
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached hit
    mod.clearAiComposeCache();
    await mod.composeNarrativeCached("tok1", facts);
    expect(fetchMock).toHaveBeenCalledTimes(2); // recomposed after clear
  });
});
