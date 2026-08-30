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
var PORTAL_LIVE = true; /* portal is live at /portal */
var WA_NUMBER = null; /* e.g. "9715XXXXXXXX" once the WhatsApp line exists */

/* ---- launch date (single source of truth) -------------------------------
   1 Oct 2026, 00:00 Gulf Standard Time. Used by countdowns and launch copy. */
var LAUNCH_DATE_UTC = Date.UTC(2026, 8, 30, 20, 0, 0);
var LAUNCH_DATE = new Date(LAUNCH_DATE_UTC);
function launchDateLabel() {
  return LAUNCH_DATE.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Dubai",
  });
}
window.ehiveLaunchLabel = launchDateLabel;

function submitLead(payload, onOk, onErr) {
  if (!FORM_ENDPOINT || FORM_ENDPOINT.indexOf("XXORESET") !== -1) {
    if (onErr) onErr("not-configured");
    return;
  }
  fetch(FORM_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  })
    .then(function (r) {
      if (!r.ok) {
        if (onErr) onErr("http-" + r.status);
        return;
      }
      r.json()
        .then(function (d) {
          if (onOk) onOk(d);
        })
        .catch(function () {
          if (onErr) onErr("parse");
        });
    })
    .catch(function (e) {
      if (onErr) onErr("network");
    });
}

