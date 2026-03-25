let tabId = null;
let refreshTimer = null;
let lastHash = "";
let allVideos = [];
let titleFilterQuery = "";

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (!tabs?.[0]) return;
  tabId = tabs[0].id;
  initTitleFilter();
  loadVideos();
  refreshTimer = setInterval(loadVideos, 1500);
});

function initTitleFilter() {
  const input = document.getElementById("titleFilterInput");
  if (!input) return;
  input.addEventListener("input", () => {
    titleFilterQuery = (input.value || "").trim().toLowerCase();
    render(allVideos, true);
  });
}

function loadVideos() {
  chrome.runtime.sendMessage({ action: "getVideoData", tabId }, res => {
    if (chrome.runtime.lastError || !res) return;
    allVideos = res.videos || [];
    render(allVideos);
  });
}

function render(videos, force = false) {
  const filteredVideos = titleFilterQuery
    ? videos.filter(v => {
        const t = (v.title || "").toLowerCase();
        const a = (v.author || "").toLowerCase();
        return t.includes(titleFilterQuery) || a.includes(titleFilterQuery);
      })
    : videos;

  const hash = `${titleFilterQuery}|` + filteredVideos.map(v => v.videoId + v.urls.length).join("|");
  if (!force && hash === lastHash) return;
  lastHash = hash;

  const el = document.getElementById("videoList");

  if (!videos.length) {
    el.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">🎬</div>
        <h3>No Videos Detected</h3>
        <p>Play a video on Facebook to see download options.</p>
      </div>`;
    return;
  }

  if (!filteredVideos.length) {
    el.innerHTML = `
      <div class="no-videos">
        <div class="no-videos-icon">🔎</div>
        <h3>No Matching Videos</h3>
        <p>Try a different title keyword.</p>
      </div>`;
    return;
  }

  el.innerHTML = "";

  filteredVideos.forEach(video => {
    // Sort: progressive first (has audio), then DASH by quality desc
    const sorted = [...video.urls].sort((a, b) => {
      if (a.type === "progressive" && b.type !== "progressive") return -1;
      if (a.type !== "progressive" && b.type === "progressive") return 1;
      return qOrder(b.quality) - qOrder(a.quality);
    });

    // Deduplicate by quality label and only show progressive URLs in the UI
    const unique = [];
    const seen = new Set();
    for (const u of sorted) {
      if (u.type !== "progressive") continue; // hide DASH/other types in popup list
      const key = u.quality + "-" + u.type;
      if (!seen.has(key)) { seen.add(key); unique.push(u); }
    }

    if (!unique.length) return;
    const best = unique[0];

    const card = document.createElement("div");
    card.className = "video-item";

    const title = video.title || "Facebook Video";
    const author = video.author || "";
    const dur = video.duration ? formatDuration(video.duration) : "";

    const dropdownItems = unique.map(u => {
      const isAudio = /(\.m4a($|\?)|\.aac($|\?)|\.mp3($|\?)|\.ogg($|\?)|\/audio\/)/i.test(u.url || "");
      const suffix = isAudio ? " (audio)" : " (video)";
      const label = `${u.quality}${suffix}`;
      return `<div class="quality-menu-item${u === best ? " selected" : ""}" data-url="${esc(u.url)}" data-quality="${u.quality}" data-type="${u.type}">${label}</div>`;
    }).join("");

    card.innerHTML = `
      ${video.thumbnail ? `<div class="video-thumb"><img src="${esc(video.thumbnail)}" alt="" /></div>` : ""}
      <div class="video-header">
        <div>
          <div class="video-title">${esc(title)}</div>
          ${author ? `<div class="video-author">${esc(author)}${dur ? ` · ${dur}` : ""}</div>` : ""}
        </div>
        <span class="video-type">${best.quality}</span>
      </div>
      <div class="button-group">
        <div class="download-button-group">
          <button class="download-btn" data-url="${esc(best.url)}" data-quality="${best.quality}">
            ⬇ Download ${best.quality}
          </button>
          ${unique.length > 1 ? `
          <button class="download-dropdown-btn">
            <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1l4 4 4-4" stroke="white" stroke-width="2" fill="none"/></svg>
          </button>
          <div class="quality-dropdown-menu">${dropdownItems}</div>` : ""}
        </div>
        <button class="copy-btn" data-url="${esc(best.url)}">📋 Copy</button>
      </div>`;

    el.appendChild(card);
  });

  bindEvents(el);
}

function bindEvents(el) {
  el.querySelectorAll(".download-btn").forEach(btn =>
    btn.addEventListener("click", () => downloadVideo(btn.dataset.url, btn.dataset.quality))
  );

  el.querySelectorAll(".copy-btn").forEach(btn =>
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.url);
      btn.textContent = "✓ Copied";
      setTimeout(() => (btn.textContent = "📋 Copy"), 2000);
    })
  );

  el.querySelectorAll(".download-dropdown-btn").forEach(btn =>
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const menu = btn.nextElementSibling;
      const open = menu.classList.toggle("show");
      btn.closest(".video-item").classList.toggle("dropdown-open", open);
    })
  );

  el.querySelectorAll(".quality-menu-item").forEach(item =>
    item.addEventListener("click", () => {
      // Selecting a quality should NOT auto-download.
      // It should update the main Download button (and Copy button) for this card.
      const card = item.closest(".video-item");
      if (!card) return;

      // Update selected styling
      card.querySelectorAll(".quality-menu-item.selected").forEach(s => s.classList.remove("selected"));
      item.classList.add("selected");

      const url = item.dataset.url;
      const quality = item.dataset.quality;

      const downloadBtn = card.querySelector(".download-btn");
      if (downloadBtn) {
        downloadBtn.dataset.url = url;
        downloadBtn.dataset.quality = quality;
        downloadBtn.textContent = `⬇ Download ${quality}`;
      }

      const typeBadge = card.querySelector(".video-type");
      if (typeBadge) typeBadge.textContent = quality;

      const copyBtn = card.querySelector(".copy-btn");
      if (copyBtn) copyBtn.dataset.url = url;

      item.closest(".quality-dropdown-menu")?.classList.remove("show");
      card.classList.remove("dropdown-open");
    })
  );

  document.addEventListener("click", () => {
    el.querySelectorAll(".quality-dropdown-menu.show").forEach(m => {
      m.classList.remove("show");
      m.closest(".video-item")?.classList.remove("dropdown-open");
    });
  });
}

function downloadVideo(url, quality) {
  chrome.runtime.sendMessage({
    action: "download",
    url,
    quality,
    filename: `Facebook Video - ${quality}.mp4`,
  });
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function qOrder(q) {
  const map = { "1080p": 10, HD: 9, "720p": 8, "480p": 7, "360p": 6, "270p": 5, "240p": 4, SD: 3, "180p": 2, MP4: 1 };
  return map[q] ?? 0;
}

function esc(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
