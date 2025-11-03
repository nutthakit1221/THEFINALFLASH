// Import Firebase modules we need
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore, doc, setDoc, getDoc } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyByVMFkmxcEHjp0RGc3EgY6j5T0wMRyU5g",
  authDomain: "profileready-ed820.firebaseapp.com",
  projectId: "profileready-ed820",
  storageBucket: "profileready-ed820.firebasestorage.app",
  messagingSenderId: "46330588294",
  appId: "1:46330588294:web:c5df05d8916897a9d4f507",
  measurementId: "G-QSB9LQFDVD"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Use this variable to store the logged-in user's data
let currentUser = null;

// Display a toast message instead of alert()
function showToast(message, type = 'success') {
  const host = document.querySelector('.toast-host');
  if (!host) {
    alert(message);
    return;
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('show'), 100);
  setTimeout(() => el.classList.remove('show'), 3000);
  setTimeout(() => el.remove(), 3500);
}

// Authentication listeners to update UI
onAuthStateChanged(auth, (user) => {
    currentUser = user;
    const loginLink = document.querySelector('.btn-nav');
    if (user) {
        loginLink.textContent = 'Logout';
        loginLink.href = '#';
        loginLink.onclick = async (e) => {
            e.preventDefault();
            try {
                await signOut(auth);
                showToast('Logged out successfully');
                setTimeout(() => location.href = 'index.html', 1000);
            } catch (err) {
                showToast('Logout failed', 'error');
            }
        };
    } else {
        loginLink.textContent = 'Login';
        loginLink.href = 'login.html';
        loginLink.onclick = null;
    }
    // Now that auth state is known, we can run page-specific logic
    runPageInit();
});

// Code for login and register pages
export function initAuthPages() {
  const form = document.querySelector('.login-form');
  const title = document.querySelector('.login-box h2')?.textContent?.toLowerCase() || '';
  if (!form) return;

  // Login
  if (title.includes('log in')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Login successful!');
        location.href = 'upload.html';
      } catch (err) {
        showToast('Login failed: ' + err.message, 'error');
      }
    });
  }

  // Register
  if (title.includes('create your account')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      if (password !== confirm) return showToast('Passwords do not match.', 'error');
      try {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast('Registration successful! Please log in.', 'success');
        location.href = 'login.html';
      } catch (err) {
        showToast('Registration failed: ' + err.message, 'error');
      }
    });
  }
}

// Code for upload page
export function initUploadPage() {
  const nextBtn = document.getElementById('nextBtn');
  const fileInput = document.getElementById('fileInput');

  if (!nextBtn || !fileInput) return;

  nextBtn.addEventListener('click', async () => {
    try {
      if (!fileInput.files.length) {
        return showToast('Please select a file first.', 'error');
      }
      const file = fileInput.files[0];
      const formData = new FormData();
      formData.append('photo', file);

      // Upload file to the backend
      const response = await fetch('/api/image/process', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || response.statusText);
      }

      const { preview, fileBase } = await response.json();

      // Save fileBase to Firestore instead of localStorage
      if (currentUser) {
          const userDoc = doc(db, "users", currentUser.uid);
          await setDoc(userDoc, { photoBase: fileBase, previewUrl: preview }, { merge: true });
      }

      location.href = 'setting.html';
    } catch (err) {
      showToast('Upload failed: ' + err.message, 'error');
    }
  });
}