(function () {
  "use strict";

  function isValidEmail(email) {
    if (typeof email !== "string") return false;
    email = email.trim();
    /* Basic RFC-like check: one @, domain has at least one dot, no spaces, reasonable length */
    if (!email || email.length > 254) return false;
    var parts = email.split("@");
    if (parts.length !== 2) return false;
    var local = parts[0];
    var domain = parts[1];
    if (!local || !domain) return false;
    if (domain.indexOf(".") === -1) return false;
    if (domain.startsWith(".") || domain.endsWith(".")) return false;
    if (/\.\./.test(domain)) return false;
    if (/\s/.test(email)) return false;
    return true;
  }
  function sanitizePhone(phone) {
    return (phone || "").replace(/[^\d+\-\s()]/g, "");
  }
  function setBtnBusy(btn, label) {
    if (!btn || btn.classList.contains("busy") || btn.disabled) return false;
    btn.dataset.originalText = btn.textContent;
    btn.textContent = label;
    btn.classList.add("busy");
    btn.disabled = true;
    return true;
  }
  function restoreBtn(btn) {
    if (!btn) return;
    btn.classList.remove("busy");
    btn.disabled = false;
    if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
      delete btn.dataset.originalText;
    }
  }

  /* Mark the page animation-capable. Until .anim is set, all content
     renders in its final visible state (no-JS safe). */
  document.body.classList.add("anim");
  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  window.addEventListener("load", function () {
    setTimeout(function () {
      document.body.classList.add("loaded");
    }, 120);
  });
  setTimeout(function () {
    document.body.classList.add("loaded");
  }, 1600);

  /* ---- nav: condense after 40px ---- */
  var nav = document.getElementById("siteNav");
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 40);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---- current-page indicator ---- */
  var here = location.pathname.split("/").pop() || "index.html";
  if (here === "" || location.pathname === "/" || location.pathname === "/index.html")
    here = "index.html";
  document.querySelectorAll(".nav-links a").forEach(function (a) {
    a.removeAttribute("aria-current");
    var href = (a.getAttribute("href") || "").split("#")[0].split("?")[0];
    if (href === "/") href = "index.html";
    href = href.replace(/^\/+/, "");
    if (href && href === here) a.setAttribute("aria-current", "page");
  });

  /* ---- mobile menu: off-canvas with focus trap + Esc ---- */
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("navMenu");
  function menuLinks() {
    return menu
      ? Array.prototype.slice.call(menu.querySelectorAll("a, button"))
      : [];
  }
  function openMenu() {
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
    var links = menuLinks();
    if (links.length) links[0].focus();
  }
  function closeMenu() {
    if (!document.body.classList.contains("menu-open")) return;
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      if (document.body.classList.contains("menu-open")) closeMenu();
      else openMenu();
    });
    menuLinks().forEach(function (a) {
      a.addEventListener("click", function () {
        document.body.classList.remove("menu-open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (!document.body.classList.contains("menu-open")) return;
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key !== "Tab") return;
      var links = menuLinks();
      if (!links.length) return;
      var first = links[0],
        last = links[links.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /* ---- scroll reveals (fail-safe: reveal all if IO never fires) ---- */
  var ioAlive = false;
  var reveals = document.querySelectorAll(".reveal");
  if (reveals.length) {
    if ("IntersectionObserver" in window && !reduceMotion) {
      var io = new IntersectionObserver(
        function (entries) {
          ioAlive = true;
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add("in-view");
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.14, rootMargin: "0px 0px -6% 0px" }
      );
      reveals.forEach(function (el) {
        io.observe(el);
      });
    } else {
      ioAlive = true;
      reveals.forEach(function (el) {
        el.classList.add("in-view");
      });
    }
    setTimeout(function () {
      if (!ioAlive) {
        document
          .querySelectorAll(".reveal:not(.in-view)")
          .forEach(function (el) {
            el.classList.add("in-view");
          });
        var st = document.getElementById("steps");
        if (st) st.classList.add("draw");
      }
      document.body.classList.add("loaded");
    }, 2600);
  }

  /* ---- homepage editorial reveals (.h-reveal -> .in) --------------------
     The light marketing homepage uses .h-reveal; this drives the staggered
     fade/slide entrance that makes the page feel alive on scroll. */
  var hReveals = document.querySelectorAll(".h-reveal");
  if (hReveals.length) {
    if ("IntersectionObserver" in window && !reduceMotion) {
      var hio = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              hio.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
      );
      hReveals.forEach(function (el) {
        hio.observe(el);
      });
      // Reveal hero elements immediately for first paint impact.
      document
        .querySelectorAll(".h-hero .h-reveal, .h-trust .h-reveal")
        .forEach(function (el) {
          setTimeout(function () {
            el.classList.add("in");
            hio.unobserve(el);
          }, 300 + (parseFloat(getComputedStyle(el).getPropertyValue("--d")) || 0) * 1000);
        });
    } else {
      hReveals.forEach(function (el) {
        el.classList.add("in");
      });
    }
    setTimeout(function () {
      document
        .querySelectorAll(".h-reveal:not(.in)")
        .forEach(function (el) {
          el.classList.add("in");
        });
    }, 3000);
  }

  /* ---- auto-reveal sections/cards that don't have explicit reveal classes ----
     Makes every public page feel alive without editing every HTML file.
     Respects prefers-reduced-motion and never hides content if JS fails. */
  if (!reduceMotion) {
    var autoSelectors = [
      ".h-section:not(.no-reveal)",
      ".h-product",
      ".h-assess-card",
      ".h-value-card",
      ".h-service-card",
      ".h-door",
      ".h-offer",
      ".eh-hero-v2 .h-eyebrow",
      ".eh-hero-v2 h1",
      ".eh-hero-v2 .h-lede",
      ".eh-hero-v2 .h-hero-actions",
    ];
    var autoRevealTargets = document.querySelectorAll(autoSelectors.join(","));
    if (autoRevealTargets.length && "IntersectionObserver" in window) {
      var autoIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              e.target.classList.add("auto-revealed");
              autoIO.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -5% 0px" }
      );
      autoRevealTargets.forEach(function (el, i) {
        el.classList.add("auto-reveal");
        el.style.setProperty("--ar-d", (i % 5) * 0.08 + "s");
        autoIO.observe(el);
      });
    } else {
      autoRevealTargets.forEach(function (el) {
        el.classList.add("auto-revealed");
      });
    }
  }

  /* ---- scroll progress indicator ---- */
  (function () {
    var bar = document.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    function updateProgress() {
      var doc = document.documentElement;
      var scroll = doc.scrollTop || document.body.scrollTop;
      var height = doc.scrollHeight - doc.clientHeight;
      var pct = height > 0 ? (scroll / height) * 100 : 0;
      bar.style.setProperty("--progress", pct.toFixed(2) + "%");
    }
    window.addEventListener("scroll", updateProgress, { passive: true });
    window.addEventListener("resize", updateProgress);
    updateProgress();
  })();

  /* ---- how-it-works connector line ---- */
  var steps = document.getElementById("steps");
  if (steps) {
    if ("IntersectionObserver" in window && !reduceMotion) {
      var so = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              steps.classList.add("draw");
              so.disconnect();
            }
          });
        },
        { threshold: 0.3 }
      );
      so.observe(steps);
    } else {
      steps.classList.add("draw");
    }
  }

  /* ---- footer year ---- */
  document.querySelectorAll("#year").forEach(function (y) {
    y.textContent = new Date().getFullYear();
  });

  /* ---- centralised launch date copy ------------------------------------
     Any [data-launch-date] span is filled from LAUNCH_DATE. The static
     fallback in the HTML keeps the date visible if JS is disabled. */
  document.querySelectorAll("[data-launch-date]").forEach(function (el) {
    el.textContent = launchDateLabel();
  });

  /* ---- newsletter: honest capture --------------------------------------
     Wires to the ESP at go-live via FORM_ENDPOINT. Until then it says so. */
  document.querySelectorAll(".news-form, .sub-form").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = f.querySelector('input[type="email"]');
      if (!inp || !isValidEmail(inp.value.trim())) {
        if (inp) inp.focus();
        return;
      }
      var email = inp.value.trim();
      submitLead(
        {
          form: "newsletter",
          email: email,
          source_page: location.pathname.split("/").pop(),
          timestamp: new Date().toISOString(),
          user_agent: navigator.userAgent,
        },
        function () {
          f.innerHTML =
            '<p style="margin:0;color:var(--gold-2);font-size:.92rem">You\u2019re on the list — watch your inbox.</p>';
        },
        function () {
          f.innerHTML =
            '<p style="margin:0;color:var(--gold-2);font-size:.92rem">The Journal list opens with the launch on ' +
            launchDateLabel() +
            " — your email hasn\u2019t been stored yet. <a href='contact.html'>Contact us</a> and we\u2019ll keep you posted.</p>";
        }
      );
    });
  });

  /* ---- banner parallax + subtle motion ------------------------------------
     Inner-page image banners get a slow parallax shift on scroll and a
     gentle reveal when they enter the viewport. Keeps long pages alive
     without distracting from the copy. */
  (function () {
    var banners = document.querySelectorAll(".h-img-banner img");
    if (!banners.length) return;
    var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          entry.target.dataset.inview = entry.isIntersecting ? "1" : "0";
        });
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    banners.forEach(function (img) {
      io.observe(img);
      img.style.transform = "scale(1.12) translateY(0)";
    });
    function onScroll() {
      banners.forEach(function (img) {
        if (img.dataset.inview !== "1") return;
        var banner = img.closest(".h-img-banner");
        var rect = banner.getBoundingClientRect();
        var winH = window.innerHeight;
        var progress = (winH - rect.top) / (winH + rect.height);
        var shift = (progress - 0.5) * 18; // +/- 9px
        img.style.transform = "scale(1.12) translateY(" + shift.toFixed(2) + "px)";
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  })();

  /* ---- founding-cohort countdown ------------------------------------------
     Target: LAUNCH_DATE_UTC (1 Oct 2026 GST).
     Any [data-countdown] block with .cd-d/.cd-h/.cd-m/.cd-s cells is driven;
     [data-cd-days] elements receive the plain day count. Zeroes, never dashes. */
  (function () {
    var blocks = document.querySelectorAll("[data-countdown]");
    var daySlots = document.querySelectorAll("[data-cd-days]");
    if (!blocks.length && !daySlots.length) return;
    var target = LAUNCH_DATE_UTC;
    function pad(n) {
      return String(n).padStart(2, "0");
    }
    function tick() {
      var diff = target - Date.now();
      if (diff <= 0) {
        blocks.forEach(function (b) {
          b.querySelectorAll(".cd-d,.cd-h,.cd-m,.cd-s").forEach(function (c) {
            c.textContent = "0";
          });
          var date = b.parentElement
            ? b.parentElement.querySelector(".count-date")
            : null;
          if (date) date.textContent = "The founding cohort is open";
        });
        daySlots.forEach(function (el) {
          el.textContent = "Open now";
        });
        document.querySelectorAll("[data-cd-open]").forEach(function (el) {
          el.textContent = "The founding cohort is open";
        });
        return; /* stop ticking: the open state is final */
      }
      var d = Math.floor(diff / 864e5);
      blocks.forEach(function (b) {
        var q = function (sel) {
          return b.querySelector(sel);
        };
        if (q(".cd-d")) q(".cd-d").textContent = d;
        if (q(".cd-h"))
          q(".cd-h").textContent = pad(Math.floor(diff / 36e5) % 24);
        if (q(".cd-m"))
          q(".cd-m").textContent = pad(Math.floor(diff / 6e4) % 60);
        if (q(".cd-s"))
          q(".cd-s").textContent = pad(Math.floor(diff / 1e3) % 60);
      });
      daySlots.forEach(function (el) {
        el.textContent = d;
      });
      setTimeout(tick, 1000);
    }
    tick();
  })();

  /* ---- hive network hero canvas ------------------------------------------
     <= 40 nodes. Connecting lines fade in, orchestrated, on load; then drift.
     Cursor brightens nearby nodes (desktop). Pauses off-screen and on hidden
     tab. One static frame under reduced motion. */
  (function () {
    var canvas = document.getElementById("lattice");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var W,
      H,
      DPR,
      nodes = [],
      mouse = { x: -9999, y: -9999 };
    var GOLD = "218,58,34",
      MIST = "156,169,188";
    var running = false,
      rafId = null,
      startT = 0;

    function sizeCanvas() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    function seed() {
      nodes = [];
      var n = Math.min(40, Math.max(24, Math.round((W * H) / 34000)));
      for (var i = 0; i < n; i++) {
        var gold = Math.random() < 0.16;
        nodes.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.24,
          vy: (Math.random() - 0.5) * 0.24,
          r: gold ? 1.7 + Math.random() * 1.2 : 1 + Math.random() * 1.1,
          gold: gold,
          pulse: Math.random() * Math.PI * 2,
          ord: i,
        });
      }
    }
    function draw(staticFrame, intro) {
      ctx.clearRect(0, 0, W, H);
      var LINK = Math.min(180, Math.max(120, W / 8));
      var i, j, a, b, dx, dy, d, alpha;
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        for (j = i + 1; j < nodes.length; j++) {
          b = nodes[j];
          dx = a.x - b.x;
          dy = a.y - b.y;
          d = Math.sqrt(dx * dx + dy * dy);
          if (d < LINK) {
            alpha = (1 - d / LINK) * (a.gold && b.gold ? 0.5 : 0.2);
            /* orchestrated intro: links appear in node order */
            alpha *= Math.max(
              0,
              Math.min(1, intro * 1.6 - ((a.ord + b.ord) % 9) * 0.09)
            );
            if (alpha <= 0) continue;
            ctx.strokeStyle =
              "rgba(" +
              (a.gold || b.gold ? GOLD : MIST) +
              "," +
              alpha.toFixed(3) +
              ")";
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      for (i = 0; i < nodes.length; i++) {
        a = nodes[i];
        var boost = 0;
        dx = a.x - mouse.x;
        dy = a.y - mouse.y;
        d = Math.sqrt(dx * dx + dy * dy);
        if (d < 140) {
          boost = 1 - d / 140;
        }
        var glow = (a.gold ? 0.85 : 0.5) * Math.min(1, intro * 1.4);
        var rr = a.r + Math.sin(a.pulse) * 0.3 + boost * 1.7;
        if (a.gold) {
          ctx.shadowColor = "rgba(" + GOLD + ",.9)";
          ctx.shadowBlur = 10 + boost * 16;
        }
        ctx.fillStyle =
          "rgba(" +
          (a.gold ? GOLD : MIST) +
          "," +
          Math.min(1, glow + boost * 0.5).toFixed(3) +
          ")";
        ctx.beginPath();
        ctx.arc(a.x, a.y, Math.max(rr, 0.4), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    function tick(t) {
      if (!running) return;
      if (!startT) startT = t;
      var intro = Math.min(1, (t - startT) / 1700);
      for (var i = 0; i < nodes.length; i++) {
        var a = nodes[i];
        a.x += a.vx;
        a.y += a.vy;
        a.pulse += 0.014;
        if (a.x < -20) a.x = W + 20;
        if (a.x > W + 20) a.x = -20;
        if (a.y < -20) a.y = H + 20;
        if (a.y > H + 20) a.y = -20;
      }
      draw(false, intro);
      rafId = requestAnimationFrame(tick);
    }
    function start() {
      if (running || reduceMotion) return;
      running = true;
      startT = 0;
      rafId = requestAnimationFrame(tick);
    }
    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }
    sizeCanvas();
    seed();
    if (reduceMotion) {
      draw(true, 1); /* single static frame */
    } else {
      /* pause when the hero is off-screen */
      if ("IntersectionObserver" in window) {
        var cio = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (e) {
              if (e.isIntersecting) start();
              else stop();
            });
          },
          { threshold: 0 }
        );
        cio.observe(canvas);
      } else {
        start();
      }
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) stop();
        else start();
      });
    }
    var resizeT;
    window.addEventListener("resize", function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(function () {
        sizeCanvas();
        seed();
        if (reduceMotion) draw(true, 1);
      }, 180);
    });
    var hero = canvas.closest(".hero") || canvas.parentElement;
    if (hero) {
      hero.addEventListener("pointermove", function (e) {
        var r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left;
        mouse.y = e.clientY - r.top;
      });
      hero.addEventListener("pointerleave", function () {
        mouse.x = -9999;
        mouse.y = -9999;
      });
    }
  })();

  /* ---- journal tag filter ---- */
  (function () {
    var fbtns = document.querySelectorAll(".f-btn");
    if (!fbtns.length) return;
    var arts = document.querySelectorAll(".art-grid .art");
    var emptyNote = document.getElementById("filterEmpty");
    fbtns.forEach(function (b) {
      b.addEventListener("click", function () {
        fbtns.forEach(function (x) {
          x.setAttribute("aria-pressed", "false");
        });
        b.setAttribute("aria-pressed", "true");
        var f = b.getAttribute("data-filter"),
          shown = 0;
        arts.forEach(function (a) {
          var show = f === "all" || a.getAttribute("data-tag") === f;
          a.classList.toggle("hide", !show);
          if (show) shown++;
        });
        if (emptyNote) emptyNote.style.display = shown ? "none" : "block";
      });
    });
  })();

  /* ---- consulting fit selector -------------------------------------------
     Two questions -> one recommendation. Logic lives here; markup on the
     consulting page carries #fitSelector with [data-stage] / [data-pain]. */
  (function () {
    var root = document.getElementById("fitSelector");
    if (!root) return;
    var FIT = {
      clarity: {
        name: "Clarity Sprint",
        price: "AED 2,500–3,000 · three hours",
        why: "You don\u2019t need a transformation programme — you need one honest afternoon on the decision that\u2019s stuck.",
        href: "consulting-clarity-sprint.html",
      },
      strategy: {
        name: "Strategy Sprint",
        price: "AED 10,000–15,000 · one day",
        why: "You have momentum and choices to make. A full day turns options into a sequenced plan.",
        href: "consulting-strategy-sprint.html",
      },
      gaps: {
        name: "GapNavigator",
        price: "AED 12,000–18,000 · diagnostic",
        why: "Growth has stalled and the reason isn\u2019t obvious. The diagnostic finds the constraint before you spend fixing the wrong thing.",
        href: "consulting-gapnavigator.html",
      },
      brand: {
        name: "Brand 3D",
        price: "AED 15,000–25,000 · engagement",
        why: "The market can\u2019t tell you apart — or you\u2019ve outgrown how you look. Brand 3D rebuilds positioning, identity and voice together.",
        href: "consulting-brand-3d.html",
      },
      ops: {
        name: "OpsBlueprint",
        price: "Scoped · discovery call first",
        why: "The business runs on you, not on systems. OpsBlueprint maps the operation and designs the one that scales.",
        href: "consulting-opsblueprint.html",
      },
      momentum: {
        name: "Momentum90",
        price: "Scoped · 90-day engagement",
        why: "You need a senior operator in the boat for a quarter — strategy, execution and accountability in one engagement.",
        href: "consulting-momentum90.html",
      },
    };
    var stage = null,
      pain = null;
    var resName = root.querySelector(".sr-name"),
      resPrice = root.querySelector(".sr-price"),
      resWhy = root.querySelector(".sr-why"),
      resLink = root.querySelector(".sr-link"),
      result = root.querySelector(".sel-result");
    function pick() {
      if (!stage || !pain) return;
      var key = pain;
      if (pain === "clarity" && (stage === "growing" || stage === "scaling"))
        key = "strategy";
      if (pain === "brand" && stage === "idea") key = "clarity";
      var r = FIT[key];
      resName.textContent = r.name;
      resPrice.textContent = r.price;
      resWhy.textContent = r.why;
      resLink.setAttribute("href", r.href);
      result.classList.add("show");
      result.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    root.querySelectorAll("[data-stage]").forEach(function (b) {
      b.addEventListener("click", function () {
        root.querySelectorAll("[data-stage]").forEach(function (x) {
          x.setAttribute("aria-pressed", "false");
        });
        b.setAttribute("aria-pressed", "true");
        stage = b.getAttribute("data-stage");
        pick();
      });
    });
    root.querySelectorAll("[data-pain]").forEach(function (b) {
      b.addEventListener("click", function () {
        root.querySelectorAll("[data-pain]").forEach(function (x) {
          x.setAttribute("aria-pressed", "false");
        });
        b.setAttribute("aria-pressed", "true");
        pain = b.getAttribute("data-pain");
        pick();
      });
    });
  })();

  /* ---- booking engine (live availability + backend) ---- */
  (function () {
    var bkConfirm = document.getElementById("bkConfirm");
    if (!bkConfirm) return;
    var BOOK = {
      "clarity-sprint": {
        name: "Clarity Sprint",
        fmt: "Three-hour working session",
        price: "AED 2,500–3,000",
        prep: "Come with your three hardest questions — leave with one clear decision.",
        free: "",
      },
      "strategy-sprint": {
        name: "Strategy Sprint",
        fmt: "Full-day strategy engagement",
        price: "AED 10,000–15,000",
        prep: "We\u2019ll send a short pre-read questionnaire after confirmation.",
        free: "",
      },
      gapnavigator: {
        name: "GapNavigator",
        fmt: "Diagnostic engagement",
        price: "AED 12,000–18,000",
        prep: "Bring your numbers — the honest ones.",
        free: "",
      },
      "brand-3d": {
        name: "Brand 3D",
        fmt: "Brand engagement",
        price: "AED 15,000–25,000",
        prep: "We\u2019ll ask for your current brand assets before the session.",
        free: "",
      },
      opsblueprint: {
        name: "OpsBlueprint — discovery call",
        fmt: "45-minute video call",
        price: "No charge",
        prep: "A conversation about how your operation actually runs today.",
        free: "No charge — a conversation, not a commitment.",
      },
      momentum90: {
        name: "Momentum90 — discovery call",
        fmt: "45-minute video call",
        price: "No charge",
        prep: "Tell us where you\u2019re stuck — we\u2019ll tell you if we\u2019re the right fix.",
        free: "No charge — a conversation, not a commitment.",
      },
      setup: {
        name: "Setup advisory call",
        fmt: "30-minute call",
        price: "No charge",
        prep: "Jurisdiction, activity, visas — bring your questions.",
        free: "No charge — a conversation, not a commitment.",
      },
      discovery: {
        name: "Discovery call",
        fmt: "30-minute call",
        price: "No charge",
        prep: "Tell us where you are and where you\u2019re headed.",
        free: "No charge — a conversation, not a commitment.",
      },
    };
    var pm = location.search.match(/[?&](?:product|type)=([a-z0-9-]+)/);
    var product = (pm && pm[1]) || "discovery";
    var bk = BOOK[product] || BOOK["discovery"];
    document.getElementById("bkName").textContent = bk.name;
    document.getElementById("bkFmt").textContent = bk.fmt;
    document.getElementById("bkPrice").textContent = bk.price;
    document.getElementById("bkPrep").textContent = bk.prep;
    document.getElementById("bkFree").textContent =
      bk.free || "Reschedule any time up to 24 hours before.";
    document.title = "Book: " + bk.name + " — eHive";

    var WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    var MO = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    var dayGrid = document.getElementById("dayGrid");
    var slotGrid = document.getElementById("slotGrid");
    var bkHint = document.getElementById("bkHint");
    var availability = [];
    var selDay = null,
      selSlot = null;

    function fmtDay(d) {
      return (
        WD[d.getDay()].charAt(0) +
        WD[d.getDay()].slice(1).toLowerCase() +
        " " +
        d.getDate() +
        " " +
        MO[d.getMonth()]
      );
    }
    function isoDate(d) {
      return d.toLocaleDateString("en-CA", { timeZone: "Asia/Dubai" });
    }
    function updateHint() {
      bkHint.textContent =
        selDay && selSlot
          ? fmtDay(selDay) + " · " + selSlot + " GST — looks good?"
          : selDay
            ? "Now pick a time slot."
            : "Pick a day and a time first.";
    }
    function slotsForDate(dateStr) {
      return availability.filter(function (s) {
        return s.date === dateStr && s.available;
      });
    }
    function renderDays() {
      dayGrid.innerHTML = "";
      var seen = {};
      availability.forEach(function (s) {
        if (seen[s.date]) return;
        seen[s.date] = true;
        var d = new Date(s.date + "T00:00:00+04:00");
        var b = document.createElement("button");
        b.type = "button";
        b.className = "day";
        b.innerHTML =
          '<span class="dw">' +
          WD[d.getDay()] +
          '</span><span class="dn">' +
          d.getDate() +
          '</span><span class="dm">' +
          MO[d.getMonth()] +
          "</span>";
        b.addEventListener("click", function () {
          dayGrid.querySelectorAll(".day").forEach(function (x) {
            x.classList.remove("on");
          });
          b.classList.add("on");
          selDay = d;
          selSlot = null;
          renderSlots();
          updateHint();
        });
        dayGrid.appendChild(b);
      });
    }
    function renderSlots() {
      slotGrid.innerHTML = "";
      if (!selDay) return;
      var dateStr = isoDate(selDay);
      var slots = slotsForDate(dateStr);
      if (slots.length === 0) {
        slotGrid.innerHTML =
          '<p class="bk-tz">No slots available on this day.</p>';
        return;
      }
      slots.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "slot";
        b.innerHTML = s.time + "<small>GST</small>";
        b.addEventListener("click", function () {
          slotGrid.querySelectorAll(".slot").forEach(function (x) {
            x.classList.remove("on");
          });
          b.classList.add("on");
          selSlot = s.time;
          updateHint();
        });
        slotGrid.appendChild(b);
      });
    }

    var today = new Date();
    var from = isoDate(new Date(today.getTime() + 24 * 60 * 60 * 1000));
    var toDate = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    var to = isoDate(toDate);
    fetch(
      "/api/availability?product=" +
        encodeURIComponent(product) +
        "&from=" +
        from +
        "&to=" +
        to
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        availability = Array.isArray(data.slots) ? data.slots : [];
        renderDays();
        renderSlots();
      })
      .catch(function () {
        dayGrid.innerHTML =
          '<p class="bk-tz">Unable to load live availability. Please refresh or contact us.</p>';
      });

    function submitBooking() {
      if (!selDay || !selSlot) {
        bkHint.textContent = "Choose a day and a time slot to continue.";
        return;
      }
      var name = document.getElementById("bkNameIn"),
        email = document.getElementById("bkEmail"),
        notes = document.getElementById("bkNotes"),
        phoneIn = document.getElementById("bkPhone");
      var nameBad = !name.value.trim();
      var emailBad = !isValidEmail(email.value.trim());
      name.classList.toggle("err", nameBad);
      document.getElementById("bkErrName").classList.toggle("on", nameBad);
      email.classList.toggle("err", emailBad);
      document.getElementById("bkErrEmail").classList.toggle("on", emailBad);
      if (nameBad || emailBad) return;

      var dateStr = isoDate(selDay);
      var when = fmtDay(selDay) + " · " + selSlot + " GST";
      var phone = phoneIn ? sanitizePhone(phoneIn.value) : "";
      var rows = [
        ["Booked", bk.name],
        ["When", when],
        ["Format", bk.fmt],
        ["Name", name.value.trim()],
        ["Email", email.value.trim()],
      ];
      if (phone) rows.push(["Phone", phone]);
      var sum = document.getElementById("bkSummary");
      sum.innerHTML = rows
        .map(function () {
          return "<li><span></span><b></b></li>";
        })
        .join("");
      var spans = sum.querySelectorAll("li span"),
        bs = sum.querySelectorAll("li b");
      rows.forEach(function (r, j) {
        spans[j].textContent = r[0];
        bs[j].textContent = r[1];
      });
      document.getElementById("bkDoneEmail").textContent = email.value.trim();

      if (!setBtnBusy(bkConfirm, "Confirming\u2026")) return;
      var errNote = document.getElementById("bkErr");
      var payload = {
        product: product,
        date: dateStr,
        time: selSlot,
        name: name.value.trim(),
        email: email.value.trim(),
        notes: notes ? notes.value.trim() : "",
        phone: phone,
      };
      fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      })
        .then(function (r) {
          return r.json();
        })
        .then(function (d) {
          restoreBtn(bkConfirm);
          if (d && d.ok) {
            if (d.emailSent === false && errNote) {
              errNote.textContent =
                "We saved your request, but the confirmation email could not be sent" +
                (d.emailError ? " (" + d.emailError + ")" : "") +
                ". We'll confirm your slot directly.";
              errNote.classList.add("show");
            } else {
              location.href = "/thank-you?src=booking";
              return;
            }
            document.getElementById("bkForm").style.display = "none";
            document.getElementById("bkDone").style.display = "block";
            var card = document.querySelector(".bk-card");
            if (card)
              card.scrollIntoView({ behavior: "smooth", block: "start" });
          } else {
            if (errNote) {
              errNote.textContent =
                d.error ||
                "That slot is no longer available. Please choose another time.";
              errNote.classList.add("show");
            }
          }
        })
        .catch(function () {
          restoreBtn(bkConfirm);
          if (errNote) {
            errNote.textContent =
              "We couldn't reach the booking server. Please try again or contact us directly.";
            errNote.classList.add("show");
          }
        });
    }

    bkConfirm.addEventListener("click", submitBooking);
    var bkForm = document.getElementById("bkForm");
    if (bkForm) {
      bkForm.addEventListener("submit", function (e) {
        e.preventDefault();
        submitBooking();
      });
    }
    var again = document.getElementById("bkAgain");
    if (again) {
      again.addEventListener("click", function () {
        document.getElementById("bkDone").style.display = "none";
        document.getElementById("bkForm").style.display = "block";
        selDay = null;
        selSlot = null;
        renderDays();
        renderSlots();
        updateHint();
      });
    }
  })();
  /* ---- login: pre-launch state vs live form (PORTAL_LIVE flag) ---- */
  (function () {
    var launch = document.getElementById("lgLaunch");
    var wrap = document.getElementById("lgFormWrap");
    if (launch && wrap) {
      launch.style.display = PORTAL_LIVE ? "none" : "block";
      wrap.style.display = PORTAL_LIVE ? "block" : "none";
    }
    var lgForm = document.getElementById("lgForm");
    if (!lgForm) return;
    lgForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!PORTAL_LIVE) return;
      var email = document.getElementById("lgEmail"),
        code = document.getElementById("lgCode");
      var emailBad = !isValidEmail(email.value.trim());
      var codeBad = code.value.trim().length < 4;
      email.classList.toggle("err", emailBad);
      document.getElementById("lgErrEmail").classList.toggle("on", emailBad);
      code.classList.toggle("err", codeBad);
      document.getElementById("lgErrCode").classList.toggle("on", codeBad);
      if (emailBad || codeBad) return;
      var raw = email.value
        .trim()
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .trim();
      var name = raw
        ? raw.replace(/\b\w/g, function (c) {
            return c.toUpperCase();
          })
        : "Demo Member";
      sessionStorage.setItem(
        "ehiveMember",
        JSON.stringify({ email: email.value.trim(), name: name, demo: true })
      );
      location.href = "portal.html";
    });
  })();

  /* ---- member portal (preview; guarded) ---- */
  (function () {
    if (!document.body.classList.contains("portal")) return;
    var mem = null;
    try {
      mem = JSON.parse(sessionStorage.getItem("ehiveMember") || "null");
    } catch (e) {}
    if (!mem) {
      location.replace("login.html");
      return;
    }

    var MO = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    var first = (mem.name || "Member").split(" ")[0];
    var el = function (id) {
      return document.getElementById(id);
    };
    if (el("mFirst")) el("mFirst").textContent = first;
    if (el("mName")) el("mName").textContent = mem.name || "Demo Member";
    var initials = (mem.name || "D M")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map(function (w) {
        return w.charAt(0).toUpperCase();
      })
      .join("");
    if (el("mAvatar")) el("mAvatar").textContent = initials || "D";

    var target = LAUNCH_DATE_UTC;
    var dd = Math.max(0, Math.floor((target - Date.now()) / 864e5));
    if (el("mDays")) el("mDays").textContent = dd;

    setTimeout(function () {
      document.querySelectorAll(".m-bar2 i").forEach(function (b) {
        b.style.width = b.getAttribute("data-w");
      });
    }, 250);

    var t = new Date();
    t.setHours(0, 0, 0, 0);
    do {
      t.setDate(t.getDate() + 1);
    } while (t.getDay() !== 4);
    if (el("msDay")) el("msDay").textContent = t.getDate();
    if (el("msMon")) el("msMon").textContent = MO[t.getMonth()];
    if (el("msWhen"))
      el("msWhen").textContent =
        "Thu " +
        t.getDate() +
        " " +
        MO[t.getMonth()] +
        " · 18:30 GST · Dubai chapter";

    document.querySelectorAll("[data-evday]").forEach(function (n) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + parseInt(n.getAttribute("data-evday"), 10));
      n.textContent = d.getDate();
    });
    document.querySelectorAll("[data-evmon]").forEach(function (n) {
      var d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + parseInt(n.getAttribute("data-evmon"), 10));
      n.textContent = MO[d.getMonth()];
    });

    var toastEl = el("mToast"),
      toastTimer = null;
    function toast(msg) {
      if (!toastEl) return;
      toastEl.textContent = msg;
      toastEl.classList.add("show");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.classList.remove("show");
      }, 3200);
    }
    document.querySelectorAll("[data-toast]").forEach(function (b) {
      b.addEventListener("click", function () {
        toast(b.getAttribute("data-toast"));
      });
    });
    document.querySelectorAll("[data-rsvp]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.classList.contains("done")) return;
        b.classList.add("done");
        b.textContent = "RSVP\u2019d \u2713";
        toast(
          "You\u2019re on the list — a calendar invite follows by email once the portal is live."
        );
      });
    });
    var so = el("mSignOut");
    if (so) {
      so.addEventListener("click", function () {
        sessionStorage.removeItem("ehiveMember");
        location.href = "login.html";
      });
    }
  })();

  /* ---- premium interactions: parallax, reveals, magnetic buttons, counters ---- */
  (function () {
    var prefersReduced = reduceMotion;
    var isTouch = window.matchMedia("(pointer: coarse)").matches;

    /* ---- scroll progress bar ---- */
    var progress = document.createElement("div");
    progress.className = "scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);
    function updateProgress() {
      var scrollTop = window.scrollY || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
      progress.style.width = pct + "%";
    }
    window.addEventListener("scroll", updateProgress, { passive: true });
    updateProgress();

    /* ---- ambient shimmer overlay on heroes ---- */
    document
      .querySelectorAll(".h-hero, .h-page-hero, .p-hero")
      .forEach(function (hero) {
        if (prefersReduced) return;
        var shimmer = document.createElement("div");
        shimmer.className = "hero-shimmer";
        shimmer.setAttribute("aria-hidden", "true");
        hero.appendChild(shimmer);
      });

    /* ---- banner image scroll parallax ---- */
    var bannerImgs = document.querySelectorAll(
      ".h-img-banner img, .img-banner img"
    );
    if (bannerImgs.length && !prefersReduced) {
      function updateBannerParallax() {
        bannerImgs.forEach(function (img) {
          var rect = img.getBoundingClientRect();
          var center = rect.top + rect.height / 2;
          var viewportCenter = window.innerHeight / 2;
          var distance = (center - viewportCenter) / window.innerHeight;
          img.style.setProperty("--parallax-y", distance * -28 + "px");
        });
      }
      window.addEventListener("scroll", updateBannerParallax, {
        passive: true,
      });
      updateBannerParallax();
    }

    /* ---- hero mouse parallax (desktop only) ---- */
    if (!prefersReduced && !isTouch) {
      document
        .querySelectorAll(".h-hero, .h-page-hero, .p-hero")
        .forEach(function (hero) {
          var layer = hero.querySelector(
            ".h-hero-visual, .lattice-bg, .motif, .book-card"
          );
          if (!layer) return;
          hero.addEventListener("pointermove", function (e) {
            var rect = hero.getBoundingClientRect();
            var x = (e.clientX - rect.left) / rect.width - 0.5;
            var y = (e.clientY - rect.top) / rect.height - 0.5;
            layer.style.setProperty("--mouse-x", x * -10 + "px");
            layer.style.setProperty("--mouse-y", y * -10 + "px");
          });
          hero.addEventListener("pointerleave", function () {
            layer.style.setProperty("--mouse-x", "0px");
            layer.style.setProperty("--mouse-y", "0px");
          });
        });
    }

    /* ---- split headline reveal ---- */
    function splitText(el) {
      el.classList.add("split-reveal");
      var children = Array.prototype.slice.call(el.childNodes);
      var delay = 0;
      el.innerHTML = "";
      children.forEach(function (node) {
        if (node.nodeType === Node.TEXT_NODE) {
          var parts = node.textContent.split(/(\s+)/);
          parts.forEach(function (part) {
            if (!part.trim()) {
              el.appendChild(document.createTextNode(part));
              return;
            }
            var wrap = document.createElement("span");
            wrap.className = "split-word";
            var inner = document.createElement("span");
            inner.className = "split-word-inner";
            inner.style.transitionDelay = delay + "s";
            inner.textContent = part;
            delay += 0.03;
            wrap.appendChild(inner);
            el.appendChild(wrap);
          });
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          var clone = node.cloneNode(false);
          Array.prototype.slice.call(node.childNodes).forEach(function (c) {
            if (c.nodeType === Node.TEXT_NODE) {
              var parts = c.textContent.split(/(\s+)/);
              parts.forEach(function (part) {
                if (!part.trim()) {
                  clone.appendChild(document.createTextNode(part));
                  return;
                }
                var wrap = document.createElement("span");
                wrap.className = "split-word";
                var inner = document.createElement("span");
                inner.className = "split-word-inner";
                inner.style.transitionDelay = delay + "s";
                inner.textContent = part;
                delay += 0.03;
                wrap.appendChild(inner);
                clone.appendChild(wrap);
              });
            } else {
              clone.appendChild(c.cloneNode(true));
            }
          });
          el.appendChild(clone);
        }
      });
    }

    document
      .querySelectorAll(".h-hero h1, .h-page-hero h1, .p-hero h1")
      .forEach(function (h1) {
        if (prefersReduced) return;
        splitText(h1);
        requestAnimationFrame(function () {
          setTimeout(function () {
            h1.classList.add("in");
          }, 120);
        });
      });

    /* ---- count-up numbers for hero stats ---- */
    function animateCount(el, target) {
      var duration = 1600;
      var start = null;
      function step(timestamp) {
        if (!start) start = timestamp;
        var p = Math.min((timestamp - start) / duration, 1);
        var eased = 1 - Math.pow(1 - p, 4);
        el.textContent = Math.floor(eased * target);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    var countTargets = document.querySelectorAll(
      ".h-hero-stats .stat b, [data-count]"
    );
    if (countTargets.length && !prefersReduced) {
      var countIo = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (e) {
            if (e.isIntersecting) {
              var target = parseInt(e.target.textContent, 10);
              if (!isNaN(target)) animateCount(e.target, target);
              countIo.unobserve(e.target);
            }
          });
        },
        { threshold: 0.5 }
      );
      countTargets.forEach(function (el) {
        countIo.observe(el);
      });
    }

    /* ---- magnetic buttons (desktop only) ---- */
    if (!prefersReduced && !isTouch) {
      document
        .querySelectorAll(".h-btn-primary, .h-btn-ghost, .btn-primary")
        .forEach(function (btn) {
          btn.classList.add("magnetic");
          btn.addEventListener("mousemove", function (e) {
            var rect = btn.getBoundingClientRect();
            var x = e.clientX - rect.left - rect.width / 2;
            var y = e.clientY - rect.top - rect.height / 2;
            btn.style.setProperty("--mag-x", x * 0.18 + "px");
            btn.style.setProperty("--mag-y", y * 0.18 + "px");
          });
          btn.addEventListener("mouseleave", function () {
            btn.style.setProperty("--mag-x", "0px");
            btn.style.setProperty("--mag-y", "0px");
          });
        });
    }

    /* ---- homepage v2: network sphere + reveals ---- */
    if (document.body.classList.contains("eh-v2")) {
      /* reveal observer for .eh-reveal */
      var ehReveals = document.querySelectorAll(".eh-reveal");
      if (ehReveals.length) {
        if ("IntersectionObserver" in window && !prefersReduced) {
          var ehIo = new IntersectionObserver(
            function (entries) {
              entries.forEach(function (e) {
                if (e.isIntersecting) {
                  e.target.classList.add("in");
                  ehIo.unobserve(e.target);
                }
              });
            },
            { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
          );
          ehReveals.forEach(function (el) {
            ehIo.observe(el);
          });
          document
            .querySelectorAll(".eh-hero-v2 .eh-reveal")
            .forEach(function (el) {
              setTimeout(function () {
                el.classList.add("in");
                ehIo.unobserve(el);
              }, 200 + (parseFloat(getComputedStyle(el).getPropertyValue("--d")) || 0) * 1000);
            });
        } else {
          ehReveals.forEach(function (el) {
            el.classList.add("in");
          });
        }
      }

      /* animated network sphere canvas */
      var sphereCanvas = document.getElementById("networkSphere");
      if (sphereCanvas && !prefersReduced) {
        var sCtx = sphereCanvas.getContext("2d");
        var sW, sH, sDPR;
        var nodes = [];
        var sRaf = null;
        var sRunning = false;
        var sMouse = { x: -9999, y: -9999 };
        var SPHERE_NODES = 120;
        var SPHERE_R = 0.32;
        var SPHERE_COLOR = "218,58,34";
        var GOLD_COLOR = "255,194,40";

        function resizeSphere() {
          sDPR = Math.min(window.devicePixelRatio || 1, 2);
          sW = sphereCanvas.clientWidth;
          sH = sphereCanvas.clientHeight;
          sphereCanvas.width = sW * sDPR;
          sphereCanvas.height = sH * sDPR;
          sCtx.setTransform(sDPR, 0, 0, sDPR, 0, 0);
          buildSphere();
        }

        function buildSphere() {
          nodes = [];
          var r = Math.min(sW, sH) * SPHERE_R;
          var cx = sW / 2;
          var cy = sH / 2;
          for (var i = 0; i < SPHERE_NODES; i++) {
            var phi = Math.acos(-1 + (2 * i) / SPHERE_NODES);
            var theta = Math.sqrt(SPHERE_NODES * Math.PI) * phi;
            var x = r * Math.cos(theta) * Math.sin(phi);
            var y = r * Math.sin(theta) * Math.sin(phi);
            var z = r * Math.cos(phi);
            nodes.push({
              x: x,
              y: y,
              z: z,
              ox: x,
              oy: y,
              oz: z,
              r: 1.2 + Math.random() * 1.3,
              gold: Math.random() < 0.12,
              pulse: Math.random() * Math.PI * 2,
            });
          }
        }

        var rotX = 0;
        var rotY = 0;
        function rotate(p, ax, ay) {
          var cosX = Math.cos(ax);
          var sinX = Math.sin(ax);
          var y1 = p.y * cosX - p.z * sinX;
          var z1 = p.y * sinX + p.z * cosX;
          var cosY = Math.cos(ay);
          var sinY = Math.sin(ay);
          var x1 = p.x * cosY + z1 * sinY;
          var z2 = -p.x * sinY + z1 * cosY;
          return { x: x1, y: y1, z: z2 };
        }

        function drawSphere() {
          sCtx.clearRect(0, 0, sW, sH);
          var cx = sW / 2;
          var cy = sH / 2;
          var projected = [];
          for (var i = 0; i < nodes.length; i++) {
            var n = nodes[i];
            var p = rotate({ x: n.ox, y: n.oy, z: n.oz }, rotX, rotY);
            var scale = 1 + p.z / (Math.min(sW, sH) * SPHERE_R * 1.8);
            var px = cx + p.x * scale;
            var py = cy + p.y * scale;
            var boost = 0;
            var dx = px - sMouse.x;
            var dy = py - sMouse.y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < 180) boost = 1 - d / 180;
            projected.push({
              x: px,
              y: py,
              z: p.z,
              r: n.r * scale + boost * 1.2,
              gold: n.gold,
              pulse: n.pulse,
            });
          }
          projected.sort(function (a, b) {
            return a.z - b.z;
          });

          /* draw links between near nodes in 3D */
          sCtx.lineWidth = 0.5;
          for (var a = 0; a < projected.length; a++) {
            for (var b = a + 1; b < projected.length; b++) {
              var dx = projected[a].x - projected[b].x;
              var dy = projected[a].y - projected[b].y;
              var dist = Math.sqrt(dx * dx + dy * dy);
              var threshold = Math.min(sW, sH) * 0.13;
              if (dist < threshold) {
                var alpha = (1 - dist / threshold) * 0.18;
                var zAvg = (projected[a].z + projected[b].z) / 2;
                alpha *= 0.6 + 0.4 * ((zAvg + Math.min(sW, sH) * SPHERE_R) / (Math.min(sW, sH) * SPHERE_R * 2));
                var color = projected[a].gold || projected[b].gold ? GOLD_COLOR : SPHERE_COLOR;
                sCtx.strokeStyle = "rgba(" + color + "," + alpha.toFixed(3) + ")";
                sCtx.beginPath();
                sCtx.moveTo(projected[a].x, projected[a].y);
                sCtx.lineTo(projected[b].x, projected[b].y);
                sCtx.stroke();
              }
            }
          }

          /* draw nodes */
          for (var j = 0; j < projected.length; j++) {
            var p = projected[j];
            var glow = p.gold ? 0.85 : 0.45;
            var rr = Math.max(p.r, 0.5);
            if (p.gold) {
              sCtx.shadowColor = "rgba(" + GOLD_COLOR + ",0.8)";
              sCtx.shadowBlur = 12;
            } else {
              sCtx.shadowColor = "rgba(" + SPHERE_COLOR + ",0.5)";
              sCtx.shadowBlur = 6;
            }
            sCtx.fillStyle =
              "rgba(" + (p.gold ? GOLD_COLOR : SPHERE_COLOR) + "," + glow.toFixed(2) + ")";
            sCtx.beginPath();
            sCtx.arc(p.x, p.y, rr, 0, Math.PI * 2);
            sCtx.fill();
            sCtx.shadowBlur = 0;
          }
        }

        function tickSphere(t) {
          if (!sRunning) return;
          rotX += 0.0018;
          rotY += 0.0024;
          for (var i = 0; i < nodes.length; i++) {
            nodes[i].pulse += 0.02;
          }
          drawSphere();
          sRaf = requestAnimationFrame(tickSphere);
        }

        function startSphere() {
          if (sRunning) return;
          sRunning = true;
          sRaf = requestAnimationFrame(tickSphere);
        }
        function stopSphere() {
          sRunning = false;
          if (sRaf) cancelAnimationFrame(sRaf);
        }

        resizeSphere();
        if ("IntersectionObserver" in window) {
          var sphereIo = new IntersectionObserver(
            function (entries) {
              entries.forEach(function (e) {
                if (e.isIntersecting) startSphere();
                else stopSphere();
              });
            },
            { threshold: 0 }
          );
          sphereIo.observe(sphereCanvas);
        } else {
          startSphere();
        }

        var sphereResizeT;
        window.addEventListener("resize", function () {
          clearTimeout(sphereResizeT);
          sphereResizeT = setTimeout(resizeSphere, 180);
        });

        sphereCanvas.addEventListener("pointermove", function (e) {
          var rect = sphereCanvas.getBoundingClientRect();
          sMouse.x = e.clientX - rect.left;
          sMouse.y = e.clientY - rect.top;
        });
        sphereCanvas.addEventListener("pointerleave", function () {
          sMouse.x = -9999;
          sMouse.y = -9999;
        });

        document.addEventListener("visibilitychange", function () {
          if (document.hidden) stopSphere();
          else startSphere();
        });
      }

      /* ---- cursor spotlight on dark v2 sections ---- */
      if (!isTouch) {
        var darkSections = document.querySelectorAll(
          ".eh-section-v2.eh-dark"
        );
        darkSections.forEach(function (sec) {
          sec.addEventListener("pointermove", function (e) {
            var rect = sec.getBoundingClientRect();
            sec.style.setProperty("--spot-x", e.clientX - rect.left + "px");
            sec.style.setProperty("--spot-y", e.clientY - rect.top + "px");
            sec.classList.add("spot-active");
          });
          sec.addEventListener("pointerleave", function () {
            sec.classList.remove("spot-active");
          });
        });
      }

      /* ---- 3D tilt on pillar cards ---- */
      if (!prefersReduced && !isTouch) {
        document.querySelectorAll(".eh-tilt").forEach(function (card) {
          card.addEventListener("mousemove", function (e) {
            var rect = card.getBoundingClientRect();
            var x = (e.clientX - rect.left) / rect.width - 0.5;
            var y = (e.clientY - rect.top) / rect.height - 0.5;
            card.style.setProperty("--rx", y * -12 + "deg");
            card.style.setProperty("--ry", x * 12 + "deg");
          });
          card.addEventListener("mouseleave", function () {
            card.style.setProperty("--rx", "0deg");
            card.style.setProperty("--ry", "0deg");
          });
        });
      }
    }
  })();
})();

