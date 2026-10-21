/* ==========================================================================
   eHive — AssessEngine
   Shared client-side assessment engine for the standalone tool pages
   (brand-check + clarity-scorecard). Vanilla JS core; the PDF report
   builder imports pdf-lib + qrcode, which esbuild resolves from
   node_modules when bundling build:public (--bundle --format=iife).

   Public API
   ----------
   AssessEngine.mount(config)  — render a full assessment into #assess-root
   AssessEngine.score(config, answers)  — pure scoring → {dims,total,band}
   AssessEngine.bandFor(config, value)  — resolve a value to its band object
   AssessEngine.buildReportPdf(config, state) — A4 multi-page report
                                          → Promise<Uint8Array>. Pure:
                                          the caller decides which narrative
                                          (template vs AI-enhanced) goes in
                                          state.ai.

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
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

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

  /* ------------------------------------------------------- PDF report ----
   * Client-side report builder (pdf-lib + qrcode, bundled by build:public).
   * Design system mirrors assess.css tokens: navy #0b1526/#0f1c3a, coral
   * #da3a22, gold #b8862e, paper #faf8f2, ink #141312. Standard fonts only
   * (Helvetica / Helvetica-Bold) so text stays selectable and the file
   * stays small. Layout idiom (wrap helper, section boxes, chips) is ported
   * from api/lib/pdf-invoice.ts. */

  var PDF_A4_W = 595.28;
  var PDF_A4_H = 841.89;

  /* Strip control characters; everything else in the narrative copy is
   * WinAnsi-safe (curly quotes, dashes, middle dots, ™) which is the
   * encoding pdf-lib uses for the standard fonts. */
  function pdfClean(s) {
    var str = String(s == null ? "" : s);
    str = str.replace(
      /[→⇒←↔↑↓✓✔✗✘₹]/g,
      function (ch) {
        switch (ch) {
          case "→": case "⇒": return "->";
          case "←": return "<-";
          case "↔": return "<->";
          case "↑": return "up";
          case "↓": return "down";
          case "✓": case "✔": return "+";
          case "✗": case "✘": return "x";
          case "₹": return "Rs";
          default: return "";
        }
      },
    );
    return str
      .replace(/[\t\n\r]+/g, " ")
      .replace(/[^\x20-\x7e\x80-\xff]/g, "");
  }

  function pdfWrap(text, font, size, maxWidth) {
    var words = pdfClean(text).split(/\s+/);
    var lines = [];
    var cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (font.widthOfTextAtSize(test, size) <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = words[i];
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  }

  /* Aurora product names take ™ on first mention (report-knowledge.md). */
  var PDF_TRADEMARKS = [
    [/Clarity Sprint(?!™)/g, "Clarity Sprint™"],
    [/Strategy Sprint(?!™)/g, "Strategy Sprint™"],
    [/Gap\s*Navigator(?!™)/g, "Gap Navigator™"],
    [/Momentum90(?!™)/g, "Momentum90™"],
    [/OpsBlueprint(?!™)/g, "OpsBlueprint™"],
    [/Brand\s*3D(?!™)/g, "Brand3D™"],
    [/Founder Mentoring(?!™)/g, "Founder Mentoring™"],
  ];
  function pdfTrademark(s) {
    var out = String(s == null ? "" : s);
    for (var i = 0; i < PDF_TRADEMARKS.length; i++) {
      out = out.replace(PDF_TRADEMARKS[i][0], PDF_TRADEMARKS[i][1]);
    }
    return out;
  }

  /* Cover title from the page title: "The eHive Brand Diagnostic" →
   * "Brand Diagnostic Report"; "The eHive Business Clarity Scorecard" →
   * "Business Clarity Report". */
  function pdfReportTitle(config) {
    var t = String(config.title || "Assessment").replace(/^The\s+eHive\s+/i, "");
    if (/scorecard\s*$/i.test(t)) t = t.replace(/scorecard\s*$/i, "Report");
    else if (!/report\s*$/i.test(t)) t += " Report";
    return t;
  }

  /* Recommendation selection mirrors the on-screen dimRecs/allRecs:
   * band-locked recs only in their band, min-threshold recs above their
   * floor, sorted impact-high first then effort-low first. */
  function pdfRecs(config, dims) {
    var narr = config.narrative || {};
    var out = [];
    dims.forEach(function (dm) {
      var band = bandFor(config, dm.pct);
      ((narr.recommendations || {})[dm.key] || []).forEach(function (r) {
        var ok =
          r.bandKey != null
            ? r.bandKey === band.key
            : dm.pct >= (r.min != null ? r.min : 0);
        if (ok) out.push({ dim: dm, rec: r });
      });
    });
    function ri(r) {
      return r.impact === "high" ? 0 : 1;
    }
    function re(r) {
      return r.effort === "low" ? 0 : 1;
    }
    out.sort(function (a, b) {
      return ri(a.rec) - ri(b.rec) || re(a.rec) - re(b.rec);
    });
    return out;
  }

  function pdfProductForHref(href) {
    var m = /[?&]product=([a-z0-9-]+)/i.exec(href || "");
    if (!m) return null;
    var map = {
      "brand-3d": "Brand3D™",
      "clarity-sprint": "Clarity Sprint™",
      "strategy-sprint": "Strategy Sprint™",
      opsblueprint: "OpsBlueprint™",
      gapnavigator: "Gap Navigator™",
      momentum90: "Momentum90™",
    };
    return map[m[1].toLowerCase()] || null;
  }

  function pdfAbsoluteUrl(href) {
    try {
      return new URL(href, global.location.href).toString();
    } catch (e) {
      return "https://www.ehiveglobal.com/" + String(href || "").replace(/^\/+/, "");
    }
  }

  async function buildReportPdf(config, state) {
    state = state || {};
    var dims = state.dims || [];
    var total = state.total != null ? Number(state.total) : 0;
    var band = state.band || bandFor(config, total);
    var ai = state.ai || null;
    var answers = state.answers || {};
    var narr = config.narrative || {};
    var toolTitle = config.toolTitle || config.title || "Assessment";
    var title = pdfReportTitle(config);
    var name = pdfClean(answers.name || answers.company || "").trim();
    var dateStr = new Date().toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    /* ---- design tokens ---- */
    var NAVY = rgb(11 / 255, 21 / 255, 38 / 255); // #0b1526
    var NAVY_MID = rgb(30 / 255, 49 / 255, 87 / 255); // #1e3157
    var NAVY_LINE = rgb(22 / 255, 38 / 255, 76 / 255); // #16264c
    var CORAL = rgb(218 / 255, 58 / 255, 34 / 255); // #da3a22
    var GOLD = rgb(184 / 255, 134 / 255, 46 / 255); // #b8862e
    var GOLD_DARK = rgb(138 / 255, 106 / 255, 29 / 255); // #8a6a1d
    var PAPER = rgb(250 / 255, 248 / 255, 242 / 255); // #faf8f2
    var PANEL = rgb(243 / 255, 241 / 255, 234 / 255); // #f3f1ea
    var CORAL_SOFT = rgb(253 / 255, 240 / 255, 236 / 255);
    var GOLD_SOFT = rgb(245 / 255, 234 / 255, 209 / 255);
    var NAVY_SOFT = rgb(226 / 255, 233 / 255, 245 / 255);
    var INK = rgb(20 / 255, 19 / 255, 18 / 255); // #141312
    var BODY = rgb(56 / 255, 54 / 255, 49 / 255);
    var GREY = rgb(95 / 255, 92 / 255, 83 / 255); // #5f5c53
    var LINE = rgb(228 / 255, 222 / 255, 207 / 255); // #e4decf
    var WHITE = rgb(1, 1, 1);
    var MIST = rgb(0.62, 0.67, 0.76); // muted light blue-grey on navy
    var FOG = rgb(0.82, 0.86, 0.94); // brighter muted on navy

    /* ---- geometry ---- */
    var W = PDF_A4_W;
    var H = PDF_A4_H;
    var MARGIN = 46; // 40pt+ outer margins
    var CW = W - MARGIN * 2;
    var TOP = H - 66;
    var BOT = 72; // footer zone sits below this

    var pdfDoc = await PDFDocument.create();
    var bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    var reg = await pdfDoc.embedFont(StandardFonts.Helvetica);

    var page = null;
    var y = 0;
    var pageNo = 0;

    /* dark pages (covers) skip the running head — the full-bleed navy is
     * painted over the whole sheet anyway. */
    function newPage(dark) {
      page = pdfDoc.addPage([W, H]);
      pageNo += 1;
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
      y = TOP;
      if (!dark && pageNo > 1) {
        page.drawText("eHive", { x: MARGIN, y: H - 38, size: 10.5, font: bold, color: NAVY });
        var wcW = reg.widthOfTextAtSize("Circle", 10.5);
        page.drawText("Circle", { x: MARGIN + bold.widthOfTextAtSize("eHive", 10.5) + 3, y: H - 38, size: 10.5, font: reg, color: GOLD_DARK });
        var rt = String(toolTitle);
        page.drawText(rt, { x: W - MARGIN - reg.widthOfTextAtSize(rt, 8), y: H - 37, size: 8, font: reg, color: GREY });
        page.drawRectangle({ x: MARGIN, y: H - 46, width: CW, height: 0.8, color: LINE });
        page.drawRectangle({ x: MARGIN, y: H - 46, width: 30, height: 0.8, color: GOLD });
      }
    }
    function need(h) {
      if (y - h < BOT) newPage();
    }
    function hexAt(cx, cy, r, color, thickness) {
      var pts = [];
      for (var i = 0; i < 6; i++) {
        var a = Math.PI / 2 + (Math.PI / 3) * i; // pointy-top hexagon
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      for (i = 0; i < 6; i++) {
        page.drawLine({ start: pts[i], end: pts[(i + 1) % 6], thickness: thickness, color: color });
      }
    }
    function para(text, opts) {
      opts = opts || {};
      var font = opts.font || reg;
      var size = opts.size || 10.5;
      var leading = opts.leading || 14;
      var color = opts.color || BODY;
      var maxWidth = opts.maxWidth || CW;
      var after = opts.after == null ? 8 : opts.after;
      var lines = pdfWrap(text, font, size, maxWidth);
      need(lines.length * leading + after);
      var x = opts.x == null ? MARGIN : opts.x;
      for (var i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: x, y: y - size, size: size, font: font, color: color });
        y -= leading;
      }
      y -= after;
      return lines.length;
    }
    function eyebrow(t, color) {
      need(22);
      page.drawText(String(t).toUpperCase(), {
        x: MARGIN,
        y: y - 8,
        size: 7.5,
        font: bold,
        color: color || CORAL,
        characterSpacing: 1.6,
      });
      y -= 15;
    }
    /* Section heading: 16pt bold navy under a small-caps eyebrow, with a
     * gold tick. need(88) guarantees the heading never orphans at the
     * bottom of a page — there's always room for it plus body copy. */
    function sectionHead(eb, t) {
      need(92);
      eyebrow(eb);
      var tl = pdfWrap(t, bold, 16, CW);
      for (var i = 0; i < tl.length; i++) {
        page.drawText(tl[i], { x: MARGIN, y: y - 16, size: 16, font: bold, color: NAVY });
        y -= 20;
      }
      y -= 6;
      page.drawRectangle({ x: MARGIN, y: y, width: 30, height: 2.2, color: GOLD });
      y -= 14;
    }
    function subLabel(t) {
      need(44); // label + at least one body line stay together
      page.drawText(String(t).toUpperCase(), {
        x: MARGIN,
        y: y - 8,
        size: 8,
        font: bold,
        color: GOLD_DARK,
        characterSpacing: 1.5,
      });
      y -= 18;
    }
    function chip(t, idx, x, yTop) {
      var styles = [
        { bg: CORAL_SOFT, fg: CORAL },
        { bg: GOLD_SOFT, fg: GOLD_DARK },
        { bg: NAVY_SOFT, fg: NAVY_MID },
        { bg: NAVY, fg: WHITE },
      ];
      var c = styles[Math.max(0, Math.min(styles.length - 1, idx))];
      var txt = String(t || "").toUpperCase();
      var w = bold.widthOfTextAtSize(txt, 7.5) + 16;
      var h = 15;
      page.drawRectangle({ x: x, y: yTop - h, width: w, height: h, color: c.bg });
      page.drawText(txt, {
        x: x + 8,
        y: yTop - h + 4.5,
        size: 7.5,
        font: bold,
        color: c.fg,
        characterSpacing: 0.5,
      });
      return w;
    }
    function bandIdxOf(b) {
      var i = ((config.bands || []).slice().sort(function (a, c) {
        return a.min - c.min;
      })).indexOf(b);
      return i < 0 ? 0 : i;
    }
    function barColor(idx) {
      return [CORAL, GOLD, NAVY_MID, NAVY][Math.max(0, Math.min(3, idx))];
    }
    function bullet(t) {
      var lines = pdfWrap(pdfTrademark(t), reg, 10.5, CW - 24);
      need(lines.length * 14.5 + 8);
      hexAt(MARGIN + 6, y - 9, 4.2, GOLD, 1.6);
      for (var i = 0; i < lines.length; i++) {
        page.drawText(lines[i], { x: MARGIN + 22, y: y - 12.5, size: 10.5, font: reg, color: BODY });
        y -= 14.5;
      }
      y -= 7;
    }

    /* ---- booking link + QR (degrades to no-QR when canvas is missing,
     * e.g. server-side or test environments) ---- */
    var recs = pdfRecs(config, dims);
    var top = recs[0] || null;
    var bookHref =
      (top && top.rec.cta && top.rec.cta.href) || (config.cta && config.cta.href) || "";
    if (bookHref && bookHref.indexOf("src=pdf") === -1) {
      bookHref += (bookHref.indexOf("?") > -1 ? "&" : "?") + "src=pdf";
    }
    var bookUrl = pdfAbsoluteUrl(bookHref);
    var qrImage = null;
    try {
      var dataUrl = await QRCode.toDataURL(bookUrl, {
        width: 520,
        margin: 1,
        color: { dark: "#0b1526", light: "#ffffff" },
      });
      var b64 = String(dataUrl).split(",")[1] || "";
      var binStr =
        typeof atob === "function"
          ? atob(b64)
          : Buffer.from(b64, "base64").toString("binary");
      var png = new Uint8Array(binStr.length);
      for (var bi = 0; bi < binStr.length; bi++) png[bi] = binStr.charCodeAt(bi);
      qrImage = await pdfDoc.embedPng(png);
    } catch (qrErr) {
      qrImage = null;
    }

    /* ================= 1 · cover — full-bleed navy */
    (function cover() {
      newPage(true);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: NAVY });
      hexAt(W - 24, 118, 170, NAVY_LINE, 2);
      hexAt(W - 24, 118, 124, NAVY_LINE, 1);
      hexAt(52, H - 84, 34, NAVY_LINE, 1.2);

      var cx = W / 2;
      hexAt(cx, H - 158, 30, GOLD, 2.4);
      page.drawEllipse({ x: cx, y: H - 158, xScale: 4, yScale: 4, color: GOLD });

      var wmW = bold.widthOfTextAtSize("eHive", 30);
      var wcW = reg.widthOfTextAtSize("Circle", 30);
      page.drawText("eHive", { x: cx - (wmW + 8 + wcW) / 2, y: H - 250, size: 30, font: bold, color: WHITE });
      page.drawText("Circle", { x: cx - (wmW + 8 + wcW) / 2 + wmW + 8, y: H - 250, size: 30, font: reg, color: GOLD });

      var tW = bold.widthOfTextAtSize(title, 17);
      page.drawText(title, { x: (W - tW) / 2, y: H - 294, size: 17, font: bold, color: FOG });

      var py = H - 348;
      if (name) {
        var pf = "PREPARED FOR";
        page.drawText(pf, { x: cx - reg.widthOfTextAtSize(pf, 8) / 2, y: py, size: 8, font: bold, color: GOLD, characterSpacing: 1.8 });
        page.drawText(name, { x: cx - bold.widthOfTextAtSize(name, 15) / 2, y: py - 23, size: 15, font: bold, color: WHITE });
        py -= 23;
      }
      page.drawText(dateStr, { x: cx - reg.widthOfTextAtSize(dateStr, 10.5) / 2, y: py - 19, size: 10.5, font: reg, color: MIST });

      var sc = String(total);
      var scW = bold.widthOfTextAtSize(sc, 96);
      page.drawText(sc, { x: cx - scW / 2 - 22, y: 292, size: 96, font: bold, color: WHITE });
      page.drawText("/100", { x: cx + scW / 2 - 20, y: 266, size: 17, font: reg, color: MIST });

      var gt = String(band.label).toUpperCase();
      var gw = bold.widthOfTextAtSize(gt, 10) + 28;
      page.drawRectangle({ x: cx - gw / 2, y: 226, width: gw, height: 24, borderColor: GOLD, borderWidth: 1.4 });
      page.drawText(gt, { x: cx - gw / 2 + 14, y: 233, size: 10, font: bold, color: GOLD, characterSpacing: 1.6 });

      var hy = 198;
      var hl = pdfWrap(band.headline, reg, 13, W - 200);
      for (var i = 0; i < hl.length; i++) {
        page.drawText(hl[i], { x: (W - reg.widthOfTextAtSize(hl[i], 13)) / 2, y: hy - 13, size: 13, font: reg, color: rgb(0.88, 0.9, 0.95) });
        hy -= 18;
      }
      page.drawRectangle({ x: cx - 45, y: hy - 14, width: 90, height: 1.6, color: GOLD });

      var cf = "Private & confidential · ehiveglobal.com";
      page.drawText(cf, { x: cx - reg.widthOfTextAtSize(cf, 8.5) / 2, y: 44, size: 8.5, font: reg, color: rgb(0.5, 0.55, 0.65) });
    })();

    /* ================= 2 · executive summary */
    (function execSummary() {
      newPage();
      sectionHead("Executive summary", band.headline || "Your result");
      para(band.copy, { size: 11, leading: 15.5, color: INK, after: 10 });

      var sorted = dims.slice().sort(function (a, b) {
        return b.pct - a.pct;
      });
      var strongest = sorted[0];
      var weakest = sorted[sorted.length - 1];
      var exec;
      if (ai && ai.executiveSummary) {
        exec = ai.executiveSummary;
      } else {
        exec =
          "Your strongest area right now is " + (strongest ? strongest.label : "—") +
          " at " + (strongest ? strongest.pct : 0) +
          "%. The clearest gap is " + (weakest ? weakest.label : "—") +
          " at " + (weakest ? weakest.pct : 0) +
          "% — and in our experience that's where the fastest, cheapest gains usually sit for a business at this stage.";
      }
      para(pdfTrademark(exec), { size: 10.5, leading: 14.5, after: 12 });

      subLabel("What this means for you");
      bullet("Your strongest area is " + (strongest ? strongest.label : "—") + " (" + (strongest ? strongest.pct : 0) + "/100) — protect it deliberately while you work the rest.");
      bullet("The clearest gap is " + (weakest ? weakest.label : "—") + " (" + (weakest ? weakest.pct : 0) + "/100) — that's where the fastest, cheapest gains sit.");
      bullet("The 90-day roadmap at the end of this report sequences the fixes — one phase at a time, with one owner per fix.");
    })();

    /* ================= 3 · how you scored */
    (function scorecard() {
      sectionHead("Your scorecard", "How you scored");
      dims.forEach(function (dm) {
        var dBand = bandFor(config, dm.pct);
        var idx = bandIdxOf(dBand);
        var label = dm.short || dm.label;
        var chipT = String(dBand.label).toUpperCase();
        var chipW = bold.widthOfTextAtSize(chipT, 7.5) + 16;
        need(44);
        page.drawText(label, { x: MARGIN, y: y - 11, size: 10.5, font: bold, color: INK });
        var valT = dm.pct + "/100";
        page.drawText(valT, {
          x: W - MARGIN - chipW - 12 - bold.widthOfTextAtSize(valT, 10.5),
          y: y - 11,
          size: 10.5,
          font: bold,
          color: NAVY,
        });
        chip(dBand.label, idx, W - MARGIN - chipW, y + 2);
        var trackY = y - 27;
        page.drawRectangle({ x: MARGIN, y: trackY, width: CW, height: 9, color: PANEL });
        page.drawRectangle({
          x: MARGIN,
          y: trackY,
          width: Math.max(2, (CW * dm.pct) / 100),
          height: 9,
          color: barColor(idx),
        });
        y -= 44;
      });
      if (config.benchmark) {
        var blines = pdfWrap(config.benchmark, reg, 9.5, CW - 28);
        var bh = 14 + 14 + blines.length * 13 + 14;
        need(bh + 10);
        y -= 4;
        page.drawRectangle({ x: MARGIN, y: y - bh, width: CW, height: bh, color: PANEL });
        page.drawRectangle({ x: MARGIN, y: y - bh, width: 3, height: bh, color: GOLD });
        page.drawText("BENCHMARK", { x: MARGIN + 16, y: y - 18, size: 7.5, font: bold, color: GOLD_DARK, characterSpacing: 1.4 });
        var by = y - 32;
        blines.forEach(function (l) {
          page.drawText(l, { x: MARGIN + 16, y: by - 9.5, size: 9.5, font: reg, color: GREY });
          by -= 13;
        });
        y -= bh + 12;
      }
    })();

    /* ================= 4 · dimension deep-dives */
    function watchBox(lines) {
      var innerW = CW - 36;
      var heights = lines.map(function (t) {
        return pdfWrap(t, reg, 10, innerW).length;
      });
      var h = 24 + heights.reduce(function (a, n) {
        return a + n * 13.5 + 6;
      }, 0) + 6;
      need(Math.min(h, TOP - BOT));
      page.drawRectangle({ x: MARGIN, y: y - h, width: CW, height: h, color: CORAL_SOFT });
      page.drawRectangle({ x: MARGIN, y: y - h, width: 3, height: h, color: CORAL });
      var iy = y - 19;
      page.drawText("WATCH OUT", { x: MARGIN + 16, y: iy, size: 7.5, font: bold, color: CORAL, characterSpacing: 1.5 });
      iy -= 17;
      lines.forEach(function (t) {
        pdfWrap(t, reg, 10, innerW).forEach(function (l) {
          page.drawText(l, { x: MARGIN + 16, y: iy - 10, size: 10, font: reg, color: INK });
          iy -= 13.5;
        });
        iy -= 6;
      });
      y -= h + 12;
    }

    (function deepDives() {
      sectionHead("The detail", "Dimension by dimension");
      dims.forEach(function (dm) {
        var d = null;
        for (var i = 0; i < (config.dimensions || []).length; i++) {
          if (config.dimensions[i].key === dm.key) d = config.dimensions[i];
        }
        if (!d) return;
        var dBand = bandFor(config, dm.pct);
        var idx = bandIdxOf(dBand);
        var aiDim = (ai && ai.dimensions && ai.dimensions[dm.key]) || {};
        var analysis = aiDim.analysis || ((narr.analysis || {})[dm.key] || {})[dBand.key] || "";
        var signals = aiDim.signals || ((narr.signals || {})[dm.key] || {})[dBand.key] || "";
        var watch = [];
        var below = d.watchBelow != null ? d.watchBelow : config.watchBelowDefault;
        if (below != null && dm.pct < below && narr.watch && narr.watch[dm.key]) {
          watch.push(narr.watch[dm.key]);
        }
        (d.questions || []).forEach(function (q) {
          if (q.type !== "choice" || !q.options) return;
          var a = answers[q.id];
          q.options.forEach(function (o) {
            if (o.label === a && o.watch) watch.push(o.watch);
          });
        });

        /* keep-together: if the whole block fits on one page, it starts on
         * one page; if it's taller than a page it flows with sub-heading
         * orphan guards instead. */
        var labelLines = pdfWrap(d.label, bold, 13, CW - 170);
        var aLines = analysis ? pdfWrap(pdfTrademark(analysis), reg, 10.5, CW).length : 0;
        var sLines = signals ? pdfWrap(pdfTrademark(signals), reg, 10.5, CW).length : 0;
        var est =
          labelLines.length * 17 + 16 +
          (aLines ? 22 + aLines * 14.5 : 0) +
          (sLines ? 22 + sLines * 14.5 : 0) +
          (watch.length ? 44 + watch.length * 14 : 0) + 24;
        need(Math.min(est, TOP - BOT));

        var chipT = String(dBand.label).toUpperCase();
        var chipW = bold.widthOfTextAtSize(chipT, 7.5) + 16;
        var scoreT = dm.pct + "/100";
        for (i = 0; i < labelLines.length; i++) {
          page.drawText(labelLines[i], { x: MARGIN, y: y - 13 - i * 15, size: 13, font: bold, color: NAVY });
        }
        chip(dBand.label, idx, W - MARGIN - chipW, y + 2);
        page.drawText(scoreT, {
          x: W - MARGIN - chipW - 12 - bold.widthOfTextAtSize(scoreT, 11),
          y: y - 12,
          size: 11,
          font: bold,
          color: NAVY,
        });
        y -= labelLines.length * 16 + 6;
        page.drawRectangle({ x: MARGIN, y: y, width: CW, height: 0.8, color: LINE });
        y -= 12;

        if (analysis) {
          subLabel("Analysis");
          para(pdfTrademark(analysis), { size: 10.5, leading: 14.5, after: 8 });
        }
        if (signals) {
          subLabel("What's happening");
          para(pdfTrademark(signals), { size: 10.5, leading: 14.5, color: GREY, after: 8 });
        }
        if (watch.length) watchBox(watch.map(pdfTrademark));
        y -= 12;
      });
    })();

    /* ================= 5 · cross-cutting insights (AI narrative only) */
    (function crossCutting() {
      if (!ai) return;
      if (!((ai.crossInsights && ai.crossInsights.length) || ai.priorities)) return;
      sectionHead("Across the dimensions", "Cross-cutting insights");
      (ai.crossInsights || []).forEach(bullet);
      if (ai.priorities) {
        subLabel("Where to focus first");
        para(pdfTrademark(ai.priorities), { size: 10.5, leading: 14.5, after: 8 });
      }
    })();

    /* ================= 6 · 90-day roadmap */
    (function roadmap() {
      var phases = config.roadmapPhases || [];
      if (!phases.length) return;
      sectionHead("Your roadmap", "Your first 90 days");
      var gap = 14;
      var bw = (CW - gap * (phases.length - 1)) / phases.length;
      var boxes = phases.map(function (p) {
        return {
          tl: pdfWrap(p.title, bold, 9.5, bw - 24),
          cl: pdfWrap(p.copy, reg, 8.5, bw - 24),
        };
      });
      var bh = 0;
      boxes.forEach(function (b) {
        bh = Math.max(bh, 48 + b.tl.length * 12 + 6 + b.cl.length * 11.5);
      });
      need(bh + 20);
      boxes.forEach(function (b, i) {
        var x = MARGIN + i * (bw + gap);
        page.drawRectangle({ x: x, y: y - bh, width: bw, height: bh, color: PANEL });
        page.drawRectangle({ x: x, y: y - 3, width: bw, height: 3, color: GOLD });
        page.drawText("0" + (i + 1), { x: x + 12, y: y - 24, size: 13, font: bold, color: CORAL });
        var ty = y - 42;
        b.tl.forEach(function (l) {
          page.drawText(l, { x: x + 12, y: ty - 9.5, size: 9.5, font: bold, color: NAVY });
          ty -= 12;
        });
        ty -= 5;
        b.cl.forEach(function (l) {
          page.drawText(l, { x: x + 12, y: ty - 8.5, size: 8.5, font: reg, color: GREY });
          ty -= 11.5;
        });
      });
      y -= bh + 26;
    })();

    /* ================= 7 · recommended next step — the conversion page.
     * Deliberately starts on a fresh page so it stands alone as a sell:
     * the routed product with ™, the why, the discovery-call promise and a
     * scannable booking QR. No prices, per the method guardrails. */
    (function nextStep() {
      var product =
        pdfProductForHref(bookHref) || (config.cta && config.cta.label) || "Discovery call";
      var why = top
        ? pdfTrademark(top.rec.why)
        : "Bring these results to a working session and we'll turn the roadmap into a plan with owners and dates — most teams leave with the first phase already scheduled.";

      newPage();
      sectionHead("Recommended next step", "One call. One clear priority.");
      page.drawText(product, { x: MARGIN, y: y - 24, size: 24, font: bold, color: NAVY });
      y -= 36;
      page.drawRectangle({ x: MARGIN, y: y, width: 40, height: 2.4, color: GOLD });
      y -= 14;

      if (top) {
        var ix = MARGIN;
        var impT = "IMPACT: " + String(top.rec.impact || "").toUpperCase();
        var iw = bold.widthOfTextAtSize(impT, 7.5) + 14;
        page.drawRectangle({
          x: ix,
          y: y - 15,
          width: iw,
          height: 15,
          color: top.rec.impact === "high" ? CORAL : NAVY_MID,
        });
        page.drawText(impT, { x: ix + 7, y: y - 10.5, size: 7.5, font: bold, color: WHITE });
        ix += iw + 8;
        var effT = "EFFORT: " + String(top.rec.effort || "").toUpperCase();
        var ew = bold.widthOfTextAtSize(effT, 7.5) + 14;
        page.drawRectangle({ x: ix, y: y - 15, width: ew, height: 15, color: GOLD_SOFT });
        page.drawText(effT, { x: ix + 7, y: y - 10.5, size: 7.5, font: bold, color: GOLD_DARK });
        y -= 28;
      }

      para(why, { size: 11, leading: 15.5, color: INK, after: 16 });

      var panelH = 176;
      need(panelH + 70);
      page.drawRectangle({ x: MARGIN, y: y - panelH, width: CW, height: panelH, color: NAVY });
      page.drawRectangle({ x: MARGIN, y: y - panelH, width: 3.5, height: panelH, color: GOLD });

      var textW = qrImage ? CW - 132 - 52 : CW - 44;
      page.drawText("WHAT HAPPENS ON YOUR DISCOVERY CALL", {
        x: MARGIN + 22,
        y: y - 30,
        size: 8.5,
        font: bold,
        color: GOLD,
        characterSpacing: 1.2,
      });
      var cy2 = y - 56;
      [
        "We'll walk through your report live.",
        "You'll leave with one clear priority whether or not we engage.",
        "No pitch, no pressure.",
      ].forEach(function (b) {
        hexAt(MARGIN + 26, cy2 - 6, 3.6, GOLD, 1.2);
        pdfWrap(b, reg, 10, textW - 20).forEach(function (l) {
          page.drawText(l, { x: MARGIN + 40, y: cy2 - 9, size: 10, font: reg, color: WHITE });
          cy2 -= 13.5;
        });
        cy2 -= 9;
      });

      if (qrImage) {
        var qs = 132;
        var qx = W - MARGIN - 16 - qs;
        var qy = y - (panelH + qs) / 2 + 4;
        page.drawRectangle({ x: qx - 6, y: qy - 6, width: qs + 12, height: qs + 12, color: WHITE });
        page.drawImage(qrImage, { x: qx, y: qy, width: qs, height: qs });
        var cap = "Scan to book your discovery call";
        page.drawText(cap, {
          x: qx + qs / 2 - reg.widthOfTextAtSize(cap, 7.5) / 2,
          y: qy - 18,
          size: 7.5,
          font: reg,
          color: rgb(0.75, 0.78, 0.86),
        });
      } else {
        /* No canvas (server/test env): the URL takes the QR's place. */
        page.drawText("BOOK YOUR CALL", { x: W - MARGIN - 180, y: y - panelH / 2 + 20, size: 7.5, font: bold, color: GOLD, characterSpacing: 1.2 });
        var uy = y - panelH / 2 + 4;
        pdfWrap(bookUrl, reg, 8, 170).forEach(function (l) {
          page.drawText(l, { x: W - MARGIN - 180, y: uy, size: 8, font: reg, color: WHITE });
          uy -= 11;
        });
      }
      y -= panelH + 20;

      para("Book directly: " + bookUrl, { size: 9, leading: 12, color: GREY, after: 3 });
      para(
        "Questions, or prefer email? " + (config.contactEmail || "info@ehiveglobal.com"),
        { size: 9, leading: 12, color: GREY, after: 0 }
      );
    })();

    /* ================= 8 · methodology + about eHive */
    (function aboutBlock() {
      sectionHead("Methodology", "About this assessment");
      if (config.methodology) {
        para(config.methodology, { size: 9.5, leading: 13.5, color: GREY, after: 16 });
      }
      need(96);
      page.drawRectangle({ x: MARGIN, y: y, width: 30, height: 2.2, color: GOLD });
      y -= 20;
      page.drawText("Confusion is expensive. Clarity is profitable.", {
        x: MARGIN,
        y: y - 14,
        size: 12.5,
        font: bold,
        color: NAVY,
      });
      y -= 32;
      page.drawText("One product, three verticals — Business Setup · Consulting · eHive Circle.", {
        x: MARGIN,
        y: y - 10,
        size: 9.5,
        font: reg,
        color: GREY,
      });
      y -= 24;
      var contact = (config.contactEmail || "info@ehiveglobal.com") + "  ·  ehiveglobal.com";
      page.drawText(contact, { x: MARGIN, y: y - 10, size: 9.5, font: bold, color: NAVY_MID });
    })();

    /* ================= appendix · the founder's own responses. The
     * methodology promises the open-text answers appear in the report and
     * are read by a strategist; the scored answers make the PDF forwardable
     * to a co-founder as a standalone record of the diagnostic. */
    function pdfHumanAnswer(q, a) {
      if (a == null || a === "") return "—";
      if (q.type === "scale") {
        var lbl = a === 1 ? q.lo || "Not at all" : a === 5 ? q.hi || "Completely true" : "";
        return a + " / 5" + (lbl ? " — " + lbl : "");
      }
      return String(a);
    }
    (function appendix() {
      var ctxRows = (config.context || []).filter(function (q) {
        var a = answers[q.id];
        return a != null && a !== "";
      });
      if (!ctxRows.length && !dims.length) return;
      newPage();
      sectionHead("Appendix", "Your responses, question by question");

      if (ctxRows.length) {
        subLabel("In your own words");
        ctxRows.forEach(function (q) {
          page.drawText(q.label, { x: MARGIN, y: y - 9.5, size: 9.5, font: bold, color: NAVY });
          y -= 20;
          para(pdfClean(answers[q.id]), { size: 9.5, leading: 13, color: GREY, after: 10 });
        });
      }

      dims.forEach(function (dm) {
        var d = null;
        for (var i = 0; i < (config.dimensions || []).length; i++) {
          if (config.dimensions[i].key === dm.key) d = config.dimensions[i];
        }
        if (!d) return;
        need(64);
        page.drawText(d.label, { x: MARGIN, y: y - 10, size: 10, font: bold, color: NAVY });
        y -= 20;
        page.drawRectangle({ x: MARGIN, y: y + 6, width: CW, height: 0.6, color: LINE });
        (d.questions || []).forEach(function (q) {
          var ql = pdfWrap(q.label, reg, 8.5, CW - 160);
          var al = pdfWrap(pdfHumanAnswer(q, answers[q.id]), bold, 8.5, 150);
          var rh = Math.max(ql.length, al.length) * 11 + 8;
          need(rh);
          var rowTop = y;
          for (var qi = 0; qi < ql.length; qi++) {
            page.drawText(ql[qi], { x: MARGIN, y: rowTop - 8.5, size: 8.5, font: reg, color: GREY });
            rowTop -= 11;
          }
          var ansTop = y;
          for (var ai = 0; ai < al.length; ai++) {
            page.drawText(al[ai], { x: W - MARGIN - 150, y: ansTop - 8.5, size: 8.5, font: bold, color: NAVY_MID });
            ansTop -= 11;
          }
          y -= rh;
        });
        y -= 14;
      });
    })();

    /* ================= back cover — full-bleed navy mirror of the cover */
    (function backCover() {
      newPage(true);
      page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: NAVY });
      hexAt(40, 90, 80, NAVY_LINE, 1.4);
      hexAt(W - 60, H - 90, 100, NAVY_LINE, 1.6);
      var cx = W / 2;
      hexAt(cx, H - 210, 30, GOLD, 2.4);
      page.drawEllipse({ x: cx, y: H - 210, xScale: 4, yScale: 4, color: GOLD });
      var wmW = bold.widthOfTextAtSize("eHive", 24);
      var wcW = reg.widthOfTextAtSize("Circle", 24);
      page.drawText("eHive", { x: cx - (wmW + 7 + wcW) / 2, y: H - 286, size: 24, font: bold, color: WHITE });
      page.drawText("Circle", { x: cx - (wmW + 7 + wcW) / 2 + wmW + 7, y: H - 286, size: 24, font: reg, color: GOLD });
      page.drawRectangle({ x: cx - 45, y: H - 322, width: 90, height: 1.6, color: GOLD });

      var tag = "Confusion is expensive. Clarity is profitable.";
      page.drawText(tag, { x: cx - bold.widthOfTextAtSize(tag, 14) / 2, y: H - 420, size: 14, font: bold, color: WHITE });
      var vt = "ONE PRODUCT, THREE VERTICALS";
      page.drawText(vt, { x: cx - bold.widthOfTextAtSize(vt, 8) / 2, y: H - 470, size: 8, font: bold, color: GOLD, characterSpacing: 1.8 });
      var vs = "Business Setup  ·  Consulting  ·  eHive Circle";
      page.drawText(vs, { x: cx - reg.widthOfTextAtSize(vs, 11) / 2, y: H - 492, size: 11, font: reg, color: rgb(0.88, 0.9, 0.95) });

      var contact = (config.contactEmail || "info@ehiveglobal.com") + "  ·  ehiveglobal.com";
      page.drawText(contact, { x: cx - reg.widthOfTextAtSize(contact, 10) / 2, y: 120, size: 10, font: reg, color: MIST });
      var cf = "Private & confidential";
      page.drawText(cf, { x: cx - reg.widthOfTextAtSize(cf, 8.5) / 2, y: 44, size: 8.5, font: reg, color: rgb(0.5, 0.55, 0.65) });
    })();

    /* ---- footer on every page from page 2 on (back cover excluded) ---- */
    for (var pi = 1; pi < pdfDoc.getPageCount() - 1; pi++) {
      var pg = pdfDoc.getPage(pi);
      pg.drawLine({
        start: { x: MARGIN, y: 56 },
        end: { x: W - MARGIN, y: 56 },
        thickness: 0.6,
        color: LINE,
      });
      var ft = "eHive · " + toolTitle + " · page " + (pi + 1);
      pg.drawText(ft, {
        x: (W - reg.widthOfTextAtSize(ft, 8)) / 2,
        y: 42,
        size: 8,
        font: reg,
        color: GREY,
      });
    }

    try {
      pdfDoc.setTitle(title + (name ? " — " + name : ""));
      pdfDoc.setAuthor("eHive");
      pdfDoc.setSubject(toolTitle + " · " + total + "/100 · " + band.label);
      pdfDoc.setKeywords(["eHive", config.tool || "assessment", "report"]);
      pdfDoc.setCreationDate(new Date());
      pdfDoc.setCreator("eHive AssessEngine");
      pdfDoc.setProducer("eHive AssessEngine");
    } catch (metaErr) {
      /* metadata is best-effort */
    }

    /* Classic xref table instead of compressed object streams: friendlier
     * to older viewers, email scanners and diff-friendly tooling, at the
     * cost of a slightly larger file on a document this size. */
    return pdfDoc.save({ useObjectStreams: false });
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
        '<div id="assessStepBody" class="' + (S.dir === "back" ? "assess-step-back" : "assess-step-fwd") + '">' + body + "</div>" +
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

      /* animate the progress fill from empty each step (inline width paints
       * before a transition can run, so set 0 and commit on the next frame) */
      var fill = root.querySelector(".assess-prog-fill");
      if (fill && !reduceMotion()) {
        var targetW = fill.style.width;
        fill.style.width = "0%";
        global.requestAnimationFrame(function () {
          global.requestAnimationFrame(function () {
            fill.style.width = targetW;
          });
        });
      }
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
        S.dir = "back";
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
      S.dir = "fwd";
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
        /* renderSummary reads S.dims/S.total/S.band for the decoy result */
        var scHp = score(config, S.answers);
        S.dims = scHp.dims;
        S.total = scHp.total;
        S.band = scHp.band;
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
          var dBand = bandFor(config, d.pct);
          var bIdx = config.bands.indexOf(dBand);
          return (
            '<div class="assess-dimbar' + (isLow ? " lowest" : "") + '">' +
            '<span class="assess-dimbar-name">' + esc(d.short || d.label) + "</span>" +
            '<span class="assess-dimbar-track"><span class="assess-dimbar-fill" data-pct="' + d.pct + '" style="width:0"></span></span>' +
            '<span class="assess-chip band-' + (bIdx < 0 ? 0 : bIdx) + ' assess-dimbar-chip">' + esc(dBand.label) + "</span>" +
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
      Array.prototype.forEach.call(fills, function (f, i) {
        var pct = Number(f.getAttribute("data-pct")) || 0;
        if (reduceMotion()) f.style.width = pct + "%";
        else setTimeout(function () {
          f.style.width = pct + "%";
        }, 260 + i * 110);
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
        '<span class="assess-launch-copy">The full strategic report is <b>FREE</b> right now ' +
        '<span class="assess-launch-was">regularly <s>' + esc(label) + "</s></span>" +
        '<span class="assess-launch-sub">Limited time — it unlocks the moment you finish.</span></span>' +
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

    /* Which narrative the PDF should use: the in-memory compose result when
     * it belongs to this exact report state, else the per-token localStorage
     * ledger (covers rehydrated reports composed on an earlier visit). */
    function aiNarrativeFor(token, total, bandKey) {
      var want = config.tool + ":" + (token || "") + ":" + total + ":" + (bandKey || "");
      if (aiStatus === "done" && aiNarrative && aiFor === want) return aiNarrative;
      if (token) return aiLoad(token, total, bandKey);
      return null;
    }

    function downloadReportPdf(btn, dims, total, band, token) {
      if (btn.disabled) return;
      var span = btn.querySelector("span");
      btn.disabled = true;
      btn.setAttribute("aria-busy", "true");
      btn.classList.remove("assess-pdf-failed");
      if (span) span.textContent = "Preparing…";
      buildReportPdf(config, {
        dims: dims,
        total: total,
        band: band,
        answers: S.answers || {},
        token: token || null,
        ai: aiNarrativeFor(token, total, band.key),
      })
        .then(function (bytes) {
          var blob = new Blob([bytes], { type: "application/pdf" });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = "ehive-" + config.tool + "-report.pdf";
          document.body.appendChild(a);
          a.click();
          if (a.remove) a.remove();
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 5000);
        })
        .catch(function () {
          btn.classList.add("assess-pdf-failed");
          if (span) span.textContent = "Couldn't build the PDF — try again";
        })
        .then(function () {
          btn.disabled = false;
          btn.removeAttribute("aria-busy");
          if (span && !btn.classList.contains("assess-pdf-failed")) {
            span.textContent = "Download PDF report";
          }
        });
    }

    /* ---- summary email with the PDF attached ---- */

    var EMAIL_FLAG_KEY = "ehiveAssessEmailed";
    function emailedMap() {
      try {
        return JSON.parse(global.localStorage.getItem(EMAIL_FLAG_KEY) || "{}");
      } catch (e) {
        return {};
      }
    }
    function wasEmailed(token) {
      return !!emailedMap()[config.tool + ":" + token];
    }
    function markEmailed(token) {
      var m = emailedMap();
      m[config.tool + ":" + token] = 1;
      try {
        global.localStorage.setItem(EMAIL_FLAG_KEY, JSON.stringify(m));
      } catch (e) {}
    }
    function bytesToBase64(bytes) {
      var bin = "";
      var CHUNK = 32768;
      for (var i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(bin);
    }
    /* Generate the same PDF the download button builds, upload it (so the
     * summary email can attach it), then ask the server to send the summary.
     * Idempotent per token: localStorage flag + server-side reportEmailedAt. */
    function emailReportCopy(btn, dims, total, band, token) {
      if (!token) return Promise.resolve(false);
      function setBtn(label, disabled, failed) {
        if (!btn) return;
        btn.disabled = !!disabled;
        if (label) btn.textContent = label;
        btn.classList.toggle("assess-pdf-failed", !!failed);
      }
      setBtn("Sending…", true, false);
      var pdfBytes = null;
      function upload() {
        return fetchJSON("/api/report/upload-pdf", {
          method: "POST",
          body: { tool: config.tool, token: token, pdfBase64: bytesToBase64(pdfBytes) },
        });
      }
      return buildReportPdf(config, {
        dims: dims,
        total: total,
        band: band,
        answers: S.answers || {},
        token: token,
        ai: aiNarrativeFor(token, total, band.key),
      })
        .then(function (bytes) {
          pdfBytes = bytes;
        })
        .then(upload)
        .catch(function () {
          return new Promise(function (r) {
            setTimeout(r, 5000);
          }).then(upload);
        })
        .then(function () {
          return fetchJSON("/api/report/send-email", {
            method: "POST",
            body: { tool: config.tool, token: token },
          });
        })
        .then(function () {
          markEmailed(token);
          setBtn("Sent — check your inbox", false, false);
          return true;
        })
        .catch(function () {
          setBtn("Couldn't send — try again", false, true);
          return false;
        });
    }

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
            "<h4>Analysis</h4>" +
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

      var product = config.cta
        ? pdfProductForHref(config.cta.href) || config.cta.label || "Discovery call"
        : "Discovery call";

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
        '<div class="assess-actions assess-actions-top">' +
        '<button type="button" class="assess-btn assess-btn-coral assess-pdf-btn" id="assessPdfBtnTop">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M8 2v8m0 0 3-3M8 10 5 7"/><path d="M3 12.5V13.5h10v-1"/></svg>' +
        "<span>Download PDF report</span></button>" +
        '<button class="assess-btn-ghost assess-email-btn" id="assessEmailBtnTop">Email me a copy</button>' +
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
        '<div class="assess-report-cta">' +
        '<div class="assess-cta-eyebrow">Recommended next step</div>' +
        "<h3>Want this done with you, not just read to you?</h3>" +
        "<p class=\"assess-cta-why\">Bring these results to a working session and we'll turn the roadmap into a plan with owners and dates — most teams leave with the first phase already scheduled.</p>" +
        '<div class="assess-cta-product">' + esc(product) + "</div>" +
        '<ul class="assess-cta-points">' +
        "<li>We'll walk through your report live.</li>" +
        "<li>You'll leave with one clear priority whether or not we engage.</li>" +
        "<li>No pitch, no pressure.</li>" +
        "</ul>" +
        (config.cta ? '<a class="assess-btn assess-btn-coral assess-cta-btn" href="' + esc(config.cta.href) + '">' + esc(config.cta.label) + " →</a>" : "") +
        "</div>" +
        '<div class="assess-actions">' +
        '<button type="button" class="assess-btn assess-btn-coral assess-pdf-btn" id="assessPdfBtn">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M8 2v8m0 0 3-3M8 10 5 7"/><path d="M3 12.5V13.5h10v-1"/></svg>' +
        "<span>Download PDF report</span></button>" +
        '<button class="assess-btn-ghost assess-email-btn" id="assessEmailBtn">Email me a copy</button>' +
        '<button class="assess-btn-ghost assess-print-btn" id="assessPrint">Print / save as PDF</button>' +
        "</div>" +
        "</article>";

      var reportToken = (opts && opts.token) || S.token;
      function bindAll(ids, fn) {
        ids.forEach(function (id) {
          var el = document.getElementById(id);
          if (el) fn(el);
        });
      }
      bindAll(["assessPrint", "assessPrintTop"], function (el) {
        el.addEventListener("click", function () {
          global.print();
        });
      });
      bindAll(["assessPdfBtn", "assessPdfBtnTop"], function (el) {
        el.addEventListener("click", function () {
          downloadReportPdf(el, dims, total, band, reportToken);
        });
      });
      bindAll(["assessEmailBtn", "assessEmailBtnTop"], function (el) {
        el.addEventListener("click", function () {
          if (wasEmailed(reportToken)) {
            el.textContent = "Already sent — check your inbox";
            return;
          }
          emailReportCopy(el, dims, total, band, reportToken);
        });
      });

      aiApply();
      /* Deliver the summary email (PDF attached) once per report, shortly
       * after the first full render — by then the AI narrative has usually
       * landed, so the attached PDF carries it. Server-side idempotency
       * (reportEmailedAt) covers flag loss. */
      if (reportToken && !wasEmailed(reportToken)) {
        setTimeout(function () {
          emailReportCopy(null, dims, total, band, reportToken);
        }, 6000);
      }
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
    buildReportPdf: buildReportPdf,
  };
  global.AssessEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
