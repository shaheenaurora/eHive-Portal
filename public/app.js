/* ==========================================================================
   eHive — shared site JS (2026 launch system)
   Single file, feature-gated by DOM presence. No framework, no dependencies.
   ========================================================================== */

/* ---- lead endpoint configuration ----------------------------------------
   Set FORM_ENDPOINT to a real collector before launch:
     - a Formspree form ID  (https://formspree.io/f/XXXXXXXX), or
     - the included serverless stub at /api/lead (see api/lead.js).
   While it still contains "XXORESET", every form fails HONESTLY:
   the user keeps their summary and is told the request was not sent.      */
var FORM_ENDPOINT = "/api/lead";
var PORTAL_LIVE   = true;    /* portal is live at /portal */
var WA_NUMBER     = null;    /* e.g. "9715XXXXXXXX" once the WhatsApp line exists */

function submitLead(payload, onOk, onErr){
  if (!FORM_ENDPOINT || FORM_ENDPOINT.indexOf("XXORESET") !== -1){
    if (onErr) onErr("not-configured");
    return;
  }
  fetch(FORM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(payload)
  }).then(function(r){
    if (r.ok) { if (onOk) onOk(); }
    else if (onErr) onErr("http-" + r.status);
  }).catch(function(e){ if (onErr) onErr("network"); });
}

