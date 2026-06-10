# ComfyFlow Panel - Gallery Fixes

This document outlines bugs found in the ComfyFlow panel's gallery functionality and provides instructions for fixing them.

---

## Bug 1: Slides Toggle Button Has No Active State

### Problem
When clicking the "Slides" or "Columns" toggle button in the gallery, there is no visual feedback showing which mode is currently active. The toggle works internally (re-renders correctly) but the user cannot see which mode is selected.

### Root Cause
1. **JavaScript**: Toggle buttons don't get an `active` class based on `this.galleryView`
2. **CSS**: No `.active` state styling exists for the toggle buttons

### Files Affected
- `packages/comfyui-comfyflow/js/comfyflow.js`
- `packages/comfyui-comfyflow/js/comfyflow.css`

### Fix Instructions

#### Step 1: Update CSS (comfyflow.css)

Add the following CSS after line 1820 (after `.comfyflow-gallery-toggle:active`):

```css
/* Active state for gallery view toggles */
.comfyflow-preview-root .comfyflow-gallery-toggle.active,
.comfyflow-preview-root .cf-gallery-toggle.active {
  background: #6366f1;
  border-color: #6366f1;
  color: #fff;
}
```

#### Step 2: Update JavaScript (comfyflow.js)

In the `_createGallery` function (around line 522-537), update the toggle button creation to include active state:

Find this code (around line 532-537):
```javascript
// Toggle to Slides button
const toggleBtn = el("button", "cf-gallery-toggle", "Slides");
toggleBtn.classList.add("comfyflow-gallery-toggle");
toggleBtn.type = "button";
toggleBtn.onclick = () => this._toggleGalleryView("slides");
header.appendChild(toggleBtn);
```

Replace with:
```javascript
// Toggle to Slides button
const toggleBtn = el("button", "cf-gallery-toggle", "Slides");
toggleBtn.classList.add("comfyflow-gallery-toggle");
toggleBtn.classList.toggle("active", viewMode === "slides" || (!viewMode && this.galleryView === "slides"));
toggleBtn.type = "button";
toggleBtn.onclick = () => this._toggleGalleryView("slides");
header.appendChild(toggleBtn);
```

Similarly, update the Columns toggle button in `_createColumnGallery` (around line 576-580):

Find:
```javascript
// Toggle to Columns button
const toggleBtn = el("button", "cf-gallery-toggle", "Columns");
toggleBtn.classList.add("comfyflow-gallery-toggle");
toggleBtn.type = "button";
toggleBtn.onclick = () => this._toggleGalleryView("columns");
header.appendChild(toggleBtn);
```

Replace with:
```javascript
// Toggle to Columns button
const toggleBtn = el("button", "cf-gallery-toggle", "Columns");
toggleBtn.classList.add("comfyflow-gallery-toggle");
toggleBtn.classList.toggle("active", viewMode === "columns" || (!viewMode && this.galleryView === "columns"));
toggleBtn.type = "button";
toggleBtn.onclick = () => this._toggleGalleryView("columns");
header.appendChild(toggleBtn);
```

---

## Bug 2: Video Thumbnails Not Showing Properly

### Problem
Video thumbnails in galleries and cards do not display correctly. Issues include:
1. No visual indicator (play button) showing that the thumbnail is a video
2. Video elements may not be sized correctly within thumbnail containers
3. Video detection is too limited (only detects by file extension or "video" in URL)

### Root Cause
1. **JavaScript**: When videos are detected, no play icon overlay is created
2. **CSS**: No rules for `video` elements inside `.comfyflow-gallery-thumb` or `.comfyflow-card-thumb`

### Files Affected
- `packages/comfyui-comfyflow/js/comfyflow.js`
- `packages/comfyui-comfyflow/js/comfyflow.css`

### Fix Instructions

#### Step 1: Add CSS for Video Elements in Gallery Thumbnails

Add the following CSS after the existing `img` rules for gallery thumbnails. Find line 1784-1785:

Current code:
```css
.comfyflow-preview-root .comfyflow-gallery-thumb:hover img,
.comfyflow-preview-root .cf-gallery-thumb:hover img {
  transform: scale(1.05);
}
```

