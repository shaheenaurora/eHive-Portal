/* ==========================================================================
   eHive — AssessEngine
   Shared client-side assessment engine for the standalone tool pages
   (brand-check today; clarity-scorecard next). Vanilla JS, no deps.

   Public API
   ----------
   AssessEngine.mount(config)  — render a full assessment into #assess-root
   AssessEngine.score(config, answers)  — pure scoring → {dims,total,band}
   AssessEngine.bandFor(config, value)  — resolve a value to its band object

   config = {
     tool: "brand-check",                 // endpoint + storage namespace
     root: "assess-root",                 // mount element id
     storageKey: "ehiveBrandCheck",       // sessionStorage resume key
     leadForm: "brand-check",             // form id posted to /api/lead
     title, intro, introNote?, fineprint?,
     meta: [{big, small}],                // intro stat strip
     brand: {href, img, alt},             // header logo (optional)
     business: [{k,label,ph,required,type:"text"}],   // step 1 (context for CRM)
     dimensions: [{key,label,short?,weight,intro?,
                   questions:[{id,label,hint?,type:"scale"|"choice"|"text",
                               lo?,hi?,options?:[{label,points,watch?}]}]}],
     context: [{id,label,hint?}],         // optional non-scored open text (appendix)
     bands: [{min,key,label,headline,copy}],
     onLeadPayload?: fn(payload, scored, answers) → payload,
                                          // last-chance extension of the /api/lead
                                          // body — clarity-scorecard uses it to keep
                                          // posting total + domains for CRM/nurture
     narrative: {
       analysis:  {dimKey: {bandKey: copy}},   // 2–3 sentences per dim × band
       signals:   {dimKey: {bandKey: copy}},   // "what's happening"
       watch:     {dimKey: copy},              // shown only when earned
       recommendations: {dimKey: [{bandKey|null, min?, title, why,
                                   impact:"high"|"medium",
                                   effort:"low"|"medium", cta?}]}
     },
     watchBelowDefault: 40,               // dim pct under this earns the callout
     roadmapPhases: [{title, copy}],
     benchmark: "…",                      // benchmark copy block
     methodology: "…",                    // "About this assessment" note
     appendixNote?: "…",
     priceLabel: "AED 99",                // fallback if /api/report/config fails
     cta: {label, href},                  // footer CTA (book.html…)
     contactEmail: "info@ehiveglobal.com"
   }

   Network surface (only these, ever):
     POST /api/lead                        (CRM, unchanged shape)
     POST /api/report/save                 → {token}
     GET  /api/report/config               → {priceAed, paymentsEnabled, launchOffer}
     GET  /api/report/:tool/:token         → saved report JSON (+paid)
     POST /api/report/request-invoice      → {ok} (never called while launchOffer)
     POST /api/report/checkout             → {url} | 503 (never called while launchOffer)
     POST /api/report/compose              → {narrative} | 502/503 → keep template
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- utils */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function store(kind) {
    var s = kind === "local" ? global.localStorage : global.sessionStorage;
    return {
      get: function (k) {
        try {
          return s.getItem(k);
        } catch (e) {
          return null;
        }
      },
      set: function (k, v) {
        try {
          s.setItem(k, v);
        } catch (e) {
          /* storage unavailable — non-fatal */
        }
      },
      del: function (k) {
        try {
          s.removeItem(k);
        } catch (e) {
          /* non-fatal */
        }
      },
    };
  }
  var sess = store("session");
  var local = store("local");

  function fetchJSON(url, opts) {
    opts = opts || {};
    return fetch(url, {
      method: opts.method || "GET",
      headers: opts.body
        ? { "Content-Type": "application/json", Accept: "application/json" }
        : { Accept: "application/json" },
      keepalive: !!opts.keepalive,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      if (!r.ok) {
        var err = new Error("HTTP " + r.status);
        err.status = r.status;
        return r
          .json()
          .catch(function () {
            return null;
          })
          .then(function (d) {
            err.data = d;
            throw err;
          });
      }
      return r.json().catch(function () {
        return null;
      });
    });
  }

  function reduceMotion() {
    try {
      return global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  /* -------------------------------------------------------------- scoring */

  function qPoints(q, a) {
    if (a == null || a === "") return null;
    if (q.type === "scale") {
      var n = Number(a);
      if (!isFinite(n)) return null;
      return Math.min(5, Math.max(1, n)) - 1; // 1–5 → 0–4
    }
    if (q.type === "choice") {
      for (var i = 0; i < (q.options || []).length; i++) {
        if (q.options[i].label === a) return q.options[i].points;
      }
      return null;
    }
    return null; // open text is context, never scored
  }

  function qMax(q) {
    if (q.type === "scale") return 4;
    var m = 0;
    (q.options || []).forEach(function (o) {
      if (o.points > m) m = o.points;
    });
    return m;
  }

  function bandFor(config, value) {
    var bands = (config.bands || []).slice().sort(function (a, b) {
      return a.min - b.min;
    });
    var hit = bands[0] || { key: "none", label: "", headline: "", copy: "" };
    for (var i = 0; i < bands.length; i++) {
      if (value >= bands[i].min) hit = bands[i];
    }
    return hit;
  }

  /* Pure scoring: answers = {questionId: value}. Unanswered scored questions
   * count as zero (the wizard prevents this from ever shipping). */
  function score(config, answers) {
    var dims = (config.dimensions || []).map(function (d) {
      var sum = 0,
        max = 0;
      (d.questions || []).forEach(function (q) {
        if (q.type === "text") return;
        var p = qPoints(q, answers ? answers[q.id] : null);
        sum += p == null ? 0 : p;
        max += qMax(q);
      });
      return {
        key: d.key,
        label: d.label,
        short: d.short || d.label,
        weight: d.weight || 0,
        raw: sum, // points earned (server /api/report/save expects score|raw + max)
        max: max,
        pct: max ? Math.round((sum / max) * 100) : 0,
      };
    });
    var wsum = 0,
      wtotal = 0;
    dims.forEach(function (d) {
      wsum += d.weight * d.pct;
      wtotal += d.weight;
    });
    var total = wtotal ? Math.round(wsum / wtotal) : 0;
    return { dims: dims, total: total, band: bandFor(config, total) };
  }

  /* --------------------------------------------------------------- mount */

  function mount(config) {
    if (!config || !config.tool || !config.dimensions || !config.bands) {
      throw new Error("AssessEngine.mount: config.tool, .dimensions and .bands are required");
    }
    var root = document.getElementById(config.root || "assess-root");
    if (!root) throw new Error("AssessEngine.mount: #" + (config.root || "assess-root") + " not found");
    root.classList.add("assess", "assess-wrap");

    var UNLOCK_KEY = "ehiveAssessUnlocked";
    var SNAP_KEY = "ehiveAssessLast";
    var unlockIndex = function () {
      try {
        return JSON.parse(local.get(UNLOCK_KEY) || "{}");
      } catch (e) {
        return {};
      }
    };
    var markUnlocked = function (token) {
      var idx = unlockIndex();
      idx[config.tool + ":" + token] = true;
      local.set(UNLOCK_KEY, JSON.stringify(idx));
    };
    var isUnlocked = function (token) {
      return !!unlockIndex()[config.tool + ":" + token];
    };
    /* last-rendered report per token — lets an already-unlocked report
     * re-render even when the server can't be reached */
    function saveSnapshot(token, dims, total, bandKey) {
      try {
        var all = JSON.parse(local.get(SNAP_KEY) || "{}");
        all[config.tool + ":" + token] = { dims: dims, total: total, band: bandKey };
        local.set(SNAP_KEY, JSON.stringify(all));
      } catch (e) {
        /* non-fatal */
      }
    }
    function getSnapshot(token) {
      try {
        return JSON.parse(local.get(SNAP_KEY) || "{}")[config.tool + ":" + token] || null;
      } catch (e) {
        return null;
      }
    }

    var urlParam = function (name) {
      try {
        return new URLSearchParams(global.location.search).get(name);
      } catch (e) {
        return null;
      }
    };
    var setUrlParam = function (name, value) {
      try {
        var u = new URL(global.location.href);
        u.searchParams.set(name, value);
        global.history.replaceState(null, "", u.toString());
      } catch (e) {
        /* non-fatal */
      }
    };

    /* ---- AI narrative upgrade -------------------------------------------
     * The template narrative renders instantly (deterministic, always
     * correct). Once the report is saved (token known) we fire-and-forget
     * POST /api/report/compose and upgrade the narrative sections in place
     * when the server-composed version arrives. We only ever replace
     * analysis/signals/executive-summary text — never scores, bars,
     * watch-outs or recommendations. ANY failure (or config.ai === false)
     * leaves the template silently: no badge, no error UI. A per-token
     * localStorage ledger means revisits with unchanged scores don't
     * recompose. */
    var AI_STORE_KEY = "ehiveAssessAI";
    var aiOn = config.ai !== false;
    var aiStatus = "idle"; /* idle | pending | done | off */
    var aiNarrative = null;
    var aiFor = null; /* tool:token:total:band the current status belongs to */

    function aiLedger() {
      try {
        return JSON.parse(local.get(AI_STORE_KEY) || "{}");
      } catch (e) {
        return {};
      }
    }
    function aiSave(token, total, bandKey, narrative) {
      try {
        var all = aiLedger();
        all[config.tool + ":" + token] = {
          v: total,
          b: bandKey || "",
          n: narrative,
        };
        var keys = Object.keys(all);
        if (keys.length > 10) delete all[keys[0]]; /* bound the ledger */
        local.set(AI_STORE_KEY, JSON.stringify(all));
      } catch (e) {
        /* non-fatal */
      }
    }
    function aiLoad(token, total, bandKey) {
      try {
        var hit = aiLedger()[config.tool + ":" + token];
        if (hit && hit.n && hit.v === total && (hit.b || "") === (bandKey || "")) {
          return hit.n;
        }
      } catch (e) {
        /* non-fatal */
      }
      return null;
    }
    function aiBadgeHtml() {
      return (
        '<span class="assess-ai-badge"><svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
        '<path d="M6 .8l1.2 3.2 3.2.3-2.4 2.1.7 3.2L6 8l-2.7 1.6.7-3.2L1.6 4.3l3.2-.3z" fill="currentColor"/></svg>' +
        "AI-enhanced analysis</span>"
      );
    }
    function aiCrossHtml(n) {
      var items = (n.crossInsights || [])
        .map(function (s) {
          return "<li>" + esc(s) + "</li>";
        })
        .join("");
      return (
        '<section class="assess-aicross">' +
        '<div class="assess-aicross-head">' +
        "<h3>Cross-cutting insights</h3>" +
        aiBadgeHtml() +
        "</div>" +
        (n.executiveSummary ? "<p>" + esc(n.executiveSummary) + "</p>" : "") +
        (items ? "<ul>" + items + "</ul>" : "") +
        (n.priorities
          ? "<h4>Where to focus first</h4><p>" + esc(n.priorities) + "</p>"
          : "") +
        "</section>"
      );
    }
    function aiFind(attr, key) {
      var nodes = root.querySelectorAll("[" + attr + ']');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute(attr) === key) return nodes[i];
      }
      return null;
    }
    function aiUpdateShimmer() {
      var pending = aiStatus === "pending";
      var targets = root.querySelectorAll(
        "[data-ai-exec], [data-ai-analysis], [data-ai-signals]"
      );
      Array.prototype.forEach.call(targets, function (t) {
        var upgraded = t.getAttribute("data-ai-upgraded") === "1";
        if (pending && !upgraded) t.classList.add("assess-ai-shimmer");
        else t.classList.remove("assess-ai-shimmer");
      });
      var note = root.querySelector("[data-ai-note]");
      if (note) note.style.display = pending ? "" : "none";
    }
    /* Upgrade whatever narrative sections are currently rendered. Safe to
     * call after every render and on every compose state change. */
    function aiApply() {
      if (aiStatus === "done" && aiNarrative) {
        var n = aiNarrative;
        var exec = root.querySelector("[data-ai-exec]");
        if (exec && n.executiveSummary && exec.getAttribute("data-ai-upgraded") !== "1") {
          exec.textContent = n.executiveSummary;
          exec.setAttribute("data-ai-upgraded", "1");
        }
        var dimsOut = n.dimensions || {};
        Object.keys(dimsOut).forEach(function (key) {
          var sec = dimsOut[key] || {};
          var pA = aiFind("data-ai-analysis", key);
          if (pA && sec.analysis && pA.getAttribute("data-ai-upgraded") !== "1") {
            pA.textContent = sec.analysis;
            pA.setAttribute("data-ai-upgraded", "1");
          }
          var pS = aiFind("data-ai-signals", key);
          if (pS && sec.signals && pS.getAttribute("data-ai-upgraded") !== "1") {
            pS.textContent = sec.signals;
            pS.setAttribute("data-ai-upgraded", "1");
          }
        });
        var crossSlot = root.querySelector("[data-ai-cross]");
        if (crossSlot && !crossSlot.hasChildNodes()) {
          crossSlot.appendChild(el(aiCrossHtml(n)));
        }
        var badgeSlots = root.querySelectorAll("[data-ai-badge]");
        Array.prototype.forEach.call(badgeSlots, function (slot) {
          if (!slot.hasChildNodes()) slot.appendChild(el(aiBadgeHtml()));
        });
      }
      aiUpdateShimmer();
    }
    function composeAI(token, total, bandKey) {
      if (!aiOn || !token) return;
      var id = config.tool + ":" + token + ":" + total + ":" + (bandKey || "");
      if (aiFor === id && (aiStatus === "done" || aiStatus === "pending")) return;
      var cached = aiLoad(token, total, bandKey);
      if (cached) {
        aiStatus = "done";
        aiNarrative = cached;
        aiFor = id;
        aiApply();
        return;
      }
      if (aiFor === id && aiStatus === "off") return; /* one attempt per report state */
      aiFor = id;
      aiStatus = "pending";
      aiApply();
      fetchJSON("/api/report/compose", {
        method: "POST",
        body: { tool: config.tool, token: token },
      })
        .then(function (d) {
          if (d && d.ok === true && d.narrative) {
            aiStatus = "done";
            aiNarrative = d.narrative;
            aiSave(token, total, bandKey, d.narrative);
          } else {
            aiStatus = "off";
          }
          aiApply();
        })
        .catch(function () {
          aiStatus = "off";
          aiApply();
        });
    }

    /* ---- step model ---- */
    var steps = [{ type: "business" }];
    config.dimensions.forEach(function (d, i) {
      steps.push({ type: "dim", i: i });
    });
    if (config.context && config.context.length) steps.push({ type: "context" });
    steps.push({ type: "gate" });

    /* ---- state ---- */
    var S = {
      answers: {},
      step: 0,
      submitted: false,
      token: null,
      dims: null,
      total: null,
      band: null,
    };

    function saveProgress() {
      sess.set(
        config.storageKey,
        JSON.stringify({ answers: S.answers, step: S.step })
      );
    }
    function clearProgress() {
      sess.del(config.storageKey);
    }
    (function restore() {
      try {
        var saved = JSON.parse(sess.get(config.storageKey) || "null");
        if (saved && saved.answers && Object.keys(saved.answers).length) {
          S.answers = saved.answers;
          S.step = Math.min(Math.max(Number(saved.step) || 0, 0), steps.length - 1);
        }
      } catch (e) {
        /* corrupt state — start fresh */
      }
    })();

    var hasProgress = Object.keys(S.answers).length > 0;

    /* =============================================================== intro */

    function renderIntro() {
      var meta = (config.meta || [])
        .map(function (m) {
          return "<div><b>" + esc(m.big) + "</b>" + esc(m.small) + "</div>";
        })
        .join("");
      root.innerHTML =
        (config.brand
          ? '<a class="assess-brand" href="' + esc(config.brand.href) + '" aria-label="' + esc(config.brand.alt || "eHive") + '"><img src="' + esc(config.brand.img) + '" alt="' + esc(config.brand.alt || "eHive") + '"></a>'
          : "") +
        '<div class="assess-rule"></div>' +
        "<h1>" + esc(config.title) + "</h1>" +
        '<p class="assess-lede">' + esc(config.intro) + "</p>" +
        (meta ? '<div class="assess-meta">' + meta + "</div>" : "") +
        (config.introNote ? '<p class="assess-lede" style="font-size:15px;margin-bottom:26px">' + esc(config.introNote) + "</p>" : "") +
        '<button class="assess-btn" id="assessStart">' +
        (hasProgress ? "Resume where you left off" : "Begin the diagnostic") +
        "</button>" +
        (config.fineprint ? '<p class="assess-fineprint">' + esc(config.fineprint) + "</p>" : "");
      document.getElementById("assessStart").addEventListener("click", function () {
        renderStep();
        global.scrollTo({ top: 0, behavior: "smooth" });
      });
    }

    /* ============================================================== wizard */

    function progressHtml() {
      var hexes = steps
        .map(function (_, i) {
          var cls = "assess-hex";
          if (i < S.step) cls += " done";
          else if (i === S.step) cls += " now";
          return '<span class="' + cls + '" title="Step ' + (i + 1) + '"></span>';
        })
        .join("");
      return (
        '<div class="assess-prog">' +
        '<div class="assess-prog-track"><div class="assess-prog-fill" style="width:' +
        Math.round((S.step / (steps.length - 1)) * 100) +
        '%"></div></div>' +
        '<div class="assess-prog-hex">' + hexes + "</div>" +
        '<div class="assess-prog-label"><span id="assessProgStep"></span><span id="assessProgName">' +
        "Step " + (S.step + 1) + " of " + steps.length +
        "</span></div></div>"
      );
    }

    function scaleHtml(q) {
      var cur = S.answers[q.id];
      var lo = q.lo || "Not at all";
      var hi = q.hi || "Completely true";
      var opts = "";
      for (var v = 1; v <= 5; v++) {
        var endSpan =
          v === 1 ? "<span>" + esc(lo) + "</span>" :
          v === 5 ? "<span>" + esc(hi) + "</span>" :
          "<span>&nbsp;</span>";
        opts +=
          '<button type="button" class="assess-sopt' + (String(cur) === String(v) ? " sel" : "") +
          '" data-q="' + esc(q.id) + '" data-v="' + v + '" aria-pressed="' + (String(cur) === String(v)) + '">' +
          '<span class="assess-snum">' + v + "</span>" + endSpan +
          '<span class="assess-scale-key">⌃ ' + v + "</span></button>";
      }
      return (
        '<div class="assess-scale" role="group" aria-label="' + esc(q.label) + '">' + opts + "</div>" +
        '<div class="assess-scale-ends"><span>' + esc(lo) + '</span><span>' + esc(hi) + "</span></div>"
      );
    }

    function choiceHtml(q) {
      var cur = S.answers[q.id];
      var opts = (q.options || [])
        .map(function (o, i) {
          return (
            '<button type="button" class="assess-copt' + (cur === o.label ? " sel" : "") +
            '" data-q="' + esc(q.id) + '" data-v="' + esc(o.label) + '" aria-pressed="' + (cur === o.label) + '">' +
            '<span class="assess-cdot"></span><span>' + esc(o.label) + "</span>" +
            '<span class="assess-scale-key">⌃ ' + (i + 1) + "</span></button>"
          );
        })
        .join("");
      return '<div class="assess-choice" role="group" aria-label="' + esc(q.label) + '">' + opts + "</div>";
    }

    function textHtml(q, gate) {
      var v = S.answers[q.id] != null ? esc(S.answers[q.id]) : "";
      if (q.type === "textarea" || (q.type === "text" && q.long))
        return '<textarea class="assess-textarea" data-q="' + esc(q.id) + '" aria-label="' + esc(q.label) +
          '" placeholder="' + esc(q.ph || "Type your answer…") + '">' + v + "</textarea>";
      var ac = gate && q.ac ? ' autocomplete="' + q.ac + '"' : "";
      return '<input class="assess-input" type="' + (q.inputType || "text") + '" data-q="' + esc(q.id) +
        '" aria-label="' + esc(q.label) + '" value="' + v + '"' + ac +
        ' placeholder="' + esc(q.ph || "") + '">';
    }

    function questionHtml(q, gate) {
      var hint = q.hint ? '<div class="assess-qhint">' + esc(q.hint) + "</div>" : "";
      var body =
        q.type === "scale" ? scaleHtml(q) :
        q.type === "choice" ? choiceHtml(q) :
        textHtml(q, gate);
      return (
        '<div class="assess-q"><span class="assess-qlabel">' + esc(q.label) +
        "</span>" + hint + body + "</div>"
      );
    }

    function fieldHtml(f) {
      var v = S.answers[f.k] != null ? esc(S.answers[f.k]) : "";
      return (
        '<div class="assess-field"><span class="assess-label">' + esc(f.label) +
        (f.required ? " *" : "") + "</span>" +
        '<input class="assess-input" type="' + (f.type === "email" ? "email" : "text") + '" data-k="' + esc(f.k) +
        '" aria-label="' + esc(f.label) + '" value="' + v + '"' +
        (f.ph ? ' placeholder="' + esc(f.ph) + '"' : "") + "></div>"
      );
    }

    function renderStep() {
      var sdef = steps[S.step];
      var body = "";

      if (sdef.type === "business") {
        var fields = (config.business || []).map(fieldHtml).join("");
        body =
          '<div class="assess-step-no">Before we start</div>' +
          '<div class="assess-step-title">A little context</div>' +
          '<div class="assess-grid2">' + fields + "</div>";
      } else if (sdef.type === "dim") {
        var d = config.dimensions[sdef.i];
        body =
          '<div class="assess-step-no">Dimension ' + (sdef.i + 1) + " of " + config.dimensions.length + "</div>" +
          '<div class="assess-step-title">' + esc(d.label) + "</div>" +
          (d.intro ? '<p class="assess-step-intro">' + esc(d.intro) + "</p>" : "") +
          d.questions.map(function (q) {
            return questionHtml(q, false);
          }).join("");
      } else if (sdef.type === "context") {
        body =
          '<div class="assess-step-no">Almost done</div>' +
          '<div class="assess-step-title">Anything else we should know? <span style="font-weight:400;font-size:15px;color:var(--eh-ink-600)">(optional)</span></div>' +
          (config.context || [])
            .map(function (q) {
              return questionHtml(
                { id: q.id, label: q.label, hint: q.hint, type: "textarea", required: false },
                false
              );
            })
            .join("");
      } else {
        body =
          '<div class="assess-step-no">Where to send your result</div>' +
          '<div class="assess-step-title">Your details</div>' +
          '<div class="assess-grid2">' +
          fieldHtml({ k: "name", label: "Your name", required: true, ph: "Full name" }) +
          fieldHtml({ k: "role", label: "Your role", ph: "e.g. Founder / CMO" }) +
          fieldHtml({ k: "email", label: "Email", required: true, ph: "you@company.com" }) +
          fieldHtml({ k: "phone", label: "Phone", ph: "+971 50 000 0000" }) +
          "</div>" +
          '<label class="assess-consent"><input type="checkbox" id="assessConsent"' +
          (S.answers._consent ? " checked" : "") + ">" +
          "<span>" + esc(
            "I'm happy for the eHive team to review my answers and send me my report and follow-ups. " +
            "I can request deletion of my data at any time."
          ) + "</span></label>" +
          /* honeypot — must stay empty */
          '<div class="assess-hp" aria-hidden="true">' +
          '<label>Website<input class="assess-input" type="text" data-k="company_website" tabindex="-1" autocomplete="off"></label>' +
          "</div>";
      }

      root.innerHTML =
        progressHtml() +
        '<div id="assessStepBody">' + body + "</div>" +
        '<p class="assess-err" id="assessErr"></p>' +
        '<div class="assess-nav">' +
        '<button class="assess-btn-ghost" id="assessBack"' + (S.step === 0 ? ' style="visibility:hidden"' : "") + ">← Back</button>" +
        '<button class="assess-btn" id="assessNext">' +
        (S.step === steps.length - 1 ? "See my result →" : "Continue →") +
        "</button></div>";

      if (sdef.type === "business") {
        var ps = document.getElementById("assessProgStep");
        if (ps) ps.textContent = "About your business";
      } else if (sdef.type === "dim") {
        var ps2 = document.getElementById("assessProgStep");
        if (ps2) ps2.textContent = "Dimension " + (sdef.i + 1) + " of " + config.dimensions.length;
      } else if (sdef.type === "context") {
        var ps3 = document.getElementById("assessProgStep");
        if (ps3) ps3.textContent = "Optional context";
      } else {
        var ps4 = document.getElementById("assessProgStep");
        if (ps4) ps4.textContent = "Your report";
      }

      wireStep();
      document.getElementById("assessBack").addEventListener("click", goBack);
      document.getElementById("assessNext").addEventListener("click", goNext);
    }

    function wireStep() {
      var bodyEl = document.getElementById("assessStepBody");
      var nodes = bodyEl.querySelectorAll(".assess-sopt, .assess-copt");
      Array.prototype.forEach.call(nodes, function (n) {
        n.addEventListener("click", function () {
          var qid = n.getAttribute("data-q");
          var v = n.getAttribute("data-v");
          S.answers[qid] = n.classList.contains("assess-sopt") ? Number(v) : v;
          var sibs = n.parentNode.querySelectorAll(".assess-sopt, .assess-copt");
          Array.prototype.forEach.call(sibs, function (s) {
            s.classList.remove("sel");
            s.setAttribute("aria-pressed", "false");
          });
          n.classList.add("sel");
          n.setAttribute("aria-pressed", "true");
          saveProgress();
        });
      });
      var inputs = bodyEl.querySelectorAll("[data-q].assess-input, [data-q].assess-textarea, [data-k].assess-input");
      Array.prototype.forEach.call(inputs, function (inp) {
        inp.addEventListener("input", function () {
          var key = inp.getAttribute("data-q") || inp.getAttribute("data-k");
          S.answers[key] = inp.value;
          saveProgress();
        });
      });
      var consent = document.getElementById("assessConsent");
      if (consent)
        consent.addEventListener("change", function () {
          S.answers._consent = consent.checked;
          saveProgress();
        });
    }

    /* keyboard nav: 1–5 answer the first unanswered question on the step,
     * ←/→ move between steps. Native Tab/Enter already works on real buttons. */
    function onKeydown(e) {
      if (document.getElementById("assessStepBody") == null) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (/^[1-5]$/.test(e.key)) {
        var groups = Array.prototype.slice.call(
          document.querySelectorAll("#assessStepBody .assess-scale, #assessStepBody .assess-choice")
        );
        for (var i = 0; i < groups.length; i++) {
          var btns = groups[i].querySelectorAll(".assess-sopt, .assess-copt");
          var idx = Number(e.key) - 1;
          if (idx < btns.length && !groups[i].querySelector(".sel")) {
            e.preventDefault();
            btns[idx].click();
            return;
          }
        }
      }
    }
    document.addEventListener("keydown", onKeydown);

    function emailOk(e) {
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e || "");
    }

    function stepError(msg, focusSel) {
      var err = document.getElementById("assessErr");
      if (!err) return;
      err.textContent = msg;
      err.classList.add("show");
      if (focusSel) {
        var f = document.querySelector(focusSel);
        if (f && f.focus) f.focus();
      }
    }

    function validateStep() {
      var sdef = steps[S.step];
      if (sdef.type === "business") {
        for (var i = 0; i < (config.business || []).length; i++) {
          var f = config.business[i];
          if (f.required && !String(S.answers[f.k] || "").trim()) {
            return { msg: "Please complete the highlighted fields to continue.", focus: '[data-k="' + f.k + '"]' };
          }
        }
        return null;
      }
      if (sdef.type === "dim") {
        var d = config.dimensions[sdef.i];
        for (var j = 0; j < d.questions.length; j++) {
          var q = d.questions[j];
          if (q.type === "text") continue;
          var a = S.answers[q.id];
          if (a == null || a === "") {
            return { msg: "Please answer every question on this step to continue.", focus: '[data-q="' + q.id + '"]' };
          }
        }
        return null;
      }
      if (sdef.type === "gate") {
        if (!String(S.answers.name || "").trim())
          return { msg: "Please add your name.", focus: '[data-k="name"]' };
        if (!emailOk(S.answers.email))
          return { msg: "Please add a valid email address.", focus: '[data-k="email"]' };
        if (!S.answers._consent)
          return { msg: "Please confirm you're happy for us to send your report.", focus: "#assessConsent" };
        return null;
      }
      return null; // context step is optional
    }

    function goBack() {
      if (S.step > 0) {
        S.step--;
        saveProgress();
        renderStep();
        global.scrollTo({ top: 0, behavior: "smooth" });
      }
    }

    function goNext() {
      var bad = validateStep();
      if (bad) {
        stepError(bad.msg, bad.focus);
        return;
      }
      if (S.step === steps.length - 1) {
        submitAll();
        return;
      }
      S.step++;
      saveProgress();
      renderStep();
      global.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* ---------------------------------------------------------- payloads */

    function humanAnswer(q) {
      var a = S.answers[q.id];
      if (a == null || a === "") return "—";
      if (q.type === "scale") {
        var lbl = a === 1 ? q.lo || "Not at all" : a === 5 ? q.hi || "Completely true" : "";
        return a + " / 5" + (lbl ? " — " + lbl : "");
      }
      if (q.type === "choice") {
        for (var i = 0; i < (q.options || []).length; i++)
          if (q.options[i].label === a) return a;
        return String(a);
      }
      return String(a);
    }

    function sourcePage() {
      try {
        return document.referrer && document.referrer.indexOf(global.location.host) !== -1
          ? new URL(document.referrer).pathname
          : "/" + config.tool + ".html";
      } catch (e) {
        return "/" + config.tool + ".html";
      }
    }

    function leadPayload() {
      var sections = config.dimensions.map(function (d, i) {
        return {
          title: (i + 1 < 10 ? "0" : "") + (i + 1) + " " + d.label,
          items: d.questions.map(function (q) {
            return { q: q.label, a: humanAnswer(q) };
          }),
        };
      });
      if (config.context && config.context.length) {
        sections.push({
          title: "Context (optional)",
          items: config.context.map(function (q) {
            var a = S.answers[q.id];
            return { q: q.label, a: a == null || a === "" ? "—" : String(a) };
          }),
        });
      }
      var payload = {
        form: config.leadForm || config.tool,
        name: S.answers.name || "",
        role: S.answers.role || "",
        email: S.answers.email || "",
        phone: S.answers.phone || "",
        company: S.answers.company || "",
        website: S.answers.website || "",
        industry: S.answers.industry || "",
        years: S.answers.years || "",
        team_size: S.answers.team_size || "",
        consent: !!S.answers._consent,
        source_page: sourcePage(),
        sections: sections,
      };
      /* Documented extension point: tools that predate the engine (the
         clarity-scorecard) must post extra fields — total + per-domain
         scores — to /api/lead so CRM nurture and the admin report keep
         working. The callback may return a replacement payload; a throw
         falls back to the default payload. */
      if (typeof config.onLeadPayload === "function") {
        try {
          var extended = config.onLeadPayload(payload, score(config, S.answers), S.answers);
          if (extended && typeof extended === "object") payload = extended;
        } catch (e) {
          /* non-fatal — default payload stands */
        }
      }
      return payload;
    }

    function submitAll() {
      /* honeypot tripped — pretend success, send nothing */
      if (String(S.answers.company_website || "").trim()) {
        clearProgress();
        renderSummary(null, { saved: false });
        return;
      }

      var nextBtn = document.getElementById("assessNext");
      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.textContent = "Building your report…";
      }

      var sc = score(config, S.answers);
      var reportBody = {
        tool: config.tool,
        email: S.answers.email || "",
        contact: {
          name: S.answers.name || "",
          role: S.answers.role || "",
          phone: S.answers.phone || "",
          company: S.answers.company || "",
          website: S.answers.website || "",
          industry: S.answers.industry || "",
          years: S.answers.years || "",
          team_size: S.answers.team_size || "",
        },
        answers: S.answers,
        dims: sc.dims,
        total: sc.total,
        band: sc.band.key,
      };

      var leadPromise = fetchJSON("/api/lead", { method: "POST", body: leadPayload(), keepalive: true })
        .then(function (d) {
          return { ok: !!(d && d.ok === true), data: d };
        })
        .catch(function () {
          return { ok: false, data: null };
        });
      var savePromise = fetchJSON("/api/report/save", { method: "POST", body: reportBody })
        .then(function (d) {
          return d && d.token ? { ok: true, token: d.token } : { ok: false };
        })
        .catch(function () {
          return { ok: false };
        });

      /* /api/lead failure blocks (inline error, stay on the gate) — the CRM
       * record is the continuity contract. /api/report/save failure must not
       * block the summary: we just render it without a token. */
      leadPromise.then(function (lead) {
        if (!lead.ok) {
          if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.textContent = "See my result →";
          }
          stepError("We couldn't send your responses right now. Please check your connection and try again.");
          return;
        }
        savePromise.then(function (save) {
          clearProgress();
          S.submitted = true;
          S.token = save.ok ? save.token : null;
          S.dims = sc.dims;
          S.total = sc.total;
          S.band = sc.band;
          if (S.token) setUrlParam("report", S.token);
          renderSummary(null, { saved: false });
          composeAI(S.token, sc.total, sc.band.key);
        });
      });
    }

    /* ===================================================== summary (free) */

    function recImpactRank(r) {
      return r.impact === "high" ? 0 : 1;
    }
    function recEffortRank(r) {
      return r.effort === "low" ? 0 : 1;
    }

    function dimRecs(d, dimPct, dimBand) {
      var recs = ((config.narrative || {}).recommendations || {})[d.key] || [];
      return recs.filter(function (r) {
        if (r.bandKey != null) return r.bandKey === dimBand.key;
        var min = r.min != null ? r.min : 0;
        return dimPct >= min;
      });
    }

    function allRecs(dims) {
      var out = [];
      dims.forEach(function (dm) {
        var d = config.dimensions.filter(function (x) {
          return x.key === dm.key;
        })[0];
        if (!d) return;
        dimRecs(d, dm.pct, bandFor(config, dm.pct)).forEach(function (r) {
          out.push({ dim: dm, rec: r });
        });
      });
      out.sort(function (a, b) {
        return recImpactRank(a.rec) - recImpactRank(b.rec) || recEffortRank(a.rec) - recEffortRank(b.rec);
      });
      return out;
    }

    function recCardHtml(r, withDim) {
      var tags =
        '<div class="assess-tags">' +
        '<span class="assess-tag impact-' + esc(r.impact) + '">Impact: ' + esc(r.impact) + "</span>" +
        '<span class="assess-tag">Effort: ' + esc(r.effort) + "</span>" +
        (withDim ? '<span class="assess-tag">' + esc(withDim) + "</span>" : "") +
        "</div>";
      return (
        '<div class="assess-rec"><h3>' + esc(r.title) + "</h3><p>" + esc(r.why) + "</p>" + tags +
        (r.cta && r.cta.href
          ? '<a class="assess-rec-cta" href="' + esc(r.cta.href) + '">' + esc(r.cta.label) + " →</a>"
          : "") +
        "</div>"
      );
    }

    function ringSvg() {
      return (
        '<svg class="assess-ring" viewBox="0 0 148 148" role="img" aria-label="Overall score">' +
        '<circle class="assess-ring-bg" cx="74" cy="74" r="64"></circle>' +
        '<circle class="assess-ring-fg" cx="74" cy="74" r="64"></circle>' +
        '<text class="assess-ring-text" x="74" y="72" text-anchor="middle" id="assessRingNum">0</text>' +
        '<text class="assess-ring-sub" x="74" y="98" text-anchor="middle">Overall / 100</text>' +
        "</svg>"
      );
    }

    function animateRing(total) {
      var C = 2 * Math.PI * 64;
      var fg = root.querySelector(".assess-ring-fg");
      var num = document.getElementById("assessRingNum");
      if (!fg || !num) return;
      fg.style.strokeDasharray = String(C);
      var target = C * (1 - total / 100);
      if (reduceMotion()) {
        fg.style.strokeDashoffset = String(target);
        num.textContent = String(total);
        return;
      }
      fg.style.strokeDashoffset = String(C);
      var t0 = null;
      var dur = 1100;
      function tick(ts) {
        if (t0 == null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        fg.style.strokeDashoffset = String(C + (target - C) * eased);
        num.textContent = String(Math.round(total * eased));
        if (p < 1) global.requestAnimationFrame(tick);
      }
      global.requestAnimationFrame(tick);
    }

    function renderSummary(savedData, opts) {
      opts = opts || {};
      var dims, total, band;
      if (savedData) {
        dims = savedData.dims || (savedData.answers ? score(config, savedData.answers).dims : []);
        total = savedData.total != null ? savedData.total : score(config, savedData.answers || {}).total;
        band = bandFor(config, total);
      } else {
        dims = S.dims;
        total = S.total;
        band = S.band;
      }
      var snapToken = (opts && opts.token) || S.token;
      if (snapToken) saveSnapshot(snapToken, dims, total, band.key);
      var sorted = dims.slice().sort(function (a, b) {
        return b.pct - a.pct;
      });
      var strongest = sorted[0];
      var weakest = sorted[sorted.length - 1];

      var exec =
        band.copy +
        " Your strongest area right now is " + strongest.label + " at " + strongest.pct +
        "%. The clearest gap is " + weakest.label + " at " + weakest.pct +
        "% — and in our experience that's where the fastest, cheapest gains usually sit for a business at this stage.";

      var lowestPct = weakest.pct;
      var bars = dims
        .map(function (d) {
          var isLow = d.pct === lowestPct && dims.length > 1;
          return (
            '<div class="assess-dimbar' + (isLow ? " lowest" : "") + '">' +
            '<span class="assess-dimbar-name">' + esc(d.short || d.label) + "</span>" +
            '<span class="assess-dimbar-track"><span class="assess-dimbar-fill" data-pct="' + d.pct + '" style="width:0"></span></span>' +
            '<span class="assess-dimbar-val">' + d.pct + "</span></div>"
          );
        })
        .join("");

      var top3 = allRecs(dims)
        .slice(0, 3)
        .map(function (x) {
          return recCardHtml(x.rec, x.dim.short || x.dim.label);
        })
        .join("");

      root.innerHTML =
        (config.brand
          ? '<a class="assess-brand" href="' + esc(config.brand.href) + '" aria-label="' + esc(config.brand.alt || "eHive") + '"><img src="' + esc(config.brand.img) + '" alt="' + esc(config.brand.alt || "eHive") + '"></a>'
          : "") +
        '<div class="assess-rule"></div>' +
        '<section class="assess-summary">' +
        '<div class="assess-step-no">' + (opts.saved ? "Your saved report" : "Your result") + "</div>" +
        "<h1>" + esc(config.summaryTitle || "Your Brand Diagnostic result") + "</h1>" +
        (opts.saved ? '<p class="assess-saved-note">Report ' + esc(opts.token || "") + " — pulled from your saved answers.</p>" : "") +
        '<div class="assess-ring-wrap">' + ringSvg() +
        "<div><span class=\"assess-band-tag\">" + esc(band.label) + "</span>" +
        '<span class="assess-ai-badge-slot" data-ai-badge></span>' +
        '<span class="assess-ai-note" data-ai-note style="display:none">Refining your analysis…</span>' +
        '<p class="assess-band-label">' + esc(band.headline) + "</p>" +
        '<p class="assess-exec" data-ai-exec>' + esc(exec) + "</p></div></div>" +
        "<h2>How the " + config.dimensions.length + " dimensions read</h2>" +
        '<div class="assess-dimbars">' + bars + "</div>" +
        '<div class="assess-reclist"><h2>Where to start</h2>' + top3 + "</div>" +
        "</section>" +
        '<div id="assessUnlock"></div>' +
        '<div id="assessReport"></div>';

      animateRing(total);
      var fills = root.querySelectorAll(".assess-dimbar-fill");
      Array.prototype.forEach.call(fills, function (f) {
        var pct = Number(f.getAttribute("data-pct")) || 0;
        if (reduceMotion()) f.style.width = pct + "%";
        else setTimeout(function () {
          f.style.width = pct + "%";
        }, 60);
      });

      renderUnlock(dims, total, band, opts);
      aiApply();
    }

    /* ------------------------------------------------------------ gating */

    /* /api/report/config is consulted every time the summary renders its
     * unlock area. Cached per session so a later render (e.g. an
     * already-unlocked rehydrated report) still resolves the launch-offer
     * state when the network drops. Never rejects — resolves null when the
     * endpoint is unreachable and nothing is cached yet. */
    var reportConfigCache = null;
    function getReportConfig() {
      return fetchJSON("/api/report/config")
        .then(function (cfg) {
          if (cfg) reportConfigCache = cfg;
          return cfg || reportConfigCache;
        })
        .catch(function () {
          return reportConfigCache;
        });
    }

    /* Launch-offer ribbon — the slim strip shown where the unlock panel
     * would otherwise sit while the launch offer runs. The displayed price
     * always prefers the server's /config value over the page priceLabel. */
    function launchRibbonHtml(cfg) {
      var price = cfg && cfg.priceAed != null ? cfg.priceAed : config.priceLabel;
      var label = price && /^AED/i.test(String(price)) ? String(price) : "AED " + price;
      return (
        '<div class="assess-launch-ribbon" role="note">' +
        '<span class="assess-launch-tag">Launch offer</span>' +
        '<span class="assess-launch-copy">Full strategic report <b>FREE</b>' +
        " · regularly " + esc(label) + "</span>" +
        "</div>"
      );
    }
    function showLaunchRibbon(box, cfg) {
      box.innerHTML = launchRibbonHtml(cfg);
    }

    function renderUnlock(dims, total, band, opts) {
      var box = document.getElementById("assessUnlock");
      if (!box) return;
      var token = (opts && opts.token) || S.token;

      /* Launch offer: the full report is free for everyone. When config
       * says so, persist the unlock per token, show the ribbon where the
       * unlock panel would have sat, render the full report — and never
       * offer (or call) checkout/invoice. */
      function tryLaunchOffer(cfg) {
        if (!(cfg && cfg.launchOffer)) return false;
        if (token) markUnlocked(token);
        showLaunchRibbon(box, cfg);
        renderReport(dims, total, band, opts);
        return true;
      }

      var alreadyFull =
        (opts && opts.paid) || (token && isUnlocked(token));
      if (alreadyFull) {
        if (token) markUnlocked(token);
        renderReport(dims, total, band, opts);
        /* an already-unlocked or rehydrated report still carries the
         * ribbon while the launch offer runs */
        getReportConfig().then(function (cfg) {
          if (cfg && cfg.launchOffer) showLaunchRibbon(box, cfg);
        });
        return;
      }

      if (!token) {
        getReportConfig().then(function (cfg) {
          if (tryLaunchOffer(cfg)) return;
          box.innerHTML =
            '<div class="assess-unlock"><h2>The full breakdown</h2>' +
            "<p>We couldn't generate a shareable link for this report just now — no problem. " +
            "Your answers are safely with us and we'll email you the full " + esc(config.toolTitle || "report") + " shortly.</p></div>";
        });
        return;
      }

      box.innerHTML =
        '<div class="assess-unlock"><h2>Unlock the full report</h2>' +
        "<p>This free summary is the headline. The full report goes dimension by dimension — what your answers reveal, what to watch, and a prioritised 90-day roadmap.</p>" +
        '<ul class="assess-unlock-list">' +
        "<li>Band-by-band analysis of all " + config.dimensions.length + " dimensions</li>" +
        "<li>Prioritised recommendations, sorted by impact and effort</li>" +
        "<li>A 90-day roadmap in three phases</li>" +
        "<li>Benchmark context and methodology notes</li>" +
        "</ul>" +
        '<p class="assess-price-note" id="assessPriceNote">Checking availability…</p>' +
        '<div id="assessUnlockActions"></div>' +
        '<p class="assess-err" id="assessUnlockErr"></p></div>';

      var note = document.getElementById("assessPriceNote");
      var actions = document.getElementById("assessUnlockActions");
      var err = document.getElementById("assessUnlockErr");
      var showErr = function (msg) {
        err.textContent = msg;
        err.classList.add("show");
      };

      getReportConfig().then(function (cfg) {
          if (tryLaunchOffer(cfg)) return;
          if (!cfg) {
            /* config endpoint unreachable — fall back to invoice flow */
            note.textContent = "One-time purchase · we'll invoice you by email";
            var fallbackBtn = el('<button class="assess-btn assess-btn-coral" id="assessPayBtn">Get the full report — ' + esc(config.priceLabel || "AED —") + "</button>");
            actions.appendChild(fallbackBtn);
            fallbackBtn.addEventListener("click", function () {
              fallbackBtn.disabled = true;
              fetchJSON("/api/report/request-invoice", { method: "POST", body: { tool: config.tool, token: token } })
                .then(function () {
                  box.querySelector(".assess-unlock").innerHTML =
                    "<h2>Invoice on its way</h2><p>We'll email your invoice; your report unlocks on payment.</p>";
                })
                .catch(function () {
                  fallbackBtn.disabled = false;
                  showErr("Couldn't reach the server just now — please try again in a moment.");
                });
            });
            return;
          }
          var price = cfg && cfg.priceAed != null ? cfg.priceAed : config.priceLabel;
          var label = price && /^AED/i.test(String(price)) ? String(price) : "AED " + price;
          var paymentsOn = !!(cfg && cfg.paymentsEnabled);

          note.textContent = paymentsOn
            ? "One-time purchase · secure card checkout · report unlocks instantly"
            : "One-time purchase · we'll invoice you by email · report unlocks on payment";

          var btn = el('<button class="assess-btn assess-btn-coral" id="assessPayBtn">Get the full report — ' + esc(label) + "</button>");
          actions.appendChild(btn);

          var busy = function (on, txt) {
            btn.disabled = on;
            btn.textContent = on ? txt : "Get the full report — " + label;
          };

          btn.addEventListener("click", function () {
            err.classList.remove("show");
            busy(true, "One moment…");
            var endpoint = paymentsOn ? "/api/report/checkout" : "/api/report/request-invoice";
            fetchJSON(endpoint, { method: "POST", body: { tool: config.tool, token: token } })
              .then(function (d) {
                if (paymentsOn) {
                  if (d && d.url) {
                    global.location.href = d.url;
                    return;
                  }
                  throw Object.assign(new Error("checkout unavailable"), { status: 503 });
                }
                /* invoice flow */
                box.querySelector(".assess-unlock").innerHTML =
                  "<h2>Invoice on its way</h2>" +
                  "<p>We'll email your invoice; your report unlocks on payment. " +
                  "Keep the link to this page — or watch your inbox for the unlocked copy.</p>";
              })
              .catch(function (e) {
                busy(false);
                if (paymentsOn) {
                  /* checkout down (e.g. 503) — offer the invoice route */
                  showErr("Card checkout isn't available right now. You can request an invoice instead — your report unlocks on payment.");
                  if (!document.getElementById("assessInvoiceBtn")) {
                    var alt = el('<button class="assess-btn-ghost" id="assessInvoiceBtn" style="color:rgba(255,255,255,.8)">Request an invoice instead</button>');
                    actions.appendChild(alt);
                    alt.addEventListener("click", function () {
                      alt.disabled = true;
                      fetchJSON("/api/report/request-invoice", { method: "POST", body: { tool: config.tool, token: token } })
                        .then(function () {
                          box.querySelector(".assess-unlock").innerHTML =
                            "<h2>Invoice on its way</h2>" +
                            "<p>We'll email your invoice; your report unlocks on payment. " +
                            "Keep the link to this page — or watch your inbox for the unlocked copy.</p>";
                        })
                        .catch(function () {
                          alt.disabled = false;
                          showErr("Couldn't reach the server just now — please try again in a moment.");
                        });
                    });
                  }
                } else {
                  showErr("Couldn't reach the server just now — please try again in a moment.");
                }
              });
          });
      });
    }

    /* ------------------------------------------------------- full report */

    function renderReport(dims, total, band, opts) {
      var box = document.getElementById("assessReport");
      if (!box) return;
      var narr = config.narrative || {};
      var bandIdx = config.bands.indexOf(band);
      if (bandIdx < 0) bandIdx = 0;

      var dimsHtml = dims
        .map(function (dm) {
          var d = config.dimensions.filter(function (x) {
            return x.key === dm.key;
          })[0];
          if (!d) return "";
          var dBand = bandFor(config, dm.pct);
          var analysis = ((narr.analysis || {})[d.key] || {})[dBand.key] || "";
          var signals = ((narr.signals || {})[d.key] || {})[dBand.key] || "";

          /* watch-out is earned, not given: dimension below its threshold,
           * a configured low band, or a specifically risky chosen option. */
          var watchLines = [];
          var below = d.watchBelow != null ? d.watchBelow : config.watchBelowDefault;
          if (below != null && dm.pct < below && narr.watch && narr.watch[d.key])
            watchLines.push(narr.watch[d.key]);
          d.questions.forEach(function (q) {
            if (q.type !== "choice" || !q.options) return;
            var a = S.answers[q.id];
            q.options.forEach(function (o) {
              if (o.label === a && o.watch) watchLines.push(o.watch);
            });
          });

          var recs = dimRecs(d, dm.pct, dBand)
            .sort(function (a, b) {
              return recImpactRank(a) - recImpactRank(b) || recEffortRank(a) - recEffortRank(b);
            })
            .map(function (r) {
              return recCardHtml(r, null);
            })
            .join("");

          return (
            '<section class="assess-rdim">' +
            '<div class="assess-rdim-head"><h3>' + esc(d.label) + "</h3>" +
            '<div class="assess-rdim-score"><span class="assess-rdim-pct">' + dm.pct + "/100</span>" +
            '<span class="assess-chip band-' + bandIdxOf(dBand) + '">' + esc(dBand.label) + "</span></div></div>" +
            '<p data-ai-analysis="' + esc(d.key) + '">' + esc(analysis) + "</p>" +
            (signals
              ? "<h4>What's happening</h4><p data-ai-signals=\"" + esc(d.key) + "\">" + esc(signals) + "</p>"
              : "") +
            watchLines
              .map(function (w) {
                return (
                  '<div class="assess-watch">' +
                  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 15 14H1z" fill="none" stroke="#da3a22" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6v3.4" stroke="#da3a22" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.9" fill="#da3a22"/></svg>' +
                  "<p><b>Watch out</b>" + esc(w) + "</p></div>"
                );
              })
              .join("") +
            (recs ? "<h4>What to do about it</h4>" + recs : "") +
            "</section>"
          );
        })
        .join("");

      function bandIdxOf(b) {
        var i = config.bands.indexOf(b);
        return i < 0 ? 0 : i;
      }

      var phases = (config.roadmapPhases || [])
        .map(function (p, i) {
          return (
            '<div class="assess-phase"><div class="assess-phase-no">' + (i + 1) + "</div>" +
            "<div><h4>" + esc(p.title) + "</h4><p>" + esc(p.copy) + "</p></div></div>"
          );
        })
        .join("");

      var ctx = (config.context || [])
        .map(function (q) {
          var a = S.answers[q.id];
          if (a == null || a === "") return "";
          return '<div class="assess-ctx"><b>' + esc(q.label) + "</b><span>" + esc(a) + "</span></div>";
        })
        .join("");

      box.innerHTML =
        '<article class="assess-report" id="assess-report">' +
        '<div class="assess-report-head">' +
        '<div class="assess-step-no">Full report</div>' +
        '<div class="assess-report-score"><span class="assess-big">' + total + "</span>" +
        '<span class="assess-chip band-' + bandIdx + '">' + esc(band.label) + "</span></div>" +
        '<div class="assess-report-ai">' +
        '<span class="assess-ai-badge-slot" data-ai-badge></span>' +
        '<span class="assess-ai-note" data-ai-note style="display:none">Refining your analysis…</span>' +
        "</div>" +
        "<h1 style=\"margin-top:10px\">" + esc(config.title) + "</h1>" +
        (opts && opts.saved ? '<p class="assess-saved-note">Your saved report' + (opts.token ? " · " + esc(opts.token) : "") + "</p>" : "") +
        "</div>" +
        dimsHtml +
        '<div data-ai-cross></div>' +
        '<div class="assess-roadmap"><h2 style="margin-bottom:6px">Your first 90 days</h2>' + phases + "</div>" +
        (config.benchmark
          ? '<div class="assess-block"><h3>How this compares</h3><p>' + esc(config.benchmark) + "</p></div>"
          : "") +
        (config.methodology
          ? '<div class="assess-block assess-appendix"><h3>About this assessment</h3><p>' + esc(config.methodology) + "</p>" +
            (ctx ? '<h3 style="margin-top:16px">Your additional context</h3>' + ctx : "") +
            (config.appendixNote ? '<p style="margin-top:10px">' + esc(config.appendixNote) + "</p>" : "") +
            "</div>"
          : "") +
        '<div class="assess-report-cta"><h3>Want this done with you, not just read to you?</h3>' +
        "<p>Bring these results to a working session and we'll turn the roadmap into a plan with owners and dates — most teams leave with the first phase already scheduled.</p>" +
        (config.cta ? '<a class="assess-btn assess-btn-coral" href="' + esc(config.cta.href) + '">' + esc(config.cta.label) + "</a>" : "") +
        "</div>" +
        '<button class="assess-btn-ghost assess-print-btn" id="assessPrint">Print / save as PDF</button>' +
        "</article>";

      var printBtn = document.getElementById("assessPrint");
      if (printBtn)
        printBtn.addEventListener("click", function () {
          global.print();
        });
      aiApply();
      global.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* ---------------------------------------------------- rehydration */

    function rehydrate(token) {
      fetchJSON("/api/report/" + encodeURIComponent(config.tool) + "/" + encodeURIComponent(token))
        .then(function (d) {
          if (!d) {
            renderIntro();
            return;
          }
          /* server verdict first; the local unlock ledger is the fallback
           * for tokens that were already paid on another device */
          var paid = d.paid === true;
          if (paid) markUnlocked(token);
          else if (isUnlocked(token)) paid = true;
          if (d.contact) {
            Object.keys(d.contact).forEach(function (k) {
              S.answers[k] = d.contact[k];
            });
          }
          if (d.answers) S.answers = d.answers;
          renderSummary(d, { saved: true, token: token, paid: paid });
          var aiTotal = d.total != null ? d.total : score(config, d.answers || {}).total;
          composeAI(token, aiTotal, bandFor(config, aiTotal).key);
        })
        .catch(function () {
          /* server unreachable — re-render from the local snapshot if we
           * have one for this token, else start fresh */
          var snap = isUnlocked(token) ? getSnapshot(token) : null;
          if (snap) {
            renderSummary(snap, { saved: true, token: token, paid: true });
            composeAI(token, snap.total, snap.band);
          } else {
            renderIntro();
          }
        });
    }

    /* ----------------------------------------------------------- startup */

    var reportToken = urlParam("report");
    if (reportToken) {
      rehydrate(reportToken);
    } else {
      renderIntro();
    }

    return {
      config: config,
      state: S,
      rescore: function () {
        return score(config, S.answers);
      },
    };
  }

  /* ---------------------------------------------------------------- export */

  var api = {
    version: "1.0.0",
    mount: mount,
    score: score,
    bandFor: bandFor,
  };
  global.AssessEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