// Code for setting page
export function initSettingsPage() {
    const photoPreview = document.getElementById('photoPreview');
    const doneBtn = document.querySelector('.settings-box .btn-primary');
    const sizeSelect = document.getElementById('size');
    const bgcolorSelect = document.getElementById('bgcolor');
    const uniformSelect = document.getElementById('uniform');
    // Additional controls for editing
    const uniformControls = document.querySelector('.uniform-controls');
    // Sliders for independent scaling along X and Y axes
    const scaleXSlider = document.getElementById('uniformScaleX');
    const scaleYSlider = document.getElementById('uniformScaleY');
    const offsetXSlider = document.getElementById('uniformOffsetX');
    const offsetYSlider = document.getElementById('uniformOffsetY');
    const brightnessSlider = document.getElementById('brightnessRange');
    const contrastSlider = document.getElementById('contrastRange');
    const undoBtn = document.getElementById('undoBtn');
    const redoBtn = document.getElementById('redoBtn');

    // Numeric inputs for precise adjustment
    const scaleXNumber = document.getElementById('uniformScaleXNumber');
    const scaleYNumber = document.getElementById('uniformScaleYNumber');
    const offsetXNumber = document.getElementById('uniformOffsetXNumber');
    const offsetYNumber = document.getElementById('uniformOffsetYNumber');
    const brightnessNumber = document.getElementById('brightnessNumber');
    const contrastNumber = document.getElementById('contrastNumber');

    // Set up uniform thumbnail click handlers. Each thumbnail has a data-uniform
    // attribute that maps to the uniform code. When clicked, we update the
    // hidden select, set the overlay image source, reveal the uniform controls
    // and reset scale/offset sliders. We also highlight the selected
    // thumbnail for visual feedback.
    const uniformThumbnails = document.querySelectorAll('.uniform-selection img');
    uniformThumbnails.forEach((thumb) => {
        thumb.addEventListener('click', () => {
            const code = thumb.dataset.uniform;
            if (uniformSelect) {
                uniformSelect.value = code;
            }
            // Map uniform codes to filenames (must mirror server-side map)
            const fileMap = {
                'womensuit': 'womensuit.png',
                'mansuit': 'mansuit.png',
                'boys-school-uniform': "boy's-school-uniform.png",
                'girls-school-uniform': "girl's-school-uniform.png",
                'mens-university-uniform': "men's-university-uniform.png",
                'womens-university-uniform': "women's-university-uniform.png"
            };
            const overlay = document.getElementById('uniformOverlay');
            if (overlay && fileMap[code]) {
                overlay.src = `images/uniforms/${fileMap[code]}`;
                overlay.style.width = '100%';
            }
            // Show the uniform controls when a uniform is chosen
            if (uniformControls) {
                uniformControls.classList.remove('hidden');
            }
            // Highlight the selected thumbnail
            uniformThumbnails.forEach(t => t.classList.remove('selected'));
            thumb.classList.add('selected');
            // Reset scale and offset to defaults upon new selection
            if (scaleXSlider) {
                scaleXSlider.value = '100';
                if (scaleXNumber) scaleXNumber.value = '100';
            }
            if (scaleYSlider) {
                scaleYSlider.value = '100';
                if (scaleYNumber) scaleYNumber.value = '100';
            }
            if (offsetXSlider) {
                offsetXSlider.value = '0';
                if (offsetXNumber) offsetXNumber.value = '0';
            }
            if (offsetYSlider) {
                offsetYSlider.value = '0';
                if (offsetYNumber) offsetYNumber.value = '0';
            }
            updateUniformTransform();
            saveHistory();
        });
    });

    if (!photoPreview || !doneBtn || !currentUser) return;

    // Reference to the user document in Firestore
    const userDoc = doc(db, "users", currentUser.uid);

    // History stack for undo/redo functionality
    let history = [];
    let redoStack = [];
    // Cropper instance (initialized when the image loads)
    let cropper;

    // Save the current state of editing controls and cropper into history
    function saveHistory() {
        const state = {
            // Save independent scale values for X and Y axes. Default to 100 if missing
            scaleX: scaleXSlider?.value || '100',
            scaleY: scaleYSlider?.value || '100',
            offsetX: offsetXSlider?.value || '0',
            offsetY: offsetYSlider?.value || '0',
            brightness: brightnessSlider?.value || '100',
            contrast: contrastSlider?.value || '100',
            cropData: cropper ? cropper.getData(true) : null
        };
        history.push(state);
        // Reset redo stack whenever a new action is saved
        redoStack.length = 0;
    }

    // Apply a saved state back to the controls and preview
    function applyState(state) {
        if (!state) return;
        // Restore independent scale controls if present
        if (scaleXSlider && typeof state.scaleX !== 'undefined') {
            scaleXSlider.value = state.scaleX;
            if (scaleXNumber) scaleXNumber.value = state.scaleX;
        }
        if (scaleYSlider && typeof state.scaleY !== 'undefined') {
            scaleYSlider.value = state.scaleY;
            if (scaleYNumber) scaleYNumber.value = state.scaleY;
        }
        if (offsetXSlider) offsetXSlider.value = state.offsetX;
        if (offsetYSlider) offsetYSlider.value = state.offsetY;
        if (brightnessSlider) brightnessSlider.value = state.brightness;
        if (contrastSlider) contrastSlider.value = state.contrast;
        updateFilters();
        updateUniformTransform();
        if (cropper && state.cropData) {
            cropper.setData(state.cropData);
        }
    }

    // Update brightness and contrast CSS filters on the photo and overlay
    function updateFilters() {
        const bVal = parseFloat(brightnessSlider?.value || '100') / 100;
        const cVal = parseFloat(contrastSlider?.value || '100') / 100;
        const filter = `brightness(${bVal}) contrast(${cVal})`;
        if (photoPreview) photoPreview.style.filter = filter;
        const uniformOverlay = document.getElementById('uniformOverlay');
        if (uniformOverlay) uniformOverlay.style.filter = filter;
    }

    // Update the uniform overlay transform based on scale and offset sliders
    function updateUniformTransform() {
        const sXVal = parseFloat(scaleXSlider?.value || '100') / 100;
        const sYVal = parseFloat(scaleYSlider?.value || '100') / 100;
        const xVal = parseFloat(offsetXSlider?.value || '0');
        const yVal = parseFloat(offsetYSlider?.value || '0');
        const uniformOverlay = document.getElementById('uniformOverlay');
        if (!uniformOverlay) return;
        // Use scale(x,y) to allow independent scaling along x and y axes
        uniformOverlay.style.transform = `translate(-50%, 0) translate(${xVal}%, ${yVal}%) scale(${sXVal}, ${sYVal})`;
    }

    // Undo and redo functions
    function undo() {
        if (history.length > 1) {
            const current = history.pop();
            redoStack.push(current);
            const prev = history[history.length - 1];
            applyState(prev);
        }
    }
    function redo() {
        if (redoStack.length > 0) {
            const state = redoStack.pop();
            history.push(state);
            applyState(state);
        }
    }

    // Attach undo/redo handlers
    undoBtn?.addEventListener('click', undo);
    redoBtn?.addEventListener('click', redo);

    // Attach input handlers to sliders and sync with numeric inputs
    // Attach input handlers for scaleX and scaleY sliders and sync with numeric inputs
    scaleXSlider?.addEventListener('input', () => {
        if (scaleXNumber) scaleXNumber.value = scaleXSlider.value;
        updateUniformTransform();
        saveHistory();
    });
    scaleYSlider?.addEventListener('input', () => {
        if (scaleYNumber) scaleYNumber.value = scaleYSlider.value;
        updateUniformTransform();
        saveHistory();
    });
    offsetXSlider?.addEventListener('input', () => {
        if (offsetXNumber) offsetXNumber.value = offsetXSlider.value;
        updateUniformTransform();
        saveHistory();
    });
    offsetYSlider?.addEventListener('input', () => {
        if (offsetYNumber) offsetYNumber.value = offsetYSlider.value;
        updateUniformTransform();
        saveHistory();
    });
    brightnessSlider?.addEventListener('input', () => {
        if (brightnessNumber) brightnessNumber.value = brightnessSlider.value;
        updateFilters();
        saveHistory();
    });
    contrastSlider?.addEventListener('input', () => {
        if (contrastNumber) contrastNumber.value = contrastSlider.value;
        updateFilters();
        saveHistory();
    });

    // Attach input handlers to numeric inputs to sync back to sliders
    scaleXNumber?.addEventListener('input', () => {
        if (scaleXSlider) scaleXSlider.value = scaleXNumber.value;
        updateUniformTransform();
        saveHistory();
    });
    scaleYNumber?.addEventListener('input', () => {
        if (scaleYSlider) scaleYSlider.value = scaleYNumber.value;
        updateUniformTransform();
        saveHistory();
    });
    offsetXNumber?.addEventListener('input', () => {
        if (offsetXSlider) offsetXSlider.value = offsetXNumber.value;
        updateUniformTransform();
        saveHistory();
    });
    offsetYNumber?.addEventListener('input', () => {
        if (offsetYSlider) offsetYSlider.value = offsetYNumber.value;
        updateUniformTransform();
        saveHistory();
    });
    brightnessNumber?.addEventListener('input', () => {
        if (brightnessSlider) brightnessSlider.value = brightnessNumber.value;
        updateFilters();
        saveHistory();
    });
    contrastNumber?.addEventListener('input', () => {
        if (contrastSlider) contrastSlider.value = contrastNumber.value;
        updateFilters();
        saveHistory();
    });

    // Retrieve the previously uploaded photo and any stored settings
    getDoc(userDoc).then(docSnap => {
        if (docSnap.exists() && docSnap.data().previewUrl) {
            photoPreview.src = docSnap.data().previewUrl;
            photoPreview.style.display = 'block';
            // If a uniform was previously selected, load its overlay
            const selectedUniform = docSnap.data().uniform;
            if (selectedUniform) {
                const fileMap = {
                    'womensuit': 'womensuit.png',
                    'mansuit': 'mansuit.png',
                    'boys-school-uniform': "boy's-school-uniform.png",
                    'girls-school-uniform': "girl's-school-uniform.png",
                    'mens-university-uniform': "men's-university-uniform.png",
                    'womens-university-uniform': "women's-university-uniform.png"
                };
                const overlay = document.getElementById('uniformOverlay');
                if (overlay && fileMap[selectedUniform]) {
                    overlay.src = `images/uniforms/${fileMap[selectedUniform]}`;
                    overlay.style.width = '100%';
                    // Show uniform controls since a uniform is selected
                    uniformControls?.classList.remove('hidden');
                }
            }
        } else {
            showToast('No file uploaded yet. Please upload a photo.', 'error');
            location.href = 'upload.html';
        }
    });

    // Initialize Cropper.js once the image has loaded
    photoPreview.addEventListener('load', () => {
        if (typeof Cropper === 'undefined') {
            console.error('Cropper.js failed to load');
            return;
        }
        cropper = new Cropper(photoPreview, {
            viewMode: 2,
            autoCropArea: 1,
            responsive: true,
            ready() {
                // Save initial state including the default crop box
                saveHistory();
            }
        });
        // Apply initial filters and transform
        updateFilters();
        updateUniformTransform();
    });

    doneBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const docSnap = await getDoc(userDoc);
        const fileBase = docSnap.exists() ? docSnap.data().photoBase : null;
        if (!fileBase) {
             return showToast('No photo to render.', 'error');
        }

        // Build request body with basic parameters
        const body = {
            fileBase: fileBase,
            size: sizeSelect.value,
            bgcolor: bgcolorSelect.value,
            uniform: uniformSelect.value
        };
        // Include uniform adjustments if a uniform is selected
        if (uniformSelect.value) {
            // Include independent scaling values for X and Y axes
            if (scaleXSlider) body.uniformScaleX = scaleXSlider.value;
            if (scaleYSlider) body.uniformScaleY = scaleYSlider.value;
            if (offsetXSlider) body.uniformOffsetX = offsetXSlider.value;
            if (offsetYSlider) body.uniformOffsetY = offsetYSlider.value;
        }
        // Include brightness and contrast adjustments
        if (brightnessSlider) body.brightness = brightnessSlider.value;
        if (contrastSlider) body.contrast = contrastSlider.value;
        // Include cropping geometry as percentages
        if (cropper) {
            const data = cropper.getData(true);
            if (data && photoPreview.naturalWidth && photoPreview.naturalHeight) {
                const xPct = (data.x / photoPreview.naturalWidth) * 100;
                const yPct = (data.y / photoPreview.naturalHeight) * 100;
                const wPct = (data.width / photoPreview.naturalWidth) * 100;
                const hPct = (data.height / photoPreview.naturalHeight) * 100;
                body.cropX = xPct;
                body.cropY = yPct;
                body.cropW = wPct;
                body.cropH = hPct;
            }
        }

        try {
            const r = await fetch('/api/image/render', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!r.ok) throw new Error((await r.json()).error || r.statusText);
            const { preview, fileBase: newFileBase } = await r.json();

            // Save new settings to Firestore
            await setDoc(userDoc, {
                photoBase: newFileBase,
                previewUrl: preview,
                size: sizeSelect.value,
                bgcolor: bgcolorSelect.value,
                uniform: uniformSelect.value
            }, { merge: true });

            location.href = 'result.html';
        } catch (err) {
            showToast('Render failed: ' + err.message, 'error');
        }
    });
}

