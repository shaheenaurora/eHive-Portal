/* ==========================================================================
   eHive interactive layer — concierge, pathfinder, palette, mini-apps
   Loaded after app.js. Everything feature-gated by DOM presence.
   ========================================================================== */
(function(){
"use strict";

var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function el(tag, cls, html){
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/* ---- toasts ---- */
var toastWrap = null;
function appToast(msg){
  if (!toastWrap){ toastWrap = el("div", "app-toasts"); document.body.appendChild(toastWrap); }
  var t = el("div", "app-toast", msg);
  toastWrap.appendChild(t);
  setTimeout(function(){ t.classList.add("hide"); setTimeout(function(){ t.remove(); }, 350); }, 2800);
}

/* ---- confetti burst at (x,y) ---- */
var CONF_COLORS = ["#D4A24C","#E2B968","#0A1628","#9CA9BC","#FAF8F3"];
function confetti(x, y, n){
  if (reduceMotion) return;
  n = n || 18;
  for (var i = 0; i < n; i++){
    var c = el("i", "app-confetti");
    c.style.left = (x + (Math.random() - .5) * 140) + "px";
    c.style.top = (y - 10 + (Math.random() - .5) * 30) + "px";
    c.style.background = CONF_COLORS[i % CONF_COLORS.length];
    c.style.animationDelay = (Math.random() * .25) + "s";
    c.style.animationDuration = (.7 + Math.random() * .5) + "s";
    document.body.appendChild(c);
    (function(node){ setTimeout(function(){ node.remove(); }, 1600); })(c);
  }
}
function confettiAt(elm, n){
  var r = elm.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top, n);
}

/* ================= CONCIERGE ================= */
var CG = {
  start: {
    text: "Hi — I&rsquo;m the eHive guide. I point people to the right door in about twenty seconds. What brings you here?",
    chips: [
      ["Set up a business", "setup"], ["Grow my business", "grow"],
      ["Join the Circle", "circle"], ["Just exploring", "explore"]
    ]
  },
  setup: {
    text: "Good instinct, doing it properly from day one. Do you know your jurisdiction path yet?",
    chips: [["Free zone", "setup2"], ["Mainland", "setup2"], ["Not sure yet", "setup2"]]
  },
  setup2: {
    text: "Either way, start with the <b>cost calculator</b> — thirty seconds, indicative numbers. Then a free consultation scopes your exact case in writing.",
    chips: [["Open the calculator", "go:business-setup.html#calculator"], ["Book a free setup call", "go:book.html?product=setup"], ["Start over", "start"]]
  },
  grow: {
    text: "What&rsquo;s the blocker, honestly?",
    chips: [["A stuck decision", "g_decision"], ["Growth has stalled", "g_stalled"],
            ["The brand isn&rsquo;t landing", "g_brand"], ["Operations depend on me", "g_ops"]]
  },
  g_decision: {
    text: "That points to the <b>Clarity Sprint</b> — three hours, one decision, AED 2,500–3,000. If the decision is bigger than one afternoon, the Strategy Sprint takes a full day.",
    chips: [["See Clarity Sprint", "go:consulting-clarity-sprint.html"], ["Take the fit quiz", "pf"], ["Start over", "start"]]
  },
  g_stalled: {
    text: "That&rsquo;s exactly what <b>GapNavigator</b> was built for — a diagnostic that finds the real constraint before you spend fixing the wrong thing.",
    chips: [["See GapNavigator", "go:consulting-gapnavigator.html"], ["Take the fit quiz", "pf"], ["Start over", "start"]]
  },
  g_brand: {
    text: "Then look at <b>Brand 3D</b> — positioning, identity and voice rebuilt together, AED 15,000–25,000 depending on scope.",
    chips: [["See Brand 3D", "go:consulting-brand-3d.html"], ["Take the fit quiz", "pf"], ["Start over", "start"]]
  },
  g_ops: {
    text: "Classic founder trap — the business runs on you, not on systems. <b>OpsBlueprint</b> maps the operation and designs the one that scales. Discovery call first, no charge.",
    chips: [["Book the discovery call", "go:book.html?product=opsblueprint"], ["Take the fit quiz", "pf"], ["Start over", "start"]]
  },
  circle: {
    text: "The Circle opens <b>1 August 2026</b> — the founding cohort is forming now. Tiers run from Horizon (AED 999/yr) to Zenith (invitation-only); Ascent fits most founders.",
    chips: [["See the tiers", "go:circle.html#tiers"], ["Join the waitlist", "go:get-started.html?door=circle"], ["Try the Hive Score demo", "sim"], ["Start over", "start"]]
  },
  explore: {
    text: "Then the <b>30-second pathfinder</b> is your best move — three questions, one honest recommendation. Or read the story first.",
    chips: [["Start the pathfinder", "pf"], ["Read about eHive", "go:about.html"], ["Start over", "start"]]
  }
};

function concierge(){
  var fab = el("button", "cg-fab");
  fab.setAttribute("aria-label", "Open the eHive guide");
  fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" stroke="#0A1628" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="#0A1628"/></svg>';
  document.body.appendChild(fab);

  var panel = null;
  function say(node, asUser){
    var body = panel.querySelector(".cg-body");
    if (asUser){
      body.appendChild(el("div", "cg-msg user", node));
      scrollBody();
      setTimeout(function(){ reply(node); }, reduceMotion ? 60 : 450);
      return;
    }
    var typing = el("div", "cg-typing", "<i></i><i></i><i></i>");
    body.appendChild(typing); scrollBody();
    setTimeout(function(){
      typing.remove();
      body.appendChild(el("div", "cg-msg bot", CG[node].text));
      renderChips(CG[node].chips);
      scrollBody();
    }, reduceMotion ? 80 : 650);
  }
  function reply(userText){ /* placeholder, replaced by flow */ }
  function scrollBody(){
    var body = panel.querySelector(".cg-body");
    body.scrollTop = body.scrollHeight;
  }
  function renderChips(chips){
    var wrap = panel.querySelector(".cg-chips");
    wrap.innerHTML = "";
    chips.forEach(function(c, i){
      var b = el("button", "cg-chip", c[0]);
      b.style.animationDelay = (i * .06) + "s";
      b.addEventListener("click", function(){ act(c[1], c[0]); });
      wrap.appendChild(b);
    });
  }
  function act(action, label){
    if (action.indexOf("go:") === 0){
      var url = action.slice(3);
      appToast("Opening <b>" + label + "</b>…");
      setTimeout(function(){ location.href = url; }, 450);
      return;
    }
    if (action === "pf"){ closePanel(); openPathfinder(); return; }
    if (action === "sim"){
      if (document.getElementById("hsSim")){
        closePanel();
        document.getElementById("hsSim").scrollIntoView({behavior:"smooth", block:"center"});
      } else {
        appToast("Opening <b>eHive Circle</b>…");
        setTimeout(function(){ location.href = "circle.html#tiers"; }, 450);
      }
      return;
    }
    say(label, true);
    pending = action;
  }
  var pending = "start";
  reply = function(){
    setTimeout(function(){ say(pending, false); }, 100);
  };
  function openPanel(){
    if (panel) return;
    panel = el("div", "cg-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "eHive guide");
    panel.innerHTML =
      '<div class="cg-head"><span class="cg-bee"><svg viewBox="0 0 24 24" fill="none">' +
      '<path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" stroke="#D4A24C" stroke-width="1.6"/>' +
      '<circle cx="12" cy="12" r="2.6" fill="#D4A24C"/></svg></span>' +
      '<div><b>The eHive guide</b><span>Scripted · honest · 20 sec</span></div>' +
      '<button class="cg-close" aria-label="Close guide">✕</button></div>' +
      '<div class="cg-body"></div><div class="cg-chips"></div>' +
      '<div class="cg-foot">A scripted guide, not a bot pretending to think.</div>';
    document.body.appendChild(panel);
    fab.classList.add("off");
    panel.querySelector(".cg-close").addEventListener("click", closePanel);
    say("start", false);
    document.addEventListener("keydown", escClose);
  }
  function escClose(e){ if (e.key === "Escape") closePanel(); }
  function closePanel(){
    if (!panel) return;
    panel.remove(); panel = null;
    fab.classList.remove("off");
    document.removeEventListener("keydown", escClose);
    fab.focus();
  }
  fab.addEventListener("click", openPanel);
}

/* ================= PATHFINDER ================= */
var PF_Q = [
  { q: "Where is the business today?",
    opts: [["idea","Just an idea — not launched"],["early","Early — first customers"],
           ["growing","Growing"],["scaling","Scaling"]] },
  { q: "What do you need most right now?",
    opts: [["legal","A legal home in the UAE"],["clarity","Clarity on a hard decision"],
           ["people","People who&rsquo;ve done it before"],["execution","Senior hands on execution"]] },
  { q: "When do you want to move?",
    opts: [["now","Now"],["quarter","This quarter"],["exploring","Just exploring"]] }
];
function pfResult(a){
  var r;
  if (a[1] === "legal"){
    r = { title: "Business Setup",
      desc: "Start with the indicative cost calculator, then a free consultation scopes your exact case — jurisdiction, activity, visas — in writing.",
      ctas: [["Calculate my setup cost","business-setup.html#calculator"],["Book a free consultation","book.html?product=setup"]] };
  } else if (a[1] === "people"){
    r = { title: "eHive Circle",
      desc: "The founding cohort opens 1 August 2026. Four tiers from AED 999 a year — Ascent fits most founders. Membership is how you stop building alone.",
      ctas: [["See the tiers","circle.html#tiers"],["Join the waitlist","get-started.html?door=circle"]] };
  } else if (a[1] === "execution"){
    if (a[0] === "growing" || a[0] === "scaling"){
      r = { title: "Momentum90",
        desc: "A senior operator in the boat for a quarter — strategy, execution reviews and accountability on a fixed cadence. Starts with a no-charge discovery call.",
        ctas: [["See Momentum90","consulting-momentum90.html"],["Book the discovery call","book.html?product=momentum90"]] };
    } else {
      r = { title: "OpsBlueprint",
        desc: "The business should run on systems, not on you. OpsBlueprint maps the operation and designs the one that scales — discovery call first, no charge.",
        ctas: [["See OpsBlueprint","consulting-opsblueprint.html"],["Book the discovery call","book.html?product=opsblueprint"]] };
    }
  } else {
    if (a[0] === "growing" || a[0] === "scaling"){
      r = { title: "Strategy Sprint",
        desc: "One full day to turn options into a sequenced plan — AED 10,000–15,000 depending on format. You leave with the decision made and the 90-day map in hand.",
        ctas: [["See Strategy Sprint","consulting-strategy-sprint.html"],["Book this sprint","book.html?product=strategy-sprint"]] };
    } else {
      r = { title: "Clarity Sprint",
        desc: "Three hours, one decision, AED 2,500–3,000. The fastest honest answer in the catalog — come with your three hardest questions.",
        ctas: [["See Clarity Sprint","consulting-clarity-sprint.html"],["Book this sprint","book.html?product=clarity-sprint"]] };
    }
  }
  if (a[2] === "exploring") r.desc = "No rush — and when you&rsquo;re ready: " + r.desc.charAt(0).toLowerCase() + r.desc.slice(1);
  return r;
}

var pfmOpen = false;
function openPathfinder(){
  if (pfmOpen) return;
  pfmOpen = true;
  var step = 0, answers = [];
  var overlay = el("div", "pfm-overlay");
  overlay.setAttribute("role","dialog");
  overlay.setAttribute("aria-modal","true");
  overlay.setAttribute("aria-label","The 30-second pathfinder");
  var card = el("div", "pfm-card");
  card.innerHTML =
    '<button class="pfm-x" aria-label="Close">✕</button>' +
    '<div class="pfm-top"><div class="pfm-kicker">The 30-second pathfinder</div><h3>Find your door.</h3></div>' +
    '<div class="pfm-prog"><i></i></div>' +
    '<div class="pfm-body"></div>';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  document.body.style.overflow = "hidden";

  function paint(){
    card.querySelector(".pfm-prog i").style.width = ((step) / 3 * 100 + 8) + "%";
    var body = card.querySelector(".pfm-body");
    if (step >= 3){
      card.querySelector(".pfm-prog i").style.width = "100%";
      var r = pfResult(answers);
      body.innerHTML =
        '<div class="pfm-result">' +
        '<div class="pr-kicker">Your door</div>' +
        '<h4>' + r.title + '</h4><p>' + r.desc + '</p>' +
        '<div class="doors">' +
        '<a class="btn btn-primary" href="' + r.ctas[0][1] + '">' + r.ctas[0][0] + ' <span class="arr">→</span></a>' +
        '<a class="btn btn-ghost" style="color:var(--ink-900);border-color:rgba(20,24,33,.3)" href="' + r.ctas[1][1] + '">' + r.ctas[1][0] + '</a>' +
        '</div><button class="pfm-restart">↺ Run it again</button></div>';
      var res = body.querySelector(".pfm-result");
      confettiAt(res, reduceMotion ? 0 : 26);
      body.querySelector(".pfm-restart").addEventListener("click", function(){
        step = 0; answers = []; paint();
      });
      return;
    }
    var html = '<p class="pfm-q">' + PF_Q[step].q + '</p><div class="pfm-opts">';
    PF_Q[step].opts.forEach(function(o){ html += '<button type="button" class="pfm-opt" data-v="' + o[0] + '"><span class="po-dot"></span>' + o[1] + '</button>'; });
    html += '</div>';
    if (step > 0) html += '<button type="button" class="pfm-back">← Back a question</button>';
    body.innerHTML = html;
    body.querySelectorAll(".pfm-opt").forEach(function(b){
      b.addEventListener("click", function(){
        answers[step] = b.getAttribute("data-v");
        var q = body.querySelector(".pfm-q");
        q.classList.add("swap-out");
        setTimeout(function(){ step++; paint(); }, reduceMotion ? 0 : 170);
      });
    });
    var back = body.querySelector(".pfm-back");
    if (back) back.addEventListener("click", function(){ step--; paint(); });
  }
  function close(){
    overlay.remove();
    document.body.style.overflow = "";
    pfmOpen = false;
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e){ if (e.key === "Escape") close(); }
  overlay.addEventListener("click", function(e){ if (e.target === overlay) close(); });
  card.querySelector(".pfm-x").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  paint();
}

/* ================= COMMAND PALETTE ================= */
var CMDK_ITEMS = [
  ["Business Setup","Page","business-setup.html"],
  ["Cost calculator","Tool","business-setup.html#calculator"],
  ["Setup walkthrough","Tool","business-setup.html#journey"],
  ["Consulting overview","Page","consulting.html"],
  ["Which product fits me?","Tool","consulting.html#fit"],
  ["Sprint day, hour by hour","Tool","consulting.html#sprintday"],
  ["Clarity Sprint","Product","consulting-clarity-sprint.html"],
  ["Strategy Sprint","Product","consulting-strategy-sprint.html"],
  ["GapNavigator","Product","consulting-gapnavigator.html"],
  ["Brand 3D","Product","consulting-brand-3d.html"],
  ["OpsBlueprint","Product","consulting-opsblueprint.html"],
  ["Momentum90","Product","consulting-momentum90.html"],
  ["eHive Circle","Page","circle.html"],
  ["Hive Score demo","Tool","circle.html#tiers"],
  ["Insights — The Hive Journal","Page","insights.html"],
  ["About eHive","Page","about.html"],
  ["Get Started","Action","get-started.html"],
  ["Book a call","Action","book.html"],
  ["30-second pathfinder","Tool","pf:"],
  ["Member login","Page","login.html"]
];
function cmdk(){
  var open = false, overlay = null, sel = 0, filtered = CMDK_ITEMS;
  function show(){
    if (open) return;
    open = true; sel = 0; filtered = CMDK_ITEMS;
    overlay = el("div", "cmdk-overlay");
    overlay.innerHTML =
      '<div class="cmdk"><input type="text" placeholder="Where to? Type to filter…" aria-label="Quick navigation">' +
      '<div class="cmdk-list" role="listbox"></div>' +
      '<div class="cmdk-foot"><span>↑↓ move</span><span>↵ open</span><span>esc close</span></div></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    var input = overlay.querySelector("input");
    input.addEventListener("input", function(){
      var q = input.value.trim().toLowerCase();
      filtered = CMDK_ITEMS.filter(function(i){ return i[0].toLowerCase().indexOf(q) !== -1 || i[1].toLowerCase().indexOf(q) !== -1; });
      sel = 0; paintList();
    });
    input.addEventListener("keydown", function(e){
      if (e.key === "ArrowDown"){ e.preventDefault(); sel = Math.min(sel + 1, filtered.length - 1); paintList(); }
      else if (e.key === "ArrowUp"){ e.preventDefault(); sel = Math.max(sel - 1, 0); paintList(); }
      else if (e.key === "Enter"){ activate(filtered[sel]); }
    });
    overlay.addEventListener("click", function(e){ if (e.target === overlay) hide(); });
    input.focus();
    paintList();
  }
  function paintList(){
    var list = overlay.querySelector(".cmdk-list");
    if (!filtered.length){
      list.innerHTML = '<div style="padding:1rem;color:var(--ink-600);font-size:.88rem">Nothing matches — try “setup”, “sprint”, “circle”…</div>';
      return;
    }
    list.innerHTML = "";
    filtered.slice(0, 9).forEach(function(item, i){
      var b = el("button", "cmdk-item" + (i === sel ? " sel" : ""),
        '<span class="ck-tag">' + item[1] + '</span><span>' + item[0] + '</span>');
      b.addEventListener("click", function(){ activate(item); });
      b.addEventListener("mousemove", function(){ sel = i; paintList(); });
      list.appendChild(b);
    });
  }
  function activate(item){
    if (!item) return;
    hide();
    if (item[2] === "pf:"){ openPathfinder(); return; }
    location.href = item[2];
  }
  function hide(){
    if (!open) return;
    overlay.remove(); overlay = null; open = false;
    document.body.style.overflow = "";
  }
  document.addEventListener("keydown", function(e){
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"){ e.preventDefault(); if (open) hide(); else show(); }
    else if (e.key === "Escape" && open) hide();
  });
}

/* ================= HIVE SCORE SIMULATOR ================= */
function hiveSim(){
  var root = document.getElementById("hsSim");
  if (!root) return;
  var score = 0, CIRC = 326.7;
  var arc = root.querySelector("#simArc"),
      num = root.querySelector("#simScore"),
      unlock = root.querySelector("#simUnlock"),
      miles = root.querySelectorAll("#simMiles li");
  var LABELS = [[0,"Your first action starts the journey."],[10,"New-member badge earned — you&rsquo;re in the room."],
    [25,"Cross-tier rooms are open to you now."],[50,"Councils notice members at 50+."],
    [80,"Vanguard eligibility reached. That&rsquo;s the top of the public ladder."]];
  function paint(animPts){
    arc.style.strokeDashoffset = String(CIRC * (1 - score / 100));
    if (animPts){
      var from = +num.textContent, t0 = null;
      if (reduceMotion){ num.textContent = score; }
      else {
        requestAnimationFrame(function step(t){
          if (!t0) t0 = t;
          var k = Math.min(1, (t - t0) / 500);
          num.textContent = Math.round(from + (score - from) * k);
          if (k < 1) requestAnimationFrame(step);
        });
      }
    } else { num.textContent = score; }
    var label = LABELS[0][1];
    LABELS.forEach(function(l){ if (score >= l[0]) label = l[1]; });
    unlock.innerHTML = label;
    miles.forEach(function(m){
      var at = +m.getAttribute("data-at");
      if (score >= at && !m.classList.contains("hit")){
        m.classList.add("hit");
        confettiAt(m, 12);
        appToast("Unlocked: <b>" + m.querySelector("span").textContent + "</b>");
      } else if (score < at){ m.classList.remove("hit"); }
    });
  }
  root.querySelectorAll(".sim-act").forEach(function(b){
    b.addEventListener("click", function(){
      var pts = +b.getAttribute("data-pts");
      if (score >= 100){ appToast("You&rsquo;re at <b>100</b> — go home, you&rsquo;ve earned it."); return; }
      score = Math.min(100, score + pts);
      b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop");
      paint(true);
    });
  });
  root.querySelector("#simReset").addEventListener("click", function(){
    score = 0; paint(false);
    appToast("Score reset — the quarter starts over.");
  });
  paint(false);
}

/* ================= SETUP JOURNEY ================= */
var JR_DATA = [
  ["Choose your jurisdiction",
   "Free zone or mainland — the decision that shapes cost, market access and visas. We model both paths for your activity before you commit to either.",
   "Your activity, roughly described — we handle the mapping."],
  ["Trade name &amp; license",
   "Name reservation, activity codes, license application — filed correctly the first time, so nothing bounces back.",
   "Passport copy and three name options you like."],
  ["Visas &amp; establishment card",
   "Establishment card, entry permits, medicals, Emirates ID — sequenced so nothing waits on something else.",
   "Your availability for one medical visit."],
  ["Bank account",
   "The hardest step for most founders. We prepare the file banks actually want to see, and make the introductions.",
   "A clear business description and source-of-funds documents."],
  ["Office &amp; go live",
   "Flexi-desk to private office, Ejari where needed, license in hand — you&rsquo;re operational.",
   "Nothing. That&rsquo;s the point."]
];
function journey(){
  var root = document.getElementById("setupJourney");
  if (!root) return;
  var idx = 0, playing = null;
  var steps = root.querySelectorAll(".jr-step"),
      fill = root.querySelector("#jrFill"),
      card = root.querySelector("#jrCard"),
      playBtn = root.querySelector("#jrPlay");
  function show(i, animate){
    idx = i;
    steps.forEach(function(s, j){
      s.classList.toggle("on", j === i);
      s.classList.toggle("done", j < i);
    });
    fill.style.width = (i / 4 * 100) + "%";
    var apply = function(){
      card.querySelector("#jrKicker").textContent = "Step " + (i + 1) + " of 5";
      card.querySelector("#jrTitle").innerHTML = JR_DATA[i][0];
      card.querySelector("#jrDesc").innerHTML = JR_DATA[i][1];
      card.querySelector("#jrYou").innerHTML = JR_DATA[i][2];
      card.classList.remove("swap-out");
      card.classList.add("swap-in");
    };
    if (animate && !reduceMotion){
      card.classList.add("swap-out");
      setTimeout(apply, 150);
    } else { apply(); }
  }
  function stopPlay(){
    if (playing){ clearInterval(playing); playing = null; }
    playBtn.classList.remove("playing");
    playBtn.innerHTML = '<span class="jr-ic">▶</span> Play the journey';
  }
  steps.forEach(function(s){
    s.addEventListener("click", function(){
      stopPlay();
      show(+s.getAttribute("data-jr"), true);
    });
  });
  playBtn.addEventListener("click", function(){
    if (playing){ stopPlay(); return; }
    playBtn.classList.add("playing");
    playBtn.innerHTML = '<span class="jr-ic">■</span> Stop';
    show(0, true);
    playing = setInterval(function(){
      if (idx >= 4){ stopPlay(); appToast("That&rsquo;s the whole journey — <b>you&rsquo;re operational</b>."); return; }
      show(idx + 1, true);
    }, 2600);
  });
  fill.style.width = "0%";
}

/* ================= JURISDICTION COMPARER ================= */
function comparer(){
  var root = document.getElementById("jurCompare");
  if (!root) return;
  var bars = root.querySelectorAll(".jc-bar i"),
      vals = root.querySelectorAll(".jc-val"),
      btns = root.querySelectorAll(".jc-toggle button");
  function paint(mode){
    bars.forEach(function(b){
      b.style.width = b.getAttribute("data-" + mode) + "%";
    });
    vals.forEach(function(v){
      v.textContent = v.getAttribute("data-" + mode);
      v.classList.remove("swap-out");
      v.classList.add("swap-in");
    });
  }
  btns.forEach(function(b){
    b.addEventListener("click", function(){
      if (b.classList.contains("on")) return;
      btns.forEach(function(x){
        x.classList.toggle("on", x === b);
        x.setAttribute("aria-selected", x === b ? "true" : "false");
      });
      vals.forEach(function(v){ v.classList.add("swap-out"); });
      setTimeout(function(){ paint(b.getAttribute("data-jc")); }, reduceMotion ? 0 : 150);
    });
  });
  /* grow bars when scrolled into view */
  if ("IntersectionObserver" in window && !reduceMotion){
    bars.forEach(function(b){ b.style.width = "0%"; });
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){
          setTimeout(function(){ paint("fz"); }, 200);
          io.disconnect();
        }
      });
    }, {threshold:.35});
    io.observe(root);
  }
}

