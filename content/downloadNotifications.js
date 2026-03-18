// Lightweight Facebook download notifications (based on tiktokDownloader).
// Shows a toast "Download started" with filename when a download begins.

let fbNotifContainer = null;

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

function fbShowDownloadToast(filename, quality) {
  if (window.self !== window.top) return;

  const container = fbEnsureNotifContainer();
  if (!container) {
    setTimeout(() => fbShowDownloadToast(filename, quality), 150);
    return;
  }

  const id = "fb-download-toast-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
  const card = document.createElement("div");
  card.id = id;
  card.className = "fb-notification-card fb-notif-anim-in";

  const qual = quality ? fbEscapeHtml(quality) : "";
  const qualHtml = qual ? `<span class="fb-notification-quality">${qual}</span>` : "";

  card.innerHTML = `
    <div class="fb-notification-header">
      <span class="fb-notification-icon">⬇️</span>
      <div class="fb-notification-body">
        <div class="fb-notification-title">Download started${qualHtml}</div>
        <div class="fb-notification-filename">${fbEscapeHtml(filename || "Facebook Video")}</div>
      </div>
    </div>
  `;

  container.appendChild(card);

  setTimeout(() => {
    card.classList.remove("fb-notif-anim-in");
    card.classList.add("fb-notif-anim-out");
    setTimeout(() => {
      if (card.parentNode) card.parentNode.removeChild(card);
    }, 300);
  }, 3500);
}

// Listen for download events from background / popup / reel script.
chrome.runtime.onMessage.addListener((req, _sender, _sendResponse) => {
  if (req && req.action === "fbShowDownloadNotification") {
    fbShowDownloadToast(req.filename, req.quality);
  }
});

