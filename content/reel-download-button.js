// Injects an icon-only Download button into the Facebook reel action bar.
// Clicking the icon toggles a quality dropdown (similar to tiktokDownloader reference).
// Runs in ISOLATED world; only on reel pages.

(function () {
  const INJECT_ATTR = "data-fb-dl-injected";
  const STYLE_ID = "fb-dl-reel-style";
  const MENU_OPEN_CLASS = "fb-dl-menu-open";
  let mountedBar = null;
  let ui = null; // { wrapper, btn, menu }
  let scheduled = false;

  function isReelPage() {
    try {
      const path =
        (new URL(window.location.href).pathname || "/").replace(/\/+$/, "") ||
        "/";
      return /^\/reel(\/\d+)?$/.test(path);
    } catch {
      return false;
    }
  }

  function getReelIdFromUrl() {
    try {
      const path =
        (new URL(window.location.href).pathname || "/").replace(/\/+$/, "") ||
        "/";
      const m = path.match(/^\/reel\/(\d+)$/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function findReelActionBarFromAny(el) {
    let cur = el;
    for (let i = 0; i < 15 && cur; i++) {
      cur = cur.parentElement;
      if (!cur || cur.children.length < 4) continue;
      const children = [...cur.children];
      const hasLike = children.some((c) =>
        c.querySelector('[aria-label="Like"]'),
      );
      const hasComment = children.some((c) =>
        c.querySelector('[aria-label="Comment"]'),
      );
      const hasShare = children.some((c) =>
        c.querySelector('[aria-label="Share"]'),
      );
      if (hasLike && hasComment && hasShare) return cur;
    }
    return null;
  }

  // FB keeps multiple reels in DOM while scrolling; pick the most "active" action bar
  // by choosing the candidate closest to the viewport center and visible.
  function findBestReelActionBar() {
    const shares = [...document.querySelectorAll('[aria-label="Share"]')];
    if (!shares.length) return null;

    const viewportHeight = window.innerHeight || 0;

    let best = null;
    let bestTop = Infinity;

    // Prefer bars whose top is in or just below the viewport (current reel),
    // falling back to previous logic only if none qualify.
    const fallbackCandidates = [];

    for (const share of shares) {
      const bar = findReelActionBarFromAny(share);
      if (!bar) continue;
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.bottom < 0 || rect.top > viewportHeight) continue; // completely off-screen

      // Primary candidates: bar whose top is at or below 0 (top of viewport) and not far below mid-screen
      if (rect.top >= 0) {
        if (rect.top < bestTop) {
          bestTop = rect.top;
          best = bar;
        }
      } else {
        fallbackCandidates.push({ bar, rect });
      }
    }

    if (best) return best;

    // Fallback: choose the bar whose center is closest to 40% of viewport height
    let bestScore = Infinity;
    const targetCy = viewportHeight * 0.4;
    for (const { bar, rect } of fallbackCandidates) {
      const cy = rect.top + rect.height / 2;
      const dist = Math.abs(cy - targetCy);
      if (dist < bestScore) {
        bestScore = dist;
        best = bar;
      }
    }
    return best;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .fb-dl-wrapper { position: relative; overflow: visible !important; }
      .fb-dl-wrapper * { box-sizing: border-box; }

      /* Menu: dark glass, like native FB surfaces */
      .fb-dl-menu {
        position: absolute;
        right: 0;
        bottom: calc(100% + 6px);
        top: auto;
        min-width: 160px;
        max-width: calc(100vw - 16px);
        max-height: 260px;
        overflow: auto;
        padding: 6px 0;
        border-radius: 10px;
        background: rgba(24, 25, 26, 0.96);
        box-shadow: 0 10px 28px rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.08);
        z-index: 2147483647;
        display: none;
      }
      .fb-dl-menu.${MENU_OPEN_CLASS} { display: block; }
      .fb-dl-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        color: rgba(255,255,255,0.92);
        font: 600 13px/1.1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        cursor: pointer;
        user-select: none;
        white-space: nowrap;
      }
      .fb-dl-item:hover { background: rgba(255,255,255,0.08); }
      .fb-dl-tag {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.92);
        flex: 0 0 auto;
      }
      .fb-dl-muted { opacity: 0.75; font-weight: 600; }
    `;
    document.documentElement.appendChild(style);
  }

  function createDownloadButtonWithMenu() {
    const wrapper = document.createElement("div");
    wrapper.setAttribute(INJECT_ATTR, "1");
    wrapper.className =
      "x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x2lah0s x193iq5w xzboxd6 x14l7nz5";
    wrapper.classList.add("fb-dl-wrapper");

    const span = document.createElement("span");
    span.className =
      "html-span xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x1hl2dhg x16tdsg8 x1vvkbs x4k7w5x x1h91t0o x1h9r5lt x1jfb8zj xv2umb2 x1beo9mf xaigb6o x12ejxvf x3igimt xarpa2k xedcshv x1lytzrv x1t2pt76 x7ja8zs x1qrby5j";

    const btn = document.createElement("div");
    btn.setAttribute("aria-label", "Download");
    btn.setAttribute("role", "button");
    btn.setAttribute("tabindex", "0");
    btn.className =
      "x1i10hfl x1qjc9v5 xjbqb8w xjqpnuy xc5r6h4 xqeqjp1 x1phubyo x13fuv20 x18b5jzi x1q0q8m5 x1t7ytsu x972fbf x10w94by x1qhh985 x14e42zd x9f619 x1ypdohk xdl72j9 x2lah0s x3ct3a4 xdj266r x14z9mp xat24cr x1lziwak x2lwn1j xeuugli xexx8yu xyri2b x18d9i69 x1c1uobl x1n2onr6 x16tdsg8 x1hl2dhg x1ja2u2z x1t137rt x1fmog5m xu25z0z x140muxe xo1y3bh x3nfvp2 x1q0g3np x87ps6o x1lku1pv x1a2a7pz x1useyqa";
    btn.style.cursor = "pointer";

    btn.innerHTML = `
<div style="padding: 0px;" class="x1n2onr6 x1ja2u2z x9f619 x78zum5 xdt5ytf x2lah0s x193iq5w xz9dl7a xsag5q8">
  <div class="x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x1iyjqo2 x2lwn1j">
    <div class="x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x2lah0s x193iq5w x6s0dn4 x1g0dm76 xpdmqnj x1gslohp x12nagc xzboxd6 x14l7nz5">
      <div class="x1ypdohk">
        <svg width="32px" height="32px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#000000" stroke-width="1.548"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M12 12V19M12 19L9.75 16.6667M12 19L14.25 16.6667M6.6 17.8333C4.61178 17.8333 3 16.1917 3 14.1667C3 12.498 4.09438 11.0897 5.59198 10.6457C5.65562 10.6268 5.7 10.5675 5.7 10.5C5.7 7.46243 8.11766 5 11.1 5C14.0823 5 16.5 7.46243 16.5 10.5C16.5 10.5582 16.5536 10.6014 16.6094 10.5887C16.8638 10.5306 17.1284 10.5 17.4 10.5C19.3882 10.5 21 12.1416 21 14.1667C21 16.1917 19.3882 17.8333 17.4 17.8333" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round"></path></g></svg>

      </div>
    </div>
    <div class="x9f619 x1n2onr6 x1ja2u2z x78zum5 xdt5ytf x2lah0s x193iq5w x6s0dn4 x1g0dm76 xpdmqnj x1gslohp x12nagc xzboxd6 x14l7nz5">
      <div class="xdvlbce"></div>
    </div>
  </div>
</div>`;

    const menu = document.createElement("div");
    menu.className = "fb-dl-menu";
    menu.setAttribute("role", "list");

    span.appendChild(btn);
    wrapper.appendChild(span);
    wrapper.appendChild(menu);
    return { wrapper, btn, menu };
  }

  function qOrder(q) {
    const map = {
      "1080p": 10,
      HD: 9,
      "720p": 8,
      "480p": 7,
      "360p": 6,
      "270p": 5,
      "240p": 4,
      SD: 3,
      "180p": 2,
      MP4: 1,
    };
    return map[q] ?? 0;
  }

  function isAudioUrl(u) {
    const url = u?.url || "";
    return (
      /\.m4a($|\?)/i.test(url) ||
      /\.aac($|\?)/i.test(url) ||
      /\.mp3($|\?)/i.test(url) ||
      /\.ogg($|\?)/i.test(url) ||
      /\/audio\//i.test(url)
    );
  }

  function getQualityTag(u) {
    if (isAudioUrl(u)) return "AUDIO";
    if (u.type === "progressive") return "VIDEO";
    if (u.type === "dash") return "DASH";
    return null;
  }

  function normalizeUrls(urls) {
    const sorted = [...(urls || [])].sort((a, b) => {
      if (a.type === "progressive" && b.type !== "progressive") return -1;
      if (a.type !== "progressive" && b.type === "progressive") return 1;
      return qOrder(b.quality) - qOrder(a.quality);
    });
    const uniq = [];
    const seen = new Set();
    for (const u of sorted) {
      if (u.type !== "progressive") continue; // hide DASH/other types in reel dropdown
      const key = `${u.quality}-${u.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(u);
    }
    return uniq;
  }

  function closeMenu(menu, wrapper) {
    menu.classList.remove(MENU_OPEN_CLASS);
    wrapper.classList.remove(MENU_OPEN_CLASS);
  }

  function openMenu(menu, wrapper) {
    menu.classList.add(MENU_OPEN_CLASS);
    wrapper.classList.add(MENU_OPEN_CLASS);
  }

  function renderMenu(menu, urls, title) {
    menu.innerHTML = "";
    const items = normalizeUrls(urls);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "fb-dl-item fb-dl-muted";
      empty.textContent = "No qualities yet";
      menu.appendChild(empty);
      return;
    }
    for (const u of items) {
      const item = document.createElement("div");
      item.className = "fb-dl-item";
      item.setAttribute("role", "option");
      const left = document.createElement("span");
      left.textContent = `${u.quality}`;
      const tag = getQualityTag(u);
      item.appendChild(left);
      if (tag) {
        const t = document.createElement("span");
        t.className = "fb-dl-tag";
        t.textContent = tag;
        item.appendChild(t);
      }
      item.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const safeTitle = (title || "Facebook Video")
          .replace(/[\\/:*?"<>|]/g, "_")
          .slice(0, 80);
        chrome.runtime.sendMessage({
          action: "download",
          url: u.url,
          quality: u.quality,
          filename: `${safeTitle} - ${u.quality || "video"}.mp4`,
        });
      });
      menu.appendChild(item);
    }
  }

  function requestCurrentVideoData(cb) {
    chrome.runtime.sendMessage({ action: "getVideoData" }, (res) => {
      if (chrome.runtime.lastError || !res?.videos?.length) {
        cb(null);
        return;
      }
      cb(res.videos[0]);
    });
  }

  function getOrCreateUI() {
    if (ui && ui.wrapper?.isConnected) return ui;
    ui = createDownloadButtonWithMenu();

    function docClick(e) {
      if (ui.wrapper.contains(e.target)) return;
      closeMenu(ui.menu, ui.wrapper);
      document.removeEventListener("click", docClick);
    }

    ui.btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = ui.menu.classList.contains(MENU_OPEN_CLASS);
      if (isOpen) {
        closeMenu(ui.menu, ui.wrapper);
        document.removeEventListener("click", docClick);
        return;
      }

      renderMenu(ui.menu, [], "");
      openMenu(ui.menu, ui.wrapper);
      document.addEventListener("click", docClick);

      requestCurrentVideoData((video) => {
        if (!video) {
          renderMenu(ui.menu, [], "");
          return;
        }
        renderMenu(ui.menu, video.urls || [], video.title || "Facebook Video");
      });
    });

    ui.btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        ui.btn.click();
      } else if (e.key === "Escape") {
        closeMenu(ui.menu, ui.wrapper);
      }
    });

    return ui;
  }

  function mountIntoBestBar() {
    if (!isReelPage()) return;
    ensureStyles();

    const bar = findBestReelActionBar();
    if (!bar) return;

    const { wrapper, menu } = getOrCreateUI();

    // If FB has multiple injected copies (older versions), remove them except ours
    document.querySelectorAll("[" + INJECT_ATTR + "]").forEach((n) => {
      if (n !== wrapper) n.remove();
    });

    // Only show the button when we actually have video data for this reel page;
    // background getVideoData is already filtered by current tab URL (including reel id).
    requestCurrentVideoData((video) => {
      if (!isReelPage()) return;

      if (!video) {
        if (wrapper.isConnected) wrapper.remove();
        mountedBar = null;
        return;
      }

      if (mountedBar !== bar) {
        closeMenu(menu, wrapper);
        mountedBar = bar;
        bar.appendChild(wrapper);
      } else if (!bar.contains(wrapper)) {
        bar.appendChild(wrapper);
      }
    });
  }

  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      mountIntoBestBar();
    });
  }

  function wireUrlChangeHandlers() {
    const fire = () => {
      // Close any open menus on navigation
      document
        .querySelectorAll(".fb-dl-menu." + MENU_OPEN_CLASS)
        .forEach((m) => m.classList.remove(MENU_OPEN_CLASS));
      document
        .querySelectorAll(".fb-dl-wrapper." + MENU_OPEN_CLASS)
        .forEach((w) => w.classList.remove(MENU_OPEN_CLASS));
      mountedBar = null;
      // Re-mount on new reel UI (SPA)
      scheduleMount();
    };

    window.addEventListener("popstate", fire);

    const origPush = history.pushState;
    history.pushState = function (...args) {
      const r = origPush.apply(this, args);
      setTimeout(fire, 50);
      return r;
    };
    const origReplace = history.replaceState;
    history.replaceState = function (...args) {
      const r = origReplace.apply(this, args);
      setTimeout(fire, 50);
      return r;
    };
  }

  // Always wire handlers (FB is an SPA; navigating to /reel may not reload the document).
  wireUrlChangeHandlers();

  const observer = new MutationObserver(() => {
    if (!isReelPage()) return;
    scheduleMount();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Scrolling between reels often changes which action bar is centered
  window.addEventListener(
    "scroll",
    () => {
      if (!isReelPage()) return;
      scheduleMount();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    if (!isReelPage()) return;
    scheduleMount();
  });

  // If we loaded directly on a reel URL, mount immediately.
  if (isReelPage()) scheduleMount();
})();
