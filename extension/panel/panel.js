/**
 * NovaTryOnMe - Side Panel Controller
 *
 * Manages the try-on results panel injected into Amazon product pages.
 * Communicates with content.js and ApiClient (which are loaded in the
 * same page context via content_scripts).
 *
 * Public API (called by content.js):
 *   NovaPanel.initPanel(productData, analysisResult)
 *   NovaPanel.showLoading()
 *   NovaPanel.showResult(resultImageBase64)
 *   NovaPanel.showStyleTips(tips)
 *   NovaPanel.showError(message)
 *   NovaPanel.destroy()
 */

// eslint-disable-next-line no-var
var NovaPanel = (function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let panelEl = null;            // The root panel DOM element
  let productData = null;        // Current product data
  let resultImageBase64 = null;  // Latest try-on result image
  let originalImageUrl = null;   // Original product image URL
  let videoPollingTimer = null;  // Timer for video status polling
  let currentMergeStyle = 'BALANCED';

  // Tip icons for style tip cards
  const TIP_ICONS = ['\u2728', '\uD83D\uDC4D', '\uD83C\uDFA8', '\u2764\uFE0F', '\uD83D\uDC57'];

  // ---------------------------------------------------------------------------
  // DOM Helpers
  // ---------------------------------------------------------------------------

  /** Shortcut to find an element inside the panel */
  function $(selector) {
    return panelEl ? panelEl.querySelector(selector) : null;
  }

  /** Shortcut to find all matching elements inside the panel */
  function $$(selector) {
    return panelEl ? panelEl.querySelectorAll(selector) : [];
  }

  // ---------------------------------------------------------------------------
  // Panel Creation & Injection
  // ---------------------------------------------------------------------------

  /**
   * Fetch the panel HTML template and inject it into the page.
   * The HTML and CSS files live alongside this script in the extension.
   */
  async function createPanel() {
    // Avoid duplicates
    if (document.getElementById('nova-tryon-panel')) {
      panelEl = document.getElementById('nova-tryon-panel');
      return;
    }

    // Inject panel CSS
    const cssUrl = chrome.runtime.getURL('panel/panel.css');
    if (!document.querySelector(`link[href="${cssUrl}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssUrl;
      document.head.appendChild(link);
    }

    // Fetch panel HTML
    const htmlUrl = chrome.runtime.getURL('panel/panel.html');
    const response = await fetch(htmlUrl);
    const html = await response.text();

    // Create panel container
    panelEl = document.createElement('div');
    panelEl.id = 'nova-tryon-panel';
    panelEl.className = 'nova-tryon-panel';
    panelEl.innerHTML = html;

    document.body.appendChild(panelEl);

    // Bind event listeners
    bindEvents();
  }

  // ---------------------------------------------------------------------------
  // Event Binding
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Close button
    const closeBtn = $('#novaPanelClose');
    if (closeBtn) closeBtn.addEventListener('click', handleClose);

    // Before/After toggle
    const btnAfter = $('#novaBtnAfter');
    const btnBefore = $('#novaBtnBefore');
    if (btnAfter) btnAfter.addEventListener('click', () => handleBeforeAfter('after'));
    if (btnBefore) btnBefore.addEventListener('click', () => handleBeforeAfter('before'));

    // Retry (error state)
    const retryBtn = $('#novaRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', () => handleRetry(currentMergeStyle));

    // Try Another Style
    const retryStyleBtn = $('#novaRetryStyle');
    if (retryStyleBtn) {
      retryStyleBtn.addEventListener('click', () => {
        const selector = $('#novaStyleSelector');
        if (selector) selector.hidden = !selector.hidden;
      });
    }

    // Style option buttons
    $$('.nova-style-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        // Highlight selected
        $$('.nova-style-option').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        handleRetry(style);
      });
    });

    // Animate button
    const animateBtn = $('#novaAnimateBtn');
    if (animateBtn) animateBtn.addEventListener('click', handleAnimate);
  }

  // ---------------------------------------------------------------------------
  // Public: initPanel
  // ---------------------------------------------------------------------------

  /**
   * Initialize the panel with product information.
   * @param {object} prodData - { title, image, category, price, ... }
   * @param {object} [analysisResult] - Optional initial analysis data
   */
  async function initPanel(prodData, analysisResult) {
    productData = prodData;
    originalImageUrl = prodData.image || '';

    await createPanel();

    // Populate product info
    const thumbEl = $('#novaProductThumb');
    const nameEl = $('#novaProductName');
    const catEl = $('#novaProductCategory');

    if (thumbEl) thumbEl.src = originalImageUrl;
    if (nameEl) nameEl.textContent = prodData.title || 'Unknown product';
    if (catEl) catEl.textContent = prodData.category || '';

    // If analysis result is provided, show tips immediately
    if (analysisResult && analysisResult.tips) {
      showStyleTips(analysisResult.tips);
    }
  }

  // ---------------------------------------------------------------------------
  // Public: showLoading
  // ---------------------------------------------------------------------------

  function showLoading() {
    const loading = $('#novaLoading');
    const result = $('#novaResultDisplay');
    const error = $('#novaError');
    const actions = $('#novaActions');

    if (loading) loading.hidden = false;
    if (result) result.hidden = true;
    if (error) error.hidden = true;
    if (actions) actions.hidden = true;
  }

  // ---------------------------------------------------------------------------
  // Public: showResult
  // ---------------------------------------------------------------------------

  /**
   * Display the try-on result image.
   * @param {string} base64 - Base64-encoded result image
   */
  function showResult(base64) {
    resultImageBase64 = base64;

    const loading = $('#novaLoading');
    const result = $('#novaResultDisplay');
    const error = $('#novaError');
    const actions = $('#novaActions');
    const afterImg = $('#novaAfterImg');
    const beforeImg = $('#novaBeforeImg');

    if (loading) loading.hidden = true;
    if (error) error.hidden = true;
    if (result) result.hidden = false;
    if (actions) actions.hidden = false;

    if (afterImg) afterImg.src = `data:image/jpeg;base64,${base64}`;
    if (beforeImg) beforeImg.src = originalImageUrl;

    // Reset to "after" view
    handleBeforeAfter('after');
  }

  // ---------------------------------------------------------------------------
  // Public: showError
  // ---------------------------------------------------------------------------

  /**
   * Display an error message in the panel.
   * @param {string} message
   */
  function showError(message) {
    const loading = $('#novaLoading');
    const result = $('#novaResultDisplay');
    const error = $('#novaError');
    const errorText = $('#novaErrorText');

    if (loading) loading.hidden = true;
    if (result) result.hidden = true;
    if (error) error.hidden = false;
    if (errorText) errorText.textContent = message || 'Something went wrong.';
  }

  // ---------------------------------------------------------------------------
  // Public: showStyleTips
  // ---------------------------------------------------------------------------

  /**
   * Render style tip cards.
   * @param {string[]} tips - Array of tip strings
   */
  function showStyleTips(tips) {
    const section = $('#novaStyleTips');
    const list = $('#novaTipsList');

    if (!section || !list || !tips || tips.length === 0) return;

    section.hidden = false;
    list.innerHTML = '';

    tips.forEach((tip, i) => {
      const card = document.createElement('div');
      card.className = 'nova-tip-card';
      card.innerHTML = `
        <div class="nova-tip-icon">${TIP_ICONS[i % TIP_ICONS.length]}</div>
        <p class="nova-tip-text">${escapeHtml(tip)}</p>
      `;
      list.appendChild(card);
    });
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Close the panel with a slide-out animation, then remove from DOM.
   */
  function handleClose() {
    if (!panelEl) return;

    // Clear any video polling
    if (videoPollingTimer) {
      clearInterval(videoPollingTimer);
      videoPollingTimer = null;
    }

    panelEl.classList.add('nova-closing');
    panelEl.addEventListener('animationend', () => {
      if (panelEl && panelEl.parentNode) {
        panelEl.parentNode.removeChild(panelEl);
      }
      panelEl = null;
    }, { once: true });

    // Dispatch event so content.js knows the panel was closed
    document.dispatchEvent(new CustomEvent('nova-panel-closed'));
  }

  /**
   * Toggle between before (original) and after (try-on) views.
   * @param {'before'|'after'} view
   */
  function handleBeforeAfter(view) {
    const beforeImg = $('#novaBeforeImg');
    const afterImg = $('#novaAfterImg');
    const btnBefore = $('#novaBtnBefore');
    const btnAfter = $('#novaBtnAfter');

    if (view === 'before') {
      if (beforeImg) beforeImg.classList.add('visible');
      if (afterImg) afterImg.classList.add('hidden');
      if (btnBefore) btnBefore.classList.add('active');
      if (btnAfter) btnAfter.classList.remove('active');
    } else {
      if (beforeImg) beforeImg.classList.remove('visible');
      if (afterImg) afterImg.classList.remove('hidden');
      if (btnAfter) btnAfter.classList.add('active');
      if (btnBefore) btnBefore.classList.remove('active');
    }
  }

  /**
   * Re-run the try-on with a different merge style.
   * Dispatches a custom event that content.js listens for.
   * @param {'BALANCED'|'SEAMLESS'|'DETAILED'} mergeStyle
   */
  function handleRetry(mergeStyle) {
    currentMergeStyle = mergeStyle;

    // Hide the style selector
    const selector = $('#novaStyleSelector');
    if (selector) selector.hidden = true;

    // Show loading state
    showLoading();

    // Dispatch event for content.js to handle
    document.dispatchEvent(new CustomEvent('nova-retry-tryon', {
      detail: { mergeStyle },
    }));
  }

  /**
   * Generate a runway animation video from the try-on result.
   * Uses ApiClient (expected to be available in the page context).
   */
  async function handleAnimate() {
    if (!resultImageBase64) {
      console.warn('[NovaPanel] No result image to animate.');
      return;
    }

    const videoSection = $('#novaVideoSection');
    const videoLoading = $('#novaVideoLoading');
    const videoPlayer = $('#novaVideoPlayer');
    const progressFill = $('#novaProgressFill');
    const animateBtn = $('#novaAnimateBtn');

    // Show the video section in loading state
    if (videoSection) videoSection.hidden = false;
    if (videoLoading) videoLoading.hidden = false;
    if (videoPlayer) videoPlayer.hidden = true;
    if (progressFill) progressFill.style.width = '0%';

    // Disable the animate button while processing
    if (animateBtn) {
      animateBtn.disabled = true;
      animateBtn.style.opacity = '0.6';
    }

    try {
      // Request video generation via the background service worker
      const prompt = 'Fashion model walking on a runway, elegant confident walk, studio lighting, professional fashion show';

      const genResult = await sendMessage({
        type: 'API_CALL',
        endpoint: '/api/video',
        data: {
          image: resultImageBase64,
          prompt: prompt,
        },
      });

      const jobId = genResult.data.jobId;
      const videoProvider = genResult.data.provider || 'veo';
      if (!jobId) throw new Error('No job ID returned');

      // Poll for video status
      let progress = 10;
      if (progressFill) progressFill.style.width = `${progress}%`;

      videoPollingTimer = setInterval(async () => {
        try {
          const statusResult = await sendMessage({
            type: 'API_CALL',
            endpoint: `/api/video/${encodeURIComponent(jobId)}?provider=${videoProvider}`,
            data: {},
          });

          const status = statusResult.data;

          // Update progress bar
          if (status.progress) {
            progress = Math.min(status.progress, 95);
          } else {
            progress = Math.min(progress + 5, 95);
          }
          if (progressFill) progressFill.style.width = `${progress}%`;

          // Check if complete (handle both videoUrl from Nova and videoBase64 from Veo)
          if ((status.status === 'Completed' || status.status === 'completed') && (status.videoUrl || status.videoBase64)) {
            clearInterval(videoPollingTimer);
            videoPollingTimer = null;

            if (progressFill) progressFill.style.width = '100%';

            // Show video player
            setTimeout(() => {
              if (videoLoading) videoLoading.hidden = true;
              if (videoPlayer) videoPlayer.hidden = false;

              const videoEl = panelEl.querySelector('#novaVideo');
              if (videoEl) {
                if (status.videoBase64) {
                  // Veo returns base64 video data
                  videoEl.src = `data:${status.videoMimeType || 'video/mp4'};base64,${status.videoBase64}`;
                } else {
                  videoEl.src = status.videoUrl;
                }
                videoEl.load();
              }

              // Re-enable animate button
              if (animateBtn) {
                animateBtn.disabled = false;
                animateBtn.style.opacity = '1';
              }
            }, 500);

          } else if (status.status === 'Failed' || status.status === 'failed') {
            clearInterval(videoPollingTimer);
            videoPollingTimer = null;

            if (videoLoading) videoLoading.hidden = true;
            if (animateBtn) {
              animateBtn.disabled = false;
              animateBtn.style.opacity = '1';
            }

            console.error('[NovaPanel] Video generation failed:', status.error);
          }
        } catch (pollErr) {
          console.error('[NovaPanel] Video polling error:', pollErr);
        }
      }, 5000); // Poll every 5 seconds

    } catch (err) {
      console.error('[NovaPanel] Animation error:', err);
      if (videoLoading) videoLoading.hidden = true;
      if (animateBtn) {
        animateBtn.disabled = false;
        animateBtn.style.opacity = '1';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Messaging Helper
  // ---------------------------------------------------------------------------

  /**
   * Send a message to the background service worker.
   * @param {object} message
   * @returns {Promise<object>}
   */
  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Escape HTML special characters to prevent XSS.
   * @param {string} str
   * @returns {string}
   */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Remove the panel from the DOM entirely (no animation).
   */
  function destroy() {
    if (videoPollingTimer) {
      clearInterval(videoPollingTimer);
      videoPollingTimer = null;
    }
    if (panelEl && panelEl.parentNode) {
      panelEl.parentNode.removeChild(panelEl);
    }
    panelEl = null;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  return {
    initPanel,
    showLoading,
    showResult,
    showStyleTips,
    showError,
    handleClose,
    handleBeforeAfter,
    handleRetry,
    handleAnimate,
    destroy,
  };
})();
