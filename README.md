# Facebook Video Downloader - Chrome Extension

A Chrome extension to download Facebook videos in various formats (MP4, HLS).

## Features

- 🎬 Download Facebook videos in MP4 and HLS formats
- 🎯 Automatic detection of video URLs (watch, reel, fb.watch)
- 📱 Elegant and modern popup interface
- 🔄 Support for multiple simultaneous downloads
- ❌ Cancel downloads at any time
- 📊 Real-time download progress notifications
- 🎨 Beautiful gradient UI design

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory

### From Bundle

1. Download the `facebook-video-downloader-v1.0.0.zip` file
2. Extract the zip file
3. Follow steps 2-5 from "From Source" above

## Building/Bundling

### Option 1: Minified Build (Recommended for Production)

```bash
npm install
npm run bundle
```

This will:

- ✅ Minify all JavaScript files (38-42% size reduction)
- ✅ Remove comments and debug code
- ✅ Optimize code with multiple compression passes
- ✅ Generate source maps for debugging
- ✅ Create a production-ready zip file

**Result:** `facebook-video-downloader-v1.0.0.zip` (optimized, smaller size)

### Option 2: Build Only (No Bundle)

```bash
npm install
npm run build
```

This creates a `dist/` directory with minified files. Useful for testing before bundling.

### Option 3: Unminified Bundle (Simple)

```bash
./bundle.sh
```

Creates a zip with original (unminified) files. No npm required, but larger file size.

### Option 4: Manual

1. Create a zip file containing all extension files
2. Exclude: `node_modules/`, `.git/`, `dist/`, `*.zip`, `*.map`

## Usage

1. Navigate to any Facebook video page (facebook.com/watch, /reel/, fb.watch, video.php)
2. Play the video (or wait for it to load)
3. Click the extension icon in the toolbar
4. Select a video quality/format from the list
5. Click "Download" to start downloading
6. Monitor progress in the notification at the bottom-left of the page

## Permissions

- **activeTab**: Access to the current Facebook tab
- **downloads**: Download video files
- **webRequest**: Intercept video URLs
- **storage**: Store download progress
- **offscreen**: Handle blob downloads

## File Structure

```
vkdownloader/
├── manifest.json          # Extension manifest
├── background/
│   ├── background.js      # Service worker (main logic)
│   ├── offscreen.html     # Offscreen document HTML
│   └── offscreen.js       # Offscreen document script
├── content/
│   └── content.js         # Content script (injected into Facebook video pages)
├── popup/
│   ├── popup.html         # Popup UI
│   ├── popup.js           # Popup logic
│   └── popup.css          # Popup styles
├── icons/
├── scripts/               # Utility scripts
├── build.js               # Build script (minification & optimization)
├── bundle.js              # Bundling script (creates zip from dist/)
├── bundle.sh              # Simple bundling script (unminified)
├── package.json           # npm configuration
└── dist/                  # Build output directory (generated)
```

## Development

1. Make changes to the source files
2. Reload the extension in `chrome://extensions/`
3. Refresh the Facebook page to test changes

## License

This extension is provided as-is for educational purposes.
