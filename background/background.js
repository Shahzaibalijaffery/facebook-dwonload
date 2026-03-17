// Facebook Video Downloader — Background Service Worker
// Video data comes from GraphQL API interception (content script).

const videoData = {}; // tabId → { videos: {videoId: {...}}, activeVideoId }

// ─── URL Helpers ──────────────────────────────────────────────

function extractVideoId(pageUrl) {
  if (!pageUrl) return null;

  console.log("pageUrl", pageUrl);
  try {
    const u = new URL(pageUrl);
    const v = u.searchParams.get("v");
    if (v) return v;
    let m;
    if ((m = u.pathname.match(/\/reel[s]?\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/watch\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/videos\/(\d+)/))) return m[1];
    if ((m = u.pathname.match(/\/\d+\/videos\/(\d+)/))) return m[1];
    if (u.hostname === "fb.watch") {
      const c = u.pathname.replace(/^\/+|\/+$/g, "");
      if (c) return c;
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Per-Tab Storage ──────────────────────────────────────────

function getTab(tabId) {
  if (!videoData[tabId]) videoData[tabId] = { videos: {}, activeVideoId: null };
  return videoData[tabId];
}

function ensureVideo(tab, videoId) {
  if (!tab.videos[videoId]) {
    tab.videos[videoId] = {
      videoId,
      title: "",
      author: "",
      permalink: "",
      duration: 0,
      thumbnail: "",
      urls: [],
    };
  }
  return tab.videos[videoId];
}

// Store rich video data from GraphQL interception
function storeGraphQLVideo(tabId, info) {
  const tab = getTab(tabId);
  const v = ensureVideo(tab, info.videoId);

  if (info.title) v.title = info.title;
  if (info.author) v.author = info.author;
  if (info.permalink) v.permalink = info.permalink;
  if (info.duration) v.duration = info.duration;
  if (info.thumbnail) v.thumbnail = info.thumbnail;

  for (const u of info.urls) {
    const key = `${u.quality}-${u.type}`;
    const idx = v.urls.findIndex((e) => `${e.quality}-${e.type}` === key);
    if (idx >= 0) {
      v.urls[idx] = { ...u, timestamp: Date.now() };
    } else {
      v.urls.push({ ...u, timestamp: Date.now() });
    }
  }

  tab.activeVideoId = info.videoId;
  persist(tabId);
  updateBadge(tabId);
  console.log(
    `[GraphQL] Video ${info.videoId}: ${v.urls.length} URLs, title="${v.title.substring(0, 50)}"`,
  );
}

function persist(tabId) {
  if (!videoData[tabId]) return;
  chrome.storage.local.set({ [`vd_${tabId}`]: videoData[tabId] });
}

function restore(tabId, cb) {
  chrome.storage.local.get([`vd_${tabId}`], (r) => {
    const stored = r[`vd_${tabId}`];
    if (stored?.videos && Object.keys(stored.videos).length)
      videoData[tabId] = stored;
    cb(videoData[tabId] || { videos: {}, activeVideoId: null });
  });
}

function updateBadge(tabId) {
  const tab = videoData[tabId];
  const count = tab ? Object.keys(tab.videos).length : 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "", tabId });
  if (count > 0)
    chrome.action.setBadgeBackgroundColor({ color: "#667eea", tabId });
}

// ─── Message Handler ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "ping") {
    sendResponse({ ok: true });
    return;
  }

  // Rich video data from GraphQL or reel document (content script)
  if (req.action === "FB_VIDEO_DATA") {
    const tabId = sender?.tab?.id;
    if (!tabId || !req.videos) {
      sendResponse({ ok: false, reason: !tabId ? "no tab" : "no videos" });
      return;
    }
    for (const video of req.videos) {
      if (video.videoId) storeGraphQLVideo(tabId, video);
    }
    sendResponse({ ok: true });
    return;
  }

  // Popup requesting video data
  if (req.action === "getVideoData") {
    const tabId = req.tabId;
    if (!tabId) {
      sendResponse({ videos: [] });
      return true;
    }

    const finish = (data) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          sendResponse({ videos: Object.values(data.videos || {}) });
          return;
        }

        let videos = Object.values(data.videos || {});
        const pageVid = extractVideoId(tab.url);

        if (pageVid) {
          const f = videos.filter((v) => v.videoId === pageVid);
          if (f.length) videos = f;
        } else if (data.activeVideoId) {
          const f = videos.filter((v) => v.videoId === data.activeVideoId);
          if (f.length) videos = f;
        }

        sendResponse({ videos });
      });
    };

    if (videoData[tabId] && Object.keys(videoData[tabId].videos).length) {
      finish(videoData[tabId]);
    } else {
      restore(tabId, finish);
    }
    return true;
  }

  // Download request from popup
  if (req.action === "download") {
    chrome.downloads.download(
      {
        url: req.url,
        filename: req.filename || "facebook_video.mp4",
        saveAs: true,
      },
      (id) => sendResponse({ downloadId: id }),
    );
    return true;
  }
});

// ─── Tab Lifecycle ────────────────────────────────────────────

chrome.tabs.onRemoved.addListener((tabId) => {
  delete videoData[tabId];
  chrome.storage.local.remove([`vd_${tabId}`]);
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (
    info.url &&
    !info.url.includes("facebook.com") &&
    !info.url.includes("fb.com")
  ) {
    delete videoData[tabId];
    chrome.storage.local.remove([`vd_${tabId}`]);
    updateBadge(tabId);
  }
});