/* ================= SPRINT EXPLORER ================= */
var SX_DATA = [
  ["09:00 — Context download",
   "Everything on the table: your numbers, your constraints, the decision you&rsquo;re actually facing. No decks to impress — we start from the honest picture."],
  ["10:30 — Options on the table",
   "Every credible path laid out with costs, risks and second-order effects. You hear the options you didn&rsquo;t know you had."],
  ["12:00 — Working lunch",
   "The room stays on. Informal and honest — this is often where the real constraint finally surfaces."],
  ["13:00 — Stress-test",
   "We attack the leading option: what breaks it, what it costs to be wrong, and what you have to believe for it to work."],
  ["15:00 — The decision",
   "One decision, made by you — with the reasoning documented so it survives the next board meeting, investor call, or 3am doubt."],
  ["16:30 — The 90-day map",
   "The decision sequenced into owners, dates and first moves — the document you execute from on Monday morning."]
];
function sprintX(){
  var root = document.getElementById("sprintExplorer");
  if (!root) return;
  var idx = 0, playing = null;
  var nodes = root.querySelectorAll(".sx-node"),
      fill = root.querySelector("#sxFill"),
      card = root.querySelector("#sxCard"),
      playBtn = root.querySelector("#sxPlay");
  function show(i, animate){
    idx = i;
    nodes.forEach(function(n, j){
      n.classList.toggle("on", j === i);
      n.setAttribute("aria-selected", j === i ? "true" : "false");
    });
    fill.style.width = (i / 5 * 100) + "%";
    var apply = function(){
      card.querySelector("#sxKicker").innerHTML = SX_DATA[i][0];
      card.querySelector("#sxDesc").innerHTML = SX_DATA[i][1];
      card.classList.remove("swap-out");
      card.classList.add("swap-in");
    };
    if (animate && !reduceMotion){
      card.classList.add("swap-out");
      setTimeout(apply, 150);
    } else { apply(); }
  }
  function stopPlay(){
    if (playing){ clearInterval(playing); playing = null; }
    playBtn.classList.remove("playing");
    playBtn.innerHTML = '<span class="jr-ic">▶</span> Play the day';
  }
  nodes.forEach(function(n){
    n.addEventListener("click", function(){
      stopPlay();
      show(+n.getAttribute("data-sx"), true);
    });
  });
  playBtn.addEventListener("click", function(){
    if (playing){ stopPlay(); return; }
    playBtn.classList.add("playing");
    playBtn.innerHTML = '<span class="jr-ic">■</span> Stop';
    show(0, true);
    playing = setInterval(function(){
      if (idx >= 5){ stopPlay(); appToast("And that&rsquo;s a sprint day — <b>decision made, map in hand</b>."); return; }
      show(idx + 1, true);
    }, 2400);
  });
}