/* ===== Scroll-driven parallax for interior image banners =====
   Subtle vertical translation tied to scroll position makes the large static
   hero banners feel alive without heavy video assets. Disabled when the user
   prefers reduced motion. */
(function () {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  var banners = document.querySelectorAll(".img-banner img");
  if (!banners.length) return;
  banners.forEach(function (img) {
    img.style.animation = "none";
    img.style.transition = "transform 0.1s linear";
    img.style.willChange = "transform";
  });
  function update() {
    var vh = window.innerHeight;
    banners.forEach(function (img) {
      var wrap = img.parentElement;
      if (!wrap) return;
      var rect = wrap.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > vh) return;
      var p = rect.top / vh;
      img.style.transform =
        "translateY(" + (p * 22).toFixed(1) + "px) scale(1.08)";
    });
  }
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();
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
  if (
    location.pathname
      .replace(/\/index\.html$/, "/")
      .indexOf("clarity-scorecard") !== -1
  )
    return;

  var css =
    "" +
    ".nav-links a[href*='clarity-scorecard']{" +
    "display:inline-flex;align-items:center;gap:.4em;padding:.5em .95em;border:1px solid var(--gold,#B8862E);" +
    "border-radius:8px;color:var(--gold,#B8862E)!important;font-weight:600;transition:background .15s,color .15s;}" +
    ".nav-links a[href*='clarity-scorecard']:hover{background:var(--gold,#B8862E);color:#fff!important;}" +
    ".sc-overlay{position:fixed;inset:0;z-index:1000;background:rgba(20,20,35,.62);backdrop-filter:blur(3px);" +
    "display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease;}" +
    ".sc-overlay.on{opacity:1;}" +
    ".sc-modal{position:relative;width:100%;max-width:820px;height:min(88vh,900px);background:#FBF9F5;border-radius:16px;" +
    "overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(10px) scale(.99);transition:transform .2s ease;}" +
    ".sc-overlay.on .sc-modal{transform:none;}" +
    ".sc-modal iframe{width:100%;height:100%;border:0;display:block;}" +
    ".sc-close{position:absolute;top:10px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;" +
    "background:rgba(26,26,46,.9);color:#fff;font-size:20px;line-height:38px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);}" +
    ".sc-close:hover{background:#1A1A2E;}" +
    ".sc-trap{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;}" +
    "@media (max-width:640px){.sc-modal{height:92vh;max-width:100%;border-radius:14px;}}";
  var style = document.createElement("style");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);

  var overlay = null,
    lastFocus = null;
  function close() {
    if (!overlay) return;
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    var el = overlay;
    setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 200);
    overlay = null;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
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
      "<iframe src='" +
      SC_URL +
      "?embed=1' title='eHive Clarity Scorecard' loading='lazy'></iframe>" +
      "<div class='sc-trap' tabindex='0' aria-hidden='true'></div>" +
      "</div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    var closeBtn = overlay.querySelector(".sc-close");
    var trap = overlay.querySelector(".sc-trap");
    closeBtn.addEventListener("click", close);
    if (trap) {
      trap.addEventListener("focus", function () {
        closeBtn.focus();
      });
      closeBtn.addEventListener("keydown", function (e) {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          trap.focus();
        }
      });
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () {
      overlay.classList.add("on");
    });
    setTimeout(function () {
      if (closeBtn) closeBtn.focus();
    }, 60);
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
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", wire);
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
  if (
    location.pathname.replace(/\/index\.html$/, "/").indexOf("brand-check") !==
    -1
  )
    return;

  var css =
    "" +
    ".nav-links a[href*='brand-check']{" +
    "display:inline-flex;align-items:center;gap:.4em;padding:.5em .95em;border:1px solid var(--gold,#B8862E);" +
    "border-radius:8px;color:var(--gold,#B8862E)!important;font-weight:600;transition:background .15s,color .15s;}" +
    ".nav-links a[href*='brand-check']:hover{background:var(--gold,#B8862E);color:#fff!important;}" +
    ".bc-overlay{position:fixed;inset:0;z-index:1000;background:rgba(20,20,35,.62);backdrop-filter:blur(3px);" +
    "display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease;}" +
    ".bc-overlay.on{opacity:1;}" +
    ".bc-modal{position:relative;width:100%;max-width:820px;height:min(90vh,940px);background:#FBF9F5;border-radius:16px;" +
    "overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(10px) scale(.99);transition:transform .2s ease;}" +
    ".bc-overlay.on .bc-modal{transform:none;}" +
    ".bc-modal iframe{width:100%;height:100%;border:0;display:block;}" +
    ".bc-close{position:absolute;top:10px;right:12px;z-index:2;width:38px;height:38px;border-radius:50%;border:0;cursor:pointer;" +
    "background:rgba(26,26,46,.9);color:#fff;font-size:20px;line-height:38px;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);}" +
    ".bc-close:hover{background:#1A1A2E;}" +
    ".bc-trap{position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;}" +
    "@media (max-width:640px){.bc-modal{height:94vh;max-width:100%;border-radius:14px;}}";
  var style = document.createElement("style");
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);

  var overlay = null,
    lastFocus = null;
  function close() {
    if (!overlay) return;
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    var el = overlay;
    setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 200);
    overlay = null;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
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
      "<iframe src='" +
      BC_URL +
      "?embed=1' title='eHive Brand Check' loading='lazy'></iframe>" +
      "<div class='bc-trap' tabindex='0' aria-hidden='true'></div>" +
      "</div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    var closeBtn = overlay.querySelector(".bc-close");
    var trap = overlay.querySelector(".bc-trap");
    closeBtn.addEventListener("click", close);
    if (trap) {
      trap.addEventListener("focus", function () {
        closeBtn.focus();
      });
      closeBtn.addEventListener("keydown", function (e) {
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          trap.focus();
        }
      });
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () {
      overlay.classList.add("on");
    });
    setTimeout(function () {
      if (closeBtn) closeBtn.focus();
    }, 60);
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
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();

