import { app } from "../../../scripts/app.js";

async function parseJson(res) {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok
        ? "Empty response from ComfyFlow plugin."
        : `ComfyFlow request failed (${res.status}). Restart ComfyUI.`,
    );
  }
  return JSON.parse(text);
}

const API = {
  status: () => fetch("/comfyflow/auth/status").then(parseJson),
  login: () =>
    fetch("/comfyflow/auth/login", { method: "POST" }).then(parseJson),
  logout: () =>
    fetch("/comfyflow/auth/logout", { method: "POST" }).then(parseJson),
  workflows: (search = "", page = 1) =>
    fetch(
      `/comfyflow/api/workflows?search=${encodeURIComponent(search)}&page=${page}&limit=24`,
    ).then(parseJson),
  load: (workflowId) =>
    fetch("/comfyflow/api/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflow_id: workflowId }),
    }).then(parseJson),
  guides: (search = "", difficulty = "", page = 1) =>
    fetch(
      `/comfyflow/api/guides?search=${encodeURIComponent(search)}&difficulty=${encodeURIComponent(difficulty)}&page=${page}&limit=24`,
    ).then(parseJson),
  guide: (slug) =>
    fetch(`/comfyflow/api/guides/${encodeURIComponent(slug)}`).then(parseJson),
  workflowPage: (workflowId) =>
    fetch(
      `/comfyflow/api/workflows/${encodeURIComponent(workflowId)}/page`,
    ).then(parseJson),
  threads: (search = "", page = 1) =>
    fetch(
      `/comfyflow/api/threads?search=${encodeURIComponent(search)}&page=${page}&limit=24`,
    ).then(parseJson),
  thread: (threadId) =>
    fetch(`/comfyflow/api/threads/${encodeURIComponent(threadId)}`).then(
      parseJson,
    ),
  updateSettings: (showNsfw, hideNsfw) =>
    fetch("/comfyflow/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        show_nsfw_content: showNsfw,
        hide_nsfw_content: hideNsfw,
      }),
    }).then(parseJson),
};

const GUIDE_DIFFICULTIES = [
  { value: "all", label: "All" },
  { value: "beginner", label: "Beginner" },
  { value: "intermediate", label: "Intermediate" },
  { value: "advanced", label: "Advanced" },
];

function guideDifficultyLabel(value) {
  const found = GUIDE_DIFFICULTIES.find((d) => d.value === value);
  return found ? found.label : value || "Guide";
}

const PANEL_MODE_KEY = "comfyflow.panelDisplayMode";

function loadPanelMode() {
  try {
    return localStorage.getItem(PANEL_MODE_KEY) === "full_site"
      ? "full_site"
      : "tabs";
  } catch {
    return "tabs";
  }
}

