/**
 * NovaTryOnMe - Popup Script
 * Auth wizard + profile management
 */

const MAX_IMAGE_DIMENSION = 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_BACKEND_URL = 'http://98.91.240.78';

// State
let pendingSignupEmail = '';
let cachedProfile = null;

// Multi-photo upload state for wizard step 2
let userPhotos = { body: [null, null, null], face: [null, null] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProductUrl(item) {
  if (item.productUrl) return item.productUrl;
  // Legacy fallback: Amazon items stored with asin only
  const id = item.productId || item.asin;
  if (!id) return '#';
  if (!item.retailer || item.retailer === 'amazon') return `https://www.amazon.com/dp/${id}`;
  return '#';
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(viewId).classList.remove('hidden');
}

function showError(elemId, msg) {
  const el = document.getElementById(elemId);
  if (el) el.textContent = msg;
}

function clearError(elemId) {
  const el = document.getElementById(elemId);
  if (el) el.textContent = '';
}

function setLoading(btn, loading) {
  if (loading) {
    btn.classList.add('loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => { toast.classList.remove('show'); }, duration);
}

function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#FF9900', '#E88B00', '#FFB84D', '#FF6600', '#00c853', '#2979ff', '#ff4081', '#aa00ff'];
  const shapes = ['square', 'circle'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    const color = colors[Math.floor(Math.random() * colors.length)];
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    const left = Math.random() * 100;
    const delay = Math.random() * 1.5;
    const size = 6 + Math.random() * 6;

    piece.style.left = left + '%';
    piece.style.width = size + 'px';
    piece.style.height = size + 'px';
    piece.style.background = color;
    piece.style.borderRadius = shape === 'circle' ? '50%' : '2px';
    piece.style.animationDelay = delay + 's';
    piece.style.animationDuration = (2 + Math.random() * 2) + 's';
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 5000);
}

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (res && res.error) return reject(new Error(res.error));
      resolve(res?.data || res);
    });
  });
}

function processImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
          if (width > height) {
            height = Math.round(height * (MAX_IMAGE_DIMENSION / width));
            width = MAX_IMAGE_DIMENSION;
          } else {
            width = Math.round(width * (MAX_IMAGE_DIMENSION / height));
            height = MAX_IMAGE_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        const base64 = dataUrl.split(',')[1];
        const sizeKB = Math.round((base64.length * 3) / 4 / 1024);
        resolve({ base64, width, height, sizeKB });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function calculateAge(birthday) {
  const birth = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function handleLogin() {
  const btn = document.getElementById('loginBtn');
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  clearError('loginError');

  if (!email || !password) {
    showError('loginError', 'Please enter email and password');
    return;
  }

  setLoading(btn, true);
  try {
    const tokens = await sendMsg({
      type: 'API_CALL', endpoint: '/api/auth/login', method: 'POST',
      data: { email, password }
    });
    await chrome.storage.local.set({
      authTokens: {
        idToken: tokens.idToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + (tokens.expiresIn * 1000),
      },
      userEmail: email,
    });
    await loadProfileAndRoute();
  } catch (err) {
    // If email not verified, resend code and go to verify screen
    if (err.message.includes('verify your email') || err.message.includes('UserNotConfirmedException')) {
      pendingSignupEmail = email;
      await chrome.storage.local.set({ pendingEmail: email, pendingPassword: password });
      // Resend verification code
      try {
        await sendMsg({
          type: 'API_CALL', endpoint: '/api/auth/resend-code', method: 'POST',
          data: { email }
        });
      } catch (_) { /* ignore resend error */ }
      document.getElementById('verifyEmailDisplay').textContent = email;
      showView('viewVerify');
    } else {
      showError('loginError', err.message);
    }
  } finally {
    setLoading(btn, false);
  }
}

async function handleSignup() {
  const btn = document.getElementById('signupBtn');
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;
  clearError('signupError');

  if (!email || !password) {
    showError('signupError', 'Please fill in all fields');
    return;
  }
  if (password !== confirm) {
    showError('signupError', 'Passwords do not match');
    return;
  }
  if (password.length < 8) {
    showError('signupError', 'Password must be at least 8 characters');
    return;
  }

  setLoading(btn, true);
  try {
    await sendMsg({
      type: 'API_CALL', endpoint: '/api/auth/signup', method: 'POST',
      data: { email, password }
    });
    pendingSignupEmail = email;
    await chrome.storage.local.set({ pendingEmail: email, pendingPassword: password });
    document.getElementById('verifyEmailDisplay').textContent = email;
    showView('viewVerify');
  } catch (err) {
    showError('signupError', err.message);
  } finally {
    setLoading(btn, false);
  }
}

async function handleVerify() {
  const btn = document.getElementById('verifyBtn');
  const code = document.getElementById('verifyCode').value.trim();
  clearError('verifyError');

  if (!code || code.length < 6) {
    showError('verifyError', 'Please enter the 6-digit code');
    return;
  }

  setLoading(btn, true);
  try {
    const stored = await chrome.storage.local.get(['pendingEmail', 'pendingPassword']);
    const email = pendingSignupEmail || stored.pendingEmail;

    await sendMsg({
      type: 'API_CALL', endpoint: '/api/auth/confirm', method: 'POST',
      data: { email, code }
    });

    // Auto-login after verification
    const password = stored.pendingPassword;
    if (password) {
      const tokens = await sendMsg({
        type: 'API_CALL', endpoint: '/api/auth/login', method: 'POST',
        data: { email, password }
      });
      await chrome.storage.local.set({
        authTokens: {
          idToken: tokens.idToken,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + (tokens.expiresIn * 1000),
        },
        userEmail: email,
      });
      await chrome.storage.local.remove(['pendingEmail', 'pendingPassword']);
      showToast('Account created successfully');
      // Go to wizard step 1
      showView('viewWizard1');
    }
  } catch (err) {
    showError('verifyError', err.message);
  } finally {
    setLoading(btn, false);
  }
}

async function handleResendCode() {
  const stored = await chrome.storage.local.get(['pendingEmail']);
  const email = pendingSignupEmail || stored.pendingEmail;
  if (!email) return;
  try {
    await sendMsg({
      type: 'API_CALL', endpoint: '/api/auth/resend-code', method: 'POST',
      data: { email }
    });
    showError('verifyError', 'Code resent! Check your email.');
    document.getElementById('verifyError').style.color = '#067d62';
  } catch (err) {
    showError('verifyError', err.message);
  }
}

async function handleSignOut() {
  await chrome.storage.local.remove(['authTokens', 'userEmail']);
  showView('viewSignIn');
}

async function handleDeleteAccount() {
  const confirmed = confirm(
    'Are you sure you want to delete your account?\n\n' +
    'This will permanently remove all your data including photos, videos, and favorites. This action cannot be undone.'
  );
  if (!confirmed) return;

  const btn = document.getElementById('deleteAccountBtn');
  setLoading(btn, true);
  try {
    await sendMsg({
      type: 'API_CALL', endpoint: '/api/account', method: 'DELETE', data: {}
    });
    await chrome.storage.local.clear();
    showToast('Account deleted successfully');
    showView('viewSignIn');
  } catch (err) {
    showToast('Failed to delete account: ' + err.message);
  } finally {
    setLoading(btn, false);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

async function loadProfileAndRoute() {
  try {
    const profile = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile', method: 'GET', data: {}
    });

    if (profile && profile.profileComplete) {
      showProfileView(profile);
    } else if (profile && profile.firstName) {
      // Partially complete - figure out where they left off
      if (!profile.bodyPhotoKey) {
        showView('viewWizard2');
      } else if (!profile.facePhotoKey) {
        showView('viewWizard3');
      } else {
        showView('viewWizard1');
      }
    } else {
      showView('viewWizard1');
    }
  } catch (err) {
    console.error('[popup] Failed to load profile:', err);
    showView('viewWizard1');
  }
}

async function showProfileView(profile) {
  cachedProfile = profile;
  const greeting = document.getElementById('profileGreeting');
  greeting.textContent = `Hi, ${profile.firstName || 'User'}!`;

  const ageEl = document.getElementById('profileAge');
  if (profile.age) ageEl.textContent = `${profile.age} years old`;

  const locEl = document.getElementById('profileLocation');
  const parts = [profile.city, profile.country].filter(Boolean);
  if (parts.length) locEl.textContent = parts.join(', ');

  // Load favorites count + videos count in parallel
  try {
    const [favData, vidData] = await Promise.all([
      sendMsg({ type: 'API_CALL', endpoint: '/api/favorites', method: 'GET', data: {} }).catch(() => null),
      sendMsg({ type: 'API_CALL', endpoint: '/api/video/list', method: 'GET', data: {} }).catch(() => null),
    ]);
    document.getElementById('favoritesCount').textContent = favData?.favorites?.length || 0;
    document.getElementById('videosCount').textContent = vidData?.videos?.length || 0;
  } catch (_) { /* ignore */ }

  // Load all photos (5 originals + 3 generated)
  try {
    const allPhotos = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile/photos/all', method: 'GET', data: {}
    });

    // Show generated photos
    const genSection = document.getElementById('profileGenerated');
    if (allPhotos.generated && allPhotos.generated.some(Boolean)) {
      genSection.hidden = false;
      for (let i = 0; i < 3; i++) {
        const img = document.getElementById(`profileGenImg${i}`);
        if (allPhotos.generated[i]) {
          img.src = `data:image/jpeg;base64,${allPhotos.generated[i]}`;
          img.hidden = false;
        } else {
          img.hidden = true;
        }
      }
    } else {
      genSection.hidden = true;
    }

    // Show original photos
    const origSection = document.getElementById('profileOriginals');
    if (allPhotos.originals && allPhotos.originals.some(Boolean)) {
      origSection.hidden = false;
      for (let i = 0; i < 5; i++) {
        const img = document.getElementById(`profileOrigImg${i}`);
        if (allPhotos.originals[i]) {
          img.src = `data:image/jpeg;base64,${allPhotos.originals[i]}`;
          img.hidden = false;
        } else {
          img.hidden = true;
        }
      }
    } else {
      origSection.hidden = true;
    }
  } catch (_) {
    // Hide photo sections if API fails
    document.getElementById('profileGenerated').hidden = true;
    document.getElementById('profileOriginals').hidden = true;
  }

  showView('viewProfile');
  checkBackendHealth('profileStatusDot', 'profileStatusText');
  loadDebugTryOnImages();
  loadPoseAndFramingState();
}