// Code for result page
export function initResultPage() {
  const img = document.querySelector('.result-image img');
  if (!img || !currentUser) return;

  const userDoc = doc(db, "users", currentUser.uid);
  getDoc(userDoc).then(docSnap => {
      if (docSnap.exists() && docSnap.data().previewUrl) {
          img.src = docSnap.data().previewUrl;
      } else {
          showToast('No result yet. Please go to setting page.', 'error');
          location.href = 'setting.html';
      }
  });
}

// Code for download page
export function initDownloadPage() {
    if (!currentUser) return;
    const userDoc = doc(db, "users", currentUser.uid);
    getDoc(userDoc).then(docSnap => {
        const fileBase = docSnap.exists() ? docSnap.data().photoBase : null;
        if (!fileBase) {
            showToast('No file to download. Please generate one first.', 'error');
            return location.href = 'result.html';
        }

        document.querySelectorAll('[data-dl]').forEach(a => {
            a.addEventListener('click', (e) => {
                e.preventDefault();
                const fmt = a.dataset.dl;
                const url = `/api/image/download?filename=${fileBase}&format=${fmt}`;
                window.open(url, '_blank');
            });
        });
    });
}

// Run the correct function based on the current page
function runPageInit() {
    const pageName = window.location.pathname.split('/').pop().split('.')[0];
    switch (pageName) {
        case 'login':
        case 'register':
            initAuthPages();
            break;
        case 'upload':
            initUploadPage();
            break;
        case 'setting':
            initSettingsPage();
            break;
        case 'result':
            initResultPage();
            break;
        case 'download':
            initDownloadPage();
            break;
    }
}
