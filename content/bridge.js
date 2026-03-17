// Runs in ISOLATED world — bridges messages from the page (MAIN world)
// to the background service worker via chrome.runtime.

function sendVideoDataToBackground(videos) {
  if (!videos || !Array.isArray(videos) || videos.length === 0) return;
  chrome.runtime.sendMessage(
    { action: "FB_VIDEO_DATA", videos },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("[FB Downloader] Bridge sendMessage error:", chrome.runtime.lastError.message);
      }
    },
  );
}

window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.type !== "FB_VIDEO_DATA") return;
  sendVideoDataToBackground(e.data.videos);
});

document.addEventListener("FB_VIDEO_DATA", (e) => {
  if (e.detail?.videos) sendVideoDataToBackground(e.detail.videos);
});
