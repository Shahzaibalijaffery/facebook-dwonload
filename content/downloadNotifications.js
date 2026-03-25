// Lightweight Facebook download notifications (toast + progress bar).
// Works with background messages:
// - action: "fbShowDownloadNotification" (optional downloadId)
// - action: "fbDownloadProgress"

let fbNotifContainer = null;
const fbCardsByDownloadId = new Map(); // downloadId -> card element

function fbEscapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function fbEnsureNotifContainer() {
  if (window.self !== window.top) return null;

  const existing = document.getElementById("fb-downloader-notifications");
  if (existing) {
    fbNotifContainer = existing;
    return existing;
  }
  if (fbNotifContainer && document.body?.contains(fbNotifContainer)) {
    return fbNotifContainer;
  }
  if (!document.body) {
    setTimeout(fbEnsureNotifContainer, 100);
    return null;
  }

  const el = document.createElement("div");
  el.id = "fb-downloader-notifications";
  document.body.appendChild(el);
  fbNotifContainer = el;
  return el;
}

function getDownloadCard(downloadId) {
  if (downloadId == null) return null;
  if (fbCardsByDownloadId.has(downloadId)) {
    const el = fbCardsByDownloadId.get(downloadId);
    if (el?.isConnected) return el;
  }

  const container = fbEnsureNotifContainer();
  if (!container) return null;

  const card = document.createElement("div");
  card.id = "fb-download-notification-" + String(downloadId);
  card.className = "fb-notification-card fb-notif-anim-in";
  container.appendChild(card);
  fbCardsByDownloadId.set(downloadId, card);
  return card;
}

function fbRenderOrUpdate(downloadId, filename, quality, progress, status) {
  const container = fbEnsureNotifContainer();
  if (!container) return;

  const safeDownloadId = downloadId != null ? downloadId : Date.now();
  const card = getDownloadCard(safeDownloadId);
  if (!card) return;

  const pct =
    typeof progress === "number" && progress >= 0
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : 0;

  const s = (status || "").toLowerCase();
  const isComplete = s === "complete" || pct === 100;
  const isFailed =
    s.includes("interrupted") ||
    s.includes("error") ||
    s.includes("failed") ||
    s.includes("cancelled");

  const icon = isComplete ? "✅" : isFailed ? "⚠️" : "⬇️";
  const titleText = isComplete
    ? "Download complete"
    : isFailed
      ? "Download failed"
      : "Downloading";

  const qual = quality ? fbEscapeHtml(quality) : "";
  const qualHtml = qual ? `<span class="fb-notification-quality">${qual}</span>` : "";

  const statusLine =
    status && (isFailed || s.includes("failed") || s.includes("error") || s.includes("starting") || s.includes("converting"))
      ? `<div class="fb-notification-status">${fbEscapeHtml(status)}</div>`
      : "";

  const progressBarHtml =
    pct != null
      ? `<div class="fb-notification-progress-wrap"><div class="fb-notification-progress-fill" style="width:${pct}%"></div></div><div class="fb-notification-progress-pct">${pct}%</div>`
      : "";

  card.innerHTML = `
    <div class="fb-notification-header">
      <span class="fb-notification-icon">${icon}</span>
      <div class="fb-notification-body">
        <div class="fb-notification-title">${fbEscapeHtml(titleText)}${qualHtml}</div>
        <div class="fb-notification-filename">${fbEscapeHtml(filename || "Facebook Video")}</div>
      </div>
    </div>
    ${statusLine}
    ${progressBarHtml}
  `;

  if (isComplete || isFailed) {
    setTimeout(() => {
      try {
        card.classList.remove("fb-notif-anim-in");
        card.classList.add("fb-notif-anim-out");
      } catch {}
      setTimeout(() => {
        if (card.parentNode) card.parentNode.removeChild(card);
        fbCardsByDownloadId.delete(safeDownloadId);
      }, 300);
    }, 4000);
  }
}

// Listen for download events from background / popup / reel script.
chrome.runtime.onMessage.addListener((req, _sender, _sendResponse) => {
  if (!req || !req.action) return;

  if (req.action === "fbShowDownloadNotification") {
    fbRenderOrUpdate(
      req.downloadId != null ? req.downloadId : null,
      req.filename,
      req.quality,
      0,
      "starting",
    );
  } else if (req.action === "fbDownloadProgress") {
    fbRenderOrUpdate(
      req.downloadId,
      req.filename,
      req.quality,
      req.progress,
      req.status,
    );
  }
});