/* Pause infinite decorative animations when off-screen */
(function () {
  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;
  var animated = document.querySelectorAll(
    ".rings, .img-banner img, .lattice-bg"
  );
  if (!animated.length || reduceMotion) return;
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        entry.target.style.animationPlayState = entry.isIntersecting
          ? "running"
          : "paused";
      });
    },
    { threshold: 0 }
  );
  animated.forEach(function (el) {
    io.observe(el);
  });
})();

/* Sticky mobile CTA for conversion pages */
(function () {
  if (window.innerWidth > 760) return;
  var path = location.pathname.split("/").pop() || "index.html";
  var pages = [
    "index.html",
    "consulting.html",
    "circle.html",
    "membership.html",
    "how-it-works.html",
    "about.html",
    "partners.html",
    "franchise.html",
    "apply.html",
    "contact.html",
  ];
  if (pages.indexOf(path) === -1) return;
  var bar = document.createElement("div");
  bar.className = "sticky-cta-bar";
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "Quick actions");
  bar.innerHTML =
    "<a class='btn btn-primary' href='clarity-scorecard.html'>Clarity Scorecard</a>" +
    "<a class='btn btn-ghost' href='circle.html'>Explore membership</a>";
  document.body.appendChild(bar);
  document.body.classList.add("has-sticky-cta");
})();