// ---------------------------------------------------------------------------
// Debug Try-On Images (loaded from chrome.storage, set by content script)
// ---------------------------------------------------------------------------

async function loadDebugTryOnImages() {
  const section = document.getElementById('debugTryOnSection');
  if (!section) return;
  try {
    const stored = await chrome.storage.local.get(['tryOnDebug']);
    const debug = stored.tryOnDebug;
    if (!debug || !debug.userPhoto || !debug.garmentPhoto) {
      section.hidden = true;
      return;
    }
    document.getElementById('debugUserPhoto').src = debug.userPhoto;
    document.getElementById('debugGarmentPhoto').src = debug.garmentPhoto;
    const extracted = debug.garmentImageUsed === 'extracted';
    document.getElementById('debugGarmentLabel').textContent = extracted ? 'Garment (extracted)' : 'Garment (original)';
    section.hidden = false;
  } catch (_) {
    section.hidden = true;
  }
}

// Listen for storage changes to update debug images in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tryOnDebug) {
    loadDebugTryOnImages();
  }
});

// ---------------------------------------------------------------------------
// Pose & Framing Controls
// ---------------------------------------------------------------------------

function setupPoseAndFramingControls() {
  // Pose buttons
  document.querySelectorAll('#poseBtns .nova-setting-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const poseIndex = parseInt(btn.dataset.pose, 10);
      document.querySelectorAll('#poseBtns .nova-setting-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      chrome.storage.local.set({ selectedPoseIndex: poseIndex });

      // Highlight the corresponding generated photo
      for (let i = 0; i < 3; i++) {
        const img = document.getElementById(`profileGenImg${i}`);
        if (img) img.classList.toggle('pose-active', i === poseIndex);
      }
    });
  });

  // Framing buttons
  document.querySelectorAll('#framingBtns .nova-setting-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const framing = btn.dataset.framing;
      document.querySelectorAll('#framingBtns .nova-setting-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      chrome.storage.local.set({ tryOnFraming: framing });
    });
  });
}

async function loadPoseAndFramingState() {
  const stored = await chrome.storage.local.get(['selectedPoseIndex', 'tryOnFraming']);
  const poseIndex = stored.selectedPoseIndex || 0;
  const framing = stored.tryOnFraming || 'full';

  // Update pose buttons
  document.querySelectorAll('#poseBtns .nova-setting-btn').forEach((btn) => {
    btn.classList.toggle('selected', parseInt(btn.dataset.pose, 10) === poseIndex);
  });

  // Highlight active generated photo
  for (let i = 0; i < 3; i++) {
    const img = document.getElementById(`profileGenImg${i}`);
    if (img) img.classList.toggle('pose-active', i === poseIndex);
  }

  // Update framing buttons
  document.querySelectorAll('#framingBtns .nova-setting-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.framing === framing);
  });
}