(function(){
  "use strict";

  /* Mark the page animation-capable. Until .anim is set, all content
     renders in its final visible state (no-JS safe). */
  document.body.classList.add("anim");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  window.addEventListener("load", function(){
    setTimeout(function(){ document.body.classList.add("loaded"); }, 120);
  });
  setTimeout(function(){ document.body.classList.add("loaded"); }, 1600);

  /* ---- nav: condense after 40px ---- */
  var nav = document.getElementById("siteNav");
  if (nav){
    var onScroll = function(){ nav.classList.toggle("scrolled", window.scrollY > 40); };
    window.addEventListener("scroll", onScroll, {passive:true});
    onScroll();
  }

  /* ---- current-page indicator ---- */
  var here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-links a").forEach(function(a){
    var href = (a.getAttribute("href") || "").split("#")[0].split("?")[0];
    if (href && href === here) a.setAttribute("aria-current", "page");
  });

  /* ---- mobile menu: off-canvas with focus trap + Esc ---- */
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("navMenu");
  function menuLinks(){
    return menu ? Array.prototype.slice.call(menu.querySelectorAll("a, button")) : [];
  }
  function openMenu(){
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    var links = menuLinks();
    if (links.length) links[0].focus();
  }
  function closeMenu(){
    if (!document.body.classList.contains("menu-open")) return;
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }
  if (toggle && menu){
    toggle.addEventListener("click", function(){
      if (document.body.classList.contains("menu-open")) closeMenu(); else openMenu();
    });
    menuLinks().forEach(function(a){
      a.addEventListener("click", function(){
        document.body.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", function(e){
      if (!document.body.classList.contains("menu-open")) return;
      if (e.key === "Escape"){ closeMenu(); return; }
      if (e.key !== "Tab") return;
      var links = menuLinks();
      if (!links.length) return;
      var first = links[0], last = links[links.length - 1];
      if (e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    });
  }

  /* ---- scroll reveals (fail-safe: reveal all if IO never fires) ---- */
  var ioAlive = false;
  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length){
    if ("IntersectionObserver" in window && !reduceMotion){
      var io = new IntersectionObserver(function(entries){
        ioAlive = true;
        entries.forEach(function(e){
          if (e.isIntersecting){ e.target.classList.add("in-view"); io.unobserve(e.target); }
        });
      }, {threshold:.14, rootMargin:"0px 0px -6% 0px"});
      reveals.forEach(function(el){ io.observe(el); });
    } else {
      ioAlive = true;
      reveals.forEach(function(el){ el.classList.add("in-view"); });
    }
    setTimeout(function(){
      if (!ioAlive){
        document.querySelectorAll(".reveal:not(.in-view)").forEach(function(el){
          el.classList.add("in-view");
        });
        var st = document.getElementById("steps");
        if (st) st.classList.add("draw");
      }
      document.body.classList.add("loaded");
    }, 2600);
  }

  /* ---- how-it-works connector line ---- */
  var steps = document.getElementById("steps");
  if (steps){
    if ("IntersectionObserver" in window && !reduceMotion){
      var so = new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if (e.isIntersecting){ steps.classList.add("draw"); so.disconnect(); }
        });
      }, {threshold:.3});
      so.observe(steps);
    } else {
      steps.classList.add("draw");
    }
  }

  /* ---- footer year ---- */
  document.querySelectorAll("#year").forEach(function(y){
    y.textContent = new Date().getFullYear();
  });

  /* ---- newsletter: honest capture --------------------------------------
     Wires to the ESP at go-live via FORM_ENDPOINT. Until then it says so. */
  document.querySelectorAll(".news-form, .sub-form").forEach(function(f){
    f.addEventListener("submit", function(e){
      e.preventDefault();
      var inp = f.querySelector('input[type="email"]');
      if (!inp || !/.+@.+\..+/.test(inp.value.trim())){ if (inp) inp.focus(); return; }
      var email = inp.value.trim();
      submitLead(
        { form: "newsletter", email: email, source_page: location.pathname.split("/").pop(),
          timestamp: new Date().toISOString(), user_agent: navigator.userAgent },
        function(){
          f.innerHTML = '<p style="margin:0;color:var(--gold-2);font-size:.92rem">You\u2019re on the list — watch your inbox.</p>';
        },
        function(){
          f.innerHTML = '<p style="margin:0;color:var(--gold-2);font-size:.92rem">The Journal list opens with the launch on 1 August 2026 — your email hasn\u2019t been stored yet. Leave it with us via Get Started and we\u2019ll keep you posted.</p>';
        }
      );
    });
  });

  /* ---- founding-cohort countdown ------------------------------------------
     Target: 1 Aug 2026, 00:00 Gulf Standard Time (UTC+4).
     Any [data-countdown] block with .cd-d/.cd-h/.cd-m/.cd-s cells is driven;
     [data-cd-days] elements receive the plain day count. Zeroes, never dashes. */
  (function(){
    var blocks = document.querySelectorAll("[data-countdown]");
    var daySlots = document.querySelectorAll("[data-cd-days]");
    if (!blocks.length && !daySlots.length) return;
    var target = Date.UTC(2026, 6, 31, 20, 0, 0); /* = 2026-08-01T00:00:00+04:00 */
    function pad(n){ return String(n).padStart(2, "0"); }
    function tick(){
      var diff = target - Date.now();
      if (diff <= 0){
        blocks.forEach(function(b){
          b.querySelectorAll(".cd-d,.cd-h,.cd-m,.cd-s").forEach(function(c){ c.textContent = "0"; });
          var date = b.parentElement ? b.parentElement.querySelector(".count-date") : null;
          if (date) date.textContent = "The founding cohort is open";
        });
        daySlots.forEach(function(el){ el.textContent = "Open now"; });
        document.querySelectorAll("[data-cd-open]").forEach(function(el){
          el.textContent = "The founding cohort is open";
        });
        return; /* stop ticking: the open state is final */
      }
      var d = Math.floor(diff / 864e5);
      blocks.forEach(function(b){
        var q = function(sel){ return b.querySelector(sel); };
        if (q(".cd-d")) q(".cd-d").textContent = d;
        if (q(".cd-h")) q(".cd-h").textContent = pad(Math.floor(diff / 36e5) % 24);
        if (q(".cd-m")) q(".cd-m").textContent = pad(Math.floor(diff / 6e4) % 60);
        if (q(".cd-s")) q(".cd-s").textContent = pad(Math.floor(diff / 1e3) % 60);
      });
      daySlots.forEach(function(el){ el.textContent = d; });
      setTimeout(tick, 1000);
    }
    tick();
  })();

  /* ---- hive network hero canvas ------------------------------------------
     <= 40 nodes. Connecting lines fade in, orchestrated, on load; then drift.
     Cursor brightens nearby nodes (desktop). Pauses off-screen and on hidden
     tab. One static frame under reduced motion. */
  (function(){
    var canvas = document.getElementById("lattice");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W, H, DPR, nodes = [], mouse = {x:-9999, y:-9999};
    var GOLD = "218,58,34", MIST = "156,169,188";
    var running = false, rafId = null, startT = 0;

    function sizeCanvas(){
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function seed(){
      nodes = [];
      var n = Math.min(40, Math.max(24, Math.round(W * H / 34000)));
      for (var i = 0; i < n; i++){
        var gold = Math.random() < 0.16;
        nodes.push({
          x: Math.random() * W, y: Math.random() * H,
          vx: (Math.random() - .5) * .24, vy: (Math.random() - .5) * .24,
          r: gold ? 1.7 + Math.random() * 1.2 : 1 + Math.random() * 1.1,
          gold: gold, pulse: Math.random() * Math.PI * 2, ord: i
        });
      }
    }
    function draw(staticFrame, intro){
      ctx.clearRect(0, 0, W, H);
      var LINK = Math.min(180, Math.max(120, W / 8));
      var i, j, a, b, dx, dy, d, alpha;
      for (i = 0; i < nodes.length; i++){
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++){
          b = nodes[j];
          dx = a.x - b.x; dy = a.y - b.y;
          d = Math.sqrt(dx*dx + dy*dy);
          if (d < LINK){
            alpha = (1 - d / LINK) * ((a.gold && b.gold) ? .5 : .2);
            /* orchestrated intro: links appear in node order */
            alpha *= Math.max(0, Math.min(1, intro * 1.6 - ((a.ord + b.ord) % 9) * .09));
            if (alpha <= 0) continue;
            ctx.strokeStyle = "rgba(" + ((a.gold || b.gold) ? GOLD : MIST) + "," + alpha.toFixed(3) + ")";
            ctx.lineWidth = .7;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (i = 0; i < nodes.length; i++){
        a = nodes[i];
        var boost = 0;
        dx = a.x - mouse.x; dy = a.y - mouse.y; d = Math.sqrt(dx*dx + dy*dy);
        if (d < 140){ boost = (1 - d / 140); }
        var glow = (a.gold ? .85 : .5) * Math.min(1, intro * 1.4);
        var rr = a.r + Math.sin(a.pulse) * .3 + boost * 1.7;
        if (a.gold){ ctx.shadowColor = "rgba(" + GOLD + ",.9)"; ctx.shadowBlur = 10 + boost * 16; }
        ctx.fillStyle = "rgba(" + (a.gold ? GOLD : MIST) + "," + Math.min(1, glow + boost * .5).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(a.x, a.y, Math.max(rr, .4), 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    function tick(t){
      if (!running) return;
      if (!startT) startT = t;
      var intro = Math.min(1, (t - startT) / 1700);
      for (var i = 0; i < nodes.length; i++){
        var a = nodes[i];
        a.x += a.vx; a.y += a.vy; a.pulse += .014;
        if (a.x < -20) a.x = W + 20; if (a.x > W + 20) a.x = -20;
        if (a.y < -20) a.y = H + 20; if (a.y > H + 20) a.y = -20;
      }
      draw(false, intro);
      rafId = requestAnimationFrame(tick);
    }
    function start(){
      if (running || reduceMotion) return;
      running = true; startT = 0;
      rafId = requestAnimationFrame(tick);
    }
    function stop(){
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
    sizeCanvas(); seed();
    if (reduceMotion){
      draw(true, 1); /* single static frame */
    } else {
      /* pause when the hero is off-screen */
      if ("IntersectionObserver" in window){
        var cio = new IntersectionObserver(function(entries){
          entries.forEach(function(e){ if (e.isIntersecting) start(); else stop(); });
        }, {threshold: 0});
        cio.observe(canvas);
      } else { start(); }
      document.addEventListener("visibilitychange", function(){
        if (document.hidden) stop(); else start();
      });
    }
    var resizeT;
    window.addEventListener("resize", function(){
      clearTimeout(resizeT);
      resizeT = setTimeout(function(){
        sizeCanvas(); seed();
        if (reduceMotion) draw(true, 1);
      }, 180);
    });
    var hero = canvas.closest(".hero") || canvas.parentElement;
    if (hero){
      hero.addEventListener("pointermove", function(e){
        var r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
      });
      hero.addEventListener("pointerleave", function(){
        mouse.x = -9999; mouse.y = -9999;
      });
    }
  })();

  /* ---- journal tag filter ---- */
  (function(){
    var fbtns = document.querySelectorAll(".f-btn");
    if (!fbtns.length) return;
    var arts = document.querySelectorAll(".art-grid .art");
    var emptyNote = document.getElementById("filterEmpty");
    fbtns.forEach(function(b){
      b.addEventListener("click", function(){
        fbtns.forEach(function(x){ x.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        var f = b.getAttribute("data-filter"), shown = 0;
        arts.forEach(function(a){
          var show = (f === "all" || a.getAttribute("data-tag") === f);
          a.classList.toggle("hide", !show);
          if (show) shown++;
        });
        if (emptyNote) emptyNote.style.display = shown ? "none" : "block";
      });
    });
  })();

  /* ---- business-setup cost calculator + lead capture ----------------------
     PLACEHOLDER PRICING LOGIC — illustrative only, pending the real
     Emirates First rate card. The capture routes into the funnel backend
     as door=business. */
  (function(){
    var activity = document.getElementById("cf-activity");
    if (!activity) return;
    var RATE = {
      fz: { base: 11500, visa: 3200, name: "Free zone" },
      ml: { base: 18500, visa: 3800, name: "Mainland" }
    };
    var OFFICE = { flexi: 4500, shared: 9500, private: 19000, none: 0 };
    var OFFICE_NAME = { flexi: "flexi-desk", shared: "shared office", private: "private office", none: "no office yet" };
    var ACT = { consulting: 1, trading: 1.15, ecommerce: 1.1, tech: 1, fnb: 1.3, other: 1 };
    var ACT_NAME = {
      consulting: "consulting & professional services", trading: "trading & general trading",
      ecommerce: "e-commerce", tech: "technology & software", fnb: "food & beverage", other: "other activity"
    };
    var office = document.getElementById("cf-office"),
        visas = document.getElementById("cf-visas"),
        visasOut = document.getElementById("cf-visas-out"),
        jur = "fz";
    var coAmount = document.getElementById("coAmount"),
        coScope = document.getElementById("coScope"),
        coBreak = document.getElementById("coBreak"),
        coAlt = document.getElementById("coAlt");
    function fmt(n){ return n.toLocaleString("en-US"); }
    function round500(n){ return Math.round(n / 500) * 500; }
    function estimate(j){
      var r = RATE[j];
      var offKey = office.value, offCost = OFFICE[offKey];
      if (j === "ml" && offKey === "none"){ offCost = OFFICE.flexi; }
      var v = parseInt(visas.value, 10);
      var base = r.base, visaCost = r.visa * v;
      var total = (base + visaCost + offCost) * ACT[activity.value];
      return { low: round500(total * .95), high: round500(total * 1.25),
               base: base, visaCost: visaCost, offCost: offCost, mult: ACT[activity.value], visas: v };
    }
    var lastMain = "fz", lastEst = null;
    function render(){
      visasOut.textContent = visas.value;
      var main = (jur === "both") ? "fz" : jur;
      var e = estimate(main);
      lastMain = main; lastEst = e;
      var scopeRest = e.visas + (e.visas === 1 ? " visa" : " visas") +
        " · " + OFFICE_NAME[office.value] + " · " + ACT_NAME[activity.value];
      coAmount.textContent = "AED " + fmt(e.low) + " – " + fmt(e.high);
      coScope.textContent = RATE[main].name + " · " + scopeRest;
      var rows = "";
      rows += "<li><span>License &amp; registration</span><b>AED " + fmt(e.base) + "</b></li>";
      rows += "<li><span>Residence visas \u00d7 " + e.visas + "</span><b>AED " + fmt(e.visaCost) + "</b></li>";
      rows += "<li><span>Office (" + OFFICE_NAME[office.value] + ")</span><b>AED " + fmt(e.offCost) + "</b></li>";
      if (e.mult !== 1){
        rows += "<li><span>Activity-specific requirements</span><b>\u00d7 " + e.mult.toFixed(2) + "</b></li>";
      }
      coBreak.innerHTML = rows;
      if (jur === "both"){
        var m = estimate("ml");
        coAlt.hidden = false;
        coAlt.innerHTML = "Mainland path for the same setup: <b>AED " + fmt(m.low) + " – " + fmt(m.high) + "</b>";
      } else {
        coAlt.hidden = true;
      }
    }
    document.querySelectorAll(".seg button").forEach(function(b){
      b.addEventListener("click", function(){
        document.querySelectorAll(".seg button").forEach(function(x){ x.classList.remove("on"); });
        b.classList.add("on");
        jur = b.getAttribute("data-jur");
        render();
      });
    });
    [activity, office].forEach(function(el){ el.addEventListener("change", render); });
    visas.addEventListener("input", render);
    render();

    var sendBtn = document.getElementById("calcSend");
    if (sendBtn){
      sendBtn.addEventListener("click", function(){
        var em = document.getElementById("calcEmail");
        var ok = document.querySelector(".cc-ok"), err = document.querySelector(".cc-err");
        if (!em || !/.+@.+\..+/.test(em.value.trim())){
          if (em){ em.focus(); em.classList.add("err"); }
          return;
        }
        em.classList.remove("err");
        var e = lastEst || estimate(lastMain);
        submitLead({
          form: "calculator-breakdown", door: "business", email: em.value.trim(),
          estimate: {
            jurisdiction: RATE[lastMain].name, activity: activity.value, office: office.value,
            visas: e.visas, low: e.low, high: e.high
          },
          source_page: "business-setup.html", referrer: document.referrer || "",
          timestamp: new Date().toISOString(), user_agent: navigator.userAgent
        }, function(){
          if (ok){ ok.style.display = "block"; ok.textContent = "Sent — the full breakdown is on its way to your inbox."; }
          if (err) err.style.display = "none";
        }, function(){
          if (err){ err.style.display = "block";
            err.textContent = "The breakdown service isn\u2019t connected yet (pre-launch). Note your estimate above — or send it through Get Started and we\u2019ll pick it up at launch.";
          }
          if (ok) ok.style.display = "none";
        });
      });
    }
  })();

  /* ---- consulting fit selector -------------------------------------------
     Two questions -> one recommendation. Logic lives here; markup on the
     consulting page carries #fitSelector with [data-stage] / [data-pain]. */
  (function(){
    var root = document.getElementById("fitSelector");
    if (!root) return;
    var FIT = {
      clarity:   { name: "Clarity Sprint", price: "AED 2,500–3,000 · three hours",
                   why: "You don\u2019t need a transformation programme — you need one honest afternoon on the decision that\u2019s stuck.",
                   href: "consulting-clarity-sprint.html" },
      strategy:  { name: "Strategy Sprint", price: "AED 10,000–15,000 · one day",
                   why: "You have momentum and choices to make. A full day turns options into a sequenced plan.",
                   href: "consulting-strategy-sprint.html" },
      gaps:      { name: "GapNavigator", price: "AED 12,000–18,000 · diagnostic",
                   why: "Growth has stalled and the reason isn\u2019t obvious. The diagnostic finds the constraint before you spend fixing the wrong thing.",
                   href: "consulting-gapnavigator.html" },
      brand:     { name: "Brand 3D", price: "AED 15,000–25,000 · engagement",
                   why: "The market can\u2019t tell you apart — or you\u2019ve outgrown how you look. Brand 3D rebuilds positioning, identity and voice together.",
                   href: "consulting-brand-3d.html" },
      ops:       { name: "OpsBlueprint", price: "Scoped · discovery call first",
                   why: "The business runs on you, not on systems. OpsBlueprint maps the operation and designs the one that scales.",
                   href: "consulting-opsblueprint.html" },
      momentum:  { name: "Momentum90", price: "Scoped · 90-day engagement",
                   why: "You need a senior operator in the boat for a quarter — strategy, execution and accountability in one engagement.",
                   href: "consulting-momentum90.html" }
    };
    var stage = null, pain = null;
    var resName = root.querySelector(".sr-name"),
        resPrice = root.querySelector(".sr-price"),
        resWhy = root.querySelector(".sr-why"),
        resLink = root.querySelector(".sr-link"),
        result = root.querySelector(".sel-result");
    function pick(){
      if (!stage || !pain) return;
      var key = pain;
      if (pain === "clarity" && (stage === "growing" || stage === "scaling")) key = "strategy";
      if (pain === "brand" && stage === "idea") key = "clarity";
      var r = FIT[key];
      resName.textContent = r.name;
      resPrice.textContent = r.price;
      resWhy.textContent = r.why;
      resLink.setAttribute("href", r.href);
      result.classList.add("show");
      result.scrollIntoView({behavior:"smooth", block:"nearest"});
    }
    root.querySelectorAll("[data-stage]").forEach(function(b){
      b.addEventListener("click", function(){
        root.querySelectorAll("[data-stage]").forEach(function(x){ x.setAttribute("aria-pressed","false"); });
        b.setAttribute("aria-pressed","true");
        stage = b.getAttribute("data-stage");
        pick();
      });
    });
    root.querySelectorAll("[data-pain]").forEach(function(b){
      b.addEventListener("click", function(){
        root.querySelectorAll("[data-pain]").forEach(function(x){ x.setAttribute("aria-pressed","false"); });
        b.setAttribute("aria-pressed","true");
        pain = b.getAttribute("data-pain");
        pick();
      });
    });
  })();

  /* ---- get-started funnel --------------------------------------------------
     Step n of 4 progress · Continue gated on validity · history.pushState so
     the browser Back button restores steps · URL prefill (?door= ?product=
     ?tier=) auto-advances · real POST to FORM_ENDPOINT with honest failure. */
  (function(){
    var gsTitle = document.getElementById("gsTitle");
    if (!gsTitle) return;
    var gs = { door: null, detail: null };
    var T2 = {
      business: "Tell us about the business",
      consulting: "Which product interests you?",
      circle: "Which tier interests you?",
      other: "What's on your mind?"
    };
    var LBL = { business: "Business Setup", consulting: "Consulting", circle: "eHive Circle", other: "Another question" };
    var PT = {
      "clarity-sprint":"Clarity Sprint","strategy-sprint":"Strategy Sprint","gapnavigator":"GapNavigator",
      "brand-3d":"Brand 3D","opsblueprint":"OpsBlueprint","momentum90":"Momentum90",
      "horizon":"Horizon","ascent":"Ascent","vanguard":"Vanguard","zenith":"Zenith (invitation-only)"
    };
    var prog = document.getElementById("gsProg");

    function paneOf(step){ return step.getAttribute("data-pane"); }
    function activeStep(){
      return document.querySelector(".gs-step.active");
    }
    function currentValid(){
      var st = activeStep();
      if (!st) return false;
      var n = st.getAttribute("data-step");
      if (n === "1") return !!gs.door;
      if (n === "2"){
        var p = paneOf(st);
        if (p === "consulting" || p === "circle") return !!gs.detail;
        if (p === "business"){ var a = document.getElementById("gsActivity"); return !!(a && a.value.trim()); }
        if (p === "other"){ var q = document.getElementById("gsQuestion"); return !!(q && q.value.trim()); }
      }
      if (n === "3"){
        var nm = document.getElementById("gsName"), em = document.getElementById("gsEmail");
        return !!(nm && nm.value.trim() && em && /.+@.+\..+/.test(em.value.trim()));
      }
      return true;
    }
    function paint(){
      var st = activeStep();
      if (!st) return;
      var n = st.getAttribute("data-step");
      var num = (n === "done") ? 4 : +n;
      document.querySelectorAll(".gs-dot").forEach(function(dt){
        dt.classList.toggle("on", +dt.getAttribute("data-dot") <= num);
      });
      if (prog){
        prog.textContent = (n === "done") ? "Request routed" : ("Step " + num + " of 4");
      }
      var pane = paneOf(st);
      gsTitle.textContent = (n === "1") ? "What brings you to eHive?"
        : (n === "3") ? "Almost there — your details"
        : (n === "done") ? "You're all set"
        : T2[pane] || "";
      /* gate every Continue within the active step */
      st.querySelectorAll(".gs-next").forEach(function(b){ b.disabled = !currentValid(); });
    }
    function go(n, push){
      document.querySelectorAll(".gs-step").forEach(function(s){ s.classList.remove("active"); });
      var sel;
      if (n === "done") sel = '.gs-step[data-step="done"]';
      else if (+n === 2) sel = '.gs-step[data-step="2"][data-pane="' + gs.door + '"]';
      else sel = '.gs-step[data-step="' + n + '"]';
      var el = document.querySelector(sel);
      if (el) el.classList.add("active");
      paint();
      if (push !== false){
        try { history.pushState({gsStep: String(n), door: gs.door}, "", "#step-" + n); } catch (e) {}
      }
      var wrap = document.querySelector(".gs-wrap") || el;
      if (wrap && window.scrollY > wrap.offsetTop + 80){
        wrap.scrollIntoView({behavior:"smooth", block:"start"});
      }
    }
    window.addEventListener("popstate", function(e){
      var st = e.state && e.state.gsStep;
      if (st){
        if (e.state.door) gs.door = e.state.door;
        go(st === "done" ? "done" : st, false);
      } else {
        go(1, false);
      }
    });

    document.querySelectorAll(".gs-path[data-door]").forEach(function(b){
      b.addEventListener("click", function(){
        gs.door = b.getAttribute("data-door");
        gs.detail = null;
        document.querySelectorAll(".gs-path[data-door]").forEach(function(x){ x.classList.remove("active"); });
        b.classList.add("active");
        paint();
      });
    });
    document.querySelectorAll(".gs-path[data-detail]").forEach(function(b){
      b.addEventListener("click", function(){
        gs.detail = b.getAttribute("data-detail");
        var pane = b.closest(".gs-step");
        pane.querySelectorAll(".gs-path[data-detail]").forEach(function(x){ x.classList.remove("active"); });
        b.classList.add("active");
        paint();
      });
    });
    document.querySelectorAll(".gs-next[data-next]").forEach(function(b){
      b.addEventListener("click", function(){
        if (b.disabled) return;
        var nx = b.getAttribute("data-next");
        go(nx === "3" ? 3 : 2);
      });
    });
    document.querySelectorAll(".gs-back").forEach(function(b){
      b.addEventListener("click", function(){
        if (b.getAttribute("data-back") === "2") go(2); else go(1);
      });
    });
    /* live-gate step 3 + text panes as the user types */
    ["gsName","gsEmail","gsActivity","gsQuestion"].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener("input", paint);
    });

    var gsSubmit = document.getElementById("gsSubmit");
    if (gsSubmit){
      gsSubmit.addEventListener("click", function(){
        var name = document.getElementById("gsName"), email = document.getElementById("gsEmail");
        var nameBad = !name.value.trim();
        var emailBad = !/.+@.+\..+/.test(email.value.trim());
        name.classList.toggle("err", nameBad);
        document.getElementById("errName").classList.toggle("on", nameBad);
        email.classList.toggle("err", emailBad);
        document.getElementById("errEmail").classList.toggle("on", emailBad);
        if (nameBad || emailBad) return;

        var detail, productOrTier = "", question = "";
        if (gs.door === "business"){
          var act = document.getElementById("gsActivity").value.trim() || "—";
          detail = act + " · " + document.getElementById("gsJurisdiction").value;
        } else if (gs.door === "other"){
          question = document.getElementById("gsQuestion").value.trim();
          detail = question ? (question.length > 60 ? question.slice(0, 60) + "…" : question) : "—";
        } else {
          detail = gs.detail || "—";
          productOrTier = gs.detail || "";
        }
        var phone = document.getElementById("gsPhone").value.trim();
        var rows = [["Door", LBL[gs.door] || "—"], ["Detail", detail],
                    ["Name", name.value.trim()], ["Email", email.value.trim()]];
        if (phone) rows.push(["Phone", phone]);
        var sum = document.getElementById("gsSummary");
        sum.innerHTML = rows.map(function(){ return '<li><span></span><b></b></li>'; }).join("");
        var spans = sum.querySelectorAll("li span"), bs = sum.querySelectorAll("li b");
        rows.forEach(function(r, i){ spans[i].textContent = r[0]; bs[i].textContent = r[1]; });

        var errNote = document.getElementById("gsErr");
        submitLead({
          form: "get-started", door: gs.door, detail: detail,
          product_or_tier: productOrTier, question: question,
          name: name.value.trim(), email: email.value.trim(), phone: phone,
          source_page: "get-started.html", referrer: document.referrer || "",
          timestamp: new Date().toISOString(), user_agent: navigator.userAgent
        }, function(){
          if (errNote) errNote.classList.remove("show");
          go("done");
        }, function(){
          if (errNote) errNote.classList.add("show");
          go("done");
        });
      });
    }

    /* prefill: ?door=business|consulting|circle|other · ?product= / ?tier= */
    var q = new URLSearchParams(location.search);
    var door = q.get("door");
    if (door && LBL[door]){
      gs.door = door;
      var db = document.querySelector('.gs-path[data-door="' + door + '"]');
      if (db) db.classList.add("active");
      var sel = q.get("product") || q.get("tier");
      if (sel && PT[sel] && (door === "consulting" || door === "circle")){
        gs.detail = PT[sel];
        var pb = document.querySelector('.gs-path[data-detail="' + PT[sel] + '"]');
        if (pb) pb.classList.add("active");
        go(3, false);
        try { history.replaceState({gsStep:"3", door:door}, "", "#step-3"); } catch (e) {}
      } else {
        go(2, false);
        try { history.replaceState({gsStep:"2", door:door}, "", "#step-2"); } catch (e) {}
      }
    } else {
      paint();
    }
  })();

  /* ---- booking engine (placeholder availability & backend) ---- */
  (function(){
    var bkConfirm = document.getElementById("bkConfirm");
    if (!bkConfirm) return;
    var BOOK = {
      "clarity-sprint": {name:"Clarity Sprint", fmt:"Three-hour working session", price:"AED 2,500–3,000",
        prep:"Come with your three hardest questions — leave with one clear decision.", free:""},
      "strategy-sprint": {name:"Strategy Sprint", fmt:"Full-day strategy engagement", price:"AED 10,000–15,000",
        prep:"We\u2019ll send a short pre-read questionnaire after confirmation.", free:""},
      "gapnavigator": {name:"GapNavigator", fmt:"Diagnostic engagement", price:"AED 12,000–18,000",
        prep:"Bring your numbers — the honest ones.", free:""},
      "brand-3d": {name:"Brand 3D", fmt:"Brand engagement", price:"AED 15,000–25,000",
        prep:"We\u2019ll ask for your current brand assets before the session.", free:""},
      "opsblueprint": {name:"OpsBlueprint — discovery call", fmt:"45-minute video call", price:"No charge",
        prep:"A conversation about how your operation actually runs today.", free:"No charge — a conversation, not a commitment."},
      "momentum90": {name:"Momentum90 — discovery call", fmt:"45-minute video call", price:"No charge",
        prep:"Tell us where you\u2019re stuck — we\u2019ll tell you if we\u2019re the right fix.", free:"No charge — a conversation, not a commitment."},
      "setup": {name:"Business setup consultation", fmt:"30-minute call", price:"No charge",
        prep:"Jurisdiction, activity, visas — bring your questions.", free:"No charge — a conversation, not a commitment."},
      "discovery": {name:"Discovery call", fmt:"30-minute call", price:"No charge",
        prep:"Tell us where you are and where you\u2019re headed.", free:"No charge — a conversation, not a commitment."}
    };
    var pm = location.search.match(/[?&](?:product|type)=([a-z0-9-]+)/);
    var bk = BOOK[pm && pm[1]] || BOOK["discovery"];
    document.getElementById("bkName").textContent = bk.name;
    document.getElementById("bkFmt").textContent = bk.fmt;
    document.getElementById("bkPrice").textContent = bk.price;
    document.getElementById("bkPrep").textContent = bk.prep;
    document.getElementById("bkFree").textContent = bk.free || "Reschedule any time up to 24 hours before.";
    document.title = "Book: " + bk.name + " — eHive";

    var WD = ["SUN","MON","TUE","WED","THU","FRI","SAT"];
    var MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var selDay = null, selSlot = null;
    var dayGrid = document.getElementById("dayGrid");
    var slotGrid = document.getElementById("slotGrid");
    var bkHint = document.getElementById("bkHint");
    function fmtDay(d){ return WD[d.getDay()].charAt(0) + WD[d.getDay()].slice(1).toLowerCase() + " " + d.getDate() + " " + MO[d.getMonth()]; }
    function updateHint(){
      bkHint.textContent = (selDay && selSlot) ? fmtDay(selDay) + " · " + selSlot + " GST — looks good?"
        : selDay ? "Now pick a time slot."
        : "Pick a day and a time first.";
    }
    for (var i = 1; i <= 14; i++){
      (function(){
        var dt = new Date(); dt.setHours(0,0,0,0); dt.setDate(dt.getDate() + i);
        var wknd = (dt.getDay() === 0 || dt.getDay() === 6);
        var b = document.createElement("button");
        b.type = "button"; b.className = "day";
        b.innerHTML = '<span class="dw">' + WD[dt.getDay()] + '</span><span class="dn">' + dt.getDate() + '</span><span class="dm">' + MO[dt.getMonth()] + '</span>';
        if (wknd) b.disabled = true;
        b.addEventListener("click", function(){
          dayGrid.querySelectorAll(".day").forEach(function(x){ x.classList.remove("on"); });
          b.classList.add("on");
          selDay = dt; selSlot = null;
          renderSlots(); updateHint();
        });
        dayGrid.appendChild(b);
      })();
    }
    function renderSlots(){
      slotGrid.innerHTML = "";
      ["09:00","11:00","14:00","16:00"].forEach(function(t, idx){
        var b = document.createElement("button");
        b.type = "button"; b.className = "slot";
        b.innerHTML = t + '<small>GST</small>';
        var taken = selDay && ((Math.floor(selDay.getTime() / 864e5) + idx) % 4 === 1);
        if (!selDay || taken) b.disabled = true;
        if (taken) b.classList.add("taken");
        b.addEventListener("click", function(){
          slotGrid.querySelectorAll(".slot").forEach(function(x){ x.classList.remove("on"); });
          b.classList.add("on");
          selSlot = t; updateHint();
        });
        slotGrid.appendChild(b);
      });
    }
    renderSlots();

    bkConfirm.addEventListener("click", function(){
      if (!selDay || !selSlot){ bkHint.textContent = "Choose a day and a time slot to continue."; return; }
      var name = document.getElementById("bkNameIn"), email = document.getElementById("bkEmail");
      var nameBad = !name.value.trim();
      var emailBad = !/.+@.+\..+/.test(email.value.trim());
      name.classList.toggle("err", nameBad);
      document.getElementById("bkErrName").classList.toggle("on", nameBad);
      email.classList.toggle("err", emailBad);
      document.getElementById("bkErrEmail").classList.toggle("on", emailBad);
      if (nameBad || emailBad) return;

      var when = fmtDay(selDay) + " · " + selSlot + " GST";
      var rows = [["Booked", bk.name], ["When", when],
                  ["Format", bk.fmt], ["Name", name.value.trim()], ["Email", email.value.trim()]];
      var sum = document.getElementById("bkSummary");
      sum.innerHTML = rows.map(function(){ return '<li><span></span><b></b></li>'; }).join("");
      var spans = sum.querySelectorAll("li span"), bs = sum.querySelectorAll("li b");
      rows.forEach(function(r, j){ spans[j].textContent = r[0]; bs[j].textContent = r[1]; });
      document.getElementById("bkDoneEmail").textContent = email.value.trim();

      var errNote = document.getElementById("bkErr");
      submitLead({
        form: "booking", product: pm && pm[1] || "discovery", when: when, format: bk.fmt,
        name: name.value.trim(), email: email.value.trim(),
        source_page: "book.html", referrer: document.referrer || "",
        timestamp: new Date().toISOString(), user_agent: navigator.userAgent
      }, function(){
        if (errNote) errNote.classList.remove("show");
      }, function(){
        if (errNote) errNote.classList.add("show");
      });
      document.getElementById("bkForm").style.display = "none";
      document.getElementById("bkDone").style.display = "block";
      var card = document.querySelector(".bk-card");
      if (card) card.scrollIntoView({behavior:"smooth", block:"start"});
    });
    var again = document.getElementById("bkAgain");
    if (again){
      again.addEventListener("click", function(){
        document.getElementById("bkDone").style.display = "none";
        document.getElementById("bkForm").style.display = "block";
      });
    }
  })();

  /* ---- login: pre-launch state vs live form (PORTAL_LIVE flag) ---- */
  (function(){
    var launch = document.getElementById("lgLaunch");
    var wrap = document.getElementById("lgFormWrap");
    if (launch && wrap){
      launch.style.display = PORTAL_LIVE ? "none" : "block";
      wrap.style.display = PORTAL_LIVE ? "block" : "none";
    }
    var lgForm = document.getElementById("lgForm");
    if (!lgForm) return;
    lgForm.addEventListener("submit", function(e){
      e.preventDefault();
      if (!PORTAL_LIVE) return;
      var email = document.getElementById("lgEmail"), code = document.getElementById("lgCode");
      var emailBad = !/.+@.+\..+/.test(email.value.trim());
      var codeBad = code.value.trim().length < 4;
      email.classList.toggle("err", emailBad);
      document.getElementById("lgErrEmail").classList.toggle("on", emailBad);
      code.classList.toggle("err", codeBad);
      document.getElementById("lgErrCode").classList.toggle("on", codeBad);
      if (emailBad || codeBad) return;
      var raw = email.value.trim().split("@")[0].replace(/[._-]+/g, " ").trim();
      var name = raw ? raw.replace(/\b\w/g, function(c){ return c.toUpperCase(); }) : "Demo Member";
      sessionStorage.setItem("ehiveMember", JSON.stringify({ email: email.value.trim(), name: name, demo: true }));
      location.href = "portal.html";
    });
  })();

  /* ---- member portal (preview; guarded) ---- */
  (function(){
    if (!document.body.classList.contains("portal")) return;
    var mem = null;
    try { mem = JSON.parse(sessionStorage.getItem("ehiveMember") || "null"); } catch (e) {}
    if (!mem){ location.replace("login.html"); return; }

    var MO = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var first = (mem.name || "Member").split(" ")[0];
    var el = function(id){ return document.getElementById(id); };
    if (el("mFirst")) el("mFirst").textContent = first;
    if (el("mName")) el("mName").textContent = mem.name || "Demo Member";
    var initials = (mem.name || "D M").split(" ").filter(Boolean).slice(0, 2)
      .map(function(w){ return w.charAt(0).toUpperCase(); }).join("");
    if (el("mAvatar")) el("mAvatar").textContent = initials || "D";

    var target = Date.UTC(2026, 6, 31, 20, 0, 0);
    var dd = Math.max(0, Math.floor((target - Date.now()) / 864e5));
    if (el("mDays")) el("mDays").textContent = dd;

    setTimeout(function(){
      document.querySelectorAll(".m-bar2 i").forEach(function(b){
        b.style.width = b.getAttribute("data-w");
      });
    }, 250);

    var t = new Date(); t.setHours(0,0,0,0);
    do { t.setDate(t.getDate() + 1); } while (t.getDay() !== 4);
    if (el("msDay")) el("msDay").textContent = t.getDate();
    if (el("msMon")) el("msMon").textContent = MO[t.getMonth()];
    if (el("msWhen")) el("msWhen").textContent = "Thu " + t.getDate() + " " + MO[t.getMonth()] + " · 18:30 GST · Dubai chapter";

    document.querySelectorAll("[data-evday]").forEach(function(n){
      var d = new Date(); d.setHours(0,0,0,0);
      d.setDate(d.getDate() + parseInt(n.getAttribute("data-evday"), 10));
      n.textContent = d.getDate();
    });
    document.querySelectorAll("[data-evmon]").forEach(function(n){
      var d = new Date(); d.setHours(0,0,0,0);
      d.setDate(d.getDate() + parseInt(n.getAttribute("data-evmon"), 10));
      n.textContent = MO[d.getMonth()];
    });

    var toastEl = el("mToast"), toastTimer = null;
    function toast(msg){
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 3200);
    }
    document.querySelectorAll("[data-toast]").forEach(function(b){
      b.addEventListener("click", function(){ toast(b.getAttribute("data-toast")); });
    });
    document.querySelectorAll("[data-rsvp]").forEach(function(b){
      b.addEventListener("click", function(){
        if (b.classList.contains("done")) return;
        b.classList.add("done");
        b.textContent = "RSVP\u2019d \u2713";
        toast("You\u2019re on the list — a calendar invite follows by email once the portal is live.");
      });
    });
    var so = el("mSignOut");
    if (so){
      so.addEventListener("click", function(){
        sessionStorage.removeItem("ehiveMember");
        location.href = "login.html";
      });
    }
  })();

})();

/* ===== eHive Clarity Scorecard — nav button + popup (progressive enhancement) =====
   Styles every link to /clarity-scorecard.html as a button and opens the
   scorecard in an in-page modal instead of navigating. Falls back to the plain
   page if JS is off. */
(function () {
  "use strict";
  if (window.__ehScorecardModal) return;
  window.__ehScorecardModal = true;

  var SC_URL = "/clarity-scorecard.html";
  // Don't run on the scorecard page itself.
  if (location.pathname.replace(/\/index\.html$/, "/").indexOf("clarity-scorecard") !== -1) return;

  var css = ""
    + ".nav-links a[href*='clarity-scorecard']{"
    + "display:inline-flex;align-items:center;gap:.4em;padding:.5em .95em;border:1px solid var(--gold,#B8862E);"
    + "border-radius:8px;color:var(--gold,#B8862E)!important;font-weight:600;transition:background .15s,color .15s;}"
    + ".nav-links a[href*='clarity-scorecard']:hover{background:var(--gold,#B8862E);color:#fff!important;}"
    + ".sc-overlay{position:fixed;inset:0;z-index:1000;background:rgba(20,20,35,.62);backdrop-filter:blur(3px);"
    + "display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease;}"
    + ".sc-overlay.on{opacity:1;}"
    + ".sc-modal{position:relative;width:100%;max-width:820px;height:min(88vh,900px);background:#FBF9F5;border-radius:16px;"
    + "overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(10px) scale(.99);transition:transform .2s ease;}"
    + ".sc-overlay.on .sc-modal{transform:none;}"
    + ".sc-modal iframe{width:100%;height:100%;border:0;display:block;}"
    + ".sc-close{position:absolute;top:10px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;"
    + "background:rgba(26,26,46,.9);color:#fff;font-size:20px;line-height:38px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);}"
    + ".sc-close:hover{background:#1A1A2E;}"
    + "@media (max-width:640px){.sc-modal{height:92vh;max-width:100%;border-radius:14px;}}";
  var style = document.createElement("style");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);

  var overlay = null, lastFocus = null;
  function close() {
    if (!overlay) return;
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    var el = overlay;
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 200);
    overlay = null;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function open() {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "sc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "eHive Clarity Scorecard");
    overlay.innerHTML =
      "<div class='sc-modal'>" +
      "<button class='sc-close' aria-label='Close'>✕</button>" +
      "<iframe src='" + SC_URL + "?embed=1' title='eHive Clarity Scorecard' loading='lazy'></iframe>" +
      "</div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    overlay.querySelector(".sc-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { overlay.classList.add("on"); });
    setTimeout(function () { var b = overlay && overlay.querySelector(".sc-close"); if (b) b.focus(); }, 60);
  }

  function wire() {
    var links = document.querySelectorAll("a[href*='clarity-scorecard']");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // allow open-in-new-tab
        e.preventDefault();
        open();
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

/* ===== eHive Brand Check — nav button + popup (progressive enhancement) =====
   Styles every link to /brand-check.html as a button and opens the Brand Check
   discovery form in an in-page modal instead of navigating. Falls back to the
   plain page if JS is off. Mirrors the Clarity Scorecard popup. */
(function () {
  "use strict";
  if (window.__ehBrandCheckModal) return;
  window.__ehBrandCheckModal = true;

  var BC_URL = "/brand-check.html";
  // Don't run on the Brand Check page itself.
  if (location.pathname.replace(/\/index\.html$/, "/").indexOf("brand-check") !== -1) return;

  var css = ""
    + ".nav-links a[href*='brand-check']{"
    + "display:inline-flex;align-items:center;gap:.4em;padding:.5em .95em;border:1px solid var(--gold,#B8862E);"
    + "border-radius:8px;color:var(--gold,#B8862E)!important;font-weight:600;transition:background .15s,color .15s;}"
    + ".nav-links a[href*='brand-check']:hover{background:var(--gold,#B8862E);color:#fff!important;}"
    + ".bc-overlay{position:fixed;inset:0;z-index:1000;background:rgba(20,20,35,.62);backdrop-filter:blur(3px);"
    + "display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease;}"
    + ".bc-overlay.on{opacity:1;}"
    + ".bc-modal{position:relative;width:100%;max-width:820px;height:min(90vh,940px);background:#FBF9F5;border-radius:16px;"
    + "overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(10px) scale(.99);transition:transform .2s ease;}"
    + ".bc-overlay.on .bc-modal{transform:none;}"
    + ".bc-modal iframe{width:100%;height:100%;border:0;display:block;}"
    + ".bc-close{position:absolute;top:10px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;"
    + "background:rgba(26,26,46,.9);color:#fff;font-size:20px;line-height:38px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);}"
    + ".bc-close:hover{background:#1A1A2E;}"
    + "@media (max-width:640px){.bc-modal{height:94vh;max-width:100%;border-radius:14px;}}";
  var style = document.createElement("style");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);

  var overlay = null, lastFocus = null;
  function close() {
    if (!overlay) return;
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    var el = overlay;
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 200);
    overlay = null;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  function open() {
    if (overlay) return;
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "bc-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "eHive Brand Check");
    overlay.innerHTML =
      "<div class='bc-modal'>" +
      "<button class='bc-close' aria-label='Close'>✕</button>" +
      "<iframe src='" + BC_URL + "?embed=1' title='eHive Brand Check' loading='lazy'></iframe>" +
      "</div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    overlay.querySelector(".bc-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { overlay.classList.add("on"); });
    setTimeout(function () { var b = overlay && overlay.querySelector(".bc-close"); if (b) b.focus(); }, 60);
  }

  function wire() {
    var links = document.querySelectorAll("a[href*='brand-check']");
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // allow open-in-new-tab
        e.preventDefault();
        open();
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

/* PWA: register the service worker so the site is installable from any page
   (Add to Home Screen / Install app). Harmless if sw.js is unavailable. */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () { /* non-fatal */ });
  });
}