/* ================= motion upgrades for existing components ================= */
function motionHooks(){
  /* funnel steps slide in on change */
  var steps = document.querySelectorAll(".gs-step");
  if (steps.length && "MutationObserver" in window){
    var mo = new MutationObserver(function(muts){
      muts.forEach(function(m){
        if (reduceMotion) return;
        /* guard every mutation on real state — classList ops on absent/present
           classes can still enqueue records and would loop the observer */
        if (m.target.classList.contains("active")){
          if (!m.target.classList.contains("step-in")) m.target.classList.add("step-in");
        } else if (m.target.classList.contains("step-in")){
          m.target.classList.remove("step-in");
        }
      });
    });
    steps.forEach(function(s){ mo.observe(s, {attributes:true, attributeFilter:["class"]}); });
  }
  /* calculator amount swap animation */
  var amt = document.getElementById("coAmount");
  if (amt && "MutationObserver" in window && !reduceMotion){
    var mo2 = new MutationObserver(function(){
      amt.classList.remove("swap-out"); void amt.offsetWidth;
      amt.classList.add("swap-in");
    });
    mo2.observe(amt, {childList:true, characterData:true, subtree:true});
  }
}

/* ================= boot ================= */
if (!document.body.classList.contains("portal")) concierge();
cmdk();
hiveSim();
journey();
comparer();
sprintX();
motionHooks();
document.querySelectorAll("[data-open-pathfinder]").forEach(function(b){
  b.addEventListener("click", openPathfinder);
});
})();