// ---------------------------------------------------------------------------
// Edit Profile (single-page, all sections visible)
// ---------------------------------------------------------------------------
// Favorites View
// ---------------------------------------------------------------------------
async function showFavoritesView() {
  showView('viewFavorites');
  const container = document.getElementById('favoritesListContainer');
  container.innerHTML = '<div class="favorites-empty">Loading...</div>';

  try {
    const favData = await sendMsg({
      type: 'API_CALL', endpoint: '/api/favorites', method: 'GET', data: {}
    });
    console.log('[popup] Raw favData response:', JSON.stringify(favData).substring(0, 500));
    const favorites = favData.favorites || [];
    console.log(`[popup] Favorites loaded: ${favorites.length}`);
    favorites.forEach((f, i) => {
      console.log(`[popup]   [${i}] asin=${f.asin}`);
      console.log(`[popup]     tryOnResultKey="${f.tryOnResultKey || '(empty)'}"`);
      console.log(`[popup]     tryOnResultUrl=${f.tryOnResultUrl ? 'YES (' + f.tryOnResultUrl.substring(0, 80) + '...)' : 'NO'}`);
      console.log(`[popup]     productImage=${f.productImage ? 'YES' : 'NO'}`);
      console.log(`[popup]     ALL KEYS:`, Object.keys(f));
    });

    if (favorites.length === 0) {
      container.innerHTML = '<div class="favorites-empty">No favorites yet.<br>Use the &#9825; button on try-on results to save items here.</div>';
      return;
    }

    // Sort by savedAt descending (newest first)
    favorites.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

    // Group by outfitId (items with same outfitId are one outfit, items without are solo)
    const outfitGroups = new Map(); // outfitId → [fav, ...]
    const soloItems = [];
    favorites.forEach((fav) => {
      if (fav.outfitId) {
        if (!outfitGroups.has(fav.outfitId)) outfitGroups.set(fav.outfitId, []);
        outfitGroups.get(fav.outfitId).push(fav);
      } else {
        soloItems.push(fav);
      }
    });

    // Build a flat render list: each entry is either {type:'outfit', items:[...]} or {type:'solo', fav}
    const renderList = [];
    outfitGroups.forEach((items) => renderList.push({ type: 'outfit', items, savedAt: items[0].savedAt }));
    soloItems.forEach((fav) => renderList.push({ type: 'solo', fav, savedAt: fav.savedAt }));
    renderList.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

    container.innerHTML = '<div class="favorites-list" id="favoritesList"></div>';
    const list = document.getElementById('favoritesList');

    // Cart selection state: Map of cardId → [productUrl, ...]
    const cartSelection = new Map();
    let cardIdCounter = 0;

    function updateCartBar() {
      const bar = document.getElementById('favCartBar');
      const countEl = document.getElementById('favCartCount');
      let totalItems = 0;
      cartSelection.forEach(urls => { totalItems += urls.length; });
      if (totalItems > 0) {
        bar.hidden = false;
        countEl.textContent = `${totalItems} item${totalItems > 1 ? 's' : ''} selected`;
      } else {
        bar.hidden = true;
      }
    }

    renderList.forEach((entry) => {
      if (entry.type === 'outfit') {
        renderOutfitCard(list, container, entry.items);
      } else {
        renderSoloCard(list, container, entry.fav);
      }
    });

    // Cart button handler — calls local Nova Act cart server (localhost:7860)
    document.getElementById('favCartBtn').addEventListener('click', async () => {
      const btn = document.getElementById('favCartBtn');
      const allUrls = [];
      cartSelection.forEach(urls => { allUrls.push(...urls); });
      if (allUrls.length === 0) return;

      btn.disabled = true;
      btn.textContent = 'Adding to cart...';

      try {
        // Call the local Nova Act cart server running on user's machine
        const resp = await fetch('http://localhost:7860/add-to-cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productUrls: allUrls }),
        });
        const result = await resp.json();
        console.log('[popup] Add to cart result:', result);

        if (result.status === 'success') {
          showToast('Items added to shopping cart successfully!', 4000);
        } else if (result.status === 'partial') {
          showToast(result.message || 'Some items could not be added to cart.', 4000);
        } else {
          throw new Error(result.error || 'Unknown error');
        }
        // Clear selection
        cartSelection.clear();
        document.querySelectorAll('.fav-card-checkbox').forEach(cb => {
          cb.checked = false;
          const card = cb.closest('.fav-card, .fav-outfit-card');
          if (card) card.classList.remove('fav-card-selected');
        });
        updateCartBar();
      } catch (err) {
        console.error('[popup] Add to cart failed:', err);
        if (err.message && err.message.includes('Failed to fetch')) {
          showToast('Cart server not running. Start it with: python3 cart_server.py', 5000);
        } else {
          showToast('Failed to add items to cart. Please try again.', 4000);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Add to Shopping Cart';
      }
    });

    function renderSoloCard(list, container, fav) {
      const card = document.createElement('div');
      card.className = 'fav-card';
      const cardId = 'favCard_' + (cardIdCounter++);

      const productImg = fav.productImage || '';
      const hasTryOnKey = !!fav.tryOnResultKey;
      const title = fav.productTitle || fav.asin || 'Unknown product';
      const category = fav.category || fav.garmentClass || '';
      const date = fav.savedAt ? new Date(fav.savedAt).toLocaleDateString() : '';
      const retailerLabels = { amazon: 'Amazon', shein: 'Shein', temu: 'Temu', google_shopping: 'Google Shopping' };
      const retailerName = retailerLabels[fav.retailer] || (fav.productUrl && !fav.productUrl.includes('amazon.com') ? 'Other' : 'Amazon');
      const productUrl = buildProductUrl(fav);

      card.innerHTML = `
        <input type="checkbox" class="fav-card-checkbox" data-card-id="${cardId}" title="Select for cart">
        <div class="fav-card-images">
          ${hasTryOnKey ? `<img class="fav-card-img fav-card-tryon" id="tryonImg_${fav.asin}" src="" alt="Try-on" style="display:none">` : ''}
          ${productImg ? `<img class="fav-card-img fav-card-product" src="${productImg}" alt="Product">` : ''}
        </div>
        <div class="fav-card-body">
          <span class="fav-card-retailer fav-retailer-${(fav.retailer || 'amazon').replace('_', '-')}">${retailerName}</span>
          <div class="fav-card-title">${title}</div>
          <div class="fav-card-meta">${[category, date].filter(Boolean).join(' · ')}</div>
        </div>
        <button class="fav-card-remove" title="Remove" data-asin="${fav.asin}">&times;</button>
      `;

      // Checkbox handler
      const checkbox = card.querySelector('.fav-card-checkbox');
      checkbox.addEventListener('click', (e) => { e.stopPropagation(); });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && productUrl !== '#') {
          cartSelection.set(cardId, [productUrl]);
          card.classList.add('fav-card-selected');
        } else {
          cartSelection.delete(cardId);
          card.classList.remove('fav-card-selected');
        }
        updateCartBar();
      });

      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('fav-card-remove') || e.target.classList.contains('fav-card-checkbox')) return;
        const url = buildProductUrl(fav);
        if (url !== '#') chrome.tabs.create({ url });
      });

      const removeBtn = card.querySelector('.fav-card-remove');
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await sendMsg({ type: 'API_CALL', endpoint: `/api/favorites/${fav.asin}`, method: 'DELETE', data: {} });
          card.remove();
          if (list.querySelectorAll('.fav-card, .fav-outfit-card').length === 0) {
            container.innerHTML = '<div class="favorites-empty">No favorites yet.<br>Use the &#9825; button on try-on results to save items here.</div>';
          }
        } catch (err) { console.error('[popup] Failed to remove favorite:', err); }
      });

      list.appendChild(card);
      loadTryOnImage(fav);
    }

    function renderOutfitCard(list, container, items) {
      const card = document.createElement('div');
      card.className = 'fav-outfit-card';
      const cardId = 'favCard_' + (cardIdCounter++);

      const date = items[0].savedAt ? new Date(items[0].savedAt).toLocaleDateString() : '';
      // Use first item's try-on image (all share the same result)
      const firstWithKey = items.find(i => i.tryOnResultKey);
      const tryOnImgId = firstWithKey ? `tryonImg_outfit_${firstWithKey.asin}` : '';

      const itemRows = items.map(i => {
        const shortTitle = (i.productTitle || i.category || 'Item').split(' ').slice(0, 4).join(' ');
        return `<div class="fav-outfit-row" data-asin="${i.asin}">
          <img class="fav-outfit-thumb" src="${i.productImage || ''}" alt="${i.category}" title="${i.productTitle || i.category}">
          <a class="fav-outfit-link" href="#">${shortTitle}</a>
        </div>`;
      }).join('');

      // Collect all product URLs for this outfit
      const outfitUrls = items.map(i => buildProductUrl(i)).filter(u => u !== '#');

      card.innerHTML = `
        <input type="checkbox" class="fav-card-checkbox" data-card-id="${cardId}" title="Select all ${items.length} items for cart">
        <div class="fav-outfit-images">
          ${tryOnImgId ? `<img class="fav-card-img fav-card-tryon" id="${tryOnImgId}" src="" alt="Try-on" style="display:none">` : ''}
        </div>
        <div class="fav-card-body">
          <span class="fav-card-retailer fav-retailer-amazon">Amazon</span>
          <div class="fav-card-title">Outfit (${items.length} items)</div>
          <div class="fav-outfit-items">${itemRows}</div>
          <div class="fav-card-meta">${date}</div>
        </div>
        <button class="fav-outfit-remove" title="Remove outfit">&times;</button>
      `;

      // Checkbox handler — selects all items in the outfit
      const checkbox = card.querySelector('.fav-card-checkbox');
      checkbox.addEventListener('click', (e) => { e.stopPropagation(); });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && outfitUrls.length > 0) {
          cartSelection.set(cardId, outfitUrls);
          card.classList.add('fav-card-selected');
        } else {
          cartSelection.delete(cardId);
          card.classList.remove('fav-card-selected');
        }
        updateCartBar();
      });

      // Click product row (thumb + link) → open that item
      card.querySelectorAll('.fav-outfit-row').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const item = items.find(i => i.asin === el.dataset.asin) || { asin: el.dataset.asin };
          const url = buildProductUrl(item);
          if (url !== '#') chrome.tabs.create({ url });
        });
      });

      // Remove entire outfit
      card.querySelector('.fav-outfit-remove').addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          for (const item of items) {
            await sendMsg({ type: 'API_CALL', endpoint: `/api/favorites/${item.asin}`, method: 'DELETE', data: {} });
          }
          card.remove();
          if (list.querySelectorAll('.fav-card, .fav-outfit-card').length === 0) {
            container.innerHTML = '<div class="favorites-empty">No favorites yet.<br>Use the &#9825; button on try-on results to save items here.</div>';
          }
        } catch (err) { console.error('[popup] Failed to remove outfit:', err); }
      });

      list.appendChild(card);
      if (firstWithKey) loadTryOnImage(firstWithKey, tryOnImgId);
    }

    function loadTryOnImage(fav, customId) {
      if (!fav.tryOnResultKey) return;
      const imgId = customId || `tryonImg_${fav.asin}`;
      sendMsg({
        type: 'API_CALL', endpoint: `/api/favorites/${fav.asin}/image`, method: 'GET', data: {}
      }).then((imgData) => {
        if (imgData && imgData.image) {
          const imgEl = document.getElementById(imgId);
          if (imgEl) {
            imgEl.src = `data:image/jpeg;base64,${imgData.image}`;
            imgEl.style.display = '';
            imgEl.style.cursor = 'pointer';
            imgEl.addEventListener('click', (e) => {
              e.stopPropagation();
              document.getElementById('lightboxImg').src = imgEl.src;
              document.getElementById('imageLightbox').classList.add('active');
            });
          }
        }
      }).catch((err) => {
        console.warn(`[popup] Failed to load try-on image for ${fav.asin}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[popup] Failed to load favorites:', err);
    container.innerHTML = '<div class="favorites-empty">Failed to load favorites.</div>';
  }
}

// ---------------------------------------------------------------------------
// Videos View
// ---------------------------------------------------------------------------
async function showVideosView() {
  showView('viewVideos');
  const container = document.getElementById('videosListContainer');
  container.innerHTML = '<div class="favorites-empty">Loading...</div>';

  try {
    const vidData = await sendMsg({
      type: 'API_CALL', endpoint: '/api/video/list', method: 'GET', data: {}
    });

    const videos = vidData.videos || [];
    if (!videos.length) {
      container.innerHTML = '<div class="favorites-empty">No saved videos yet.<br>Use the "Save" button on generated videos to save them here.</div>';
      return;
    }

    // Sort newest first
    videos.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

    container.innerHTML = '<div class="videos-list" id="videosList"></div>';
    const list = document.getElementById('videosList');

    videos.forEach((video) => {
      const card = document.createElement('div');
      card.className = 'video-card';

      const date = video.savedAt ? new Date(video.savedAt).toLocaleDateString() : '';
      const title = video.productTitle || video.asin || 'Try-on video';
      const shortTitle = title.split(' ').slice(0, 5).join(' ');

      card.innerHTML = `
        <div class="video-card-player">
          ${video.videoUrl ? `<video class="video-card-video" controls preload="metadata"><source src="${video.videoUrl}" type="video/mp4"></video>` : '<div class="video-card-placeholder">Video unavailable</div>'}
        </div>
        <div class="video-card-body">
          <div class="video-card-info">
            ${video.productImage ? `<img class="video-card-product-img" src="${video.productImage}" alt="Product">` : ''}
            <div>
              <div class="video-card-title">${shortTitle}</div>
              <div class="video-card-meta">${date}</div>
            </div>
          </div>
          <div class="video-card-actions">
            ${video.asin ? `<a class="video-card-link" href="#" data-asin="${video.asin}">View Product</a>` : ''}
            <button class="video-card-delete" title="Remove video" data-video-id="${video.videoId}">&times;</button>
          </div>
        </div>
      `;

      // Click product link
      const productLink = card.querySelector('.video-card-link');
      if (productLink) {
        productLink.addEventListener('click', (e) => {
          e.preventDefault();
          const url = buildProductUrl(video);
          if (url !== '#') chrome.tabs.create({ url });
        });
      }

      // Delete video
      card.querySelector('.video-card-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const videoId = e.target.dataset.videoId;
        try {
          await sendMsg({ type: 'API_CALL', endpoint: `/api/video/${encodeURIComponent(videoId)}`, method: 'DELETE', data: {} });
          card.remove();
          if (list.querySelectorAll('.video-card').length === 0) {
            container.innerHTML = '<div class="favorites-empty">No saved videos yet.<br>Use the "Save" button on generated videos to save them here.</div>';
          }
        } catch (err) {
          console.error('[popup] Failed to remove video:', err);
        }
      });

      list.appendChild(card);
    });
  } catch (err) {
    console.error('[popup] Failed to load videos:', err);
    container.innerHTML = '<div class="favorites-empty">Failed to load videos.</div>';
  }
}

// ---------------------------------------------------------------------------

let editOriginalReplaceIndex = null;

async function showEditProfile() {
  // Pre-fill personal info from cached profile
  if (cachedProfile) {
    document.getElementById('editFirstName').value = cachedProfile.firstName || '';
    document.getElementById('editLastName').value = cachedProfile.lastName || '';
    document.getElementById('editBirthday').value = cachedProfile.birthday || '';
    document.getElementById('editSex').value = cachedProfile.sex || '';
    document.getElementById('editCountry').value = cachedProfile.country || '';
    document.getElementById('editCity').value = cachedProfile.city || '';
    document.getElementById('editClothesSize').value = cachedProfile.clothesSize || '';
    document.getElementById('editShoesSize').value = cachedProfile.shoesSize || '';
    // Language: prefer DynamoDB profile, fallback to chrome.storage.local
    chrome.storage.local.get(['stellaLanguage'], (result) => {
      document.getElementById('editLanguage').value = cachedProfile.language || result.stellaLanguage || 'en';
    });
    if (cachedProfile.birthday) {
      const age = calculateAge(cachedProfile.birthday);
      document.getElementById('editAgeDisplay').textContent = age > 0 ? `Age: ${age}` : '';
    }
  }

  // Load all 5 original photos
  try {
    const allPhotos = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile/photos/all', method: 'GET', data: {}
    });
    if (allPhotos.originals && allPhotos.originals.length > 0) {
      for (let i = 0; i < 5; i++) {
        const img = document.getElementById(`editOrigImg${i}`);
        if (allPhotos.originals[i]) {
          img.src = `data:image/jpeg;base64,${allPhotos.originals[i]}`;
        } else {
          img.src = '';
          img.alt = 'No photo';
        }
      }
    }
  } catch (err) {
    console.warn('[popup] Failed to load original photos:', err.message);
  }

  showView('viewEditProfile');
}

async function handleEditSaveInfo() {
  const btn = document.getElementById('editSaveInfoBtn');
  const firstName = document.getElementById('editFirstName').value.trim();
  const lastName = document.getElementById('editLastName').value.trim();
  const birthday = document.getElementById('editBirthday').value;
  const sex = document.getElementById('editSex').value;
  const country = document.getElementById('editCountry').value;
  const city = document.getElementById('editCity').value.trim();
  const clothesSize = document.getElementById('editClothesSize').value;
  const shoesSize = document.getElementById('editShoesSize').value;
  const language = document.getElementById('editLanguage').value || 'en';

  if (!firstName || !lastName) {
    showToast('Please enter your first and last name.');
    return;
  }

  setLoading(btn, true);
  try {
    await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile', method: 'PUT',
      data: { firstName, lastName, birthday, sex, country, city, clothesSize, shoesSize, language }
    });
    // Update cached profile so Stella and other features use the new values
    if (cachedProfile) {
      Object.assign(cachedProfile, { firstName, lastName, birthday, sex, country, city, clothesSize, shoesSize, language });
    }
    // Persist language locally so Stella uses it even before backend deploy
    chrome.storage.local.set({ stellaLanguage: language });
    showToast('Profile updated successfully');
  } catch (err) {
    showToast('Failed to save: ' + err.message);
  } finally {
    setLoading(btn, false);
  }
}

async function handleEditRegenAiPhotos() {
  const btn = document.getElementById('editRegenAiBtn');
  const statusEl = document.getElementById('editRegenStatus');
  setLoading(btn, true);
  statusEl.hidden = false;
  statusEl.textContent = 'Fetching your original photos...';

  try {
    // Fetch current originals from S3 (same data showEditProfile already loads)
    const allPhotos = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile/photos/all', method: 'GET', data: {}
    });

    if (!allPhotos.originals || allPhotos.originals.filter(Boolean).length < 5) {
      alert('All 5 original photos are required before regenerating.');
      return;
    }

    statusEl.textContent = 'Generating 3 AI pose photos... This may take a minute.';
    const startTime = Date.now();

    // Call the SAME endpoint used during account creation
    const result = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile/generate-photos', method: 'POST',
      data: { userImages: allPhotos.originals }
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    const successCount = result.generatedPhotos ? result.generatedPhotos.filter(Boolean).length : 0;

    // Update chrome.storage with new generated photo (same logic as wizard)
    if (result.generatedPhotos && result.generatedPhotos[0]) {
      await chrome.storage.local.set({
        bodyPhoto: result.generatedPhotos[0],
        selectedPoseIndex: 0
      });
    }

    statusEl.textContent = `Done! ${successCount}/3 photos generated in ${totalTime}s`;
    btn.textContent = 'Regenerate AI Photos';
    showToast('Profile photos regenerated successfully');
    setTimeout(() => { statusEl.hidden = true; }, 5000);
  } catch (err) {
    statusEl.textContent = 'Failed: ' + err.message;
  } finally {
    setLoading(btn, false);
  }
}

async function handleEditOriginalReplace(file, index) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    alert('Please upload a JPEG, PNG, or WebP image.');
    return;
  }
  const item = document.querySelector(`.edit-original-item[data-index="${index}"]`);
  const btn = item.querySelector('.edit-original-change-btn');
  const origText = btn.textContent;
  btn.textContent = 'Uploading...';
  btn.disabled = true;
  item.classList.add('uploading');

  try {
    const result = await processImage(file);
    await sendMsg({
      type: 'API_CALL', endpoint: `/api/profile/photos/original/${index}`, method: 'PUT',
      data: { image: result.base64 }
    });
    // Update the displayed image
    document.getElementById(`editOrigImg${index}`).src = `data:image/jpeg;base64,${result.base64}`;
    btn.textContent = 'Done!';
    setTimeout(() => { btn.textContent = origText; }, 1500);
  } catch (err) {
    alert('Failed to replace photo: ' + err.message);
    btn.textContent = origText;
  } finally {
    btn.disabled = false;
    item.classList.remove('uploading');
  }
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

async function handleWizard1Next() {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const birthday = document.getElementById('birthday').value;
  const sex = document.getElementById('sex').value;
  const country = document.getElementById('country').value;
  const city = document.getElementById('city').value.trim();
  const clothesSize = document.getElementById('clothesSize').value;
  const shoesSize = document.getElementById('shoesSize').value;
  const language = document.getElementById('language').value || 'en';

  if (!firstName || !lastName || !birthday || !sex || !country || !city || !clothesSize || !shoesSize) {
    showToast('Please fill in all fields.');
    return;
  }

  try {
    await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile', method: 'PUT',
      data: { firstName, lastName, birthday, sex, country, city, clothesSize, shoesSize, language }
    });
    chrome.storage.local.set({ stellaLanguage: language });
    // Open as a full tab for photo upload (popup closes when file dialogs open)
    openAsTab('wizard2');
  } catch (err) {
    alert('Failed to save: ' + err.message);
  }
}

/**
 * Open popup.html in a full browser tab so file dialogs work reliably.
 * Chrome extension popups close when system dialogs (file picker) open,
 * losing all JS state. Tabs don't have this problem.
 */
function openAsTab(step) {
  const url = chrome.runtime.getURL('popup/popup.html') + '?step=' + step;
  chrome.tabs.create({ url });
  // Close the popup if we're in one
  if (!isRunningAsTab()) window.close();
}

function isRunningAsTab() {
  return window.location.search.includes('step=');
}

// ---------------------------------------------------------------------------
// Multi-photo upload for wizard step 2
// ---------------------------------------------------------------------------

async function handleMultiPhotoUpload(category, index, file) {
  console.log(`[upload] handleMultiPhotoUpload called: ${category} ${index}, file: ${file.name} (${file.type})`);
  if (!ALLOWED_TYPES.includes(file.type)) {
    alert('Please upload a JPEG, PNG, or WebP image.');
    return;
  }
  try {
    const result = await processImage(file);
    console.log(`[upload] processImage done: ${result.width}x${result.height}, ${result.sizeKB}KB`);
    userPhotos[category][index] = result.base64;

    // Update preview
    const previewId = `${category}Preview${index}`;
    const preview = document.getElementById(previewId);
    if (preview) {
      preview.src = `data:image/jpeg;base64,${result.base64}`;
      preview.hidden = false;
    }

    // Enable "Generate" button when all 5 photos are uploaded
    const allFilled = userPhotos.body.every(Boolean) && userPhotos.face.every(Boolean);
    document.getElementById('wizard2Next').disabled = !allFilled;
    console.log(`[upload] allFilled: ${allFilled}`);
  } catch (err) {
    console.error(`[upload] error:`, err);
    alert('Failed to process image: ' + err.message);
  }
}


async function handleWizard2Next() {
  const allFilled = userPhotos.body.every(Boolean) && userPhotos.face.every(Boolean);
  if (!allFilled) return;

  const btn = document.getElementById('wizard2Next');
  setLoading(btn, true);

  // Move to wizard3 and start generation
  showView('viewWizard3');

  // Reset progress UI
  for (let i = 0; i < 3; i++) {
    const step = document.getElementById(`genStep${i}`);
    step.querySelector('.gen-step-icon').innerHTML = '&#9711;';
    step.classList.remove('gen-step-done', 'gen-step-active', 'gen-step-error');
    step.querySelector('.gen-step-time').textContent = '';
    document.getElementById(`genImg${i}`).hidden = true;
  }
  document.getElementById('wizard3Done').hidden = true;
  clearError('genError');

  try {
    // Mark first step as active
    document.getElementById('genStep0').classList.add('gen-step-active');
    document.getElementById('genStep0').querySelector('.gen-step-icon').innerHTML = '&#8987;';

    const userImages = [...userPhotos.body, ...userPhotos.face];
    const startTime = Date.now();

    const result = await sendMsg({
      type: 'API_CALL', endpoint: '/api/profile/generate-photos', method: 'POST',
      data: { userImages }
    });

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

    // Update progress UI with results
    if (result.generatedPhotos) {
      for (let i = 0; i < 3; i++) {
        const step = document.getElementById(`genStep${i}`);
        step.classList.remove('gen-step-active');
        if (result.generatedPhotos[i]) {
          step.classList.add('gen-step-done');
          step.querySelector('.gen-step-icon').innerHTML = '&#10003;';
          const img = document.getElementById(`genImg${i}`);
          img.src = `data:image/jpeg;base64,${result.generatedPhotos[i]}`;
          img.hidden = false;
        } else {
          step.classList.add('gen-step-error');
          step.querySelector('.gen-step-icon').innerHTML = '&#10007;';
        }
      }
      document.getElementById('genStep2').querySelector('.gen-step-time').textContent = `${totalTime}s total`;
    }

    // Store first generated photo for backward compat + reset pose selection
    // Actual pose images are fetched from S3 by the backend using poseIndex
    if (result.generatedPhotos && result.generatedPhotos[0]) {
      await chrome.storage.local.set({
        bodyPhoto: result.generatedPhotos[0],
        selectedPoseIndex: 0
      });
    }

    // Show success message and complete button
    const successEl = document.getElementById('genSuccess');
    if (successEl) successEl.hidden = false;
    document.getElementById('wizard3Done').hidden = false;

    // Celebrate with confetti!
    launchConfetti();
  } catch (err) {
    showError('genError', 'Generation failed: ' + err.message);
    // Mark all steps as error
    for (let i = 0; i < 3; i++) {
      const step = document.getElementById(`genStep${i}`);
      step.classList.remove('gen-step-active');
      step.classList.add('gen-step-error');
      step.querySelector('.gen-step-icon').innerHTML = '&#10007;';
    }
  } finally {
    setLoading(btn, false);
  }
}

async function handleWizard3Done() {
  if (isRunningAsTab()) {
    // Close the tab — user will open popup normally to see profile
    window.close();
  } else {
    await loadProfileAndRoute();
  }
}

// ---------------------------------------------------------------------------
// Upload Area Setup
// ---------------------------------------------------------------------------

function setupUploadArea(areaId, inputId, handler) {
  const area = document.getElementById(areaId);
  const input = document.getElementById(inputId);
  if (!area || !input) return;

  area.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handler(e.target.files[0]);
  });
  area.addEventListener('dragenter', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', (e) => { e.preventDefault(); area.classList.remove('drag-over'); });
  area.addEventListener('drop', (e) => {
    e.preventDefault();
    area.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) handler(e.dataTransfer.files[0]);
  });
}

// ---------------------------------------------------------------------------
// Backend Health
// ---------------------------------------------------------------------------

async function checkBackendHealth(dotId, textId) {
  dotId = dotId || 'statusDot';
  textId = textId || 'statusText';
  const dot = document.getElementById(dotId);
  const text = document.getElementById(textId);
  if (!dot || !text) return;

  const stored = await chrome.storage.local.get(['backendUrl']);
  const url = stored.backendUrl || DEFAULT_BACKEND_URL;

  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      dot.className = 'status-dot connected';
      text.textContent = 'Backend connected';
    } else {
      dot.className = 'status-dot disconnected';
      text.textContent = `Backend error (${resp.status})`;
    }
  } catch (_) {
    dot.className = 'status-dot disconnected';
    text.textContent = 'Backend unreachable';
  }
}

// ---------------------------------------------------------------------------
// Backend URL
// ---------------------------------------------------------------------------

async function saveBackendUrl() {
  const input = document.getElementById('backendUrlInput');
  if (!input) return;
  const url = input.value.trim();
  if (!url) return;
  await chrome.storage.local.set({ backendUrl: url });
  const btn = document.getElementById('saveUrlBtn');
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = 'Saved!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
  checkBackendHealth('profileStatusDot', 'profileStatusText');
}

// ---------------------------------------------------------------------------
// Smart Search
// ---------------------------------------------------------------------------

async function handleSmartSearch() {
  const input = document.getElementById('smartSearchInput');
  const btn = document.getElementById('smartSearchBtn');
  const errorEl = document.getElementById('smartSearchError');
  const query = input.value.trim();

  errorEl.textContent = '';

  if (!query) {
    errorEl.textContent = 'Please enter a search query';
    return;
  }

  // Open the results page in a new tab with the query + user sizes
  const searchParams = new URLSearchParams({ q: query });
  if (cachedProfile?.clothesSize) searchParams.set('clothesSize', cachedProfile.clothesSize);
  if (cachedProfile?.shoesSize) searchParams.set('shoesSize', cachedProfile.shoesSize);
  if (cachedProfile?.sex) searchParams.set('sex', cachedProfile.sex);
  const resultsUrl = chrome.runtime.getURL('smart-search/results.html') + '?' + searchParams.toString();
  chrome.tabs.create({ url: resultsUrl });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  // Bind auth events
  document.getElementById('loginBtn').addEventListener('click', handleLogin);
  document.getElementById('signupBtn').addEventListener('click', handleSignup);
  document.getElementById('verifyBtn').addEventListener('click', handleVerify);
  document.getElementById('goToSignUp').addEventListener('click', (e) => { e.preventDefault(); showView('viewSignUp'); });
  document.getElementById('goToSignIn').addEventListener('click', (e) => { e.preventDefault(); showView('viewSignIn'); });
  document.getElementById('resendCode').addEventListener('click', (e) => { e.preventDefault(); handleResendCode(); });
  document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
  document.getElementById('deleteAccountBtn').addEventListener('click', handleDeleteAccount);

  // Enter key on login/signup
  document.getElementById('loginPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('signupConfirm').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSignup(); });
  document.getElementById('verifyCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleVerify(); });

  // Wizard events
  document.getElementById('wizard1Next').addEventListener('click', handleWizard1Next);
  document.getElementById('wizard2Back').addEventListener('click', () => showView('viewWizard1'));
  document.getElementById('wizard2Next').addEventListener('click', handleWizard2Next);
  document.getElementById('wizard3Done').addEventListener('click', handleWizard3Done);

  // Birthday auto-age
  document.getElementById('birthday').addEventListener('change', (e) => {
    const age = calculateAge(e.target.value);
    document.getElementById('ageDisplay').textContent = age > 0 ? `Age: ${age}` : '';
  });

  // Upload inputs for wizard step 2 — plain visible file inputs
  [['bodyFileInput0','body',0],['bodyFileInput1','body',1],['bodyFileInput2','body',2],
   ['faceFileInput0','face',0],['faceFileInput1','face',1]].forEach(([id, cat, idx]) => {
    const input = document.getElementById(id);
    console.log(`[init] Setting up ${id}: found=${!!input}`);
    if (input) input.addEventListener('change', (e) => {
      console.log(`[init] change event on ${id}, files: ${e.target.files.length}`);
      if (e.target.files.length > 0) handleMultiPhotoUpload(cat, idx, e.target.files[0]);
    });
  });

  // Smart Search / Outfit Builder / Voice Agent tab switching
  document.querySelectorAll('.search-mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.search-mode-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.dataset.mode;
      document.getElementById('panelSmartSearch').classList.toggle('hidden', mode !== 'single');
      document.getElementById('panelOutfitBuilder').classList.toggle('hidden', mode !== 'outfit');
      document.getElementById('panelCosmetics').classList.toggle('hidden', mode !== 'cosmetics');
      document.getElementById('panelVoiceAgent').classList.toggle('hidden', mode !== 'voice');
    });
  });

  // Stella Voice Agent — inline in side panel
  initStella();

  // Cosmetics / Beauty Try-On
  initCosmetics();

  document.getElementById('smartSearchBtn').addEventListener('click', handleSmartSearch);
  document.getElementById('smartSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSmartSearch();
  });

  // Outfit Builder — open Virtual Wardrobe in a new tab
  document.getElementById('outfitBuildBtn').addEventListener('click', () => {
    const top = document.getElementById('outfitTop').value.trim();
    const bottom = document.getElementById('outfitBottom').value.trim();
    const shoes = document.getElementById('outfitShoes').value.trim();
    const necklace = document.getElementById('outfitNecklace').value.trim();
    const earrings = document.getElementById('outfitEarrings').value.trim();
    const bracelets = document.getElementById('outfitBracelets').value.trim();
    const errorEl = document.getElementById('outfitBuildError');
    errorEl.textContent = '';
    if (!top && !bottom) {
      errorEl.textContent = 'Please describe at least a top or bottom';
      return;
    }
    const outfitParams = new URLSearchParams();
    if (top) outfitParams.set('top', top);
    if (bottom) outfitParams.set('bottom', bottom);
    if (shoes) outfitParams.set('shoes', shoes);
    if (necklace) outfitParams.set('necklace', necklace);
    if (earrings) outfitParams.set('earrings', earrings);
    if (bracelets) outfitParams.set('bracelets', bracelets);
    if (cachedProfile?.clothesSize) outfitParams.set('clothesSize', cachedProfile.clothesSize);
    if (cachedProfile?.shoesSize) outfitParams.set('shoesSize', cachedProfile.shoesSize);
    if (cachedProfile?.sex) outfitParams.set('sex', cachedProfile.sex);
    const url = chrome.runtime.getURL('outfit-builder/wardrobe.html') + '?' + outfitParams.toString();
    chrome.tabs.create({ url });
  });

  // Edit profile
  document.getElementById('editProfileBtn').addEventListener('click', showEditProfile);
  document.getElementById('editProfileBack').addEventListener('click', () => loadProfileAndRoute());
  document.getElementById('editSaveInfoBtn').addEventListener('click', handleEditSaveInfo);
  document.getElementById('editRegenAiBtn').addEventListener('click', handleEditRegenAiPhotos);
  // Edit profile birthday auto-age
  document.getElementById('editBirthday').addEventListener('change', (e) => {
    const age = calculateAge(e.target.value);
    document.getElementById('editAgeDisplay').textContent = age > 0 ? `Age: ${age}` : '';
  });

  // Edit profile — 5-photo grid "Change" buttons + shared file input
  document.querySelectorAll('.edit-original-change-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      editOriginalReplaceIndex = parseInt(btn.dataset.index, 10);
      document.getElementById('editOriginalFileInput').click();
    });
  });
  document.getElementById('editOriginalFileInput').addEventListener('change', (e) => {
    if (e.target.files.length > 0 && editOriginalReplaceIndex !== null) {
      handleEditOriginalReplace(e.target.files[0], editOriginalReplaceIndex);
      e.target.value = '';
    }
  });

  // Image lightbox — click any profile photo to view full size
  const lightbox = document.getElementById('imageLightbox');
  document.querySelectorAll('.clickable-img').forEach((img) => {
    img.addEventListener('click', () => {
      if (!img.src || img.hidden) return;
      document.getElementById('lightboxImg').src = img.src;
      lightbox.classList.add('active');
    });
  });
  document.getElementById('lightboxClose').addEventListener('click', () => {
    lightbox.classList.remove('active');
  });
  lightbox.addEventListener('click', (e) => {
    if (e.target.classList.contains('lightbox-backdrop')) {
      lightbox.classList.remove('active');
    }
  });

  // Pose & Framing controls
  setupPoseAndFramingControls();

  // Favorites click → show favorites view
  document.getElementById('profileFavorites').addEventListener('click', showFavoritesView);
  document.getElementById('favBackBtn').addEventListener('click', () => loadProfileAndRoute());

  // Videos click → show videos view
  document.getElementById('profileVideos').addEventListener('click', showVideosView);
  document.getElementById('videosBackBtn').addEventListener('click', () => loadProfileAndRoute());

  // Backend URL
  const saveUrlBtn = document.getElementById('saveUrlBtn');
  if (saveUrlBtn) saveUrlBtn.addEventListener('click', saveBackendUrl);

  // Load backend URL
  const stored = await chrome.storage.local.get(['backendUrl']);
  const urlInput = document.getElementById('backendUrlInput');
  if (urlInput) urlInput.value = stored.backendUrl || DEFAULT_BACKEND_URL;

  // Check if opened as tab with a specific step (e.g. ?step=wizard2)
  const urlParams = new URLSearchParams(window.location.search);
  const forceStep = urlParams.get('step');

  // Check auth state
  const authData = await chrome.storage.local.get(['authTokens']);
  if (authData.authTokens && authData.authTokens.idToken) {
    // Check if token is expired
    if (authData.authTokens.expiresAt && authData.authTokens.expiresAt > Date.now()) {
      if (forceStep) {
        // forceStep is like "wizard2" → viewId is "viewWizard2"
        showView('view' + forceStep[0].toUpperCase() + forceStep.slice(1));
      } else {
        await loadProfileAndRoute();
      }
    } else if (authData.authTokens.refreshToken) {
      // Try refresh — with retry on transient failure
      let refreshed = false;
      for (let attempt = 0; attempt < 2 && !refreshed; attempt++) {
        try {
          const newTokens = await sendMsg({
            type: 'API_CALL', endpoint: '/api/auth/refresh', method: 'POST',
            data: { refreshToken: authData.authTokens.refreshToken }
          });
          await chrome.storage.local.set({
            authTokens: {
              ...authData.authTokens,
              idToken: newTokens.idToken,
              accessToken: newTokens.accessToken,
              expiresAt: Date.now() + (newTokens.expiresIn * 1000),
            }
          });
          refreshed = true;
        } catch (e) {
          console.warn(`[popup] Token refresh attempt ${attempt + 1} failed:`, e);
          if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (refreshed) {
        if (forceStep) {
          showView('view' + forceStep[0].toUpperCase() + forceStep.slice(1));
        } else {
          await loadProfileAndRoute();
        }
      } else {
        // Refresh failed but we still have tokens — try loading profile anyway
        // (the background.js will handle refresh on actual API calls)
        console.warn('[popup] Token refresh failed, attempting to load profile with existing tokens');
        try {
          await loadProfileAndRoute();
        } catch (_) {
          showView('viewSignIn');
        }
      }
    } else {
      showView('viewSignIn');
    }
  } else {
    showView('viewSignIn');
  }

  checkBackendHealth();
}

document.addEventListener('DOMContentLoaded', init);

// ==========================================================================
// Cosmetics / Beauty Try-On
// ==========================================================================
function initCosmetics() {
  let selectedFaceIndex = 0;
  const faceSelector = document.getElementById('cosmeticFaceSelector');
  if (!faceSelector) return;

  // Load face photos from profile
  (async () => {
    try {
      const allPhotos = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'API_CALL', endpoint: '/api/profile/photos/all', method: 'GET', data: {}
        }, (resp) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (resp && resp.error) return reject(new Error(resp.error));
          resolve(resp?.data || resp);
        });
      });

      // Face photos are at indices 3 and 4 of originals
      const facePhotos = (allPhotos.originals || []).slice(3, 5).filter(Boolean);
      if (facePhotos.length === 0) {
        faceSelector.innerHTML = '<p class="cosmetics-face-loading">No face photos uploaded yet. Go to profile to add them.</p>';
        return;
      }

      // Load stored face index preference
      const stored = await chrome.storage.local.get(['selectedFaceIndex']);
      const storedIdx = stored.selectedFaceIndex || 0;
      selectedFaceIndex = Math.min(storedIdx, facePhotos.length - 1);

      faceSelector.innerHTML = '';
      facePhotos.forEach((photo, i) => {
        const img = document.createElement('img');
        img.className = 'cosmetics-face-thumb' + (i === selectedFaceIndex ? ' selected' : '');
        img.src = `data:image/jpeg;base64,${photo}`;
        img.title = `Face photo ${i + 1}`;
        img.addEventListener('click', () => {
          faceSelector.querySelectorAll('.cosmetics-face-thumb').forEach(t => t.classList.remove('selected'));
          img.classList.add('selected');
          selectedFaceIndex = i;
          chrome.storage.local.set({ selectedFaceIndex: i });
        });
        faceSelector.appendChild(img);
      });
    } catch (err) {
      console.error('[Cosmetics] Failed to load face photos:', err);
      faceSelector.innerHTML = '<p class="cosmetics-face-loading">Could not load face photos</p>';
    }
  })();
}

// ==========================================================================
// Stella — Inline Voice Agent (Nova 2 Sonic)
// ==========================================================================
function initStella() {
  const BACKEND_URL = DEFAULT_BACKEND_URL;
  const INPUT_SAMPLE_RATE = 16000;
  const OUTPUT_SAMPLE_RATE = 24000;
  const CHUNK_SIZE = 512;

  let socket = null;
  let mediaStream = null;
  let audioContext = null;
  let processorNode = null;
  let sourceNode = null;
  let playbackCtx = null;
  let playbackQueue = [];
  let isPlaying = false;
  let isSessionActive = false;
  let currentPlaybackSource = null;

  const micBtn = document.getElementById('stellaMicBtn');
  const stopBtn = document.getElementById('stellaStopBtn');
  const voiceSelect = document.getElementById('stellaVoice');
  const statusBadge = document.getElementById('stellaStatus');
  const stateLabel = document.getElementById('stellaState');
  const orb = document.getElementById('stellaAvatar');
  const transcript = document.getElementById('stellaTranscript');
  const toolBar = document.getElementById('stellaToolBar');
  const toolText = document.getElementById('stellaToolText');

  function setStatus(cls, text) {
    statusBadge.className = 'stella-status' + (cls ? ' ' + cls : '');
    statusBadge.textContent = text;
  }

  function setOrbState(state) {
    orb.className = 'stella-avatar' + (state ? ' ' + state : '');
  }

  function appendTranscript(role, text) {
    if (!text || !text.trim()) return;
    const placeholder = transcript.querySelector('.stella-placeholder');
    if (placeholder) placeholder.remove();
    const msg = document.createElement('div');
    msg.className = 'stella-msg ' + role;
    msg.textContent = text;
    transcript.appendChild(msg);
    transcript.scrollTop = transcript.scrollHeight;
  }

  // Socket.IO connection
  function connectSocket() {
    if (typeof io === 'undefined') {
      setStatus('error', 'Error');
      stateLabel.textContent = 'Socket.IO not loaded';
      return;
    }
    socket = io(BACKEND_URL + '/voice', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('[Stella] Connected:', socket.id);
      setStatus('connected', 'Connected');
      stateLabel.textContent = 'Tap mic to talk';
    });

    socket.on('disconnect', () => {
      console.log('[Stella] Disconnected');
      setStatus('', 'Offline');
      endSession();
    });

    socket.on('audioOutput', (base64Audio) => {
      queueAudioForPlayback(base64Audio);
      setOrbState('speaking');
    });

    socket.on('textOutput', (data) => {
      if (data.role === 'ASSISTANT' || data.role === 'assistant') {
        appendTranscript('assistant', data.text);
      } else if (data.role === 'USER' || data.role === 'user') {
        // User started speaking — barge-in: flush Stella's audio
        flushPlayback();
        appendTranscript('user', data.text);
      }
    });

    socket.on('toolStart', (data) => {
      toolBar.hidden = false;
      toolText.textContent = 'Running: ' + data.toolName + '...';
      setOrbState('thinking');
    });

    socket.on('toolEnd', () => { toolBar.hidden = true; });

    socket.on('toolAction', (data) => {
      console.log('[Stella] Tool action:', data);
      handleToolAction(data);
    });

    socket.on('error', (data) => {
      console.error('[Stella] Error:', data.message);
      const isTimeout = data.message && data.message.toLowerCase().includes('timed out');
      if (isTimeout && isSessionActive) {
        appendTranscript('system', 'Connection hiccup — reconnecting...');
        setStatus('', 'Reconnecting...');
        // Auto-restart session after a brief delay
        setTimeout(async () => {
          try {
            isSessionActive = false;
            if (socket && socket.connected) socket.emit('endSession');
            await startSession();
            appendTranscript('system', 'Stella is back and listening!');
          } catch (err) {
            console.error('[Stella] Auto-restart failed:', err);
            appendTranscript('system', 'Reconnect failed: ' + err.message);
            setStatus('error', 'Error');
          }
        }, 1500);
      } else {
        appendTranscript('system', 'Error: ' + data.message);
        setStatus('error', 'Error');
      }
    });
  }

  // Forward search/outfit results from extension tabs to voice socket
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'SEARCH_RESULTS_LOADED' && socket && socket.connected) {
      socket.emit('searchResultsLoaded', { products: msg.products });
      console.log('[Stella] Forwarded search results to voice session:', msg.products?.length);
    }
    if (msg.type === 'OUTFIT_RESULTS_LOADED' && socket && socket.connected) {
      socket.emit('outfitResultsLoaded', { tops: msg.tops, bottoms: msg.bottoms, shoes: msg.shoes });
      console.log('[Stella] Forwarded outfit results to voice session');
    }
  });

  // Audio capture
  async function startAudioCapture() {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: INPUT_SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    audioContext = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(CHUNK_SIZE, 1, 1);

    processorNode.onaudioprocess = (e) => {
      if (!isSessionActive || !socket) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const bytes = new Uint8Array(int16.buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      socket.emit('audioInput', btoa(binary));
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);
  }

  function stopAudioCapture() {
    if (processorNode) { processorNode.disconnect(); processorNode = null; }
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
    if (audioContext) { audioContext.close(); audioContext = null; }
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  }

  // Audio playback
  function queueAudioForPlayback(base64Audio) {
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
    playbackQueue.push(float32);
    if (!isPlaying) playNextChunk();
  }

  function flushPlayback() {
    playbackQueue = [];
    if (currentPlaybackSource) {
      try { currentPlaybackSource.stop(); } catch (_) {}
      currentPlaybackSource = null;
    }
    isPlaying = false;
    if (isSessionActive) { setOrbState('listening'); setStatus('listening', 'Listening...'); }
  }

  function playNextChunk() {
    if (playbackQueue.length === 0) {
      isPlaying = false;
      currentPlaybackSource = null;
      if (isSessionActive) { setOrbState('listening'); setStatus('listening', 'Listening...'); }
      return;
    }
    isPlaying = true;
    if (!playbackCtx) playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    const samples = playbackQueue.shift();
    const buffer = playbackCtx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);
    const source = playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(playbackCtx.destination);
    source.onended = () => { currentPlaybackSource = null; playNextChunk(); };
    currentPlaybackSource = source;
    source.start();
  }

  // Session management
  async function startSession() {
    if (isSessionActive) return;
    try {
      setStatus('', 'Connecting...');
      stateLabel.textContent = 'Connecting to Stella...';
      if (!socket || !socket.connected) connectSocket();
      // Wait for connection
      if (!socket.connected) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
          socket.once('connect', () => { clearTimeout(timeout); resolve(); });
        });
      }
      await startAudioCapture();
      const voiceId = voiceSelect.value;
      // Language priority: DynamoDB profile (via cachedProfile) > chrome.storage fallback > English
      const langStorage = await new Promise(r => chrome.storage.local.get(['stellaLanguage'], r));
      const userLang = (cachedProfile && cachedProfile.language) || langStorage.stellaLanguage || 'en';
      // Get auth token for userId extraction
      const authStorage = await new Promise(r => chrome.storage.local.get(['authTokens'], r));
      const authToken = authStorage?.authTokens?.idToken || null;
      await new Promise((resolve, reject) => {
        socket.emit('startSession', {
        voiceId,
        language: userLang,
        authToken,
        sex: cachedProfile?.sex || null,
        clothesSize: cachedProfile?.clothesSize || null,
        shoesSize: cachedProfile?.shoesSize || null,
      }, (response) => {
          if (response.status === 'ok') resolve();
          else reject(new Error(response.message || 'Failed to start session'));
        });
      });
      isSessionActive = true;
      micBtn.classList.add('active');
      micBtn.hidden = true;
      stopBtn.hidden = false;
      voiceSelect.disabled = true;
      setOrbState('listening');
      setStatus('listening', 'Listening...');
      stateLabel.textContent = 'Speak naturally';
      transcript.innerHTML = '';
      appendTranscript('system', 'Stella is listening...');
    } catch (err) {
      console.error('[Stella] Failed to start:', err);
      setStatus('error', 'Error');
      stateLabel.textContent = err.message;
      stopAudioCapture();
    }
  }

  function endSession() {
    if (!isSessionActive) return;
    isSessionActive = false;
    stopAudioCapture();
    playbackQueue = [];
    isPlaying = false;
    if (playbackCtx) { playbackCtx.close(); playbackCtx = null; }
    if (socket && socket.connected) socket.emit('endSession');
    micBtn.classList.remove('active');
    micBtn.hidden = false;
    stopBtn.hidden = true;
    voiceSelect.disabled = false;
    setOrbState('');
    setStatus('connected', 'Connected');
    stateLabel.textContent = 'Tap mic to talk';
    toolBar.hidden = true;
    appendTranscript('system', 'Session ended.');
  }

  // Tool action handler
  function handleToolAction(data) {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      switch (data.action) {
        case 'smart_search':
          chrome.runtime.sendMessage({ type: 'VOICE_SMART_SEARCH', query: data.query });
          appendTranscript('system', 'Searching: "' + data.query + '"');
          break;
        case 'try_on':
          chrome.runtime.sendMessage({ type: 'VOICE_TRY_ON', productTitle: data.productTitle, productUrl: data.productUrl });
          appendTranscript('system', 'Try-on: "' + data.productTitle + '"');
          break;
        case 'build_outfit':
          chrome.runtime.sendMessage({ type: 'VOICE_BUILD_OUTFIT', top: data.top, bottom: data.bottom, shoes: data.shoes, necklace: data.necklace, earrings: data.earrings, bracelets: data.bracelets, sex: cachedProfile?.sex || null });
          appendTranscript('system', 'Building outfit...');
          break;
        case 'add_to_cart':
          chrome.runtime.sendMessage({ type: 'VOICE_ADD_TO_CART', productUrl: data.productUrl, productTitle: data.productTitle });
          appendTranscript('system', 'Adding to cart: ' + (data.productTitle || data.productUrl));
          break;
        case 'save_favorite':
          chrome.runtime.sendMessage({ type: 'VOICE_SAVE_FAVORITE' });
          appendTranscript('system', 'Saving to favorites...');
          break;
        case 'save_video':
          chrome.runtime.sendMessage({ type: 'VOICE_SAVE_VIDEO' });
          appendTranscript('system', 'Saving video...');
          break;
        case 'animate_tryon':
          chrome.runtime.sendMessage({ type: 'VOICE_ANIMATE' });
          appendTranscript('system', 'Generating animation...');
          break;
        case 'download':
          chrome.runtime.sendMessage({ type: 'VOICE_DOWNLOAD', downloadType: data.downloadType || 'image' });
          appendTranscript('system', 'Downloading ' + (data.downloadType || 'image') + '...');
          break;
        case 'send_tryon':
          chrome.runtime.sendMessage({ type: 'VOICE_SEND' });
          appendTranscript('system', 'Sharing try-on result...');
          break;
        case 'select_search_item':
          chrome.runtime.sendMessage({ type: 'VOICE_SELECT_SEARCH_ITEM', number: data.number });
          appendTranscript('system', 'Selecting item #' + data.number + ' for try-on...');
          break;
        case 'select_outfit_items':
          chrome.runtime.sendMessage({
            type: 'VOICE_SELECT_OUTFIT_ITEMS',
            topNumber: data.topNumber || null,
            bottomNumber: data.bottomNumber || null,
            shoesNumber: data.shoesNumber || null,
          });
          {
            const selParts = [];
            if (data.topNumber) selParts.push('top #' + data.topNumber);
            if (data.bottomNumber) selParts.push('bottom #' + data.bottomNumber);
            if (data.shoesNumber) selParts.push('shoes #' + data.shoesNumber);
            appendTranscript('system', 'Selecting ' + selParts.join(', ') + ' for try-on...');
          }
          break;
      }
    }
  }

  // Event listeners
  micBtn.addEventListener('click', startSession);
  stopBtn.addEventListener('click', endSession);

  // Auto-connect on load
  connectSocket();
}