function savePanelMode(mode) {
  try {
    localStorage.setItem(PANEL_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return "0";
  return Number(n).toLocaleString();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

class ComfyFlowPanel {
  constructor() {
    this.root = el("div", "comfyflow-panel");
    this.root.setAttribute("data-comfyflow", "1");
    this.visible = false;
    this.tab = "workflows";
    this.guideView = "list";
    this.search = "";
    this.guideSearch = "";
    this.guideDifficulty = "all";
    this.page = 1;
    this.activeGuide = null;
    /** @type {"list" | "detail"} */
    this.workflowView = "list";
    this.activeWorkflowBrowser = null;
    /** @type {"list" | "detail"} */
    this.threadView = "list";
    this.activeThread = null;
    this.threadSearch = "";
    /** @type {"list" | "detail"} */
    this.aiWorkflowView = "list";
    this.activeAiWorkflow = null;
    /** @type {"columns" | "slides"} */
    this.galleryView = "columns";
    /** @type {"tabs" | "full_site"} */
    this.panelMode = loadPanelMode();
    this.state = {
      logged_in: false,
      profile: null,
      app_url: "https://comfy-flow.com",
    };
    this._authPollInterval = null;
    this._loadPollInterval = null;
    this._build();
  }

  _build() {
    const header = el("div", "comfyflow-header");
    header.appendChild(el("span", "comfyflow-title", "ComfyFlow"));
    this.statusEl = el("span", "comfyflow-status", "");
    header.appendChild(this.statusEl);
    const closeBtn = el("button", "comfyflow-close", "×");
    closeBtn.type = "button";
    closeBtn.title = "Close ComfyFlow panel";
    closeBtn.setAttribute("aria-label", "Close ComfyFlow panel");
    closeBtn.onclick = () => {
      if (this.visible) togglePanel();
    };
    header.appendChild(closeBtn);
    this.root.appendChild(header);

    this.tabsEl = el("div", "comfyflow-tabs comfyflow-tabs-three");
    this.tabWorkflowsBtn = el("button", "comfyflow-tab active", "Workflows");
    this.tabGuidesBtn = el("button", "comfyflow-tab", "Guides");
    this.tabThreadsBtn = el("button", "comfyflow-tab", "Threads");
    this.tabAiWorkflowBtn = el("button", "comfyflow-tab", "AI workflow");
    this.tabWorkflowsBtn.type = "button";
    this.tabGuidesBtn.type = "button";
    this.tabThreadsBtn.type = "button";
    this.tabAiWorkflowBtn.type = "button";
    this.tabWorkflowsBtn.onclick = () => this._setTab("workflows");
    this.tabGuidesBtn.onclick = () => this._setTab("guides");
    this.tabThreadsBtn.onclick = () => this._setTab("threads");
    this.tabAiWorkflowBtn.onclick = () => this._setTab("aiworkflow");
    this.tabsEl.appendChild(this.tabWorkflowsBtn);
    this.tabsEl.appendChild(this.tabGuidesBtn);
    this.tabsEl.appendChild(this.tabThreadsBtn);
    this.tabsEl.appendChild(this.tabAiWorkflowBtn);
    this.root.appendChild(this.tabsEl);

    const toolbar = el("div", "comfyflow-toolbar");
    this.loginBtn = el("button", "comfyflow-btn primary", "Sign in");
    this.loginBtn.type = "button";
    this.refreshBtn = el("button", "comfyflow-btn", "Refresh");
    this.refreshBtn.type = "button";
    this.refreshBtn.onclick = () => {
      if (this.panelMode === "full_site") {
        try {
          this.fullSiteIframe.contentWindow?.location.reload();
        } catch {
          const u = this.fullSiteIframe.src;
          this.fullSiteIframe.src = u;
        }
        return;
      }
      void this._refreshActiveTab();
    };
    this.logoutBtn = el("button", "comfyflow-btn", "Sign out");
    this.logoutBtn.type = "button";
    this.openSiteBtn = el("button", "comfyflow-btn", "Open site");
    this.openSiteBtn.type = "button";
    this.settingsBtn = el("button", "comfyflow-btn", "Settings");
    this.settingsBtn.type = "button";
    this.settingsBtn.title = "Panel display mode";
    this.settingsMenu = el("div", "comfyflow-settings-menu cf-hidden");
    const optTabs = el(
      "button",
      "comfyflow-settings-opt",
      "Tabs — workflows, guides, threads in-panel",
    );
    optTabs.type = "button";
    optTabs.onclick = () => {
      this._setPanelMode("tabs");
      this._hideSettingsMenu();
    };
    const optFull = el(
      "button",
      "comfyflow-settings-opt",
      "Full website — embed the whole site",
    );
    optFull.type = "button";
    optFull.onclick = () => {
      this._setPanelMode("full_site");
      this._hideSettingsMenu();
    };
    this.settingsMenu.appendChild(optTabs);
    this.settingsMenu.appendChild(optFull);

    const settingsDivider = el("div", "comfyflow-settings-divider");

    const rowHide = el("div", "comfyflow-settings-row");
    const labelHide = el(
      "span",
      "comfyflow-settings-label",
      "Hide NSFW content",
    );
    this.hideNsfwCheckbox = el("input", "comfyflow-settings-checkbox");
    this.hideNsfwCheckbox.type = "checkbox";
    this.hideNsfwCheckbox.onchange = () => void this._onSettingsChanged();
    rowHide.appendChild(labelHide);
    rowHide.appendChild(this.hideNsfwCheckbox);

    const hintHide = el(
      "div",
      "comfyflow-settings-hint",
      "Enable to hide all NSFW content from the feed",
    );

    const rowShow = el("div", "comfyflow-settings-row");
    const labelShow = el(
      "span",
      "comfyflow-settings-label",
      "Show NSFW content (unblur)",
    );
    this.showNsfwCheckbox = el("input", "comfyflow-settings-checkbox");
    this.showNsfwCheckbox.type = "checkbox";
    this.showNsfwCheckbox.onchange = () => void this._onSettingsChanged();
    rowShow.appendChild(labelShow);
    rowShow.appendChild(this.showNsfwCheckbox);

    const hintShow = el(
      "div",
      "comfyflow-settings-hint",
      "Enable to view sensitive content without blur",
    );

    this.settingsMenu.appendChild(settingsDivider);
    this.settingsMenu.appendChild(rowHide);
    this.settingsMenu.appendChild(hintHide);
    this.settingsMenu.appendChild(rowShow);
    this.settingsMenu.appendChild(hintShow);
    const settingsWrap = el("div", "comfyflow-settings-wrap");
    settingsWrap.appendChild(this.settingsBtn);
    settingsWrap.appendChild(this.settingsMenu);
    toolbar.appendChild(this.loginBtn);
    toolbar.appendChild(this.logoutBtn);
    toolbar.appendChild(this.refreshBtn);
    toolbar.appendChild(settingsWrap);
    toolbar.appendChild(this.openSiteBtn);
    this.root.appendChild(toolbar);

    this.wfSearchRow = el("div", "comfyflow-search-row");
    this.searchInput = el("input", "comfyflow-search");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "Search workflows…";
    this.searchBtn = el("button", "comfyflow-btn primary", "Search");
    this.searchBtn.type = "button";
    this.wfSearchRow.appendChild(this.searchInput);
    this.wfSearchRow.appendChild(this.searchBtn);
    this.root.appendChild(this.wfSearchRow);

    this.guideSearchRow = el("div", "comfyflow-search-row cf-hidden");
    this.guideSearchInput = el("input", "comfyflow-search");
    this.guideSearchInput.type = "search";
    this.guideSearchInput.placeholder = "Search guides…";
    this.guideSearchBtn = el("button", "comfyflow-btn primary", "Search");
    this.guideSearchBtn.type = "button";
    this.guideSearchRow.appendChild(this.guideSearchInput);
    this.guideSearchRow.appendChild(this.guideSearchBtn);
    this.root.appendChild(this.guideSearchRow);

    this.guideFilterRow = el("div", "comfyflow-guide-filters cf-hidden");
    this.guideFilterBtns = [];
    for (const diff of GUIDE_DIFFICULTIES) {
      const btn = el("button", "comfyflow-filter-chip", diff.label);
      btn.type = "button";
      btn.dataset.value = diff.value;
      if (diff.value === "all") btn.classList.add("active");
      btn.onclick = () => {
        this.guideDifficulty = diff.value;
        for (const chip of this.guideFilterBtns) {
          chip.classList.toggle("active", chip.dataset.value === diff.value);
        }
        void this._loadGuides();
      };
      this.guideFilterBtns.push(btn);
      this.guideFilterRow.appendChild(btn);
    }
    this.root.appendChild(this.guideFilterRow);

    this.threadSearchRow = el("div", "comfyflow-search-row cf-hidden");
    this.threadSearchInput = el("input", "comfyflow-search");
    this.threadSearchInput.type = "search";
    this.threadSearchInput.placeholder = "Search threads…";
    this.threadSearchBtn = el("button", "comfyflow-btn primary", "Search");
    this.threadSearchBtn.type = "button";
    this.threadSearchRow.appendChild(this.threadSearchInput);
    this.threadSearchRow.appendChild(this.threadSearchBtn);
    this.root.appendChild(this.threadSearchRow);

    this.bodyEl = el("div", "comfyflow-body");
    this.listEl = el("div", "comfyflow-list");
    this.guideListEl = el("div", "comfyflow-list cf-hidden");
    this.guideDetailEl = el("div", "comfyflow-guide-detail cf-hidden");
    this.workflowDetailEl = el(
      "div",
      "comfyflow-workflow-detail comfyflow-guide-detail cf-hidden",
    );
    this.threadListEl = el("div", "comfyflow-list cf-hidden");
    this.threadDetailEl = el("div", "comfyflow-guide-detail cf-hidden");
    this.aiWorkflowListEl = el("div", "comfyflow-list cf-hidden");
    this.aiWorkflowDetailEl = el("div", "comfyflow-guide-detail cf-hidden");
    this.bodyEl.appendChild(this.listEl);
    this.bodyEl.appendChild(this.guideListEl);
    this.bodyEl.appendChild(this.guideDetailEl);
    this.bodyEl.appendChild(this.workflowDetailEl);
    this.bodyEl.appendChild(this.threadListEl);
    this.bodyEl.appendChild(this.threadDetailEl);
    this.bodyEl.appendChild(this.aiWorkflowListEl);
    this.bodyEl.appendChild(this.aiWorkflowDetailEl);
    this.root.appendChild(this.bodyEl);

    this.fullSiteWrap = el("div", "comfyflow-full-site cf-hidden");
    this.fullSiteIframe = document.createElement("iframe");
    this.fullSiteIframe.className = "comfyflow-full-site-iframe";
    this.fullSiteIframe.title = "ComfyFlow";
    this.fullSiteIframe.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-popups allow-forms allow-popups-to-escape-sandbox",
    );
    this.fullSiteWrap.appendChild(this.fullSiteIframe);
    this.root.appendChild(this.fullSiteWrap);

    this.messageEl = el("div", "comfyflow-message", "");
    this.root.appendChild(this.messageEl);

    this.loginBtn.onclick = () => this._login();
    this.logoutBtn.onclick = () => this._logout();
    this.openSiteBtn.onclick = () =>
      window.open(this.state.app_url || "https://comfy-flow.com", "_blank");
    this.searchBtn.onclick = () => {
      this.search = this.searchInput.value.trim();
      this.page = 1;
      void this._loadWorkflows();
    };
    this.searchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        this.search = this.searchInput.value.trim();
        this.page = 1;
        void this._loadWorkflows();
      }
    };
    this.guideSearchBtn.onclick = () => {
      this.guideSearch = this.guideSearchInput.value.trim();
      this.page = 1;
      void this._loadGuides();
    };
    this.guideSearchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        this.guideSearch = this.guideSearchInput.value.trim();
        this.page = 1;
        void this._loadGuides();
      }
    };
    this.threadSearchBtn.onclick = () => {
      this.threadSearch = this.threadSearchInput.value.trim();
      this.page = 1;
      void this._loadThreads();
    };
    this.threadSearchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        this.threadSearch = this.threadSearchInput.value.trim();
        this.page = 1;
        void this._loadThreads();
      }
    };
    this.settingsBtn.onclick = () => this._toggleSettingsMenu();
    this._applyPanelMode();
    this._syncTabUi();
  }

  setMessage(text, isError = false) {
    this.messageEl.textContent = text || "";
    this.messageEl.classList.toggle("error", isError);
  }

  _hideSettingsMenu() {
    this.settingsMenu.classList.add("cf-hidden");
    this.settingsMenu.classList.remove("cf-visible");
  }

  _toggleSettingsMenu() {
    const open = !this.settingsMenu.classList.contains("cf-hidden");
    if (open) {
      this._hideSettingsMenu();
      return;
    }
    this.settingsMenu.classList.remove("cf-hidden");
    this.settingsMenu.classList.add("cf-visible");
  }

  _syncSettingsUi() {
    const loggedIn = this.state.logged_in;
    const profile = this.state.profile || {};

    const showNsfw = loggedIn ? !!profile.show_nsfw_content : false;
    const hideNsfw = loggedIn ? !!profile.hide_nsfw_content : false;

    if (this.showNsfwCheckbox) {
      this.showNsfwCheckbox.checked = showNsfw;
      this.showNsfwCheckbox.disabled = !loggedIn;
    }
    if (this.hideNsfwCheckbox) {
      this.hideNsfwCheckbox.checked = hideNsfw;
      this.hideNsfwCheckbox.disabled = !loggedIn;
    }
  }

  async _onSettingsChanged() {
    if (!this.state.logged_in) return;
    const showNsfw = !!this.showNsfwCheckbox?.checked;
    const hideNsfw = !!this.hideNsfwCheckbox?.checked;
    this.setMessage("Saving settings...");
    try {
      const res = await API.updateSettings(showNsfw, hideNsfw);
      if (res.error) throw new Error(res.error);
      if (res.profile) {
        this.state.profile = res.profile;
      } else {
        this.state.profile = {
          ...this.state.profile,
          show_nsfw_content: showNsfw,
          hide_nsfw_content: hideNsfw,
        };
      }
      this.setMessage("Settings saved.");
      this._syncSettingsUi();
      await this._refreshActiveTab();
    } catch (e) {
      this.setMessage(String(e), true);
      this._syncSettingsUi();
    }
  }

  _createNsfwImage(
    imageUrl,
    isNsfw,
    altText = "Image",
    customClass = "comfyflow-card-thumb",
  ) {
    const wrapper = el("div", `${customClass} comfyflow-nsfw-blur-wrapper`);

    const containerClass =
      customClass === "comfyflow-card-thumb"
        ? "cf-thumb-card"
        : "cf-thumb-prose";
    const container = el("div", containerClass);

    // Detect if URL is a video
    const isVideo = imageUrl.toLowerCase().match(/\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/) 
      || imageUrl.includes("video") 
      || imageUrl.includes("/videos/")
      || imageUrl.includes("stream")
      || imageUrl.includes("playback");

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

    const showNsfw =
      this.state.logged_in && !!this.state.profile?.show_nsfw_content;
    const blurred = !!isNsfw && !showNsfw;

    if (blurred) {
      container.classList.add("comfyflow-nsfw-blurred");

      const overlay = el("div", "comfyflow-nsfw-overlay");
      const title = el("span", "comfyflow-nsfw-title", "Sensitive content");
      const desc = el(
        "span",
        "comfyflow-nsfw-desc",
        "Sensitive content. Turn on 'Show NSFW content' under Settings to view media.",
      );
      overlay.appendChild(title);
      overlay.appendChild(desc);
      wrapper.appendChild(overlay);
    }

    return wrapper;
  }

  _createGallery(urls, title, isNsfw, viewMode = "columns") {
    if (!urls || urls.length === 0) return null;

    const container = el("div", "cf-gallery-container");
    container.dataset.galleryInitialized = "true";

    // Header
    const header = el("div", "cf-gallery-header");
    header.classList.add("comfyflow-gallery-header");

    const titleEl = el("span", "cf-gallery-title-text", "Gallery");
    titleEl.classList.add("comfyflow-gallery-title-text");
    header.appendChild(titleEl);

    // Create buttons container and wrap both toggle buttons
    const buttonsContainer = el("div", "cf-gallery-header-buttons");
    buttonsContainer.classList.add("comfyflow-gallery-header-buttons");

    const columnsBtn = el("button", "cf-gallery-toggle", "Columns");
    columnsBtn.classList.add("comfyflow-gallery-toggle");
    columnsBtn.classList.toggle("active", viewMode === "columns");
    columnsBtn.type = "button";
    columnsBtn.onclick = () => this._toggleGalleryView("columns");

    const slidesBtn = el("button", "cf-gallery-toggle", "Slides");
    slidesBtn.classList.add("comfyflow-gallery-toggle");
    slidesBtn.classList.toggle("active", viewMode === "slides");
    slidesBtn.type = "button";
    slidesBtn.onclick = () => this._toggleGalleryView("slides");

    buttonsContainer.appendChild(columnsBtn);
    buttonsContainer.appendChild(slidesBtn);
    header.appendChild(buttonsContainer);

    container.appendChild(header);

    // Create Columns view (grid of thumbnails)
    const columnsView = el("div", "cf-gallery-columns-view");
    columnsView.classList.add("comfyflow-gallery-columns-view");

    const grid = el("div", "cf-gallery-grid");
    grid.classList.add("comfyflow-gallery-grid");

    urls.forEach((url, idx) => {
      const wrapped = this._createNsfwImage(
        url,
        isNsfw,
        `${title || "Gallery"} ${idx + 1}`,
        "cf-gallery-thumb",
      );
      wrapped.classList.add("comfyflow-gallery-thumb");
      wrapped.onclick = () => this._openGalleryLightbox(urls, idx, isNsfw);
      grid.appendChild(wrapped);
    });

    columnsView.appendChild(grid);
    container.appendChild(columnsView);

    // Create Slides view (carousel)
    const slidesView = el("div", "cf-gallery-slides-view");
    slidesView.classList.add("comfyflow-gallery-slides-view");
    slidesView.classList.add("cf-hidden");

    const slideFrame = el("div", "cf-gallery-slide-frame");
    slideFrame.classList.add("comfyflow-gallery-slide-frame");

    // Current slide index
    let currentIndex = 0;
    const totalSlides = urls.length;

    // Counter display
    const counter = el("span", "cf-gallery-counter", `${currentIndex + 1} / ${totalSlides}`);
    counter.classList.add("comfyflow-gallery-counter");
    header.appendChild(counter);

    // Media container inside slide frame
    const mediaContainer = el("div", "cf-gallery-slide-media");
    mediaContainer.classList.add("comfyflow-gallery-slide-media");

    const showNsfw = this.state.logged_in && !!this.state.profile?.show_nsfw_content;
    const blurred = !!isNsfw && !showNsfw;

    const renderSlide = (idx) => {
      mediaContainer.innerHTML = "";
      const url = urls[idx];

      const isVideo = url.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/) || url.includes("video");

      let mediaEl;
      if (isVideo) {
        mediaEl = document.createElement("video");
        mediaEl.src = url;
        mediaEl.muted = true;
        mediaEl.playsInline = true;
        mediaEl.loop = true;
        mediaEl.setAttribute("data-video-thumbnail", "true");
      } else {
        mediaEl = el("img");
        mediaEl.src = url;
        mediaEl.alt = `${title || "Gallery"} ${idx + 1}`;
        mediaEl.loading = "eager";
      }

      mediaEl.classList.add("cf-gallery-slide-img");
      mediaEl.classList.add("comfyflow-gallery-slide-img");

      if (blurred) {
        mediaEl.classList.add("comfyflow-nsfw-blurred");
      }

      mediaContainer.appendChild(mediaEl);
      counter.textContent = `${idx + 1} / ${totalSlides}`;
    };

    renderSlide(currentIndex);

    // Left arrow
    const leftArrow = el("button", "cf-gallery-arrow left", "‹");
    leftArrow.classList.add("comfyflow-gallery-arrow");
    leftArrow.onclick = (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex - 1 + totalSlides) % totalSlides;
      renderSlide(currentIndex);
    };

    // Right arrow
    const rightArrow = el("button", "cf-gallery-arrow right", "›");
    rightArrow.classList.add("comfyflow-gallery-arrow");
    rightArrow.onclick = (e) => {
      e.stopPropagation();
      currentIndex = (currentIndex + 1) % totalSlides;
      renderSlide(currentIndex);
    };

    slideFrame.appendChild(leftArrow);
    slideFrame.appendChild(rightArrow);
    slideFrame.appendChild(mediaContainer);

    // Click on slide frame to open lightbox
    slideFrame.onclick = () => this._openGalleryLightbox(urls, currentIndex, isNsfw);

    slidesView.appendChild(slideFrame);

    // Dots navigation
    if (totalSlides > 1) {
      const dotsContainer = el("div", "cf-gallery-dots");
      dotsContainer.classList.add("comfyflow-gallery-dots");

      urls.forEach((_, idx) => {
        const dot = el("button", "cf-gallery-dot");
        dot.classList.add("comfyflow-gallery-dot");
        dot.classList.toggle("active", idx === currentIndex);
        dot.onclick = (e) => {
          e.stopPropagation();
          currentIndex = idx;
          renderSlide(currentIndex);
          // Update active dot
          dotsContainer.querySelectorAll(".cf-gallery-dot").forEach((d, i) => {
            d.classList.toggle("active", i === currentIndex);
          });
        };
        dotsContainer.appendChild(dot);
      });

      slidesView.appendChild(dotsContainer);
    }

    container.appendChild(slidesView);

    // Set initial visibility based on viewMode
    if (viewMode === "slides") {
      columnsView.classList.add("cf-hidden");
      slidesView.classList.remove("cf-hidden");
    }

    return container;
  }

  _openGalleryLightbox(urls, startIndex, isNsfw) {
    const showNsfw = this.state.logged_in && !!this.state.profile?.show_nsfw_content;
    if (isNsfw && !showNsfw) return;

    const lightbox = el("div", "cf-lightbox");
    lightbox.classList.add("comfyflow-lightbox");

    const closeBtn = el("button", "cf-lightbox-close", "×");
    closeBtn.classList.add("comfyflow-lightbox-close");
    closeBtn.onclick = () => lightbox.remove();
    lightbox.appendChild(closeBtn);

    const contentBox = el("div", "cf-lightbox-content");
    contentBox.classList.add("comfyflow-lightbox-content");

    let activeIndex = startIndex;

    const renderLightboxMedia = (idx) => {
      const prevMedia = contentBox.querySelector("img, video");
      if (prevMedia) prevMedia.remove();

      const url = urls[idx];
      const isVideo = url.toLowerCase().match(/\.(mp4|webm|ogg|mov)$/) || url.includes("video");

      let mediaEl;
      if (isVideo) {
        mediaEl = document.createElement("video");
        mediaEl.src = url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
        mediaEl.playsInline = true;
      } else {
        mediaEl = document.createElement("img");
        mediaEl.src = url;
      }
      contentBox.appendChild(mediaEl);

      const counter = lightbox.querySelector(".comfyflow-lightbox-counter");
      if (counter) counter.textContent = `${idx + 1} / ${urls.length}`;
    };

    if (urls.length > 1) {
      const lPrev = el("button", "cf-lightbox-arrow left", "‹");
      lPrev.classList.add("comfyflow-lightbox-arrow");
      lPrev.onclick = () => {
        activeIndex = (activeIndex - 1 + urls.length) % urls.length;
        renderLightboxMedia(activeIndex);
      };

      const lNext = el("button", "cf-lightbox-arrow right", "›");
      lNext.classList.add("comfyflow-lightbox-arrow");
      lNext.onclick = () => {
        activeIndex = (activeIndex + 1) % urls.length;
        renderLightboxMedia(activeIndex);
      };

      contentBox.appendChild(lPrev);
      contentBox.appendChild(lNext);

      const counter = el("div", "cf-lightbox-counter", `${activeIndex + 1} / ${urls.length}`);
      counter.classList.add("comfyflow-lightbox-counter");
      lightbox.appendChild(counter);
    }

    renderLightboxMedia(activeIndex);
    lightbox.appendChild(contentBox);
    document.body.appendChild(lightbox);
  }

  _toggleGalleryView(viewMode) {
    this.galleryView = viewMode;

    // Find all gallery containers and toggle their views
    const containers = document.querySelectorAll(".cf-gallery-container");
    containers.forEach((container) => {
      const columnsView = container.querySelector(".cf-gallery-columns-view");
      const slidesView = container.querySelector(".cf-gallery-slides-view");
      const columnsBtn = container.querySelector(".cf-gallery-toggle:first-of-type");
      const slidesBtn = container.querySelectorAll(".cf-gallery-toggle")[1];

      if (columnsView && slidesView) {
        columnsView.classList.toggle("cf-hidden", viewMode !== "columns");
        slidesView.classList.toggle("cf-hidden", viewMode !== "slides");
      }

      // Update active states on toggle buttons
      if (columnsBtn) {
        columnsBtn.classList.toggle("active", viewMode === "columns");
      }
      if (slidesBtn) {
        slidesBtn.classList.toggle("active", viewMode === "slides");
      }
    });
  }

  _setPanelMode(mode) {
    this.panelMode = mode;
    savePanelMode(mode);
    this._hideSettingsMenu();
    this._applyPanelMode();
    this._syncTabUi();
    if (this.state.logged_in) void this._refreshActiveTab();
  }

  _applyPanelMode() {
    const full = this.panelMode === "full_site";
    this.tabsEl.classList.toggle("cf-hidden", full);
    this.bodyEl.classList.toggle("cf-hidden", full);
    this.fullSiteWrap.classList.toggle("cf-hidden", !full);
    this.fullSiteWrap.classList.toggle("cf-visible", full);
    if (full) {
      const base = this.state.app_url || "https://comfy-flow.com";
      this.fullSiteIframe.src = base;
    }
  }

  _setTab(tab) {
    if (this.panelMode !== "tabs") return;
    if (
      this.tab === tab &&
      this.guideView === "list" &&
      this.workflowView === "list" &&
      this.threadView === "list" &&
      this.aiWorkflowView === "list"
    )
      return;
    this.tab = tab;
    this.guideView = "list";
    this.activeGuide = null;
    this.workflowView = "list";
    this.activeWorkflowBrowser = null;
    this.threadView = "list";
    this.activeThread = null;
    this.aiWorkflowView = "list";
    this.activeAiWorkflow = null;
    this._syncTabUi();
    void this._refreshActiveTab();
  }

  _syncTabUi() {
    if (this.panelMode === "full_site") {
      this.wfSearchRow.classList.add("cf-hidden");
      this.guideSearchRow.classList.add("cf-hidden");
      this.guideFilterRow.classList.add("cf-hidden");
      this.threadSearchRow.classList.add("cf-hidden");
      return;
    }
    const isWf = this.tab === "workflows";
    const isGuides = this.tab === "guides";
    const isThreads = this.tab === "threads";
    const isAiWorkflow = this.tab === "aiworkflow";
    this.tabWorkflowsBtn.classList.toggle("active", isWf);
    this.tabGuidesBtn.classList.toggle("active", isGuides);
    this.tabThreadsBtn.classList.toggle("active", isThreads);
    this.tabAiWorkflowBtn.classList.toggle("active", isAiWorkflow);
    this.wfSearchRow.classList.toggle(
      "cf-hidden",
      !(isWf && this.workflowView === "list"),
    );
    this.guideSearchRow.classList.toggle(
      "cf-hidden",
      !(isGuides && this.guideView === "list"),
    );
    this.guideFilterRow.classList.toggle(
      "cf-hidden",
      !(isGuides && this.guideView === "list"),
    );
    this.threadSearchRow.classList.toggle(
      "cf-hidden",
      !(isThreads && this.threadView === "list"),
    );
    this.listEl.classList.toggle(
      "cf-hidden",
      !(isWf && this.workflowView === "list"),
    );
    this.workflowDetailEl.classList.toggle(
      "cf-hidden",
      !(isWf && this.workflowView === "detail"),
    );
    this.guideListEl.classList.toggle(
      "cf-hidden",
      !(isGuides && this.guideView === "list"),
    );
    this.guideDetailEl.classList.toggle(
      "cf-hidden",
      !(isGuides && this.guideView === "detail"),
    );
    this.threadListEl.classList.toggle(
      "cf-hidden",
      !(isThreads && this.threadView === "list"),
    );
    this.threadDetailEl.classList.toggle(
      "cf-hidden",
      !(isThreads && this.threadView === "detail"),
    );
    this.aiWorkflowListEl.classList.toggle(
      "cf-hidden",
      !isAiWorkflow,
    );
    this.aiWorkflowDetailEl.classList.toggle(
      "cf-hidden",
      !(isAiWorkflow && this.aiWorkflowView === "detail"),
    );
  }

  async _refreshActiveTab() {
    if (!this.state.logged_in) return;
    if (this.panelMode === "full_site") return;
    if (this.tab === "workflows") {
      if (this.workflowView === "detail" && this.activeWorkflowBrowser) {
        void this._renderWorkflowDetail(this.activeWorkflowBrowser);
        return;
      }
      await this._loadWorkflows();
      return;
    }
    if (this.tab === "guides") {
      if (this.guideView === "list") await this._loadGuides();
      else if (this.activeGuide?.slug)
        await this._openGuide(this.activeGuide.slug, false);
      return;
    }
    if (this.tab === "threads") {
      if (this.threadView === "detail" && this.activeThread) {
        void this._renderThreadDetail(this.activeThread);
        return;
      }
      await this._loadThreads();
      return;
    }
    if (this.tab === "aiworkflow") {
      if (this.aiWorkflowView === "detail" && this.activeAiWorkflow) {
        // TODO: render detail view when implemented
        return;
      }
      this._renderAiWorkflowComingSoon();
      return;
    }
  }

  async refreshAuth() {
    try {
      this.state = await API.status();
    } catch {
      this.state = { logged_in: false };
    }
    this._syncSettingsUi();
    const name = this.state.profile?.username || "";
    this.statusEl.textContent = this.state.logged_in
      ? name
        ? `Signed in as @${name}`
        : "Signed in"
      : "Not signed in";
    this.loginBtn.classList.toggle("cf-hidden", this.state.logged_in);
    this.logoutBtn.classList.toggle("cf-hidden", !this.state.logged_in);
    if (this.state.logged_in) {
      await this._refreshActiveTab();
      if (this.panelMode === "full_site") {
        const base = this.state.app_url || "https://comfy-flow.com";
        this.fullSiteIframe.src = base;
      }
    } else {
      this.listEl.innerHTML = "";
      this.guideListEl.innerHTML = "";
      this.guideDetailEl.innerHTML = "";
      this.workflowDetailEl.innerHTML = "";
      this.threadListEl.innerHTML = "";
      this.threadDetailEl.innerHTML = "";
      this.aiWorkflowListEl.innerHTML = "";
      this.aiWorkflowDetailEl.innerHTML = "";
      this.guideView = "list";
      this.workflowView = "list";
      this.activeWorkflowBrowser = null;
      this.threadView = "list";
      this.activeThread = null;
      this.aiWorkflowView = "list";
      this.activeAiWorkflow = null;
      this._syncTabUi();
      this.setMessage(
        "Sign in with your ComfyFlow account to browse workflows and guides.",
      );
    }
  }

  async _login() {
    this.setMessage("Opening browser — complete sign-in there…");
    try {
      const loginRes = await fetch("/comfyflow/auth/login", { method: "POST" });
      const loginData = await parseJson(loginRes);
      if (!loginData.state) {
        throw new Error(
          "ComfyUI plugin did not return a handoff state. Restart ComfyUI.",
        );
      }
      this.setMessage("Finish signing in in your browser, then return here.");
      const handoffState = loginData.state;
      const poll = setInterval(async () => {
        try {
          const pollRes = await fetch(
            `/comfyflow/auth/poll-handoff?state=${encodeURIComponent(handoffState)}`,
          );
          const pollData = await parseJson(pollRes);
          if (pollData.ready) {
            clearInterval(poll);
            await this.refreshAuth();
            this.setMessage("Signed in successfully.");
            return;
          }
        } catch {
          // keep polling
        }
        await this.refreshAuth();
        if (this.state.logged_in) {
          clearInterval(poll);
          this.setMessage("Signed in successfully.");
        }
      }, 1500);
      setTimeout(() => clearInterval(poll), 180000);
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  async _logout() {
    await API.logout();
    await this.refreshAuth();
    this.setMessage("Signed out.");
  }

  async _loadWorkflows() {
    if (!this.state.logged_in) return;
    this.setMessage("Loading workflows…");
    try {
      const data = await API.workflows(this.search, this.page);
      if (data.error) throw new Error(data.error);
      if (data.app_url) this.state.app_url = data.app_url;
      this._renderList(data.workflows || []);
      this.setMessage("");
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  _renderList(workflows) {
    this.listEl.innerHTML = "";

    const hideNsfw =
      this.state.logged_in && !!this.state.profile?.hide_nsfw_content;
    const filtered = workflows.filter((wf) => !(hideNsfw && wf.is_nsfw));

    if (!filtered.length) {
      this.listEl.appendChild(
        el("div", "comfyflow-empty", "No workflows found."),
      );
      return;
    }
    for (const wf of filtered) {
      const card = el("div", "comfyflow-card");
      // Add thumbnail if available
      if (wf.thumbnail_url) {
        const thumb = this._createNsfwImage(
          wf.thumbnail_url,
          wf.is_nsfw,
          wf.title || "Workflow thumbnail",
          "comfyflow-card-thumb",
        );
        card.appendChild(thumb);
      }

      const titleContainer = el("div", "comfyflow-card-title");
      if (wf.is_nsfw) {
        titleContainer.appendChild(el("span", "comfyflow-nsfw-badge", "NSFW"));
      }
      titleContainer.appendChild(
        document.createTextNode(wf.title || "Untitled"),
      );

      const meta = el("div", "comfyflow-card-meta");
      const author = wf.author?.username || "unknown";
      const vc = fmtNum(wf.view_count);
      const dc = fmtNum(wf.download_count);
      const cc = fmtNum(wf.clone_count);
      const rat =
        (wf.rating_count ?? 0) > 0
          ? ` · ★ ${Number(wf.rating_avg || 0).toFixed(1)} (${fmtNum(wf.rating_count)})`
          : "";
      meta.textContent = `@${author} · ${vc} views · ${dc} dl · ${cc} clones${rat}`;
      const actions = el("div", "comfyflow-card-actions");
      const loadBtn = el("button", "comfyflow-btn primary", "Load");
      loadBtn.type = "button";
      loadBtn.onclick = () => void this._loadWorkflow(wf.id, wf.title);
      const viewBtn = el("button", "comfyflow-btn", "View page");
      viewBtn.type = "button";
      viewBtn.onclick = () => this._openWorkflowBrowser(wf);
      const openTabBtn = el("button", "comfyflow-btn", "Open tab");
      openTabBtn.type = "button";
      openTabBtn.onclick = () => window.open(wf.app_url, "_blank");
      actions.appendChild(loadBtn);
      actions.appendChild(viewBtn);
      actions.appendChild(openTabBtn);
      card.appendChild(titleContainer);
      card.appendChild(meta);
      card.appendChild(actions);
      this.listEl.appendChild(card);
    }
  }

  async _loadWorkflow(id, title) {
    this.setMessage(`Loading “${title || id}”…`);
    try {
      const data = await API.load(id);
      if (data.error) throw new Error(data.error);
      if (!data.workflow_data) throw new Error("No workflow JSON in response");
      await app.loadGraphData(data.workflow_data);
      this.setMessage(`Loaded “${data.title || title}”.`);
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  _openWorkflowBrowser(wf) {
    const base = this.state.app_url || "https://comfy-flow.com";
    const url = wf.app_url || `${base}/workflow/${wf.id}`;
    this.tab = "workflows";
    this.guideView = "list";
    this.activeGuide = null;
    this.workflowView = "detail";
    this.activeWorkflowBrowser = { ...wf, app_url: url };
    this.tabWorkflowsBtn.classList.add("active");
    this.tabGuidesBtn.classList.remove("active");
    this.tabThreadsBtn.classList.remove("active");
    this._syncTabUi();
    void this._renderWorkflowDetail(this.activeWorkflowBrowser);
    this.setMessage("");
  }

  _backToWorkflows() {
    this.workflowView = "list";
    this.activeWorkflowBrowser = null;
    this.workflowDetailEl.innerHTML = "";
    this._syncTabUi();
    void this._loadWorkflows();
  }

  async _renderWorkflowDetail(wf) {
    this.workflowDetailEl.innerHTML = "";
    const scroll = el("div", "comfyflow-guide-scroll");
    const top = el("div", "comfyflow-guide-top");
    const backBtn = el("button", "comfyflow-btn", "← Workflows");
    backBtn.type = "button";
    backBtn.onclick = () => this._backToWorkflows();
    top.appendChild(backBtn);
    const openTabBtn = el("button", "comfyflow-btn", "Open tab");
    openTabBtn.type = "button";
    openTabBtn.onclick = () => window.open(wf.app_url, "_blank");
    top.appendChild(openTabBtn);
    scroll.appendChild(top);

    let page = null;
    try {
      page = await API.workflowPage(wf.id);
    } catch {
      page = null;
    }
    const titleText = page?.title || wf.title || "Workflow";
    const author = page?.author?.username ?? wf.author?.username ?? "unknown";
    const vc = page?.view_count ?? wf.view_count;
    const dc = page?.download_count ?? wf.download_count;
    const cc = page?.clone_count ?? wf.clone_count;
    const ra = page?.rating_avg ?? wf.rating_avg;
    const rc = page?.rating_count ?? wf.rating_count;
    const head = el("div", "comfyflow-guide-head");
    head.appendChild(el("h2", "comfyflow-guide-title", titleText));
    const meta = el("div", "comfyflow-guide-meta");
    const bits = [
      `@${author}`,
      `${fmtNum(vc)} views`,
      `${fmtNum(dc)} downloads`,
      `${fmtNum(cc)} clones`,
    ];
    if ((rc ?? 0) > 0)
      bits.push(`★ ${Number(ra || 0).toFixed(1)} (${fmtNum(rc)})`);
    meta.textContent = bits.join(" · ");
    head.appendChild(meta);
    scroll.appendChild(head);

    // Always use article mode (no website layout toggle)
    // Use preview_urls if available, otherwise fall back to thumbnail_url
    const previewUrls = page?.preview_urls || [];
    const thumbnailUrl = page?.thumbnail_url || wf.thumbnail_url;
    const allImageUrls =
      previewUrls.length > 0
        ? previewUrls
        : thumbnailUrl
          ? [thumbnailUrl]
          : [];
    if (allImageUrls.length > 0) {
      const gallery = this._createGallery(
        allImageUrls,
        titleText,
        page?.is_nsfw ?? wf.is_nsfw,
        this.galleryView,
      );
      if (gallery) scroll.appendChild(gallery);
    }
    const prose = el("div", "comfyflow-prose");
    prose.innerHTML =
      (page && page.body_html) || "<p><em>No description.</em></p>";
    scroll.appendChild(prose);
    this.workflowDetailEl.appendChild(scroll);
  }

  async _loadThreads() {
    if (!this.state.logged_in) return;
    this.setMessage("Loading threads…");
    try {
      const data = await API.threads(this.threadSearch, this.page);
      if (data.error) throw new Error(data.error);
      if (data.app_url) this.state.app_url = data.app_url;
      this._renderThreadList(data.threads || []);
      this.setMessage("");
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  _renderThreadList(threads) {
    this.threadListEl.innerHTML = "";

    const hideNsfw =
      this.state.logged_in && !!this.state.profile?.hide_nsfw_content;
    const filtered = threads.filter((t) => !(hideNsfw && t.is_nsfw));

    if (!filtered.length) {
      this.threadListEl.appendChild(
        el("div", "comfyflow-empty", "No threads found."),
      );
      return;
    }
    for (const t of filtered) {
      const card = el("div", "comfyflow-card comfyflow-guide-card");
      card.onclick = () => void this._openThread(t.id, true);
      const pin = t.is_pinned ? "📌 " : "";

      const title = el("div", "comfyflow-card-title");
      if (t.is_nsfw) {
        title.appendChild(el("span", "comfyflow-nsfw-badge", "NSFW"));
      }
      if (pin) {
        title.appendChild(document.createTextNode(pin));
      }
      title.appendChild(document.createTextNode(t.title || "Untitled"));

      const meta = el("div", "comfyflow-card-meta");
      const author = t.author?.username || "unknown";
      const cat = t.category?.name || "Forum";
      meta.textContent = `${cat} · @${author} · ${fmtNum(t.view_count)} views · ${fmtNum(t.reply_count)} replies`;
      card.appendChild(title);
      card.appendChild(meta);
      this.threadListEl.appendChild(card);
    }
  }

  _backToThreads() {
    this.threadView = "list";
    this.activeThread = null;
    this.threadDetailEl.innerHTML = "";
    this._syncTabUi();
    void this._loadThreads();
  }

  async _openThread(id, showLoading = true) {
    if (!id) return;
    if (showLoading) this.setMessage("Loading thread…");
    try {
      const data = await API.thread(id);
      if (data.error) throw new Error(data.error);
      if (data.app_url) this.state.app_url = data.app_url;
      this.activeThread = data;
      this.threadView = "detail";
      this._syncTabUi();
      await this._renderThreadDetail(data);
      this.setMessage("");
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  async _renderThreadDetail(thread) {
    this.threadDetailEl.innerHTML = "";
    const scroll = el("div", "comfyflow-guide-scroll");
    const top = el("div", "comfyflow-guide-top");
    const backBtn = el("button", "comfyflow-btn", "← Threads");
    backBtn.type = "button";
    backBtn.onclick = () => this._backToThreads();
    top.appendChild(backBtn);
    const openTabBtn = el("button", "comfyflow-btn", "Open tab");
    openTabBtn.type = "button";
    openTabBtn.onclick = () => window.open(thread.app_url, "_blank");
    top.appendChild(openTabBtn);
    scroll.appendChild(top);

    const head = el("div", "comfyflow-guide-head");
    const titleContainer = el("h2", "comfyflow-guide-title");
    if (thread.is_nsfw) {
      titleContainer.appendChild(el("span", "comfyflow-nsfw-badge", "NSFW"));
    }
    titleContainer.appendChild(
      document.createTextNode(thread.title || "Thread"),
    );
    head.appendChild(titleContainer);

    const meta = el("div", "comfyflow-guide-meta");
    const author = thread.author?.username || "unknown";
    const cat = thread.category?.name || "Forum";
    meta.textContent = `${cat} · @${author} · ${fmtNum(thread.view_count)} views · ${fmtNum(thread.reply_count)} replies`;
    head.appendChild(meta);
    scroll.appendChild(head);

    // Always use article mode (no website layout toggle)
    if (thread.image_urls?.length > 0) {
      const gallery = this._createGallery(
        thread.image_urls,
        thread.title,
        thread.is_nsfw,
        this.galleryView,
      );
      if (gallery) scroll.appendChild(gallery);
    }
    const prose = el("div", "comfyflow-prose");
    prose.innerHTML = thread.body_html || "<p><em>No opening post.</em></p>";
    scroll.appendChild(prose);
    this.threadDetailEl.appendChild(scroll);
  }

  _renderAiWorkflowComingSoon() {
    this.aiWorkflowListEl.innerHTML = "";
    const msg = el("div", "comfyflow-coming-soon", "Coming Soon:)");
    this.aiWorkflowListEl.appendChild(msg);
  }

  async _loadGuides() {
    if (!this.state.logged_in) return;
    this.setMessage("Loading guides…");
    try {
      const diff = this.guideDifficulty === "all" ? "" : this.guideDifficulty;
      const data = await API.guides(this.guideSearch, diff, this.page);
      if (data.error) throw new Error(data.error);
      if (data.app_url) this.state.app_url = data.app_url;
      this._renderGuideList(data.guides || []);
      this.setMessage("");
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  _renderGuideList(guides) {
    this.guideListEl.innerHTML = "";

    const hideNsfw =
      this.state.logged_in && !!this.state.profile?.hide_nsfw_content;
    const filtered = guides.filter((g) => !(hideNsfw && g.is_nsfw));

    if (!filtered.length) {
      this.guideListEl.appendChild(
        el("div", "comfyflow-empty", "No guides found."),
      );
      return;
    }
    for (const g of filtered) {
      const card = el("div", "comfyflow-card comfyflow-guide-card");
      card.onclick = () => void this._openGuide(g.slug, true);
      // Add thumbnail if available (from image_urls array or thumbnail_url)
      const thumbUrls = g.image_urls?.length
        ? g.image_urls
        : g.thumbnail_url
          ? [g.thumbnail_url]
          : [];
      if (thumbUrls.length > 0) {
        const thumb = this._createNsfwImage(
          thumbUrls[0],
          g.is_nsfw,
          g.title || "Guide thumbnail",
          "comfyflow-card-thumb",
        );
        card.appendChild(thumb);
      }

      const title = el("div", "comfyflow-card-title");
      if (g.is_nsfw) {
        title.appendChild(el("span", "comfyflow-nsfw-badge", "NSFW"));
      }
      title.appendChild(document.createTextNode(g.title || "Untitled"));

      const meta = el("div", "comfyflow-card-meta");
      const author = g.author?.username || "unknown";
      const diff = guideDifficultyLabel(g.difficulty);
      const ratingLine =
        (g.rating_count ?? 0) > 0
          ? ` · ★ ${Number(g.rating_avg || 0).toFixed(1)} (${fmtNum(g.rating_count)})`
          : "";
      meta.textContent = `${diff} · @${author}${ratingLine}`;
      const excerpt = el("div", "comfyflow-card-excerpt", g.excerpt || "");
      card.appendChild(title);
      card.appendChild(meta);
      if (g.excerpt) card.appendChild(excerpt);
      this.guideListEl.appendChild(card);
    }
  }

  _backToGuides() {
    this.guideView = "list";
    this.activeGuide = null;
    this._syncTabUi();
    void this._loadGuides();
  }

  async _openGuide(slug, showLoading = true) {
    if (!slug) return;
    if (showLoading) this.setMessage("Loading guide…");
    try {
      const data = await API.guide(slug);
      if (data.error) throw new Error(data.error);
      if (data.app_url) this.state.app_url = data.app_url;
      this.activeGuide = data;
      this.guideView = "detail";
      this._syncTabUi();
      this._renderGuideDetail(data);
      this.setMessage("");
    } catch (e) {
      this.setMessage(String(e), true);
    }
  }

  _renderGuideDetail(guide) {
    this.guideDetailEl.innerHTML = "";
    const scroll = el("div", "comfyflow-guide-scroll");

    const top = el("div", "comfyflow-guide-top");
    const backBtn = el("button", "comfyflow-btn", "← Guides");
    backBtn.type = "button";
    backBtn.onclick = () => this._backToGuides();
    top.appendChild(backBtn);
    const webBtn = el("button", "comfyflow-btn", "Open tab");
    webBtn.type = "button";
    webBtn.onclick = () => window.open(guide.app_url, "_blank");
    top.appendChild(webBtn);
    scroll.appendChild(top);

    const head = el("div", "comfyflow-guide-head");
    head.appendChild(el("h2", "comfyflow-guide-title", guide.title || "Guide"));
    const meta = el("div", "comfyflow-guide-meta");
    const author = guide.author?.username || "unknown";
    meta.textContent = `${guideDifficultyLabel(guide.difficulty)} · @${author}`;
    head.appendChild(meta);
    if (guide.excerpt) {
      head.appendChild(el("p", "comfyflow-guide-excerpt", guide.excerpt));
    }
    scroll.appendChild(head);

    const base = this.state.app_url || "https://comfy-flow.com";
    const linkedItems =
      guide.linked_workflows?.length > 0
        ? guide.linked_workflows
        : (guide.linked_workflow_ids || []).map((id) => ({
            id,
            title: id.slice(0, 8) + "…",
          }));
    if (linkedItems.length) {
      const wfBar = el("div", "comfyflow-linked-wfs");
      wfBar.appendChild(
        el("span", "comfyflow-linked-label", "Workflows in this guide"),
      );
      const actions = el("div", "comfyflow-card-actions");
      for (const item of linkedItems) {
        const id = item.id;
        const loadBtn = el("button", "comfyflow-btn primary", "Load");
        loadBtn.type = "button";
        loadBtn.onclick = (e) => {
          e.stopPropagation();
          void this._loadWorkflow(id);
        };
        const viewBtn = el("button", "comfyflow-btn", "View page");
        viewBtn.type = "button";
        viewBtn.onclick = (e) => {
          e.stopPropagation();
          this._openWorkflowBrowser({
            id,
            title: item.title || id.slice(0, 8) + "…",
            app_url: `${base}/workflow/${id}`,
            author: {},
            download_count: 0,
          });
        };
        const textWrap = el("div", "comfyflow-linked-wf-text");
        const titleEl = el(
          "span",
          "comfyflow-linked-wf-title",
          item.title || id.slice(0, 8) + "…",
        );
        titleEl.title = id;
        const idEl = el("span", "comfyflow-wf-id subtle", id.slice(0, 8) + "…");
        textWrap.appendChild(titleEl);
        textWrap.appendChild(idEl);
        const row = el("div", "comfyflow-linked-row");
        row.appendChild(textWrap);
        const btns = el("div", "comfyflow-linked-row-btns");
        btns.appendChild(loadBtn);
        btns.appendChild(viewBtn);
        row.appendChild(btns);
        actions.appendChild(row);
      }
      wfBar.appendChild(actions);
      scroll.appendChild(wfBar);
    }

    // Always use article mode (no website layout toggle)
    if (guide.image_urls?.length > 0) {
      const gallery = this._createGallery(
        guide.image_urls,
        guide.title,
        guide.is_nsfw,
        this.galleryView,
      );
      if (gallery) scroll.appendChild(gallery);
    }
    const prose = el("div", "comfyflow-prose");
    prose.innerHTML = guide.body_html || "";
    prose.addEventListener("click", (e) => {
      const anchor = e.target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      const match = href.match(/\/workflow\/([^/?#"']+)/i);
      const base = this.state.app_url || "https://comfy-flow.com";
      if (match) {
        e.preventDefault();
        this._openWorkflowBrowser({
          id: match[1],
          title: anchor.textContent?.trim() || "Workflow",
          app_url: `${base}/workflow/${match[1]}`,
          author: {},
          download_count: 0,
        });
      }
    });
    scroll.appendChild(prose);
    this.guideDetailEl.appendChild(scroll);
  }

  _startPolling() {
    if (this._authPollInterval) return; // Already polling

    this._authPollInterval = setInterval(() => {
      if (!this.state.logged_in) void this.refreshAuth();
    }, 5000);

    this._loadPollInterval = setInterval(() => {
      void this._pollQueuedLoads();
    }, 1500);

    window.addEventListener("focus", this._onFocus);
  }

  _stopPolling() {
    if (this._authPollInterval) {
      clearInterval(this._authPollInterval);
      this._authPollInterval = null;
    }
    if (this._loadPollInterval) {
      clearInterval(this._loadPollInterval);
      this._loadPollInterval = null;
    }
    window.removeEventListener("focus", this._onFocus);
  }

  _onFocus = () => {
    if (!this.state.logged_in) void this.refreshAuth();
  };

  async _pollQueuedLoads() {
    try {
      const res = await fetch("/comfyflow/api/poll-load");
      const data = await res.json();
      if (data.pending && data.workflow_data) {
        await app.loadGraphData(data.workflow_data);
        this.setMessage(`Loaded "${data.title || data.id}" from ComfyFlow.`);
        if (!this.visible) this.toggle();
      }
    } catch {
      // ComfyUI not ready yet
    }
  }

  toggle() {
    this.visible = !this.visible;
    this.root.classList.toggle("cf-visible", this.visible);
    this.root.classList.toggle("cf-hidden", !this.visible);
    applySplitLayout(this.visible);

    if (this.visible) {
      void this.refreshAuth();
      this._startPolling();
    } else {
      this._stopPolling();
    }
  }
}

const PANEL_WIDTH_KEY = "comfyflow.panelWidth";
const PANEL_MIN_PX = 320;
const PANEL_MAX_RATIO = 0.78;
const PANEL_DEFAULT_RATIO = 0.42;

let panelWidthPx = loadPanelWidth();
let viewportShell = null;
let lastViewportW = 0;
let lastViewportH = 0;
let resizeDebounceTimer = 0;
let isDraggingPanel = false;

function loadPanelWidth() {
  const stored = Number.parseInt(
    localStorage.getItem(PANEL_WIDTH_KEY) || "",
    10,
  );
  const max = Math.round(window.innerWidth * PANEL_MAX_RATIO);
  if (Number.isFinite(stored) && stored >= PANEL_MIN_PX && stored <= max)
    return stored;
  return Math.max(
    PANEL_MIN_PX,
    Math.round(window.innerWidth * PANEL_DEFAULT_RATIO),
  );
}

function getPanelMaxWidth() {
  return Math.round(window.innerWidth * PANEL_MAX_RATIO);
}

function setPanelWidth(px, persist = true) {
  panelWidthPx = Math.max(PANEL_MIN_PX, Math.min(px, getPanelMaxWidth()));
  document.documentElement.style.setProperty(
    "--comfyflow-panel-width",
    `${panelWidthPx}px`,
  );
  panel.root.style.width = `${panelWidthPx}px`;
  if (persist) localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidthPx));
  if (panel.visible) updateViewportSize();
}

function findComfyuiRoot() {
  for (const id of ["comfyui-app", "vue-app", "app", "root"]) {
    const node = document.getElementById(id);
    if (node && node.id !== "comfyflow-viewport") return node;
  }
  const body = document.querySelector(".comfyui-body");
  if (body) {
    let parent = body.parentElement;
    while (parent && parent !== document.body) {
      if (parent.id !== "comfyflow-viewport") return parent;
      parent = parent.parentElement;
    }
  }
  for (const child of document.body.children) {
    if (!(child instanceof HTMLElement)) continue;
    if (child.id === "comfyflow-viewport" || child.id === "comfyflow-fab")
      continue;
    if (child.dataset.comfyflow) continue;
    if (child === panel.root) continue;
    if (["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) continue;
    return child;
  }
  return null;
}

/** Wrap ComfyUI in a box sized like the browser window minus the panel. */
function ensureViewportShell() {
  if (viewportShell?.isConnected) return viewportShell;

  viewportShell = document.getElementById("comfyflow-viewport");
  if (viewportShell) return viewportShell;

  const root = findComfyuiRoot();
  if (!root?.parentNode) return null;

  viewportShell = el("div", "comfyflow-viewport");
  viewportShell.id = "comfyflow-viewport";
  root.parentNode.insertBefore(viewportShell, root);
  viewportShell.appendChild(root);
  return viewportShell;
}

function getViewportWidth() {
  return panel.visible
    ? Math.max(320, window.innerWidth - panelWidthPx)
    : window.innerWidth;
}

function applyViewportDimensions(triggerResize = true) {
  const shell = panel.visible ? ensureViewportShell() : viewportShell;
  const w = getViewportWidth();
  const h = window.innerHeight;

  if (w === lastViewportW && h === lastViewportH) {
    if (triggerResize) scheduleCanvasRefresh();
    return;
  }
  lastViewportW = w;
  lastViewportH = h;

  document.documentElement.style.setProperty(
    "--comfyflow-viewport-width",
    `${w}px`,
  );

  if (shell) {
    if (panel.visible) {
      shell.style.width = `${w}px`;
      shell.style.maxWidth = `${w}px`;
    } else {
      shell.style.width = "100%";
      shell.style.maxWidth = "100%";
    }
    shell.style.height = `${h}px`;
    shell.style.minHeight = `${h}px`;
  }

  if (triggerResize) scheduleCanvasRefresh();
}

function updateViewportSize(triggerResize = true) {
  applyViewportDimensions(triggerResize);
}

function getComfyBody() {
  return document.querySelector(".comfyui-body");
}

function getCanvasContainer() {
  return (
    app.canvasContainer ||
    document.getElementById("graph-canvas-container") ||
    document.querySelector(".graph-canvas-container")
  );
}

/** Remove inline overrides (current or from older plugin builds) so ComfyUI layout can recover. */
function cleanupLayoutOverrides() {
  const props = [
    "width",
    "max-width",
    "height",
    "max-height",
    "min-width",
    "min-height",
    "flex",
    "flex-basis",
    "justify-self",
    "align-self",
    "overflow",
    "box-sizing",
    "margin-right",
    "padding-right",
  ];
  for (const el of [
    getCanvasContainer(),
    app.canvasEl || document.getElementById("graph-canvas"),
    getComfyBody(),
  ]) {
    if (!el) continue;
    el.classList.remove("comfyflow-graph-sized");
    for (const prop of props) el.style.removeProperty(prop);
  }
  const root = document.documentElement;
  for (const key of [
    "--comfyflow-inset-left",
    "--comfyflow-inset-right",
    "--comfyflow-inset-top",
    "--comfyflow-inset-bottom",
    "--comfyflow-graph-width",
    "--comfyflow-graph-height",
  ]) {
    root.style.removeProperty(key);
  }
}

/** Let ComfyUI handle canvas sizing via its own ResizeObserver — one window resize only. */
function notifyGraphResize() {
  window.dispatchEvent(new Event("resize"));
}

function scheduleCanvasRefresh() {
  if (isDraggingPanel) return;
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = setTimeout(() => {
    resizeDebounceTimer = 0;
    notifyGraphResize();
  }, 150);
}

function scheduleCanvasRefreshOnce() {
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = 0;
  requestAnimationFrame(() => notifyGraphResize());
}

function applySplitLayout(active) {
  cleanupLayoutOverrides();

  document.body.classList.toggle("comfyflow-split-active", active);

  if (active) {
    document.documentElement.style.setProperty(
      "--comfyflow-panel-width",
      `${panelWidthPx}px`,
    );
    panel.root.style.width = `${panelWidthPx}px`;
  } else {
    document.documentElement.style.removeProperty("--comfyflow-panel-width");
    document.documentElement.style.removeProperty("--comfyflow-viewport-width");
  }

  lastViewportW = 0;
  lastViewportH = 0;
  updateViewportSize(true);
  applyFabPosition();
  scheduleCanvasRefreshOnce();
  if (active) {
    setTimeout(() => notifyGraphResize(), 250);
  }
}

function mountPanelResizer() {
  if (panel.root.querySelector(".comfyflow-resizer")) return;
  const resizer = el("div", "comfyflow-resizer");
  resizer.title = "Drag to resize ComfyFlow panel";
  resizer.setAttribute("role", "separator");
  resizer.setAttribute("aria-orientation", "vertical");
  resizer.setAttribute("aria-label", "Resize ComfyFlow panel");

  resizer.addEventListener("pointerdown", (e) => {
    if (!panel.visible) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      resizer.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startWidth = panelWidthPx;
    document.body.classList.add("comfyflow-resizing");
    isDraggingPanel = true;

    let done = false;
    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return;
      panelWidthPx = Math.max(
        PANEL_MIN_PX,
        Math.min(startWidth + (startX - ev.clientX), getPanelMaxWidth()),
      );
      document.documentElement.style.setProperty(
        "--comfyflow-panel-width",
        `${panelWidthPx}px`,
      );
      panel.root.style.width = `${panelWidthPx}px`;
      applyViewportDimensions(false);
    };

    const cleanup = () => {
      if (done) return;
      done = true;
      resizer.removeEventListener("pointermove", onMove);
      resizer.removeEventListener("pointerup", cleanup);
      resizer.removeEventListener("pointercancel", cleanup);
      resizer.removeEventListener("lostpointercapture", cleanup);
      try {
        if (resizer.hasPointerCapture(pointerId))
          resizer.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      isDraggingPanel = false;
      document.body.classList.remove("comfyflow-resizing");
      setPanelWidth(panelWidthPx, true);
      lastViewportW = 0;
      lastViewportH = 0;
      updateViewportSize(true);
      scheduleCanvasRefreshOnce();
    };

    resizer.addEventListener("pointermove", onMove);
    resizer.addEventListener("pointerup", cleanup);
    resizer.addEventListener("pointercancel", cleanup);
    resizer.addEventListener("lostpointercapture", cleanup);
  });

  panel.root.prepend(resizer);
}

const style = document.createElement("style");
style.textContent = `
:root {
  --comfyflow-panel-width: 480px;
}
body.comfyflow-split-active {
  overflow-x: hidden;
}
.comfyflow-viewport {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
}
.comfyflow-viewport .comfyui-body,
.comfyflow-viewport .graph-canvas-container {
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
}
body.comfyflow-resizing,
body.comfyflow-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
body.comfyflow-resizing .comfyflow-resizer::after {
  background: #6366f1;
}
.comfyflow-panel {
  display: none;
  position: fixed;
  width: var(--comfyflow-panel-width, 480px);
  height: 100vh;
  max-height: none;
  z-index: 9000;
}
.comfyflow-panel.cf-visible {
  display: flex;
  flex-direction: column;
}
.comfyflow-panel.cf-hidden {
  display: none;
}
`;

document.head.appendChild(style);

(async () => {
  try {
    const cssUrl = new URL("./comfyflow.css", import.meta.url).href;
    const res = await fetch(cssUrl);
    let css = await res.text();

    // Process preview-root selectors to apply correctly in ComfyUI
    css = css.replaceAll(
      ".comfyflow-preview-root.comfyflow-split-active",
      "body.comfyflow-split-active",
    );
    css = css.replaceAll(
      ".comfyflow-preview-root.comfyflow-fab-dragging",
      "body.comfyflow-fab-dragging",
    );
    css = css.replaceAll(
      ".comfyflow-preview-root.comfyflow-resizing",
      "body.comfyflow-resizing",
    );
    // Strip layout/position rule for the preview-root container, transferring rules to .comfyflow-panel
    css = css.replace(
      /\.comfyflow-preview-root\s*\{([^}]*--comfyflow-panel-width[^}]*)\}/g,
      '.comfyflow-panel {$1}',
    );
    // Map other root rules (e.g. font-size clamps in media queries) directly to the comfyflow panel
    css = css.replace(/\.comfyflow-preview-root(?=\{)/g, ".comfyflow-panel");
    // Strip the preview-root prefix from descendants
    css = css.replaceAll(".comfyflow-preview-root ", "");

    const sharedStyle = document.createElement("style");
    sharedStyle.textContent = css;
    document.head.insertBefore(sharedStyle, style);
  } catch (err) {
    console.error("Failed to load ComfyFlow shared CSS:", err);
  }
})();

const panel = new ComfyFlowPanel();
document.body.appendChild(panel.root);
mountPanelResizer();

const FAB_STATE_KEY = "comfyflow.fabState";
const FAB_SNAP_EDGE_PX = 56;

let fabState = loadFabState();
let fabDrag = null;
let fabSuppressClick = false;

function getDefaultFabY(viewportHeight, fabH = 44) {
  return Math.round(viewportHeight * 0.75 - fabH / 2);
}

function loadFabState() {
  try {
    const raw = JSON.parse(localStorage.getItem(FAB_STATE_KEY) || "null");
    if (raw && (raw.mode === "free" || raw.mode === "docked")) {
      return {
        mode: raw.mode,
        x: typeof raw.x === "number" ? raw.x : null,
        y: typeof raw.y === "number" ? raw.y : null,
        collapsed: !!raw.collapsed,
      };
    }
  } catch {
    // ignore
  }
  return { mode: "docked", x: null, y: null, collapsed: false };
}

function saveFabState() {
  localStorage.setItem(FAB_STATE_KEY, JSON.stringify(fabState));
}

function clampFab(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

function getFabDockRightPx() {
  return panel.visible ? panelWidthPx : 0;
}

/** Right edge of the ComfyUI area (panel left edge when split is open). */
function getFabSnapEdgeX() {
  return panel.visible ? window.innerWidth - panelWidthPx : window.innerWidth;
}

function getFabMaxX(fabW) {
  const edge = getFabSnapEdgeX();
  return Math.max(8, edge - fabW - 8);
}

function applyFabPosition() {
  const fab = document.getElementById("comfyflow-fab");
  if (!fab) return;

  fab.classList.toggle("free", fabState.mode === "free");
  fab.classList.toggle("docked", fabState.mode === "docked");
  fab.classList.toggle(
    "collapsed",
    fabState.mode === "docked" && fabState.collapsed,
  );
  fab.classList.toggle("active", panel.visible);

  fab.style.bottom = "auto";
  fab.style.left = "auto";
  fab.style.right = "auto";
  fab.style.top = "auto";
  fab.style.transform = "";

  const dockRight = getFabDockRightPx();
  const fabH = fab.offsetHeight || 44;
  const fabW = fab.offsetWidth || 100;
  const defaultY = getDefaultFabY(window.innerHeight, fabH);
  const maxX = getFabMaxX(fabW);

  if (fabState.mode === "docked") {
    const top = clampFab(
      fabState.y ?? defaultY,
      48,
      window.innerHeight - fabH - 16,
    );
    fabState.y = top;
    fab.style.right = `${dockRight}px`;
    fab.style.top = `${top}px`;
  } else {
    const x = clampFab(fabState.x ?? maxX, 8, maxX);
    const y = clampFab(
      fabState.y ?? defaultY,
      8,
      window.innerHeight - fabH - 8,
    );
    fabState.x = x;
    fabState.y = y;
    fab.style.left = `${x}px`;
    fab.style.top = `${y}px`;
  }
}

function applyFabDragPosition() {
  const fab = document.getElementById("comfyflow-fab");
  if (!fab) return;

  const dockRight = getFabDockRightPx();
  const fabH = fab.offsetHeight || 44;
  const fabW = fab.offsetWidth || 100;
  const maxX = getFabMaxX(fabW);

  if (fabState.mode === "docked") {
    fab.style.left = "auto";
    fab.style.right = `${dockRight}px`;
    fab.style.top = `${clampFab(fabState.y ?? 0, 48, window.innerHeight - fabH - 16)}px`;
  } else {
    fab.style.right = "auto";
    fab.style.left = `${clampFab(fabState.x ?? 0, 8, maxX)}px`;
    fab.style.top = `${clampFab(fabState.y ?? 0, 8, window.innerHeight - fabH - 8)}px`;
  }
}

function setFabDragging(active) {
  document.body.classList.toggle("comfyflow-fab-dragging", active);
}

function togglePanel() {
  panel.toggle();
  applyFabPosition();
}

function mountFloatingButton() {
  if (document.getElementById("comfyflow-fab")) return;

  const fab = el("button", "comfyflow-fab");
  fab.id = "comfyflow-fab";
  fab.type = "button";
  fab.title = "Drag to move · Click to open";

  const label = el("span", "comfyflow-fab-label", "ComfyFlow");
  fab.appendChild(label);

  fab.addEventListener("click", (e) => {
    if (fabSuppressClick) {
      fabSuppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (fabState.mode === "docked" && fabState.collapsed) {
      fabState.collapsed = false;
      saveFabState();
      applyFabPosition();
      return;
    }
    togglePanel();
  });

  fab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const rect = fab.getBoundingClientRect();
    fabDrag = {
      pointerId: e.pointerId,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      wasDocked: fabState.mode === "docked",
    };
    fab.classList.add("dragging");
    setFabDragging(true);
    fab.setPointerCapture(e.pointerId);
  });

  fab.addEventListener("pointermove", (e) => {
    if (!fabDrag || fabDrag.pointerId !== e.pointerId) return;
    const dx = e.clientX - fabDrag.startX;
    const dy = e.clientY - fabDrag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) fabDrag.moved = true;

    const fabH = fab.offsetHeight || 44;
    const fabW = fab.offsetWidth || 100;
    const maxX = getFabMaxX(fabW);
    const snapEdge = getFabSnapEdgeX();

    if (fabState.mode === "docked") {
      if (dx < -24) {
        fabState.mode = "free";
        fabState.collapsed = false;
        fabState.x = clampFab(fabDrag.originX + dx, 8, maxX);
        fabState.y = clampFab(
          fabDrag.originY + dy,
          8,
          window.innerHeight - fabH - 8,
        );
      } else {
        fabState.y = clampFab(
          fabDrag.originY + dy,
          48,
          window.innerHeight - fabH - 16,
        );
      }
    } else {
      fabState.x = clampFab(fabDrag.originX + dx, 8, maxX);
      fabState.y = clampFab(
        fabDrag.originY + dy,
        8,
        window.innerHeight - fabH - 8,
      );
      if (e.clientX >= snapEdge - FAB_SNAP_EDGE_PX) {
        fabState.mode = "docked";
        fabState.collapsed = false;
        fabState.x = null;
      }
    }
    applyFabDragPosition();
  });

  fab.addEventListener("pointerup", (e) => {
    if (!fabDrag || fabDrag.pointerId !== e.pointerId) return;
    fab.classList.remove("dragging");
    setFabDragging(false);
    fab.releasePointerCapture(e.pointerId);

    if (fabDrag.moved) {
      fabSuppressClick = true;
      const snapEdge = getFabSnapEdgeX();
      if (
        fabState.mode === "free" &&
        e.clientX >= snapEdge - FAB_SNAP_EDGE_PX
      ) {
        fabState.mode = "docked";
        fabState.collapsed = false;
        fabState.y = fab.getBoundingClientRect().top;
        fabState.x = null;
      }
      saveFabState();
      applyFabPosition();
    }
    fabDrag = null;
  });

  fab.addEventListener("pointercancel", () => {
    fab.classList.remove("dragging");
    setFabDragging(false);
    if (fabDrag?.moved) fabSuppressClick = true;
    fabDrag = null;
    applyFabPosition();
  });

  document.body.appendChild(fab);
  requestAnimationFrame(() => applyFabPosition());
}

async function consumeSessionFromHash() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#comfyflow_session=")) return false;

  try {
    const encoded = decodeURIComponent(
      hash.slice("#comfyflow_session=".length),
    );
    const data = JSON.parse(atob(encoded));

    // Store in sessionStorage instead of keeping in URL
    sessionStorage.setItem("comfyflow_pending_session", JSON.stringify(data));

    // Clean the URL immediately
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    // Send via postMessage to panel
    const res = await fetch("/comfyflow/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const result = await parseJson(res);
    if (!res.ok || !result.ok) {
      throw new Error(result.error || "Could not save ComfyFlow session");
    }

    sessionStorage.removeItem("comfyflow_pending_session");
    await panel.refreshAuth();
    panel.setMessage("Signed in to ComfyFlow.");
    if (!panel.visible) panel.toggle();
    return true;
  } catch (err) {
    panel.setMessage(String(err), true);
    sessionStorage.removeItem("comfyflow_pending_session");
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    return false;
  }
}

app.registerExtension({
  name: "ComfyFlow",
  commands: [
    {
      id: "comfyflow.openPanel",
      label: "Open ComfyFlow",
      function: () => togglePanel(),
    },
    {
      id: "comfyflow.signIn",
      label: "Sign in to ComfyFlow",
      function: () => {
        togglePanel();
        if (!panel.state.logged_in) void panel._login();
      },
    },
  ],
  menuCommands: [
    {
      path: ["Extensions", "ComfyFlow"],
      commands: ["comfyflow.openPanel", "comfyflow.signIn"],
    },
  ],
  async setup() {
    mountFloatingButton();
    await consumeSessionFromHash();
    panel._startPolling(); // Start polling immediately
    let windowResizeTimer = 0;
    window.addEventListener("resize", () => {
      if (windowResizeTimer) clearTimeout(windowResizeTimer);
      windowResizeTimer = setTimeout(() => {
        windowResizeTimer = 0;
        lastViewportW = 0;
        lastViewportH = 0;
        updateViewportSize(true);
        applyFabPosition();
      }, 120);
    });
    cleanupLayoutOverrides();
  },
});