Add after it:
```css
/* Video styling for gallery thumbnails */
.comfyflow-preview-root .comfyflow-gallery-thumb video,
.comfyflow-preview-root .cf-gallery-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: transform 0.3s ease;
}

.comfyflow-preview-root .comfyflow-gallery-thumb:hover video,
.comfyflow-preview-root .cf-gallery-thumb:hover video {
  transform: scale(1.05);
}
```

#### Step 2: Add CSS for Video Elements in Card Thumbnails

Add the following CSS after the card thumbnail `img` rules. Find line 679-681:

Current code:
```css
.comfyflow-preview-root .comfyflow-card:hover .comfyflow-card-thumb img {
  transform: scale(1.05);
}
```

Add after it:
```css
/* Video styling for card thumbnails */
.comfyflow-preview-root .comfyflow-card-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: transform 0.3s ease;
}

.comfyflow-preview-root .comfyflow-card:hover .comfyflow-card-thumb video {
  transform: scale(1.05);
}
```

#### Step 3: Add Video Play Icon in JavaScript

In the `_createNsfwImage` function (around line 469-489), update the video element creation to add a play icon overlay.

Find this code (around line 473-487):
```javascript
let mediaEl;
if (isVideo) {
  mediaEl = document.createElement("video");
  mediaEl.src = imageUrl;
  mediaEl.muted = true;
  mediaEl.playsInline = true;
  mediaEl.loop = true;
  mediaEl.setAttribute("data-video-thumbnail", "true");
  mediaEl.onerror = () => wrapper.classList.add("cf-hidden");
} else {
  mediaEl = el("img");
  mediaEl.src = imageUrl;
  mediaEl.alt = altText;
  mediaEl.loading = "lazy";
  mediaEl.onerror = () => wrapper.classList.add("cf-hidden");
}
container.appendChild(mediaEl);
wrapper.appendChild(container);
```

Replace with:
```javascript
let mediaEl;
if (isVideo) {
  mediaEl = document.createElement("video");
  mediaEl.src = imageUrl;
  mediaEl.muted = true;
  mediaEl.playsInline = true;
  mediaEl.loop = true;
  mediaEl.setAttribute("data-video-thumbnail", "true");
  mediaEl.onerror = () => wrapper.classList.add("cf-hidden");

  // Add play icon overlay for video thumbnails
  const playIcon = document.createElement("div");
  playIcon.className = "cf-gallery-video-play";
  playIcon.textContent = "▶";
  playIcon.style.position = "absolute";
  playIcon.style.top = "50%";
  playIcon.style.left = "50%";
  playIcon.style.transform = "translate(-50%, -50%)";
  wrapper.appendChild(playIcon);
} else {
  mediaEl = el("img");
  mediaEl.src = imageUrl;
  mediaEl.alt = altText;
  mediaEl.loading = "lazy";
  mediaEl.onerror = () => wrapper.classList.add("cf-hidden");
}
container.appendChild(mediaEl);
wrapper.appendChild(container);
```

#### Step 4: Improve Video Detection (Optional Enhancement)

The current video detection only checks for file extensions and "video" in the URL. This may miss many video URLs. Consider enhancing the detection (around line 470):

Current:
```javascript
const isVideo = imageUrl.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/) || imageUrl.includes("video");
```

Enhanced (add more patterns):
```javascript
const isVideo = imageUrl.toLowerCase().match(/\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/) 
  || imageUrl.includes("video") 
  || imageUrl.includes("/videos/")
  || imageUrl.includes("stream")
  || imageUrl.includes("playback");
```

---

## Summary of Changes

| File | Line(s) | Change |
|------|---------|--------|
| `comfyflow.css` | ~1820 | Add `.active` state CSS for toggle buttons |
| `comfyflow.css` | ~1785 | Add `video` rules for gallery thumbnails |
| `comfyflow.css` | ~681 | Add `video` rules for card thumbnails |
| `comfyflow.js` | ~532-537 | Add active class to Slides toggle button |
| `comfyflow.js` | ~576-580 | Add active class to Columns toggle button |
| `comfyflow.js` | ~473-487 | Add play icon overlay for video thumbnails |

---

## Testing

After applying these fixes:
1. Open a workflow/guide with a gallery containing multiple images
2. Click the "Slides" / "Columns" toggle - verify the active button is highlighted
3. View galleries/cards containing video thumbnails - verify play icon appears and videos display correctly