/* Exit-intent lead capture (desktop only, once per session) */
(function () {
  if (window.matchMedia("(pointer: coarse)").matches) return;
  if (window.sessionStorage.getItem("ehiveExitSeen")) return;
  var path = location.pathname;
  var skip =
    path.indexOf("clarity-scorecard") !== -1 ||
    path.indexOf("brand-check") !== -1 ||
    path.indexOf("book.html") !== -1 ||
    path.indexOf("thank-you") !== -1 ||
    path.indexOf("login") !== -1;
  if (skip) return;

  var overlay = null,
    lastFocus = null;
  function close() {
    if (!overlay) return;
    overlay.classList.remove("on");
    document.body.style.overflow = "";
    var el = overlay;
    setTimeout(function () {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 200);
    overlay = null;
    document.removeEventListener("keydown", onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function focusables() {
    return overlay
      ? Array.prototype.slice.call(
          overlay.querySelectorAll(
            "button, a[href], input, textarea, select, [tabindex]:not([tabindex='-1'])"
          )
        ).filter(function (el) {
          return !el.disabled && el.offsetParent !== null;
        })
      : [];
  }
  function onKey(e) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab" || !overlay) return;
    var links = focusables();
    if (!links.length) return;
    var first = links[0],
      last = links[links.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function open() {
    if (overlay) return;
    window.sessionStorage.setItem("ehiveExitSeen", "1");
    lastFocus = document.activeElement;
    overlay = document.createElement("div");
    overlay.className = "exit-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Get clarity before you go");
    overlay.innerHTML =
      "<div class='exit-card'>" +
      "<button class='exit-close' aria-label='Close'>&times;</button>" +
      "<p class='exit-eyebrow'>Not ready to apply?</p>" +
      "<h2>Get clarity in 2 minutes</h2>" +
      "<p>The Clarity Scorecard shows you exactly where to focus next. No pitch, no spam.</p>" +
      "<div class='exit-actions'>" +
      "<a class='btn btn-primary' href='clarity-scorecard.html'>Take the Scorecard</a>" +
      "<a class='btn btn-ghost' href='book.html?product=consulting'>Book a free call</a>" +
      "</div></div>";
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    var closeBtn = overlay.querySelector(".exit-close");
    closeBtn.addEventListener("click", close);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () {
      overlay.classList.add("on");
      closeBtn.focus();
    });
  }
  document.addEventListener("mouseout", function (e) {
    if (e.clientY < 8 && !window.sessionStorage.getItem("ehiveExitSeen")) {
      open();
    }
  });
})();

/* ===== Live public stats on the homepage ===== */
(function () {
  "use strict";
  var stats = document.querySelectorAll("[data-stat]");
  if (!stats.length) return;

  function animate(el, value) {
    var duration = 900;
    var start = 0;
    var startTime = null;
    function step(t) {
      if (!startTime) startTime = t;
      var p = Math.min((t - startTime) / duration, 1);
      el.textContent = Math.floor(p * value).toLocaleString("en-IN");
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  fetch("/api/public-stats")
    .then(function (r) {
      if (!r.ok) throw new Error("stats unavailable");
      return r.json();
    })
    .then(function (data) {
      stats.forEach(function (el) {
        var key = el.getAttribute("data-stat");
        var value = data && typeof data[key] === "number" ? data[key] : 0;
        if (value > 0) animate(el, value);
        else el.textContent = "0";
      });
    })
    .catch(function () {
      stats.forEach(function (el) {
        el.textContent = "—";
      });
    });
})();

/* PWA: register the service worker so the site is installable from any page
   (Add to Home Screen / Install app). Harmless if sw.js is unavailable. */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function () {
      /* non-fatal */
    });
  });
}
