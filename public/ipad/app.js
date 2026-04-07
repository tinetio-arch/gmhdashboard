// VERSION: 2026-03-19-09:35 - Patient tab spinner fix v3 + diagnostic logging
/* ============================================================
   GMH Ops v2.0 — iPad Companion App (LIVE DATA)
   Connects to /ops/api/* endpoints via same-origin cookies
   VERSION: 2.4.0 - March 18, 2026
   NEW: Patient timeout fix, CEO tab restrictions, print labels, split-vial dispensing
   ============================================================ */

// Log version immediately so we can verify correct file is loaded
console.log('%c📱 iPad App v2.4.0 Loaded', 'background: #22d3ee; color: #000; padding: 4px 8px; border-radius: 4px; font-weight: bold');
console.log('✅ v2.4.0: Timeout fixes, CEO restrictions, print labels, split-vial dispense');
console.log('🕒 Build time: March 18, 2026');

// Show version in page (will be visible in bottom corner)
window.addEventListener('DOMContentLoaded', () => {
    document.body.insertAdjacentHTML('beforeend', `
        <div style="
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.7);
            color: #22d3ee;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 10px;
            font-family: monospace;
            z-index: 9999;
            pointer-events: none;
        ">v2.4.0</div>
    `);
});

// ─── STATE ──────────────────────────────────────────────────
let dashboardData = null;       // from /ops/api/ipad/dashboard
let healthieAppointments = [];  // from /ops/api/cron/morning-prep
let inventorySummary = null;    // from /ops/api/inventory/intelligence/summary
let inventoryAlerts = [];       // from /ops/api/inventory/intelligence/alerts
let vialList = [];              // individual vials from /ops/api/inventory/vials
let labsQueue = [];             // from /ops/api/labs/review-queue
let patient360Cache = {};       // patient_id -> 360 data
let allPatients = [];            // from /ops/api/patients
let scribeSessions = [];         // from /ops/api/scribe/sessions
let activeScribeSession = null;  // currently selected session
let isRecording = false;
let isPaused = false;
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let audioAnalyser = null;
let audioContext = null;
let pausedDuration = 0;
let pauseStartTime = null;
let autoPausedBySystem = false;  // true when auto-paused by visibilitychange (phone call, app switch)
let scribeView = 'list';        // 'list' | 'new' | 'recording' | 'transcript' | 'note' | 'review'
let supplyItems = null;          // from /ops/api/inventory/supplies
let scheduleAllData = [];        // from /ops/api/ipad/schedule (all appointments)

// ─── CONSTANTS ──────────────────────────────────────────────
const CLINIC_TIMEZONE = 'America/Phoenix';
const WASTE_PER_SYRINGE = 0.1;  // mL waste per testosterone syringe

// ─── BACKGROUND TRANSCRIPTION POLLING SERVICE ───────────────
// Survives tab navigation, page visibility changes, and user actions
let activePolls = new Map(); // sessionId → { sessionId, attempts, maxAttempts, interval }

function startBackgroundTranscriptionPoll(sessionId) {
    if (activePolls.has(sessionId)) {
        console.log(`[Background Poll] Already polling session ${sessionId}`);
        return;
    }

    const pollInfo = {
        sessionId,
        attempts: 0,
        maxAttempts: 60,
        interval: null,
    };

    activePolls.set(sessionId, pollInfo);

    pollInfo.interval = setInterval(async () => {
        pollInfo.attempts++;

        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

            if (data?.success && data.data?.status === 'transcribed') {
                stopBackgroundPoll(sessionId);
                scribeLoaded = false;
                await loadScribeSessions();
                const patientName = data.data.patient_name || scribeSessions.find(s => s.session_id === sessionId)?.patient_name || 'patient';
                showToast(`✅ Transcription complete for ${patientName}`, 'success');
                updateBadges();
                if (currentTab === 'scribe') renderCurrentTab();
            } else if (data?.data?.status === 'error') {
                stopBackgroundPoll(sessionId);
                showToast(`❌ Transcription failed`, 'error');
                scribeLoaded = false;
                await loadScribeSessions();
                if (currentTab === 'scribe') renderCurrentTab();
            } else if (pollInfo.attempts >= pollInfo.maxAttempts) {
                stopBackgroundPoll(sessionId);
                showToast(`⏱ Transcription timed out - check back later`, 'warning');
            }
        } catch (err) {
            if (err.message === 'AUTH_EXPIRED') {
                stopBackgroundPoll(sessionId);
                throw err;
            }
            console.warn(`[Background Poll] Error for ${sessionId}:`, err);
        }
    }, 5000);

    console.log(`[Background Poll] Started for session ${sessionId}`);
}

function stopBackgroundPoll(sessionId) {
    const pollInfo = activePolls.get(sessionId);
    if (pollInfo?.interval) {
        clearInterval(pollInfo.interval);
        activePolls.delete(sessionId);
        console.log(`[Background Poll] Stopped for session ${sessionId}`);
    }
}

function stopAllBackgroundPolls() {
    for (const [sessionId] of activePolls) {
        stopBackgroundPoll(sessionId);
    }
}

async function checkForPendingTranscriptions() {
    try {
        const sessions = scribeSessions.filter(s => s.status === 'transcribing');
        if (sessions.length === 0) return;

        console.log(`[Scribe Recovery] Found ${sessions.length} sessions in 'transcribing' status`);

        for (const session of sessions) {
            const check = await apiFetch(`/ops/api/scribe/transcribe?session_id=${session.session_id}`);

            if (check?.success && check.data?.status === 'transcribed') {
                console.log(`[Scribe Recovery] ✅ Recovered completed transcription for ${session.patient_name}`);
                scribeLoaded = false;
                await loadScribeSessions();
                showToast(`✅ Recovered completed transcription for ${session.patient_name}`, 'success');
            } else if (check?.data?.status === 'transcribing') {
                console.log(`[Scribe Recovery] Session ${session.session_id} still processing - starting background poll`);
                startBackgroundTranscriptionPoll(session.session_id);
            }
        }
    } catch (err) {
        console.warn('[Scribe Recovery] Check failed:', err);
    }
}

// FIX(2026-04-07): Recover orphaned video scribe blobs that survived in IndexedDB
// after page close/crash during video calls
async function recoverVideoScribeBlobs() {
    try {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('gmh_scribe_backup', 1);
            req.onupgradeneeded = (e) => { e.target.result.createObjectStore('pending_audio', { keyPath: 'id' }); };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });

        const tx = db.transaction('pending_audio', 'readonly');
        const store = tx.objectStore('pending_audio');
        const allKeys = await new Promise((resolve, reject) => {
            const req = store.getAllKeys();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        if (allKeys.length === 0) return;
        console.log(`[Video Scribe Recovery] Found ${allKeys.length} orphaned audio blob(s) in IndexedDB`);

        for (const key of allKeys) {
            const record = await new Promise((resolve, reject) => {
                const rtx = db.transaction('pending_audio', 'readonly');
                const req = rtx.objectStore('pending_audio').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });

            if (!record || !record.blob) continue;

            // Skip if older than 24 hours (stale)
            if (record.timestamp && Date.now() - record.timestamp > 24 * 60 * 60 * 1000) {
                console.log(`[Video Scribe Recovery] Skipping stale blob: ${key} (${new Date(record.timestamp).toLocaleString()})`);
                const dtx = db.transaction('pending_audio', 'readwrite');
                dtx.objectStore('pending_audio').delete(key);
                continue;
            }

            console.log(`[Video Scribe Recovery] Uploading orphaned blob: ${key} for patient ${record.patient_name || record.patient_id}`);
            showToast(`Recovering lost video recording for ${record.patient_name || 'patient'}...`, 'info');

            try {
                const fd = new FormData();
                fd.append('audio', record.blob, key);
                fd.append('patient_id', record.patient_id || '');
                fd.append('visit_type', record.visit_type || 'telehealth');
                fd.append('patient_name', record.patient_name || '');
                fd.append('appointment_id', record.appointment_id || '');
                fd.append('encounter_date', new Date(record.timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }));

                const resp = await fetch('/ops/api/scribe/transcribe/', { method: 'POST', body: fd, credentials: 'include' });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.success) {
                        console.log(`[Video Scribe Recovery] ✅ Uploaded orphaned blob: ${key}`);
                        showToast(`✅ Recovered video recording for ${record.patient_name || 'patient'}!`, 'success');
                        // Clean up from IndexedDB
                        const dtx = db.transaction('pending_audio', 'readwrite');
                        dtx.objectStore('pending_audio').delete(key);
                        // Reload scribe sessions to show the new one
                        scribeLoaded = false;
                        await loadScribeSessions();
                    }
                } else {
                    console.error(`[Video Scribe Recovery] Upload failed for ${key}: HTTP ${resp.status}`);
                    showToast(`⚠️ Failed to recover recording for ${record.patient_name || 'patient'}`, 'error');
                }
            } catch (uploadErr) {
                console.error(`[Video Scribe Recovery] Upload error for ${key}:`, uploadErr);
            }
        }
    } catch (err) {
        // Non-fatal — IndexedDB might not exist yet
        if (err?.name !== 'NotFoundError') {
            console.warn('[Video Scribe Recovery] Check failed:', err);
        }
    }
}

async function retryTranscription(sessionId) {
    showToast('Checking transcription status...', 'info');
    try {
        const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

        if (data?.success && data.data?.status === 'transcribed') {
            showToast('✅ Transcription complete!', 'success');
            scribeLoaded = false;
            await loadScribeSessions();
            renderCurrentTab();
        } else if (data?.data?.status === 'transcribing') {
            showToast('Still processing... started background check', 'info');
            startBackgroundTranscriptionPoll(sessionId);
        } else if (data?.data?.status === 'error') {
            showToast('❌ Transcription failed: ' + (data.data.error || 'Unknown error'), 'error');
        } else {
            showToast('Status: ' + (data?.data?.status || 'unknown'), 'info');
        }
    } catch (err) {
        showToast('Status check failed: ' + err.message, 'error');
    }
}

// ─── RECORDING INTERRUPTION PROTECTION ──────────────────────
// Auto-pause recording when the page loses visibility (phone call, app switch, lock screen)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRecording && !isPaused && mediaRecorder && mediaRecorder.state === 'recording') {
        console.log('[Scribe] Page hidden — auto-pausing recording to prevent data loss');
        mediaRecorder.pause();
        isPaused = true;
        autoPausedBySystem = true;
        pauseStartTime = Date.now();
        // Timer keeps running so user sees elapsed time when they return
    }
    if (!document.hidden && autoPausedBySystem && isRecording) {
        // Page visible again — show warning but DON'T auto-resume
        console.log('[Scribe] Page visible again — recording still paused, awaiting manual resume');
        showToast('⚠️ Recording was auto-paused (interruption detected). Tap Resume to continue.', 'warning', 5000);
        renderCurrentTab();
    }
});

// Emergency safety net — try to preserve chunks if page is closing
window.addEventListener('beforeunload', (e) => {
    if (isRecording && mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        console.warn('[Scribe] Page unloading during recording — attempting to stop and preserve audio');
        try {
            if (mediaRecorder.state === 'paused') mediaRecorder.resume();
            mediaRecorder.stop();
        } catch (err) {
            console.error('[Scribe] Emergency stop failed:', err);
        }
    }
});
let scribePatientId = null;
let scribePatientName = '';
let scribeVisitType = 'follow_up';
let currentTranscript = '';
let currentNote = null;

let currentTab = 'today';
let selectedPatient = null;
let activeLabFilter = 'pending';
let activeInventoryTab = 'dea';
let activeSupplyFilter = 'All';
let isConnected = false;
let isLoading = false;
let scribeLoaded = false;       // prevent infinite reload
let labsLoaded = false;         // prevent infinite reload
let patientsLoaded = false;     // prevent infinite reload
let currentUser = null;          // from /api/ipad/me — role, permissions

// HTML sanitizer to prevent XSS
function sanitize(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\//g, '&#x2F;'); // Extra protection for URLs
}

// FIX(2026-03-25): Healthie messages contain HTML (<p>, <br>, &nbsp;).
// Safely render message content: allow basic formatting, strip dangerous tags.
function renderHealthieMessage(html) {
    if (!html) return '';
    var str = String(html);
    // Decode common HTML entities first
    str = str.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
    // Convert block tags to line breaks
    str = str.replace(/<br\s*\/?>/gi, '\n');
    str = str.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
    str = str.replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n');
    // Strip all remaining HTML tags
    str = str.replace(/<[^>]+>/g, '');
    // Clean up whitespace
    str = str.replace(/\n{3,}/g, '\n\n').trim();
    // Now sanitize the plain text for safe HTML insertion, but preserve line breaks
    str = sanitize(str);
    str = str.replace(/\n/g, '<br>');
    return str;
}

// Convert Healthie HTML to plain text (for previews)
function healthieToPlainText(html) {
    if (!html) return '';
    var str = String(html);
    str = str.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    str = str.replace(/<br\s*\/?>/gi, ' ');
    str = str.replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, ' ');
    str = str.replace(/<[^>]+>/g, '');
    str = str.replace(/\s{2,}/g, ' ').trim();
    return str;
}

// ─── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    updateClock();
    setInterval(updateClock, 30000);
    setupTabBar();
    setupPullToRefresh();

    // Phase 1: RBAC — load current user before anything else
    const authenticated = await loadCurrentUser();
    if (!authenticated) {
        showLoginOverlay();
        return;
    }

    applyRolePermissions();
    setupHashRouting();
    loadAllData();

    // ✅ AUTO-REFRESH: Schedule tab refreshes every 5 minutes
    // FIX(2026-03-31): Use loadScheduleForRange instead of renderCurrentTab to avoid
    // destroying the entire DOM (which causes jarring resets and loses provider filter UI state)
    setInterval(async () => {
        if (currentTab === 'schedule' && isConnected && !isLoading) {
            console.log('[Auto-Refresh] Refreshing schedule data in place...');
            try {
                await loadScheduleForRange(true);
            } catch (e) {
                console.warn('[Auto-Refresh] Failed:', e);
            }
        }
    }, 300000); // 5 minutes
});

// ─── AUTH & RBAC ────────────────────────────────────────────
async function loadCurrentUser() {
    try {
        const resp = await fetch('/ops/api/ipad/me/', { credentials: 'include' });
        if (!resp.ok) return false;
        const data = await resp.json();
        if (data.error) return false;
        currentUser = data;

        // Show logout button when logged in
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.style.display = 'inline-block';
        }

        // Update connection text to show username
        const connText = document.getElementById('connectionText');
        if (connText && data.email) {
            connText.textContent = data.email.split('@')[0];
        }

        console.log('[Auth] Logged in as:', data.email, '| Role:', data.role, '| Permissions:', data.permissions);

        return true;
    } catch (e) {
        console.warn('Auth check failed:', e);
        return false;
    }
}

// Logout handler
async function handleLogout() {
    if (!confirm('Are you sure you want to logout?')) return;

    console.log('[Auth] Logging out...');

    try {
        await fetch('/ops/api/auth/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (e) {
        console.warn('Logout API failed:', e);
    }

    // Clear local state
    currentUser = null;
    dashboardData = null;

    // Hide logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'none';

    // Reload page to show login
    window.location.reload();
}

function showLoginOverlay() {
    document.body.insertAdjacentHTML('beforeend', `
        <div id="loginOverlay" style="
            position:fixed; inset:0; z-index:9999;
            background: linear-gradient(135deg, #0a0f1a 0%, #111827 50%, #0f172a 100%);
            display:flex; align-items:center; justify-content:center;
            font-family:'DM Sans', sans-serif;
        ">
            <div style="
                width:380px; padding:40px; border-radius:16px;
                background:rgba(30,41,59,0.7); border:1px solid rgba(100,200,255,0.15);
                backdrop-filter:blur(20px); box-shadow:0 25px 50px rgba(0,0,0,0.5);
            ">
                <div style="text-align:center; margin-bottom:28px;">
                    <span style="font-size:28px; font-weight:700; color:#fff;">GMH</span>
                    <span style="font-size:28px; font-weight:300; color:#22d3ee;">Ops</span>
                    <div style="font-size:12px; color:#94a3b8; margin-top:4px; letter-spacing:0.1em; text-transform:uppercase;">iPad Staff Dashboard</div>
                </div>
                <div id="loginError" style="display:none; padding:10px 14px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:16px;"></div>
                <div style="margin-bottom:16px;">
                    <label style="display:block; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px; font-weight:600;">Email</label>
                    <input id="loginEmail" type="email" placeholder="you@nowoptimal.com" autocomplete="email" autofocus style="
                        width:100%; padding:12px 16px; border-radius:8px; border:1px solid rgba(100,200,255,0.15);
                        background:rgba(15,23,42,0.8); color:#fff; font-size:15px; font-family:inherit; outline:none;
                        transition:border-color 0.2s;
                    " onfocus="this.style.borderColor='#22d3ee'" onblur="this.style.borderColor='rgba(100,200,255,0.15)'">
                </div>
                <div style="margin-bottom:24px;">
                    <label style="display:block; font-size:11px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.08em; margin-bottom:6px; font-weight:600;">Password</label>
                    <input id="loginPassword" type="password" placeholder="••••••••" autocomplete="current-password" style="
                        width:100%; padding:12px 16px; border-radius:8px; border:1px solid rgba(100,200,255,0.15);
                        background:rgba(15,23,42,0.8); color:#fff; font-size:15px; font-family:inherit; outline:none;
                        transition:border-color 0.2s;
                    " onfocus="this.style.borderColor='#22d3ee'" onblur="this.style.borderColor='rgba(100,200,255,0.15)'"
                    onkeydown="if(event.key==='Enter') handleLogin()">
                </div>
                <button onclick="handleLogin()" id="loginBtn" style="
                    width:100%; padding:14px; border:none; border-radius:8px;
                    background:linear-gradient(135deg, #22d3ee, #06b6d4); color:#0a0f1a;
                    font-size:15px; font-weight:700; cursor:pointer; font-family:inherit;
                    transition:all 0.2s; letter-spacing:0.02em;
                ">Sign In</button>
            </div>
        </div>
    `);
}

async function handleLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const btn = document.getElementById('loginBtn');

    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password';
        errorEl.style.display = 'block';
        return;
    }

    btn.textContent = 'Signing in…';
    btn.disabled = true;
    errorEl.style.display = 'none';

    try {
        const resp = await fetch('/ops/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await resp.json();

        if (resp.ok && data.success) {
            // Reload user and boot app
            const authed = await loadCurrentUser();
            if (authed) {
                document.getElementById('loginOverlay')?.remove();
                applyRolePermissions();
                setupHashRouting();
                loadAllData();
                return;
            }
        }
        errorEl.textContent = data.error || 'Invalid credentials';
        errorEl.style.display = 'block';
    } catch (e) {
        errorEl.textContent = 'Connection error — try again';
        errorEl.style.display = 'block';
    } finally {
        btn.textContent = 'Sign In';
        btn.disabled = false;
    }
}

function applyRolePermissions() {
    if (!currentUser) return;
    const perms = currentUser.permissions || {};
    const nav = document.querySelector('.tab-bar');

    // Hide Scribe tab for non-provider/non-admin
    const scribeTab = nav?.querySelector('[data-tab="scribe"]');
    if (scribeTab && !perms.can_use_scribe) {
        scribeTab.style.display = 'none';
    }

    // Add Schedule tab for all staff (prevent duplicates)
    if (nav && !nav.querySelector('[data-tab="schedule"]')) {
        const scheduleTab = document.createElement('button');
        scheduleTab.className = 'tab-item';
        scheduleTab.dataset.tab = 'schedule';
        scheduleTab.innerHTML = `
            <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span class="tab-label">Schedule</span>
        `;
        scheduleTab.addEventListener('click', () => { window.location.hash = '#schedule'; });
        // Insert after Labs tab
        const labsTab = nav.querySelector('[data-tab="labs"]');
        if (labsTab && labsTab.nextSibling) {
            nav.insertBefore(scheduleTab, labsTab.nextSibling);
        } else {
            nav.appendChild(scheduleTab);
        }
    }

    // Add Messages tab for all staff (prevent duplicates)
    if (nav && !nav.querySelector('[data-tab="messages"]')) {
        const messagesTab = document.createElement('button');
        messagesTab.className = 'tab-item';
        messagesTab.dataset.tab = 'messages';
        messagesTab.innerHTML = `
            <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="tab-label">Messages</span>
            <span class="tab-badge hidden" id="messagesBadge">0</span>
        `;
        messagesTab.addEventListener('click', () => { window.location.hash = '#messages'; });
        // Insert before Patients tab
        const patientsTabForMsg = nav.querySelector('[data-tab="patients"]');
        if (patientsTabForMsg) {
            nav.insertBefore(messagesTab, patientsTabForMsg);
        } else {
            nav.appendChild(messagesTab);
        }
    }

    // CEO tab — Phil Schafer ONLY
    const isPhil = currentUser.email === 'admin@nowoptimal.com';
    const isProviderOrAdmin = currentUser.is_provider === true
        || currentUser.email === 'admin@granitemountainhealth.com'
        || currentUser.email === 'admin@nowoptimal.com';
    if (isPhil && nav && !nav.querySelector('[data-tab="ceo"]')) {
        const ceoTab = document.createElement('button');
        ceoTab.className = 'tab-item';
        ceoTab.dataset.tab = 'ceo';
        ceoTab.innerHTML = `
            <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/>
            </svg>
            <span class="tab-label">CEO</span>
        `;
        ceoTab.addEventListener('click', () => { window.location.hash = '#ceo'; });
        // Insert CEO tab before Patients (last tab)
        const patientsTab = nav.querySelector('[data-tab="patients"]');
        if (patientsTab) {
            nav.insertBefore(ceoTab, patientsTab);
        } else {
            nav.appendChild(ceoTab);
        }
    }

    // Render user badge in status bar
    renderUserBadge();
}

function renderUserBadge() {
    const statusRight = document.querySelector('.status-bar-right');
    if (!statusRight || !currentUser) return;
    const roleBadges = { admin: '👑', write: '🩺', read: '💉' };
    const roleLabels = { admin: 'Admin', write: 'Provider', read: 'Staff' };
    const badge = roleBadges[currentUser.role] || '👤';
    const label = currentUser.display_name || currentUser.email?.split('@')[0] || 'User';
    const roleLabel = roleLabels[currentUser.role] || currentUser.role;

    // Insert before the clock
    const clockEl = document.getElementById('statusTime');
    const userBadge = document.createElement('span');
    userBadge.className = 'user-badge';
    userBadge.style.cssText = 'font-size:12px; color:var(--text-secondary); margin-right:12px; display:flex; align-items:center; gap:4px;';
    userBadge.innerHTML = `${badge} <span style="color:var(--text-primary); font-weight:500;">${label}</span> <span style="font-size:10px; color:var(--text-tertiary);">${roleLabel}</span>`;
    if (clockEl) {
        statusRight.insertBefore(userBadge, clockEl);
    } else {
        statusRight.appendChild(userBadge);
    }
}

function updateClock() {
    const el = document.getElementById('statusTime');
    if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
}

// ─── TAB BAR ────────────────────────────────────────────────
function setupTabBar() {
    document.querySelectorAll('.tab-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            window.location.hash = '#' + tab;
        });
    });
}

function setupHashRouting() {
    window.addEventListener('hashchange', handleHash);
    handleHash();
}

function handleHash() {
    const hash = window.location.hash.replace('#', '') || 'today';
    switchTab(hash);
}

function switchTab(tab) {
    removeFloatingEditBar();
    const validTabs = ['today', 'labs', 'scribe', 'inventory', 'patients', 'ceo', 'schedule', 'messages'];
    if (!validTabs.includes(tab)) tab = 'today';
    // RBAC: prevent access to tabs user doesn't have permission for
    if (currentUser?.permissions) {
        // CEO tab — Phil Schafer ONLY
        if (tab === 'ceo' && currentUser.email !== 'admin@nowoptimal.com') tab = 'today';
        if (tab === 'scribe' && !currentUser.permissions.can_use_scribe) tab = 'today';
        // Schedule and Messages tabs available to all authenticated users
    }
    currentTab = tab;

    document.querySelectorAll('.tab-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    renderCurrentTab();
}

// ─── PULL TO REFRESH ────────────────────────────────────────
function setupPullToRefresh() {
    const main = document.getElementById('mainContent');
    let startY = 0;
    let pulling = false;

    main.addEventListener('touchstart', e => {
        if (main.scrollTop <= 0) {
            startY = e.touches[0].clientY;
            pulling = true;
        }
    }, { passive: true });

    main.addEventListener('touchmove', e => {
        if (!pulling) return;
        const deltaY = e.touches[0].clientY - startY;
        const pullEl = document.getElementById('pullRefresh');
        if (deltaY > 60 && main.scrollTop <= 0) {
            pullEl.classList.add('visible');
        } else {
            pullEl.classList.remove('visible');
        }
    }, { passive: true });

    main.addEventListener('touchend', () => {
        const pullEl = document.getElementById('pullRefresh');
        if (pullEl.classList.contains('visible')) {
            loadAllData();
            setTimeout(() => pullEl.classList.remove('visible'), 1000);
        }
        pulling = false;
    });
}

// ─── RENDERING ──────────────────────────────────────────────
function renderCurrentTab() {
    const main = document.getElementById('mainContent');
    main.innerHTML = '';

    const view = document.createElement('div');
    view.className = 'tab-view active';
    view.id = `view-${currentTab}`;

    switch (currentTab) {
        case 'today': renderTodayView(view); break;
        case 'labs': renderLabsView(view); break;
        case 'scribe': renderScribeView(view); break;
        case 'inventory': renderInventoryView(view); break;
        case 'patients': renderPatientsView(view); break;
        case 'ceo': renderCEODashboard(view); break;
        case 'schedule': renderScheduleView(view); break;
        case 'messages': renderMessagesView(view); break;
    }

    main.appendChild(view);
    main.scrollTop = 0;
}

// ─── SESSION AUTO-REFRESH ───────────────────────────────────
// FIX(2026-03-15): Silent session refresh for long clinic days (10-hour interval)
let _sessionRefreshInterval = null;
let _isRefreshingSession = false;
let _refreshPromise = null;

async function attemptSessionRefresh() {
    try {
        const resp = await fetch('/ops/api/auth/refresh/', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
        });
        return resp.ok;
    } catch {
        return false;
    }
}

function startSessionAutoRefresh() {
    if (_sessionRefreshInterval) clearInterval(_sessionRefreshInterval);
    // Refresh every 10 hours (36,000,000 ms) — session TTL is 12 hours
    _sessionRefreshInterval = setInterval(async () => {
        console.log('[Auth] Auto-refreshing session...');
        const ok = await attemptSessionRefresh();
        if (!ok) console.warn('[Auth] Auto-refresh failed — session may expire soon');
    }, 10 * 60 * 60 * 1000);
}

// Start auto-refresh on load
startSessionAutoRefresh();

// ─── API LAYER ──────────────────────────────────────────────
async function apiFetch(url, options = {}) {
    const timeoutMs = options._timeout || 15000; // default 15s timeout
    const defaults = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    };
    const merged = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };
    delete merged._timeout;

    // Add AbortController timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    if (!merged.signal) merged.signal = controller.signal;

    try {
        const resp = await fetch(url, merged);

        if ((resp.status === 401 || resp.status === 403) && !_isRefreshingSession) {
            // Attempt one silent refresh before showing login overlay
            _isRefreshingSession = true;
            try {
                if (!_refreshPromise) _refreshPromise = attemptSessionRefresh();
                const refreshed = await _refreshPromise;
                _refreshPromise = null;
                _isRefreshingSession = false;

                if (refreshed) {
                    // Retry the original request once
                    const retryResp = await fetch(url, merged);
                    if (retryResp.status === 401 || retryResp.status === 403) {
                        showAuthExpired();
                        throw new Error('AUTH_EXPIRED');
                    }
                    if (!retryResp.ok) {
                        const errorText = await retryResp.text().catch(() => '');
                        console.error(`[API Error] ${retryResp.status} ${url}:`, errorText.substring(0, 200));
                        throw new Error(`HTTP ${retryResp.status}`);
                    }
                    return await retryResp.json();
                } else {
                    showAuthExpired();
                    throw new Error('AUTH_EXPIRED');
                }
            } catch (err) {
                _isRefreshingSession = false;
                _refreshPromise = null;
                if (err.message === 'AUTH_EXPIRED') throw err;
                showAuthExpired();
                throw new Error('AUTH_EXPIRED');
            }
        }

        if (resp.status === 401 || resp.status === 403) {
            showAuthExpired();
            throw new Error('AUTH_EXPIRED');
        }

        if (!resp.ok) {
            // ✅ USER-FRIENDLY ERROR MESSAGES — parse server error for 400s
            const errorText = await resp.text().catch(() => '');
            console.error(`[API Error] ${resp.status} ${url}:`, errorText.substring(0, 500));

            let serverMsg = '';
            try { serverMsg = JSON.parse(errorText)?.error || ''; } catch {}

            if (resp.status >= 500) {
                showToast('Server error - please try again', 'error');
            } else if (resp.status === 404) {
                showToast('Resource not found', 'error');
            } else if (resp.status === 400 && serverMsg) {
                showToast(serverMsg, 'error');
            } else if (resp.status === 400) {
                showToast('Invalid request', 'error');
            } else {
                showToast(`Request failed (${resp.status})`, 'error');
            }

            throw new Error(serverMsg || `HTTP ${resp.status}`);
        }

        clearTimeout(timeoutId);
        return await resp.json();
    } catch (e) {
        clearTimeout(timeoutId);
        if (e.message === 'AUTH_EXPIRED') throw e;

        // Handle timeout (AbortError)
        if (e.name === 'AbortError') {
            console.warn(`[API Timeout] ${url} did not respond within ${timeoutMs}ms`);
            throw new Error('REQUEST_TIMEOUT');
        }

        // ✅ NETWORK ERROR MESSAGES
        if (e.name === 'TypeError' && e.message.includes('fetch')) {
            showToast('Network error - check your connection', 'error');
        }

        console.warn(`API call failed: ${url}`, e);
        throw e;
    }
}

function showAuthExpired() {
    // Hide the old static overlay if it's visible
    const oldOverlay = document.getElementById('authOverlay');
    if (oldOverlay) oldOverlay.classList.remove('visible');
    // Show the login form (remove existing one first to prevent duplicates)
    if (!document.getElementById('loginOverlay')) {
        showLoginOverlay();
    }
    setConnectionStatus(false);
}

function setConnectionStatus(connected) {
    isConnected = connected;
    const dot = document.getElementById('connectionDot');
    const text = document.getElementById('connectionText');
    if (connected) {
        dot.classList.remove('disconnected');
        text.textContent = 'Connected';
    } else {
        dot.classList.add('disconnected');
        text.textContent = 'Disconnected';
    }
}

// ─── DATA LOADING ───────────────────────────────────────────
async function loadAllData() {
    isLoading = true;
    scribeLoaded = false; // reset on full refresh
    labsLoaded = false;
    patientsLoaded = false;
    patient360Cache = {}; // clear stale patient data on full refresh
    renderCurrentTab(); // Show loading states

    let anySuccess = false;

    // Parallel fetch: dashboard + inventory + schedule + patients + labs
    const results = await Promise.allSettled([
        loadDashboard(),
        loadInventoryAlerts(),
        loadInventorySummary(),
        loadHealthieAppointments(),
        loadAllPatients(),
        loadLabsQueue()
    ]);

    anySuccess = results.some(r => r.status === 'fulfilled' && r.value === true);

    if (anySuccess) {
        setConnectionStatus(true);
        showToast('Data synced', 'success');
    } else if (results.every(r => r.status === 'rejected' && r.reason?.message === 'AUTH_EXPIRED')) {
        // Auth overlay already shown
    } else {
        setConnectionStatus(false);
        showToast('Unable to load data — check connection', 'error');
    }

    isLoading = false;
    renderCurrentTab();
    updateBadges();

    // Restore chart panel if it was open before the refresh
    if (chartPanelOpen && chartPanelData && currentTab === 'scribe') {
        const content = document.getElementById('chartPanelContent');
        if (content) renderChartPanel(content);
        const panel = document.getElementById('chartPanel');
        if (panel) {
            panel.classList.add('open');
            if (chartPanelState === 'minimized') panel.classList.add('minimized');
            if (chartPanelState === 'expanded') panel.classList.add('expanded');
        }
    }
}

async function loadDashboard() {
    try {
        const data = await apiFetch('/ops/api/ipad/dashboard/');
        if (data.success && data.data) {
            // Normalize snake_case API fields to camelCase used by frontend
            const d = data.data;
            dashboardData = {
                stagedDoses: d.staged_doses || d.stagedDoses || [],
                paymentIssues: d.payment_alerts || d.payment_issues || d.paymentIssues || [],
                patients: (d.patients || []).map(p => ({
                    ...p,
                    id: p.patient_id || p.id,
                    name: p.full_name || p.name || p.patient_name || '',
                    status: p.status_key || p.status || 'Active',
                })),
                summary: d.summary || {},
                revenue: d.revenue || {},
                totalActivePatients: d.total_active_patients || d.totalActivePatients || 0,
                patientsByType: d.patients_by_type || d.patientsByType || {},
            };
            return true;
        }
        dashboardData = data.data || data;
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Dashboard load failed:', e);
        return false;
    }
}

async function loadHealthieAppointments() {
    console.log("[iPad] Loading Healthie appointments...");
    try {
        // Use lightweight schedule endpoint (cookie-authenticated, no cron secret)
        const data = await apiFetch('/ops/api/ipad/schedule/');
        if (data?.success && Array.isArray(data.patients)) {
            healthieAppointments = data.patients.map(p => ({
                id: p.appointment_id || '',
                patient_id: p.patient_id || p.healthie_id || '',
                patient_name: p.full_name || p.patient_name || '',
                appointment_type: p.appointment_type || '',
                status: p.appointment_status || 'scheduled',
                appointment_status: p.appointment_status || 'scheduled',
                time: p.time || '',
                provider: p.provider || '',
                has_staged_dose: p.has_staged_dose || false,
                has_payment_issue: p.has_payment_issue || false,
                has_pending_lab: p.has_pending_lab || false,
            }));
        } else if (Array.isArray(data)) {
            healthieAppointments = data;
        }
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Healthie appointments load failed:', e);
        return false;
    }
}

async function loadInventorySummary() {
    try {
        const data = await apiFetch('/ops/api/inventory/intelligence/summary/');
        // API returns { success, data: { vials: {aggregate}, peptides: [...], supplies: [...] } }
        if (data?.success && data?.data) {
            inventorySummary = data.data;
        } else {
            inventorySummary = data;
        }
        // Also load individual vial list for DEA section
        await loadVialList();
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Inventory summary load failed:', e);
        return false;
    }
}

async function loadVialList() {
    try {
        // Fetch individual active vials for the DEA inventory view
        const data = await apiFetch('/ops/api/inventory/vials/');
        if (data?.success && Array.isArray(data.data)) {
            vialList = data.data;
        } else if (Array.isArray(data)) {
            vialList = data;
        } else if (data?.vials) {
            vialList = data.vials;
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Vial list load failed:', e);
    }
}

async function loadInventoryAlerts() {
    try {
        const data = await apiFetch('/ops/api/inventory/intelligence/alerts/');
        // API returns { success, data: { alerts: [...], summary: {...} } }
        if (data?.success && data?.data?.alerts) {
            inventoryAlerts = data.data.alerts;
        } else if (data?.alerts) {
            inventoryAlerts = data.alerts;
        } else if (Array.isArray(data)) {
            inventoryAlerts = data;
        } else if (data?.data && Array.isArray(data.data)) {
            inventoryAlerts = data.data;
        }
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Inventory alerts load failed:', e);
        return false;
    }
}

async function loadLabsQueue() {
    try {
        // First load pending, then also load all for history
        const data = await apiFetch('/ops/api/labs/review-queue/?status=all&limit=100');
        // API returns { success, items: [...], counts: {...} }
        if (data?.success && Array.isArray(data.items)) {
            labsQueue = data.items;
        } else if (Array.isArray(data)) {
            labsQueue = data;
        } else if (data?.data && Array.isArray(data.data)) {
            labsQueue = data.data;
        } else if (data?.labs) {
            labsQueue = data.labs;
        }
        labsLoaded = true;
        return true;
    } catch (e) {
        labsLoaded = true; // mark as attempted even on failure
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Labs queue load failed:', e);
        return false;
    }
}

async function loadAllPatients() {
    try {
        const data = await apiFetch('/ops/api/patients/');
        // API returns { data: [...] }
        if (data?.data && Array.isArray(data.data)) {
            allPatients = data.data.map(p => ({
                ...p,
                id: p.patient_id || p.id,
                name: p.full_name || p.name || p.patient_name || '',
                status: p.status_key || p.status || 'Active',
                healthie_client_id: p.healthie_client_id || p.healthie_id || '',
                ghl_contact_id: p.ghl_contact_id || '',
                avatar_url: p.avatar_url || '',
            }));
        } else if (Array.isArray(data)) {
            allPatients = data;
        }
        patientsLoaded = true;
        return true;
    } catch (e) {
        patientsLoaded = true; // mark as attempted even on failure
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Patient list load failed:', e);
        return false;
    }
}

async function loadPatient360(patientId, forceRefresh = false) {
    if (!forceRefresh && patient360Cache[patientId]) return patient360Cache[patientId];
    try {
        const data = await apiFetch(`/ops/api/ipad/patient/${patientId}/`, { _timeout: 10000 });
        // API returns { success, data: { demographics, recent_dispenses, recent_peptides, payment_issues, staged_doses, summary } }
        const result = (data?.success && data?.data) ? data.data : data;
        patient360Cache[patientId] = result;
        return result;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        if (e.message === 'REQUEST_TIMEOUT') {
            console.warn(`Patient 360 timed out for ${patientId} — showing partial data`);
            return null; // triggers "Extended patient data not available" message
        }
        console.warn(`Patient 360 load failed for ${patientId}:`, e);
        return null;
    }
}

// Invalidate patient cache after mutations so next view shows fresh data
function invalidatePatientCache(patientId) {
    delete patient360Cache[patientId];
}

// ─── BADGE UPDATES ──────────────────────────────────────────
function updateBadges() {
    // Labs badge
    const labsBadge = document.getElementById('labsBadge');
    const labsPending = getLabsPending().length;
    if (labsBadge) {
        if (labsPending > 0) {
            labsBadge.textContent = labsPending;
            labsBadge.classList.remove('hidden');
        } else {
            labsBadge.classList.add('hidden');
        }
    }

    // Inventory badge
    const invBadge = document.getElementById('inventoryBadge');
    const alertCount = inventoryAlerts.length;
    if (invBadge) {
        if (alertCount > 0) {
            invBadge.textContent = alertCount;
            invBadge.classList.remove('hidden');
        } else {
            invBadge.classList.add('hidden');
        }
    }

    // Scribe badge — show active sessions count
    const scribeBadge = document.getElementById('scribeBadge');
    const activeSessions = scribeSessions.filter(s => s.status === 'transcribed' || s.status === 'note_generated').length;
    if (scribeBadge) {
        if (activeSessions > 0) {
            scribeBadge.textContent = activeSessions;
            scribeBadge.classList.remove('hidden');
        } else {
            scribeBadge.classList.add('hidden');
        }
    }
}

// ─── HELPERS ────────────────────────────────────────────────
function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
}

function formatDate() {
    return new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
        timeZone: CLINIC_TIMEZONE
    });
}

function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

function getStagedDoses() {
    return (dashboardData && dashboardData.stagedDoses) ? dashboardData.stagedDoses : [];
}

function getPaymentIssues() {
    return (dashboardData && dashboardData.paymentIssues) ? dashboardData.paymentIssues : [];
}

function getPatients() {
    // Prefer full patient list, fall back to dashboard-only patients
    if (allPatients.length > 0) return allPatients;
    return (dashboardData && dashboardData.patients) ? dashboardData.patients : [];
}

function getLabsPending() {
    // Prefer dedicated labs queue, fall back to dashboard labs
    if (labsQueue.length > 0) return labsQueue.filter(l => l.status === 'pending_review' || l.status === 'pending' || l.status === 'needs_review');
    return [];
}

// ─── TOAST ──────────────────────────────────────────────────
let _persistentToast = null;

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Show a persistent toast with a spinner that stays until dismissPersistentToast() is called.
 * Use for long-running operations like AI generation.
 */
function showPersistentToast(message, type = 'info') {
    dismissPersistentToast(); // remove any existing one
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.id = 'persistentToast';
    toast.innerHTML = `<div class="loading-spinner" style="width:14px; height:14px; border-width:2px; flex-shrink:0;"></div> <span id="persistentToastMsg">${message}</span> <span id="persistentToastTimer" style="font-size:11px; color:var(--text-tertiary); margin-left:4px;">0s</span>`;
    container.appendChild(toast);
    _persistentToast = toast;
    // Start elapsed timer
    const startTime = Date.now();
    toast._timerInterval = setInterval(() => {
        const el = document.getElementById('persistentToastTimer');
        if (el) el.textContent = Math.floor((Date.now() - startTime) / 1000) + 's';
    }, 1000);
    return toast;
}

function updatePersistentToast(message) {
    const msg = document.getElementById('persistentToastMsg');
    if (msg) msg.innerHTML = message;
}

/**
 * Show a detailed, scrollable edit result toast with a dismiss button.
 * Stays until tapped or auto-dismisses after 15 seconds.
 */
function showEditResultToast(title, detailHtml) {
    const container = document.getElementById('toastContainer');
    // Remove any existing edit result toast
    const existing = document.getElementById('editResultToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast success';
    toast.id = 'editResultToast';
    toast.style.cssText = 'flex-direction:column; align-items:stretch; max-height:50vh; cursor:pointer; padding:12px 16px;';
    toast.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <strong style="font-size:14px;">${title}</strong>
            <span style="font-size:11px; color:var(--text-tertiary);">tap to dismiss</span>
        </div>
        <div style="overflow-y:auto; max-height:35vh; -webkit-overflow-scrolling:touch;">
            ${detailHtml}
        </div>
    `;
    toast.onclick = () => {
        toast.style.animation = 'toast-out 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    };
    container.appendChild(toast);

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'toast-out 0.3s ease-out forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 15000);
}

function dismissPersistentToast() {
    if (_persistentToast) {
        if (_persistentToast._timerInterval) clearInterval(_persistentToast._timerInterval);
        _persistentToast.style.animation = 'toast-out 0.3s ease-out forwards';
        setTimeout(() => { try { _persistentToast?.remove(); } catch(e){} }, 300);
        _persistentToast = null;
    }
    // Also remove by ID in case reference was lost
    const el = document.getElementById('persistentToast');
    if (el) { el.style.animation = 'toast-out 0.3s ease-out forwards'; setTimeout(() => el?.remove(), 300); }
}

// ─── LOADING STATE ──────────────────────────────────────────
function renderLoadingState() {
    return `
        <div class="loading-state">
            <div class="loading-spinner"></div>
            <span>Loading data…</span>
        </div>
    `;
}

function renderEmptyState(icon, title, subtitle) {
    return `
        <div class="empty-state">
            <div class="empty-icon">${icon}</div>
            <h3>${title}</h3>
            <p>${subtitle || ''}</p>
        </div>
    `;
}

// ============================================================
// TODAY VIEW
// ============================================================
function renderTodayView(container) {
    // Only show loading spinner on very first load when we have zero data
    if (isLoading && !dashboardData && healthieAppointments.length === 0 && allPatients.length === 0) {
        container.innerHTML = renderLoadingState();
        return;
    }

    const stagedDoses = getStagedDoses();
    const paymentIssues = getPaymentIssues();
    const patients = getPatients();
    const revenue = dashboardData?.revenue || {};

    // Compute stats
    const activePatientCount = dashboardData?.totalActivePatients || allPatients.length || patients.length || 0;
    const labsPendingCount = getLabsPending().length || 0;
    const stagedCount = stagedDoses.length || 0;
    const paymentIssueCount = paymentIssues.length || 0;
    const appointmentCount = healthieAppointments.length;

    // Build action items from live data
    const actions = buildActionItems(labsPendingCount, paymentIssueCount, stagedCount);

    // Greeting — personalized to logged-in user
    const userName = currentUser?.display_name || currentUser?.email?.split('@')[0] || 'Team';

    container.innerHTML = `
        <div class="greeting">
            <h1>${getGreeting()}, ${sanitize(userName)}</h1>
            <div class="date">${formatDate()}</div>
        </div>

        <div class="stats-row stagger-in">
            <div class="stat-card" onclick="window.location.hash='#schedule'">
                <div class="stat-icon cyan">📅</div>
                <div class="stat-value">${appointmentCount}</div>
                <div class="stat-label">Today's Appts</div>
            </div>
            <div class="stat-card" onclick="window.location.hash='#patients'">
                <div class="stat-icon purple">👥</div>
                <div class="stat-value">${activePatientCount}</div>
                <div class="stat-label">Active Patients</div>
            </div>
            <div class="stat-card" onclick="window.location.hash='#labs'">
                <div class="stat-icon green">🧪</div>
                <div class="stat-value">${labsPendingCount}</div>
                <div class="stat-label">Labs Pending</div>
            </div>
            <div class="stat-card ${paymentIssueCount > 0 ? 'alert' : ''}" onclick="scrollToSection('paymentSection')">
                <div class="stat-icon red">💳</div>
                <div class="stat-value">${paymentIssueCount}</div>
                <div class="stat-label">Payment Issues</div>
            </div>
        </div>

        ${(currentUser?.email === 'admin@nowoptimal.com' && (revenue.today >= 0 || revenue.week >= 0 || revenue.month >= 0)) ? `
            <div class="section-header">
                <h2>Revenue</h2>
            </div>
            <div class="stats-row stagger-in" style="margin-bottom:12px;">
                <div class="stat-card" style="flex:1; border-left:3px solid #22c55e;">
                    <div class="stat-value" style="color:#22c55e;">$${(revenue.today || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    <div class="stat-label">Today</div>
                </div>
                <div class="stat-card" style="flex:1; border-left:3px solid #3b82f6;">
                    <div class="stat-value" style="color:#3b82f6;">$${(revenue.week || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    <div class="stat-label">This Week</div>
                </div>
                <div class="stat-card" style="flex:1; border-left:3px solid #a855f7;">
                    <div class="stat-value" style="color:#a855f7;">$${(revenue.month || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                    <div class="stat-label">This Month</div>
                </div>
            </div>
        ` : ''}

        ${actions.length > 0 ? `
            <div class="section-header">
                <h2>Action Queue</h2>
                <button class="section-action" onclick="clearAllActions()">Clear All</button>
            </div>
            <div class="action-queue stagger-in" id="actionQueue">
                ${actions.map((a, i) => renderActionCard(a, i)).join('')}
            </div>
        ` : ''}

        <div class="section-header">
            <h2>Today's Schedule</h2>
            <button class="section-action" onclick="window.location.hash='#schedule'">${appointmentCount} appointments →</button>
        </div>
        ${appointmentCount > 0 ? `
            <div class="stagger-in">
                ${healthieAppointments.map(a => renderHealthieAppointment(a)).join('')}
            </div>
        ` : renderEmptyState('📅', 'No Appointments Today', 'No patients are scheduled for today')}

        ${stagedDoses.length > 0 ? `
            <div class="section-header" id="stagedDosesSection">
                <h2>Staged Doses</h2>
                <span class="section-action">${stagedCount} staged</span>
            </div>
            <div class="schedule-timeline stagger-in">
                ${buildSchedule(stagedDoses).map(s => renderScheduleItem(s)).join('')}
            </div>
        ` : ''}

        ${paymentIssues.length > 0 ? `
            <div class="section-header" id="paymentSection">
                <h2>Payment Issues</h2>
                <span class="section-action">${paymentIssueCount} issues</span>
            </div>
            <div class="stagger-in">
                ${paymentIssues.map(p => renderPaymentIssueCard(p)).join('')}
            </div>
        ` : ''}

        ${renderTodayInventoryAlerts()}
    `;

    // Setup swipe gestures on action cards
    setTimeout(() => setupSwipeGestures(), 100);
}

function renderTodayInventoryAlerts() {
    // Build inventory overview from available data
    const vialData = inventorySummary?.vials || {};
    const peptides = inventorySummary?.peptides || [];
    const supplies = supplyItems || inventorySummary?.supplies || [];

    const activeVials = parseInt(vialData.active_count || '0');
    const peptideCount = peptides.length;
    const lowSupplies = supplies.filter(s => {
        const qty = s.qty_on_hand ?? s.current_count ?? 0;
        const par = s.par_level ?? null;
        return par && qty <= par;
    });

    let html = '';

    // Inventory Overview — compact stat cards
    if (activeVials > 0 || peptideCount > 0 || supplies.length > 0) {
        html += `
            <div class="section-header" id="inventoryOverview">
                <h2>Inventory Overview</h2>
                <button class="section-action" onclick="window.location.hash='#inventory'">View All →</button>
            </div>
            <div class="stats-row stagger-in" style="margin-bottom:12px;">
                <div class="stat-card" onclick="window.location.hash='#inventory'" style="flex:1;">
                    <div class="stat-icon green">💉</div>
                    <div class="stat-value">${activeVials}</div>
                    <div class="stat-label">Active Vials</div>
                </div>
                <div class="stat-card" onclick="window.location.hash='#inventory'" style="flex:1;">
                    <div class="stat-icon purple">💊</div>
                    <div class="stat-value">${peptideCount}</div>
                    <div class="stat-label">Peptide Products</div>
                </div>
                <div class="stat-card ${lowSupplies.length > 0 ? 'alert' : ''}" onclick="window.location.hash='#inventory'" style="flex:1;">
                    <div class="stat-icon ${lowSupplies.length > 0 ? 'red' : 'cyan'}">📦</div>
                    <div class="stat-value">${lowSupplies.length}</div>
                    <div class="stat-label">${lowSupplies.length > 0 ? 'Low Supplies' : 'All Stocked'}</div>
                </div>
            </div>
        `;
    }

    // Low stock items list
    if (lowSupplies.length > 0) {
        html += `
            <div class="stagger-in" style="margin-bottom:16px;">
                ${lowSupplies.slice(0, 5).map(s => {
            const qty = s.qty_on_hand ?? s.current_count ?? 0;
            const par = s.par_level ?? 0;
            const name = s.name || s.supply_name || '';
            return `
                        <div style="display:flex; align-items:center; padding:8px 14px; background:linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.03)); border-radius:8px; margin-bottom:4px; border-left:3px solid var(--red);">
                            <span style="font-size:13px; flex:1; font-weight:500;">${name}</span>
                            <span style="font-size:13px; color:var(--red); font-weight:600;">${qty}/${par}</span>
                        </div>
                    `;
        }).join('')}
                ${lowSupplies.length > 5 ? `<div style="text-align:center; padding:6px; color:var(--text-tertiary); font-size:12px;">+ ${lowSupplies.length - 5} more items below par</div>` : ''}
            </div>
        `;
    }

    return html;
}

function buildActionItems(labsCount, paymentsCount, stagedCount) {
    const items = [];
    if (labsCount > 0) {
        items.push({ id: 'labs', text: `${labsCount} Lab Results Need Review`, icon: '🧪', tab_target: 'labs', item_type: 'labs' });
    }
    if (inventoryAlerts.length > 0) {
        items.push({ id: 'inv', text: `${inventoryAlerts.length} Inventory Alert${inventoryAlerts.length > 1 ? 's' : ''}`, icon: '📦', tab_target: 'inventory', item_type: 'inventory' });
    }
    if (paymentsCount > 0) {
        items.push({ id: 'pay', text: `${paymentsCount} Payment Issue${paymentsCount > 1 ? 's' : ''} to Resolve`, icon: '💳', tab_target: '', item_type: 'alert' });
    }
    return items;
}

function buildSchedule(stagedDoses) {
    return stagedDoses.map(dose => ({
        id: dose.id || dose.staged_dose_id,
        patient_name: dose.patient_name || dose.patientName || 'Unknown',
        time: dose.scheduled_time || dose.time || '',
        type: dose.medication || dose.substance || dose.type || 'Dose',
        dosage: dose.dosage || dose.amount || '',
        vial_id: dose.vial_id || dose.vialId || '',
        status: dose.status || 'staged',
    }));
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderActionCard(action, index) {
    const hasTarget = action.tab_target && action.item_type !== 'alert';
    const clickAction = hasTarget
        ? `onclick="window.location.hash='#${action.tab_target}'"`
        : '';

    return `
        <div class="action-card" data-id="${action.id}" ${clickAction}>
            <div class="swipe-hint"></div>
            <div class="action-icon">${action.icon}</div>
            <div class="action-text">${action.text}</div>
            <div class="action-arrow">›</div>
        </div>
    `;
}

function renderHealthieAppointment(appt) {
    const name = appt.patient_name || appt.patientName || appt.name || appt.full_name || 'Unknown';
    const time = appt.time || appt.scheduled_time || appt.start_time || '';
    const type = appt.type || appt.appointment_type || appt.reason || '';
    const provider = appt.provider || '';
    const status = appt.status || appt.appointment_status || 'scheduled';
    const patientId = appt.patient_id || appt.id || '';

    let statusClass = 'scheduled';
    let statusLabel = 'Scheduled';
    if (status === 'checked_in' || status === 'Checked In') { statusClass = 'checked_in'; statusLabel = 'Checked In'; }
    else if (status === 'in_progress' || status === 'In Progress') { statusClass = 'in_progress'; statusLabel = 'In Progress'; }
    else if (status === 'completed' || status === 'Completed') { statusClass = 'completed'; statusLabel = 'Complete'; }
    else if (status === 'Confirmed') { statusClass = 'checked_in'; statusLabel = 'Confirmed'; }
    else if (status === 'No Show') { statusClass = 'completed'; statusLabel = 'No Show'; }

    const displayTime = typeof time === 'string' && time.includes('T')
        ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: CLINIC_TIMEZONE })
        : time;

    const apptId = appt.id || appt.healthie_id || '';
    const canAdvance = statusClass !== 'completed' && apptId;

    return `
        <div class="healthie-appt-card" style="cursor:default;">
            <div class="healthie-appt-time">${displayTime || '—'}</div>
            <div class="healthie-appt-info" ${patientId ? `onclick="openChartForPatient('${patientId}', '${sanitize(name).replace(/'/g, "\\\'")}');" style="cursor:pointer; flex:1;"` : 'style="flex:1;"'}>
                <div class="healthie-appt-name">${sanitize(name)}</div>
                <div class="healthie-appt-type">${sanitize(type)}${provider ? ' · ' + sanitize(provider) : ''}</div>
            </div>
            <div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">
                ${patientId ? `<button onclick="event.stopPropagation(); openChartForPatient('${patientId}', '${sanitize(name).replace(/'/g, "\\\'")}')" style="padding:5px 8px; background:rgba(0,212,255,0.12); color:var(--cyan); border:1px solid rgba(0,212,255,0.25); border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; white-space:nowrap;">📋</button>` : ''}
                <div class="healthie-appt-status sched-status ${statusClass}" ${canAdvance ? `onclick="event.stopPropagation(); handleHealthieClick('${apptId}', '${status}')" style="cursor:pointer;" title="Click to advance status"` : ''}>${statusLabel}</div>
            </div>
        </div>
    `;
}

async function handleHealthieClick(id, currentStatus) {
    // Map Healthie statuses to next status in workflow
    const normalized = (currentStatus || '').toLowerCase().replace(/\s+/g, '_');
    const nextStatusMap = {
        'scheduled': 'Confirmed',
        'confirmed': 'Checked In',
        'checked_in': 'In Progress',
        'in_progress': 'Completed',
    };
    const next = nextStatusMap[normalized];
    if (!next || !id) return;

    // Optimistic update — change local state immediately
    // Try healthieAppointments (Today view)
    let appt = healthieAppointments.find(a => String(a.id) === String(id));
    const previousStatus = appt ? (appt.status || appt.appointment_status) : null;
    if (appt) {
        appt.status = next;
        appt.appointment_status = next;
    }
    renderCurrentTab();
    showToast(`Status → ${next}`, 'info');

    // Persist to Healthie via backend API
    try {
        const resp = await apiFetch('/ops/api/ipad/appointment-status/', {
            method: 'PATCH',
            body: JSON.stringify({ appointment_id: id, status: next }),
        });
        if (resp.success) {
            showToast(`✓ Status saved to Healthie`, 'success');
            // Reload schedule data to reflect change (handles Schedule view)
            if (currentTab === 'schedule') loadScheduleData();
        } else {
            throw new Error(resp.error || 'Unknown error');
        }
    } catch (e) {
        console.error('[iPad] Status update failed:', e);
        // Rollback to previous status (Today view)
        if (appt && previousStatus) {
            appt.status = previousStatus;
            appt.appointment_status = previousStatus;
        }
        renderCurrentTab();
        // If on schedule tab, reload from server to ensure consistent state
        if (currentTab === 'schedule') loadScheduleData();
        showToast(`Status update failed: ${e.message}`, 'error');
    }
}

// FIX(2026-03-15): Added fallback defaults to prevent undefined button labels
function renderScheduleItem(dose) {
    const displayTime = dose.time || '—';
    const patientName = dose.patient_name || 'Unknown';
    const doseType = dose.type || 'Dose';
    const doseStatus = dose.status || 'staged';
    return `
        <div class="schedule-item">
            <div class="sched-time">${displayTime}</div>
            <div class="sched-dot"></div>
            <div class="sched-info">
                <div class="sched-name">${patientName}</div>
                <div class="sched-type">${doseType}${dose.dosage ? ' · ' + dose.dosage : ''}</div>
                ${dose.vial_id ? `<div class="dose-detail"><span>Vial: ${dose.vial_id}</span></div>` : ''}
            </div>
            <div class="sched-status ${doseStatus}">${doseStatus.replace('_', ' ')}</div>
        </div>
    `;
}

function renderPaymentIssueCard(issue) {
    const name = issue.patient_name || issue.patientName || issue.name || 'Unknown';
    const issueType = issue.issue_type || issue.issue || issue.reason || 'Payment issue';
    const severity = issue.issue_severity || issue.severity || 'medium';
    const amount = parseFloat(issue.amount_owed || issue.amount || issue.balance || 0);
    const daysOverdue = issue.days_overdue || '';
    const patientId = issue.patient_id || '';

    const severityColors = { high: '#ef4444', critical: '#ef4444', medium: '#f59e0b', low: '#3b82f6' };
    const severityColor = severityColors[severity] || '#f59e0b';
    const severityLabels = { high: '🔴', critical: '🔴', medium: '🟡', low: '🔵' };

    return `
        <div class="payment-issue-card" onclick="${patientId ? `navigateToPatient('${patientId}', '${sanitize(name).replace(/'/g, "\\\'")}')` : ''}" style="border-left:3px solid ${severityColor};">
            <div class="payment-issue-icon">${severityLabels[severity] || '💳'}</div>
            <div class="payment-issue-text">
                <div class="payment-issue-name">${sanitize(name)}</div>
                <div class="payment-issue-detail">${sanitize(issueType)}${daysOverdue ? ` · ${daysOverdue} days overdue` : ''}</div>
            </div>
            ${amount > 0 ? `<div class="payment-issue-amount" style="color:${severityColor};">$${amount.toFixed(2)}</div>` : ''}
        </div>
    `;
}

function setupSwipeGestures() {
    document.querySelectorAll('.action-card').forEach(card => {
        let startX = 0;
        let deltaX = 0;
        const hint = card.querySelector('.swipe-hint');

        card.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            card.classList.add('swiping-right');
        }, { passive: true });

        card.addEventListener('touchmove', e => {
            deltaX = e.touches[0].clientX - startX;
            if (deltaX > 0 && hint) {
                hint.style.width = Math.min(deltaX, card.offsetWidth) + 'px';
                card.style.transform = `translateX(${Math.min(deltaX * 0.3, 60)}px)`;
            }
        }, { passive: true });

        card.addEventListener('touchend', () => {
            card.classList.remove('swiping-right');
            if (deltaX > 120) {
                card.classList.add('dismissed');
                showToast('Dismissed', 'success');
                setTimeout(() => card.remove(), 400);
            } else {
                if (hint) hint.style.width = '0';
                card.style.transform = '';
                card.style.transition = 'transform 0.2s ease-out';
                setTimeout(() => card.style.transition = '', 200);
            }
            deltaX = 0;
        });
    });
}

function clearAllActions() {
    const cards = document.querySelectorAll('.action-card');
    cards.forEach((card, i) => {
        setTimeout(() => {
            card.classList.add('dismissed');
            setTimeout(() => card.remove(), 400);
        }, i * 80);
    });
}

// ============================================================
// LABS VIEW
// ============================================================
function renderLabsView(container) {
    // Try loading labs if not loaded (with guard to prevent infinite loop)
    if (labsQueue.length === 0 && !labsLoaded && !isLoading) {
        container.innerHTML = renderLoadingState();
        labsLoaded = true; // prevent re-entry
        loadLabsQueue().then(success => {
            if (currentTab === 'labs') {
                renderCurrentTab();
                updateBadges();
            }
        });
        return;
    }

    const allLabs = labsQueue;
    const pending = allLabs.filter(l => l.status === 'pending_review' || l.status === 'pending' || l.status === 'needs_review');
    const approved = allLabs.filter(l => l.status === 'approved' || l.status === 'reviewed');
    const normalPending = pending.filter(l => !l.critical && !l.is_critical);

    // Apply search filter
    const labSearch = (window._labSearchQuery || '').toLowerCase();
    let filteredLabs = activeLabFilter === 'pending' ? pending
        : activeLabFilter === 'approved' ? approved
            : allLabs;
    if (labSearch) {
        filteredLabs = filteredLabs.filter(l => {
            const name = (l.patient_name || l.patientName || '').toLowerCase();
            const testType = (l.test_type || l.testType || l.panel_name || '').toLowerCase();
            return name.includes(labSearch) || testType.includes(labSearch);
        });
    }

    container.innerHTML = `
        <h1 style="font-size:28px; margin-bottom:20px;">Lab Results</h1>
        <div style="margin-bottom:12px;">
            <input type="text" id="labSearchInput" placeholder="Search by patient name or panel type..."
                value="${sanitize(window._labSearchQuery || '')}"
                oninput="window._labSearchQuery = this.value; updateLabsFiltering();"
                style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
        </div>
        <div class="labs-header">
            <button class="labs-header-tab ${activeLabFilter === 'pending' ? 'active' : ''}"
                    onclick="setLabFilter('pending')">Review Queue (${pending.length})</button>
            <button class="labs-header-tab ${activeLabFilter === 'approved' ? 'active' : ''}"
                    onclick="setLabFilter('approved')">Approved (${approved.length})</button>
            <button class="labs-header-tab ${activeLabFilter === 'all' ? 'active' : ''}"
                    onclick="setLabFilter('all')">History</button>
            ${normalPending.length > 0 && activeLabFilter === 'pending' ? `
                <button class="batch-approve-btn" onclick="batchApproveNormal()">
                    ⚡ Batch Approve All Normal (${normalPending.length})
                </button>
            ` : ''}
        </div>
        <div class="stagger-in" id="labsList">
            ${filteredLabs.map(l => renderLabCard(l)).join('')}
            ${filteredLabs.length === 0 ? renderEmptyState('🧪',
        labSearch ? 'No results for "' + sanitize(labSearch) + '"'
        : activeLabFilter === 'pending' ? 'No labs pending review' : 'No lab results',
        activeLabFilter === 'pending' && !labSearch ? 'All caught up!' : '') : ''}
        </div>
    `;
    // Restore focus to search input if it was active
    const si = document.getElementById('labSearchInput');
    if (si && labSearch) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
}

function setLabFilter(filter) {
    activeLabFilter = filter;
    renderCurrentTab();
}

// FIX(2026-04-01): Only re-render lab results list, not the entire container.
// Prevents the search input from being destroyed/rebuilt on each keystroke.
function updateLabsFiltering() {
    var labSearch = (window._labSearchQuery || '').toLowerCase();
    var allLabs = labsQueue;
    var pending = allLabs.filter(function(l) { return l.status === 'pending_review' || l.status === 'pending' || l.status === 'needs_review'; });
    var approved = allLabs.filter(function(l) { return l.status === 'approved' || l.status === 'reviewed'; });
    var filteredLabs = activeLabFilter === 'pending' ? pending
        : activeLabFilter === 'approved' ? approved
            : allLabs;
    if (labSearch) {
        filteredLabs = filteredLabs.filter(function(l) {
            var name = (l.patient_name || l.patientName || '').toLowerCase();
            var testType = (l.test_type || l.testType || l.panel_name || '').toLowerCase();
            return name.includes(labSearch) || testType.includes(labSearch);
        });
    }
    var listEl = document.getElementById('labsList');
    if (listEl) {
        listEl.innerHTML = filteredLabs.map(function(l) { return renderLabCard(l); }).join('')
            + (filteredLabs.length === 0 ? renderEmptyState('🧪',
                labSearch ? 'No results for "' + sanitize(labSearch) + '"' : 'No lab results', '') : '');
    }
}

function renderLabCard(lab) {
    const isCritical = lab.critical || lab.is_critical;
    const critClass = isCritical ? 'critical' : '';
    const badgeClass = isCritical ? 'critical' : 'normal';
    const badgeText = isCritical ? 'CRITICAL' : 'NORMAL';
    const isApproved = lab.status === 'approved' || lab.status === 'reviewed';
    const labId = lab.id || lab.lab_id;
    const patientName = lab.patient_name || lab.patientName || 'Unknown';
    const dob = lab.dob || lab.date_of_birth || '';
    const testType = lab.test_type || lab.testType || lab.panel_name || 'Lab Panel';
    const receivedDate = lab.received_date || lab.created_at || lab.date || '';
    const clinic = lab.clinic || '';
    const isPC = clinic.toLowerCase().includes('primary');
    const summary = lab.summary || lab.ai_summary || '';

    // Parse results
    let results = {};
    if (lab.results_json) {
        try { results = typeof lab.results_json === 'string' ? JSON.parse(lab.results_json) : lab.results_json; } catch (e) { }
    } else if (lab.results) {
        results = typeof lab.results === 'string' ? JSON.parse(lab.results) : lab.results;
    }

    return `
        <div class="lab-card ${critClass} ${isApproved ? 'approved' : ''}" id="lab-${labId}">
            <div class="lab-card-header">
                <div class="lab-patient-info">
                    <div class="lab-patient-name">${patientName}${clinic ? ` <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:${isPC ? 'rgba(6,15,106,0.12)' : 'rgba(220,38,38,0.10)'}; color:${isPC ? '#6875d5' : '#DC2626'}; font-weight:600; vertical-align:middle;">${isPC ? 'Primary Care' : 'Mens Health'}</span>` : ''}</div>
                    ${dob ? `<div class="lab-patient-dob">DOB: ${dob}</div>` : ''}
                </div>
                <span class="lab-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="lab-test-row">
                <span class="lab-test-type">${testType}</span>
                <span class="lab-received">${receivedDate ? 'Received ' + receivedDate : ''}</span>
            </div>
            ${summary ? `
                <div class="lab-summary" id="labSummary-${labId}" onclick="event.stopPropagation()">
                    <div class="lab-summary-header">✨ AI Summary</div>
                    <p>${summary}</p>
                    ${Object.keys(results).length > 0 ? `
                        <div class="lab-results-grid">
                            ${Object.entries(results).map(([k, v]) => {
        const val = String(v);
        return `
                                    <div class="lab-result-item">
                                        <span class="result-key">${k}</span>
                                        <span class="result-val ${val.includes('⚠') || val.includes('HIGH') || val.includes('LOW') ? 'flagged' : ''}">${val.replace('⚠️', '').trim()}</span>
                                    </div>
                                `;
    }).join('')}
                        </div>
                    ` : ''}
                </div>
                <div style="cursor:pointer; padding:8px 0; text-align:center; color:var(--text-tertiary); font-size:12px;"
                     onclick="toggleLabSummary('${labId}')">
                    <span id="labToggle-${labId}">▼ Tap to view AI summary</span>
                </div>
            ` : ''}
            ${!isApproved ? `
                <div class="lab-actions">
                    <button class="btn-view-pdf" onclick="event.stopPropagation(); viewLabPdf('${labId}', '${patientName.replace(/'/g, "\\'")}')">
                        📄 View PDF
                    </button>
                    <button class="btn-approve" onclick="event.stopPropagation(); approveLab('${labId}')">✓ APPROVE</button>
                    <button class="btn-reject" onclick="event.stopPropagation(); rejectLab('${labId}')">Reject</button>
                </div>
            ` : `
                <div class="lab-actions">
                    <button class="btn-view-pdf" onclick="event.stopPropagation(); viewLabPdf('${labId}', '${patientName.replace(/'/g, "\\'")}')">
                        📄 View PDF
                    </button>
                    <button class="btn-approve" disabled>✓ APPROVED</button>
                </div>
            `}
        </div>
    `;
}

function toggleLabSummary(id) {
    const summary = document.getElementById(`labSummary-${id}`);
    const toggle = document.getElementById(`labToggle-${id}`);
    if (summary) {
        const visible = summary.classList.toggle('visible');
        if (toggle) toggle.textContent = visible ? '▲ Hide AI summary' : '▼ Tap to view AI summary';
    }
}

async function approveLab(id) {
    // Call the review-queue POST endpoint with approve action
    try {
        const result = await apiFetch('/ops/api/labs/review-queue/', {
            method: 'POST',
            body: JSON.stringify({ id: id, action: 'approve' })
        });
        if (result?.success) {
            showToast('Lab result approved & uploaded to Healthie', 'success');
        } else {
            showToast(result?.error || 'Approve failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Lab approve failed:', e);
    }
    const lab = labsQueue.find(l => (l.id || l.lab_id) == id);
    if (lab) lab.status = 'approved';
    updateBadges();
    renderCurrentTab();
}

async function rejectLab(id) {
    try {
        const result = await apiFetch('/ops/api/labs/review-queue/', {
            method: 'POST',
            body: JSON.stringify({ id: id, action: 'reject', rejection_reason: 'Rejected from iPad' })
        });
        if (result?.success) {
            showToast('Lab result rejected', 'info');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Lab reject failed:', e);
    }
    const lab = labsQueue.find(l => (l.id || l.lab_id) == id);
    if (lab) lab.status = 'rejected';
    updateBadges();
    renderCurrentTab();
}

async function batchApproveNormal() {
    const normalPending = labsQueue.filter(l =>
        !l.critical && !l.is_critical &&
        (l.status === 'pending_review' || l.status === 'pending' || l.status === 'needs_review')
    );
    let approved = 0;
    for (const lab of normalPending) {
        try {
            // FIX(2026-03-15): Added trailing slash to prevent 404/redirect
            await apiFetch('/ops/api/labs/review-queue/', {
                method: 'POST',
                body: JSON.stringify({ id: lab.id || lab.lab_id, action: 'approve' })
            });
            lab.status = 'approved';
            approved++;
        } catch (e) {
            if (e.message === 'AUTH_EXPIRED') throw e;
            console.warn(`Batch approve failed for ${lab.id}:`, e);
        }
    }
    updateBadges();
    showToast(`${approved} normal labs approved`, 'success');
    renderCurrentTab();
}

async function viewLabPdf(labId, patientName) {
    const modal = document.getElementById('pdfViewerModal');
    const iframe = document.getElementById('pdfViewerFrame');
    const title = document.getElementById('pdfViewerTitle');
    const actions = document.getElementById('pdfViewerActions');

    if (!modal || !iframe) {
        showToast('PDF viewer not available', 'error');
        return;
    }

    title.textContent = `${patientName} — Lab Results`;
    iframe.src = '';
    modal.classList.add('visible');
    iframe.style.display = 'none';
    document.getElementById('pdfViewerLoading').style.display = 'flex';

    // Show approve/reject buttons for pending labs
    const lab = labsQueue.find(l => (l.id || l.lab_id) == labId);
    const isPending = lab && (lab.status === 'pending_review' || lab.status === 'pending' || lab.status === 'needs_review');
    actions.innerHTML = isPending ? `
        <button class="btn-approve" onclick="approveLab('${labId}'); closeLabPdf();">✓ APPROVE</button>
        <button class="btn-reject" onclick="rejectLab('${labId}'); closeLabPdf();">Reject</button>
    ` : '';

    try {
        const data = await apiFetch(`/ops/api/labs/review-queue/${labId}/pdf/`);
        if (data?.success && data.url) {
            iframe.src = data.url;
            iframe.style.display = 'block';
            document.getElementById('pdfViewerLoading').style.display = 'none';
        } else {
            document.getElementById('pdfViewerLoading').innerHTML = `
                <div class="empty-icon">📄</div>
                <h3>No PDF Available</h3>
                <p>${data?.error || 'This lab does not have a PDF attached.'}</p>
            `;
        }
    } catch (e) {
        document.getElementById('pdfViewerLoading').innerHTML = `
            <div class="empty-icon">⚠️</div>
            <h3>Error Loading PDF</h3>
            <p>${e.message}</p>
        `;
    }
}

function closeLabPdf() {
    const modal = document.getElementById('pdfViewerModal');
    const iframe = document.getElementById('pdfViewerFrame');
    if (modal) modal.classList.remove('visible');
    if (iframe) iframe.src = '';
}
// ============================================================
// SCRIBE VIEW — AI Medical Scribe
// ============================================================
async function loadScribeSessions() {
    try {
        const data = await apiFetch('/ops/api/scribe/sessions/?limit=30');
        if (data?.success && Array.isArray(data.data)) {
            scribeSessions = data.data;
        }
        scribeLoaded = true;

        // ✅ AUTO-RECOVERY: Check for stuck transcriptions
        await checkForPendingTranscriptions();
        // ✅ AUTO-RECOVERY: Check for orphaned video scribe blobs in IndexedDB
        await recoverVideoScribeBlobs();
    } catch (e) {
        scribeLoaded = true; // mark as attempted even on failure
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Scribe sessions load failed:', e);
    }
}

function renderScribeView(container) {
    // Load sessions on first visit (with guard to prevent infinite loop)
    if (!scribeLoaded && !isLoading) {
        container.innerHTML = renderLoadingState();
        scribeLoaded = true; // prevent re-entry
        loadScribeSessions().then(() => {
            if (currentTab === 'scribe') renderCurrentTab();
            updateBadges();
        });
        return;
    }

    // Remove floating AI edit bar when not in review mode
    if (scribeView !== 'review') removeFloatingEditBar();

    switch (scribeView) {
        case 'list': renderScribeList(container); break;
        case 'new': renderScribeNewSession(container); break;
        case 'recording': renderScribeRecording(container); break;
        case 'transcript': renderScribeTranscript(container); break;
        case 'note': renderScribeNote(container); break;
        case 'review': renderScribeReview(container); break;
        default: renderScribeList(container);
    }

    // Restore chart panel content after re-render if patient data is loaded
    if (chartPanelOpen && chartPanelData && (scribeView === 'recording' || scribeView === 'note' || scribeView === 'review')) {
        const content = document.getElementById('chartPanelContent');
        if (content) renderChartPanel(content);
    }
}

function renderScribeList(container) {
    const sessions = scribeSessions;
    const inProgress = sessions.filter(s => s.status === 'transcribed' || s.status === 'note_generated');
    const completed = sessions.filter(s => s.status === 'submitted' || s.status === 'signed');
    const recent = sessions.filter(s => s.status === 'recording');

    container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:24px;">
            <h1 style="font-size:28px;">AI Scribe</h1>
            <button class="btn-primary scribe-new-btn" onclick="startNewScribeSession()">
                <span style="font-size:18px;">🎙</span> New Session
            </button>
        </div>

        ${inProgress.length > 0 ? `
            <div class="section-header" style="margin-top:0">
                <h2>In Progress</h2>
                <span class="section-action">${inProgress.length} active</span>
            </div>
            <div class="stagger-in">
                ${inProgress.map(s => renderScribeSessionCard(s)).join('')}
            </div>
        ` : ''}

        ${recent.length > 0 ? `
            <div class="section-header">
                <h2>Recording</h2>
            </div>
            <div class="stagger-in">
                ${recent.map(s => renderScribeSessionCard(s)).join('')}
            </div>
        ` : ''}

        ${completed.length > 0 ? `
            <div class="section-header">
                <h2>Completed</h2>
                <span class="section-action">${completed.length} done</span>
            </div>
            <div class="stagger-in">
                ${completed.map(s => renderScribeSessionCard(s)).join('')}
            </div>
        ` : ''}

        ${sessions.length === 0 ? `
            <div class="empty-state">
                <div class="empty-icon">🎙</div>
                <h3>No Scribe Sessions</h3>
                <p>Tap <strong>New Session</strong> to start your first AI-powered visit note.</p>
            </div>
        ` : ''}
    `;
}

function renderScribeSessionCard(session) {
    const name = session.patient_name || 'Unknown Patient';
    const visitType = (session.visit_type || 'follow_up').replace(/_/g, ' ');
    const encounterDateStr = session.encounter_date
        ? new Date(session.encounter_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: CLINIC_TIMEZONE })
        : null;
    const timeStr = session.created_at ? new Date(session.created_at).toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: CLINIC_TIMEZONE
    }) : '';
    const time = encounterDateStr ? `${encounterDateStr} · ${timeStr}` : timeStr;
    const status = session.status || 'recording';
    const statusColors = {
        recording: 'var(--red)', transcribed: 'var(--yellow)', transcribing: 'var(--cyan)',
        note_generated: 'var(--cyan)', submitted: 'var(--green)', signed: 'var(--green)',
    };
    const statusLabels = {
        recording: 'Recording', transcribed: 'Needs Note', transcribing: '⏳ Transcribing...',
        note_generated: 'Review Note', submitted: 'Submitted', signed: 'Signed',
    };
    const nextAction = {
        transcribed: () => `onclick="openScribeSession('${session.session_id}', 'note')"`,
        note_generated: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
        submitted: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
        signed: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
    };
    const clickAttr = nextAction[status] ? nextAction[status]() : '';
    const isUnknown = !session.patient_name || session.patient_name === 'Unknown Patient' || session.patient_name === 'Unknown';
    const connectBtn = `<button onclick="event.stopPropagation(); connectPatientToSession('${session.session_id}')"
        style="padding:4px 10px; font-size:12px; border:1px solid var(--cyan); color:var(--cyan); background:rgba(0,212,255,0.1);
        border-radius:6px; cursor:pointer; margin-left:8px; white-space:nowrap;">
        ${isUnknown ? '🔗 Connect Patient' : '🔄 Change'}
    </button>`;

    return `
        <div class="scribe-session-card" ${clickAttr}>
            <div class="scribe-session-header">
                <div class="scribe-session-info">
                    <div class="scribe-session-patient" style="display:flex; align-items:center;">
                        ${name} ${connectBtn}
                    </div>
                    <div class="scribe-session-meta">${visitType} · ${time}</div>
                </div>
                <div class="scribe-status-badge" style="background:${statusColors[status] || 'var(--text-tertiary)'}20; color:${statusColors[status] || 'var(--text-tertiary)'}">
                    ${statusLabels[status] || status}
                </div>
            </div>
            ${status === 'transcribing' ? `
                <button class="scribe-retry-btn" onclick="event.stopPropagation(); retryTranscription('${session.session_id}');"
                        style="margin-top:8px; padding:8px 16px; background:var(--cyan); color:#000; border:none; border-radius:8px; font-weight:600; cursor:pointer;">
                    🔄 Check Status
                </button>
            ` : ''}
            ${session.transcript_length > 0 ? `
                <div class="scribe-session-detail">
                    <span>📝 ${session.transcript_length.toLocaleString()} chars transcribed</span>
                    ${session.has_note ? '<span>📋 SOAP note generated</span>' : ''}
                    ${session.healthie_note_id ? '<span>✅ In Healthie</span>' : ''}
                </div>
            ` : ''}
        </div>
    `;
}

// Connect or change the patient for a scribe session
async function connectPatientToSession(sessionId) {
    // Show a patient picker overlay
    const overlay = document.createElement('div');
    overlay.id = 'patientPickerOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:var(--card);border-radius:16px;padding:24px;width:90%;max-width:500px;max-height:70vh;display:flex;flex-direction:column;border:1px solid rgba(0,212,255,0.2);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                <h3 style="margin:0;color:var(--text-primary);font-size:18px;">🔗 Connect Patient</h3>
                <button onclick="document.getElementById('patientPickerOverlay').remove()"
                    style="background:none;border:none;color:var(--text-secondary);font-size:20px;cursor:pointer;">✕</button>
            </div>
            <input id="patientPickerSearch" type="text" placeholder="Search any patient by name..."
                style="padding:12px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--text-primary);font-size:15px;margin-bottom:12px;outline:none;"
                oninput="debouncedPatientSearch(this.value)">
            <div id="patientPickerList" style="flex:1;overflow-y:auto;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    window._pickerSessionId = sessionId;
    
    // Default to today's scheduled patients
    const patientPickerList = document.getElementById('patientPickerList');
    const uniquePatients = [];
    const seen = new Set();
    (healthieAppointments || []).forEach(a => {
        const id = a.healthie_id || a.patient_id || a.id;
        const nm = a.patient_name || a.full_name;
        if (id && nm && !seen.has(id)) {
            seen.add(id);
            uniquePatients.push({ id: id, first_name: nm, last_name: '' });
        }
    });

    if (uniquePatients.length > 0) {
        renderPatientPickerList(uniquePatients);
    } else {
        patientPickerList.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">Type a name to search Healthie</div>';
    }
}

let _pickerSearchTimeout = null;
function debouncedPatientSearch(searchText) {
    if (_pickerSearchTimeout) clearTimeout(_pickerSearchTimeout);
    
    const list = document.getElementById('patientPickerList');
    if (!searchText || searchText.length < 2) {
        // Revert to default schedule if empty
        const uniquePatients = [];
        const seen = new Set();
        (healthieAppointments || []).forEach(a => {
            const id = a.healthie_id || a.patient_id || a.id;
            const nm = a.patient_name || a.full_name;
            if (id && !seen.has(id)) { seen.add(id); uniquePatients.push({ id: id, first_name: nm, last_name: '' }); }
        });
        if (uniquePatients.length > 0) renderPatientPickerList(uniquePatients);
        else list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">Type a name to search Healthie</div>';
        return;
    }

    list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">Searching Healthie...</div>';
    
    _pickerSearchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch(`/ops/api/patients/search/?q=${encodeURIComponent(searchText)}`);
            const data = await resp.json();
            if (data.success && data.patients && data.patients.length > 0) {
                renderPatientPickerList(data.patients);
            } else {
                list.innerHTML = '<div style="color:var(--text-secondary);padding:20px;text-align:center;">No patients found matching "'+searchText+'"</div>';
            }
        } catch(e) {
            list.innerHTML = '<div style="color:#ef4444;padding:20px;text-align:center;">Search failed</div>';
        }
    }, 400);
}

function renderPatientPickerList(patients) {
    const list = document.getElementById('patientPickerList');
    if (!list) return;
    list.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;padding-left:8px;text-transform:uppercase;">Select Patient</div>' + patients.map(p => {
        const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown';
        const hid = p.healthie_id || p.id || '';
        return `
            <div onclick="selectPatientForSession('${hid}', '${name.replace(/'/g, "\\'")}')"
                style="padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;color:var(--text-primary);
                display:flex;justify-content:space-between;align-items:center;transition:background 0.15s; border-radius:8px;"
                onmouseover="this.style.background='rgba(0,212,255,0.08)'" onmouseout="this.style.background='none'">
                <div>
                    <div style="font-weight:600;font-size:15px;">${name}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">Healthie ID: ${hid}</div>
                </div>
                <span style="color:var(--cyan);font-size:14px;">Select →</span>
            </div>
        `;
    }).join('');
}

async function selectPatientForSession(healthieId, patientName) {
    const sessionId = window._pickerSessionId;
    if (!sessionId || !healthieId) return;

    // Close the picker
    const overlay = document.getElementById('patientPickerOverlay');
    if (overlay) overlay.remove();

    showToast(`Connecting ${patientName} to session…`, 'info');

    try {
        const resp = await fetch(`/ops/api/scribe/sessions/${sessionId}/change-patient/`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ healthie_patient_id: healthieId }),
        });
        const result = await resp.json();
        if (result.success) {
            showToast(`✅ Connected ${result.data.new_patient_name} to session`, 'success');
            // Refresh the scribe list by invalidating memory cache
            scribeLoaded = false;
            scribeView = 'list';
            renderCurrentTab();
        } else {
            showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        showToast('Error connecting patient: ' + e.message, 'error');
    }
}

function startNewScribeSession() {
    scribeView = 'new';
    renderCurrentTab();
}

function renderScribeNewSession(container) {
    container.innerHTML = `
        <div class="scribe-header-row">
            <button class="scribe-back-btn" onclick="scribeView='list'; renderCurrentTab();">← Back</button>
            <h1 style="font-size:24px;">New Scribe Session</h1>
            ${getChartToggleBtn()}
        </div>
        ${getChartPanelHTML()}

        <div class="scribe-form">
            <div class="scribe-field">
                <label>Patient (Healthie)</label>
                <div class="patient-search-wrapper">
                    <input type="text" id="scribePatientSearch" class="patient-search-input"
                           placeholder="Type 2+ letters to search patients…"
                           autocomplete="off" />
                    <div id="scribePatientResults" class="patient-search-results"></div>
                    <div id="scribePatientSelected" class="patient-selected-badge" style="display:none;"></div>
                </div>
            </div>
            <div class="scribe-field">
                <label>Visit Type</label>
                <div class="scribe-visit-types">
                    ${['follow_up', 'initial', 'urgent', 'telehealth', 'procedure'].map(vt => `
                        <button class="visit-type-btn ${scribeVisitType === vt ? 'active' : ''}" 
                                onclick="scribeVisitType='${vt}'; document.querySelectorAll('.visit-type-btn').forEach(b=>b.classList.remove('active')); this.classList.add('active');">
                            ${vt.replace(/_/g, ' ')}
                        </button>
                    `).join('')}
                </div>
            </div>
            <div class="scribe-field">
                <label>Encounter Date</label>
                <input type="date" id="scribeEncounterDate"
                       value="${new Date().toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE })}"
                       max="${new Date().toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE })}"
                       style="padding:10px 12px; border-radius:8px; border:1px solid var(--border); background:var(--surface); color:var(--text-primary); font-size:14px; width:100%;" />
                <p style="font-size:12px; color:var(--text-tertiary); margin-top:4px;">Change to backdate notes for past visits</p>
            </div>
            <div class="scribe-field">
                <label>Input Method</label>
                <div class="scribe-method-toggle">
                    <button class="method-btn active" id="methodRecord" onclick="selectScribeMethod('record')">
                        🎙 Record Audio
                    </button>
                    <button class="method-btn" id="methodType" onclick="selectScribeMethod('type')">
                        ⌨️ Type Transcript
                    </button>
                </div>
            </div>
            <div id="scribeMethodContent">
                <div class="scribe-record-prompt">
                    <div class="record-icon-large">🎙</div>
                    <p>Tap <strong>Start Recording</strong> to capture the visit conversation.</p>
                    <p style="font-size:12px; color:var(--text-tertiary);">Audio is transcribed by AWS Transcribe Medical</p>
                </div>
            </div>
            <button class="btn-primary scribe-start-btn" id="scribeStartBtn" onclick="beginScribeCapture()" disabled>
                Start Recording
            </button>
        </div>
    `;

    // Wire up typeahead patient search
    // NOTE: container is a detached DOM element at this point (appended to doc AFTER this fn returns)
    // So we MUST use container.querySelector, NOT document.getElementById
    let searchTimeout = null;
    const input = container.querySelector('#scribePatientSearch');
    const results = container.querySelector('#scribePatientResults');
    const badge = container.querySelector('#scribePatientSelected');


    // Ensure allPatients is loaded for local search — ALWAYS retry if empty
    if (allPatients.length === 0) {
        console.log('[Scribe] allPatients is empty, force loading…');
        patientsLoaded = false; // reset so it retries
        loadAllPatients().then(ok => {
            console.log('[Scribe] Patient load result:', ok, 'count:', allPatients.length);
        }).catch(e => console.warn('[Scribe] Pre-load patients failed:', e));
    } else {
        console.log('[Scribe] allPatients already loaded:', allPatients.length);
    }

    if (input) {
        console.log('[Scribe] Patient search input wired up');
        input.addEventListener('input', () => {
            const q = input.value.trim();
            console.log('[Scribe] Search input:', q, 'allPatients:', allPatients.length);
            if (searchTimeout) clearTimeout(searchTimeout);
            if (q.length < 2) {
                results.innerHTML = '';
                results.style.display = 'none';
                return;
            }
            // Show searching indicator immediately
            results.innerHTML = '<div class="patient-search-loading">Searching…</div>';
            results.style.display = 'block';
            searchTimeout = setTimeout(async () => {
                // Instant local search from allPatients
                const ql = q.toLowerCase();
                const localMatches = allPatients.filter(p => {
                    const nm = (p.name || p.full_name || p.patient_name || '').toLowerCase();
                    return nm.includes(ql);
                }).slice(0, 15).map(p => ({
                    patient_id: p.id || p.patient_id || '',
                    healthie_id: p.healthie_client_id || '',
                    name: p.name || p.full_name || p.patient_name || 'Unknown',
                    dob: p.dob || '',
                    email: p.email || '',
                    source: 'local',
                }));

                console.log('[Scribe] Local matches:', localMatches.length);

                // Show local results immediately
                if (localMatches.length > 0) {
                    renderScribeSearchResults(localMatches, results);
                }

                // Also try Healthie search (async, graceful fallback)
                try {
                    const hData = await apiFetch(`/ops/api/patients/search/?q=${encodeURIComponent(q)}`);
                    const hResults = (hData?.patients || []).map(p => ({
                        patient_id: '',
                        healthie_id: p.healthie_id || p.id || '',
                        name: `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown',
                        dob: p.dob || '',
                        email: p.email || '',
                        source: 'healthie',
                    }));
                    // Merge: keep local matches first, add unique Healthie results
                    const seenNames = new Set(localMatches.map(p => p.name.toLowerCase()));
                    const uniqueHealthie = hResults.filter(p => !seenNames.has(p.name.toLowerCase()));
                    const combined = [...localMatches, ...uniqueHealthie].slice(0, 15);
                    console.log('[Scribe] Combined results:', combined.length);
                    if (combined.length > 0) {
                        renderScribeSearchResults(combined, results);
                    } else if (localMatches.length === 0) {
                        results.innerHTML = '<div class="patient-search-empty">No patients found</div>';
                        results.style.display = 'block';
                    }
                } catch (he) {
                    // Healthie search failed — just show local results
                    console.warn('[Scribe] Healthie search failed:', he.message);
                    if (localMatches.length === 0) {
                        results.innerHTML = '<div class="patient-search-empty">No patients found — check connection</div>';
                        results.style.display = 'block';
                    }
                }
            }, 200);
        });
    } else {
        console.error('[Scribe] Patient search input NOT found in DOM!');
    }
}

function renderScribeSearchResults(patients, resultsEl) {
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = patients.map(p => {
        const dob = p.dob ? ` · DOB: ${p.dob}` : '';
        const src = p.source === 'healthie' ? ' <span style="font-size:9px; color:#22d3ee;">Healthie</span>' : '';
        const pid = p.patient_id || p.healthie_id || '';
        return `<div class="patient-search-item" onclick="selectScribePatient('${pid}', '${p.name.replace(/'/g, "\\'")}')">
            <span class="patient-search-name">${p.name}${src}</span>
            <span class="patient-search-detail">${p.email || ''}${dob}</span>
        </div>`;
    }).join('');
}

function selectScribePatient(healthieId, name) {
    scribePatientId = healthieId;
    scribePatientName = name;
    const input = document.getElementById('scribePatientSearch');
    const results = document.getElementById('scribePatientResults');
    const badge = document.getElementById('scribePatientSelected');
    const btn = document.getElementById('scribeStartBtn');

    if (input) input.value = '';
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    if (badge) {
        badge.style.display = 'flex';
        badge.innerHTML = `
            <span>👤 ${name}</span>
            <button onclick="clearScribePatient()" class="patient-clear-btn">✕</button>
        `;
    }
    if (btn) btn.disabled = false;

    // Auto-load chart into the global panel (visible from any view)
    openChartForPatient(healthieId, name);

    // Add chart button to header if not already present
    const headerRow = document.querySelector('.scribe-header-row');
    if (headerRow && !headerRow.querySelector('.chart-toggle-btn')) {
        const chartBtn = document.createElement('button');
        chartBtn.className = 'chart-toggle-btn';
        chartBtn.textContent = '📋 Chart';
        chartBtn.onclick = () => toggleChartPanel();
        headerRow.appendChild(chartBtn);
    }
}

function clearScribePatient() {
    scribePatientId = null;
    scribePatientName = '';
    const badge = document.getElementById('scribePatientSelected');
    const btn = document.getElementById('scribeStartBtn');
    if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
    if (btn) btn.disabled = true;
}

async function discardScribeSession() {
    if (!activeScribeSession) return;
    if (!confirm('Discard this session? This cannot be undone.')) return;
    try {
        await fetch(`/ops/api/scribe/sessions/${activeScribeSession.session_id}/`, {
            method: 'DELETE',
            credentials: 'include',
        });
        showToast('Session discarded', 'info');
    } catch (e) {
        console.warn('Discard API failed:', e);
    }
    activeScribeSession = null;
    currentNote = null;
    scribeView = 'list';
    await loadScribeSessions();
    renderCurrentTab();
    updateBadges();
}

function selectScribeMethod(method) {
    document.getElementById('methodRecord').classList.toggle('active', method === 'record');
    document.getElementById('methodType').classList.toggle('active', method === 'type');
    const content = document.getElementById('scribeMethodContent');
    const btn = document.getElementById('scribeStartBtn');

    if (method === 'type') {
        content.innerHTML = `
            <div class="scribe-field">
                <label>Paste or type the visit transcript</label>
                <textarea id="scribeManualTranscript" class="scribe-textarea" rows="10" 
                          placeholder="Enter the visit notes or transcript here…"></textarea>
            </div>
        `;
        btn.textContent = 'Submit Transcript';
        btn.onclick = submitManualTranscript;
    } else {
        content.innerHTML = `
            <div class="scribe-record-prompt">
                <div class="record-icon-large">🎙</div>
                <p>Tap <strong>Start Recording</strong> to capture the visit conversation.</p>
                <p style="font-size:12px; color:var(--text-tertiary);">Audio is transcribed by Deepgram Nova-2 Medical</p>
            </div>
        `;
        btn.textContent = 'Start Recording';
        btn.onclick = beginScribeCapture;
    }
}

// Smart MIME type detection — iPad/Safari prefers mp4, Chrome/Firefox prefer webm
function getRecordingMimeType() {
    const candidates = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4;codecs=mp4a.40.2',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/wav',
    ];
    for (const mt of candidates) {
        try {
            if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt)) {
                console.log('[Scribe] Using MIME type:', mt);
                return mt;
            }
        } catch (e) { /* skip */ }
    }
    console.warn('[Scribe] No preferred MIME type supported, using browser default');
    return ''; // let browser pick
}

// Store detected MIME type globally so handleRecordingComplete can use it
let recordingMimeType = '';

async function beginScribeCapture() {
    // ✅ Reset recording warning flag
    window._recordingWarningShown = false;
    if (!scribePatientId) {
        showToast('Please select a patient first', 'error');
        return;
    }

    // Check for MediaRecorder support (very old browsers)
    if (typeof MediaRecorder === 'undefined') {
        showToast('Recording not supported on this browser. Please update your iPad.', 'error');
        return;
    }

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (micErr) {
        console.error('[Scribe] Microphone access error:', micErr);
        if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
            showToast('Microphone access denied. Please allow microphone access in Settings → Safari → Microphone.', 'error');
        } else if (micErr.name === 'NotFoundError') {
            showToast('No microphone found. Please check your device.', 'error');
        } else {
            showToast('Could not access microphone: ' + (micErr.message || micErr.name), 'error');
        }
        return;
    }

    try {
        audioChunks = [];
        recordingMimeType = getRecordingMimeType();
        const recorderOptions = recordingMimeType ? { mimeType: recordingMimeType } : {};
        mediaRecorder = new MediaRecorder(stream, recorderOptions);
        // Update recordingMimeType to what the browser actually chose
        recordingMimeType = mediaRecorder.mimeType || recordingMimeType;
        console.log('[Scribe] MediaRecorder created with mimeType:', mediaRecorder.mimeType);

        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = handleRecordingComplete;
        mediaRecorder.onerror = (e) => {
            console.error('[Scribe] MediaRecorder error:', e);
            showToast('Recording error: ' + (e.error?.message || 'unknown'), 'error');
            stopScribeRecording();
        };
        mediaRecorder.start(1000); // collect in 1-sec chunks
        isRecording = true;
        isPaused = false;
        autoPausedBySystem = false;
        pausedDuration = 0;
        pauseStartTime = null;
        // Set up AudioContext analyser for real audio level visualization
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            audioAnalyser = audioContext.createAnalyser();
            audioAnalyser.fftSize = 128;
            source.connect(audioAnalyser);
        } catch (e) {
            console.warn('AudioContext not available, using fallback waveform:', e);
        }
        recordingStartTime = Date.now();
        scribeView = 'recording';
        // Auto-open chart in global panel (persists across view changes)
        chartPanelOpen = true;
        renderCurrentTab();
        const pid = scribePatientId || activeScribeSession?.patient_id;
        const pname = scribePatientName || activeScribeSession?.patient_name || 'Patient';
        if (pid) {
            openChartForPatient(pid, pname);
        }
        // Start timer
        recordingTimer = setInterval(updateRecordingTimer, 1000);
        showToast('Recording started', 'success');
    } catch (err) {
        // Stop the mic stream if MediaRecorder fails
        stream.getTracks().forEach(t => t.stop());
        console.error('[Scribe] MediaRecorder creation error:', err);
        showToast('Could not start recording: ' + (err.message || 'unsupported format'), 'error');
    }
}

function renderScribeRecording(container) {
    const pauseLabel = isPaused ? '▶ Resume' : '⏸ Pause';
    const recordingState = isPaused ? 'paused' : 'active';

    const autoPauseBanner = autoPausedBySystem ? `
                <div class="auto-pause-banner" onclick="togglePauseRecording()">
                    <div class="auto-pause-icon">⚠️</div>
                    <div class="auto-pause-text">
                        <strong>Recording auto-paused</strong>
                        <span>Interrupted by phone call or app switch — tap here to resume</span>
                    </div>
                </div>
            ` : '';

    container.innerHTML = `
        <div class="scribe-recording-view">
            <div class="scribe-header-row">
                <h1 style="font-size:24px;">${autoPausedBySystem ? '⚠️ Auto-Paused' : isPaused ? '⏸ Paused' : '🔴 Recording Visit'}</h1>
                ${getChartToggleBtn()}
            </div>
            ${autoPauseBanner}
            ${getChartPanelHTML()}
            <div class="scribe-recording-center">
                <div class="recording-pulse-ring ${isPaused ? 'recording-paused' : ''}">
                    <div class="recording-pulse-dot"></div>
                </div>
                <div class="recording-timer" id="recordingTimer">00:00</div>
                <div class="recording-patient">${getPatientNameById(scribePatientId)}</div>
                <div class="recording-visit-type">${scribeVisitType.replace(/_/g, ' ')}</div>
            </div>
            <div class="recording-waveform" id="waveform">
                ${Array.from({ length: 40 }, () => '<div class="wave-bar"></div>').join('')}
            </div>
            <div class="recording-controls" style="display:flex; gap:12px; justify-content:center;">
                <button class="btn-pause-recording" onclick="togglePauseRecording()" style="
                    padding:14px 28px; border-radius:12px; font-size:15px; font-weight:600;
                    background:${isPaused ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)'};
                    color:${isPaused ? '#22c55e' : '#fbbf24'};
                    border:1px solid ${isPaused ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)'};
                    cursor:pointer; font-family:inherit;
                ">${pauseLabel}</button>
                <button class="btn-stop-recording" onclick="stopScribeRecording()">
                    <span class="stop-icon">◼</span> Stop Recording
                </button>
            </div>
        </div>
    `;
    animateWaveform();
}

function updateRecordingTimer() {
    const el = document.getElementById('recordingTimer');
    if (!el || !recordingStartTime) return;
    // Subtract paused time from elapsed
    const currentPause = isPaused && pauseStartTime ? (Date.now() - pauseStartTime) : 0;
    const elapsed = Math.floor((Date.now() - recordingStartTime - pausedDuration - currentPause) / 1000);

    // ✅ AUTO-STOP AT 60 MINUTES
    if (elapsed >= 3600 && isRecording) {
        showToast('⚠️ Maximum recording length (1 hour) reached - stopping automatically', 'warning');
        stopScribeRecording();
        return;
    }

    // ✅ WARN AT 55 MINUTES
    if (elapsed === 3300 && !window._recordingWarningShown) {
        showToast('⚠️ Recording will auto-stop at 60 minutes (5 min remaining)', 'warning', 10000);
        window._recordingWarningShown = true;
    }
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
}

function animateWaveform() {
    const bars = document.querySelectorAll('.wave-bar');
    if (bars.length === 0 || !isRecording) return;

    if (isPaused) {
        // Show flat bars when paused
        bars.forEach(bar => { bar.style.height = '8%'; });
        if (isRecording) requestAnimationFrame(() => setTimeout(animateWaveform, 200));
        return;
    }

    if (audioAnalyser) {
        // Use real audio frequency data
        const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
        audioAnalyser.getByteFrequencyData(dataArray);
        const step = Math.max(1, Math.floor(dataArray.length / bars.length));
        bars.forEach((bar, i) => {
            const val = dataArray[Math.min(i * step, dataArray.length - 1)] || 0;
            bar.style.height = Math.max(5, (val / 255) * 90) + '%';
        });
    } else {
        // Fallback: random animation
        bars.forEach(bar => {
            bar.style.height = (Math.random() * 60 + 10) + '%';
        });
    }
    if (isRecording) requestAnimationFrame(() => setTimeout(animateWaveform, 80));
}

function togglePauseRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

    if (isPaused) {
        // Resume
        mediaRecorder.resume();
        isPaused = false;
        autoPausedBySystem = false;
        pausedDuration += (Date.now() - (pauseStartTime || Date.now()));
        pauseStartTime = null;
        showToast('Recording resumed', 'info');
    } else {
        // Pause
        mediaRecorder.pause();
        isPaused = true;
        pauseStartTime = Date.now();
        showToast('Recording paused', 'info');
    }
    renderCurrentTab();
    // Restart timer update
    if (recordingTimer) clearInterval(recordingTimer);
    recordingTimer = setInterval(updateRecordingTimer, 1000);
}

function getPatientNameById(id) {
    // Use scribePatientName if it matches the current scribe patient
    if (scribePatientName && id === scribePatientId) return scribePatientName;
    if (stageDosePatientName && id === stageDosePatientId) return stageDosePatientName;
    const patients = getPatients();
    const p = patients.find(p => String(p.id || p.patient_id) === String(id) || String(p.healthie_client_id) === String(id));
    return p ? (p.name || p.patient_name || p.full_name || 'Unknown') : (scribePatientName || 'Unknown Patient');
}

function stopScribeRecording() {
    if (mediaRecorder && (mediaRecorder.state === 'recording' || mediaRecorder.state === 'paused')) {
        if (mediaRecorder.state === 'paused') mediaRecorder.resume(); // must resume before stop
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    isRecording = false;
    isPaused = false;
    autoPausedBySystem = false;
    pausedDuration = 0;
    pauseStartTime = null;
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
    // Clean up audio analyser
    if (audioContext) { try { audioContext.close(); } catch (e) { } audioContext = null; }
    audioAnalyser = null;
}

async function handleRecordingComplete() {
    showToast('Uploading audio for transcription…', 'info');

    // Use the actual MIME type that was recorded (detected in beginScribeCapture)
    const mimeType = recordingMimeType || 'audio/webm';
    const blob = new Blob(audioChunks, { type: mimeType });

    // Determine file extension from MIME type
    const extMap = {
        'audio/webm;codecs=opus': 'webm',
        'audio/webm': 'webm',
        'audio/mp4;codecs=mp4a.40.2': 'mp4',
        'audio/mp4': 'mp4',
        'audio/ogg;codecs=opus': 'ogg',
        'audio/wav': 'wav',
        'audio/x-wav': 'wav',
    };
    const ext = extMap[mimeType] || (mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm');
    const filename = `visit-recording.${ext}`;
    console.log(`[Scribe] Uploading: ${filename} (${mimeType}, ${(blob.size / 1024).toFixed(1)}KB)`);

    // CRITICAL: Save blob to global variable for retry on failure
    window._pendingRecordingBlob = blob;
    window._pendingRecordingMeta = {
        filename, mimeType, ext,
        patientId: scribePatientId,
        patientName: scribePatientName || 'Unknown',
        visitType: scribeVisitType,
        savedAt: new Date().toISOString(),
    };

    // Also backup to IndexedDB so it survives page refresh
    try {
        const dbReq = indexedDB.open('scribe_backup', 1);
        dbReq.onupgradeneeded = (e) => { e.target.result.createObjectStore('recordings', { keyPath: 'id' }); };
        dbReq.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('recordings', 'readwrite');
            tx.objectStore('recordings').put({
                id: 'pending_' + Date.now(),
                blob: blob,
                meta: window._pendingRecordingMeta,
            });
        };
    } catch (idbErr) { console.warn('[Scribe] IndexedDB backup failed:', idbErr); }

    await attemptScribeUpload(blob, filename);
}

// Separate upload function so it can be retried
async function attemptScribeUpload(blob, filename) {
    const formData = new FormData();
    formData.append('audio', blob, filename);
    formData.append('patient_id', scribePatientId);
    formData.append('visit_type', scribeVisitType);
    formData.append('patient_name', scribePatientName || '');
    const encounterDateEl = document.getElementById('scribeEncounterDate');
    if (encounterDateEl?.value) formData.append('encounter_date', encounterDateEl.value);

    try {
        const resp = await fetch('/ops/api/scribe/transcribe/', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });

        // Check response status BEFORE parsing JSON
        if (!resp.ok) {
            const errorText = await resp.text().catch(() => 'Unknown error');
            console.error('[Scribe] Upload failed:', resp.status, errorText.substring(0, 200));
            showUploadFailedRetryScreen(resp.status, errorText.substring(0, 100));
            return;
        }

        // Safe JSON parse
        let data;
        try {
            data = await resp.json();
        } catch (parseErr) {
            console.error('[Scribe] Response parse error:', parseErr);
            showUploadFailedRetryScreen(0, 'Server returned invalid response');
            return;
        }

        if (data.success) {
            // Clear backup on success
            window._pendingRecordingBlob = null;
            window._pendingRecordingMeta = null;
            try { indexedDB.deleteDatabase('scribe_backup'); } catch (e) {}

            activeScribeSession = data.data;
            // Check if transcription is async (AWS Transcribe) or already done
            if (data.data.status === 'transcribing' || data.data.transcription_job_name) {
                // ✅ NEW: Start background polling instead of blocking UI
                startBackgroundTranscriptionPoll(data.data.session_id);
                showToast('✅ Audio uploaded! Transcribing in background...', 'success');
                // Return to list immediately
                scribeView = 'list';
                await loadScribeSessions();
                renderCurrentTab();
                updateBadges();
                return;
            } else if (data.data.status === 'transcribed') {
                // Sync transcription already complete
                showToast(`✅ Transcribed! ${data.data.transcript_length || 0} characters`, 'success');
                await loadScribeSessions();
                scribeView = 'note';
                renderCurrentTab();
                updateBadges();
            } else {
                showToast(`Transcribed! ${data.data.transcript_length || 0} characters`, 'success');
                await loadScribeSessions();
                scribeView = 'note';
                renderCurrentTab();
                updateBadges();
            }
        } else {
            showUploadFailedRetryScreen(0, data.error || 'Transcription failed');
        }
    } catch (e) {
        console.error('[Scribe] Transcription error:', e);
        showUploadFailedRetryScreen(0, e.message || 'Network error');
    }
}

// Show a retry screen instead of discarding the recording on failure
function showUploadFailedRetryScreen(status, errorMsg) {
    showToast('Upload failed — your recording is saved locally. You can retry.', 'error');
    const container = document.getElementById('mainContent');
    if (!container) return;
    const meta = window._pendingRecordingMeta || {};
    const blobSize = window._pendingRecordingBlob ? (window._pendingRecordingBlob.size / (1024 * 1024)).toFixed(1) + ' MB' : 'unknown';
    container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; max-width:500px; margin:0 auto;">
            <div style="font-size:48px; margin-bottom:16px;">⚠️</div>
            <h2 style="color:#ef4444; margin-bottom:8px;">Upload Failed</h2>
            <p style="color:var(--text-secondary); margin-bottom:20px;">
                Error: ${errorMsg}${status ? ' (HTTP ' + status + ')' : ''}
            </p>
            <div style="background:var(--surface); border:1px solid var(--border-light); border-radius:12px; padding:16px; margin-bottom:20px; text-align:left;">
                <div style="font-size:13px; color:var(--text-secondary);">
                    <strong>Patient:</strong> ${meta.patientName || 'Unknown'}<br>
                    <strong>Audio size:</strong> ${blobSize}<br>
                    <strong>Recorded at:</strong> ${meta.savedAt ? new Date(meta.savedAt).toLocaleTimeString() : 'Unknown'}
                </div>
            </div>
            <p style="color:#22c55e; font-size:13px; margin-bottom:20px;">
                ✅ Your recording is saved in browser memory. Do NOT close this tab.
            </p>
            <div style="display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                <button onclick="retryScribeUpload()" style="padding:12px 24px; border-radius:10px; background:var(--cyan); color:#000; font-weight:700; font-size:15px; border:none; cursor:pointer;">
                    🔄 Retry Upload
                </button>
                <button onclick="downloadPendingRecording()" style="padding:12px 24px; border-radius:10px; background:var(--surface); color:var(--text-primary); font-weight:600; font-size:14px; border:1px solid var(--border-light); cursor:pointer;">
                    💾 Download Audio
                </button>
                <button onclick="scribeView='list'; renderCurrentTab();" style="padding:12px 24px; border-radius:10px; background:transparent; color:var(--text-tertiary); font-weight:500; font-size:13px; border:1px solid var(--border-light); cursor:pointer;">
                    Discard & Go Back
                </button>
            </div>
        </div>
    `;
}

function retryScribeUpload() {
    if (!window._pendingRecordingBlob) {
        showToast('No pending recording found', 'error');
        return;
    }
    const meta = window._pendingRecordingMeta || {};
    showToast('Retrying upload…', 'info');
    attemptScribeUpload(window._pendingRecordingBlob, meta.filename || 'visit-recording.webm');
}

function downloadPendingRecording() {
    if (!window._pendingRecordingBlob) {
        showToast('No pending recording found', 'error');
        return;
    }
    const meta = window._pendingRecordingMeta || {};
    const url = URL.createObjectURL(window._pendingRecordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (meta.patientName || 'recording').replace(/[^a-zA-Z0-9]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.' + (meta.ext || 'webm');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Audio file downloaded', 'success');
}

// ❌ DEPRECATED: Old blocking pollTranscription removed - now using background polling
// See startBackgroundTranscriptionPoll() instead

async function submitManualTranscript() {
    const textarea = document.getElementById('scribeManualTranscript');
    if (!textarea || !textarea.value.trim()) {
        showToast('Please enter a transcript', 'error');
        return;
    }
    if (!scribePatientId) {
        showToast('Please select a patient', 'error');
        return;
    }

    showToast('Submitting transcript…', 'info');
    const formData = new FormData();
    formData.append('patient_id', scribePatientId);
    formData.append('visit_type', scribeVisitType);
    formData.append('patient_name', scribePatientName || '');
    formData.append('transcript', textarea.value.trim());
    const encounterDateEl = document.getElementById('scribeEncounterDate');
    if (encounterDateEl?.value) formData.append('encounter_date', encounterDateEl.value);

    try {
        const resp = await fetch('/ops/api/scribe/transcribe/', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });
        const data = await resp.json();
        if (data.success) {
            activeScribeSession = data.data;
            showToast('Transcript saved!', 'success');
            await loadScribeSessions();
            scribeView = 'note';
            renderCurrentTab();
            updateBadges();
        } else {
            showToast(data.error || 'Submission failed', 'error');
        }
    } catch (e) {
        showToast('Submission failed', 'error');
    }
}

function openScribeSession(sessionId, view) {
    const session = scribeSessions.find(s => s.session_id === sessionId);
    if (session) {
        activeScribeSession = session;
        scribeView = view || 'note';
        scribePatientId = session.patient_id;

        // ✅ FIX: If opening review and note exists, load it first (don't regenerate!)
        if (view === 'review' && session.has_note) {
            console.log('[Scribe] Loading existing note instead of regenerating...');
            loadExistingScribeNote(sessionId).then(loaded => {
                if (loaded) {
                    console.log('[Scribe] ✅ Existing note loaded from cache');
                } else {
                    console.warn('[Scribe] Failed to load existing note - will need to regenerate');
                }
                renderCurrentTab();
            });
        } else {
            renderCurrentTab();
        }
    }
}

// ✅ NEW: Load existing note from database (avoid CPU-heavy regeneration)
async function loadExistingScribeNote(sessionId) {
    try {
        const resp = await fetch(`/ops/api/scribe/sessions/${sessionId}/note`, {
            credentials: 'include'
        });

        if (resp.ok) {
            const result = await resp.json();
            if (result.success) {
                currentNote = result.data;
                console.log('[Scribe] Note loaded:', currentNote.note_id, '| Status:', currentNote.healthie_status);
                return true;
            }
        } else if (resp.status === 404) {
            console.log('[Scribe] No existing note found (will need to generate)');
        } else {
            console.warn('[Scribe] Failed to load note:', resp.status);
        }
    } catch (e) {
        console.error('[Scribe] Exception loading note:', e);
    }
    return false;
}

function renderScribeNote(container) {
    if (!activeScribeSession) { scribeView = 'list'; renderCurrentTab(); return; }

    container.innerHTML = `
        <div class="scribe-header-row">
            <button class="scribe-back-btn" onclick="scribeView='list'; renderCurrentTab();">← Back</button>
            <h1 style="font-size:24px;">Generate SOAP Note</h1>
            ${getChartToggleBtn()}
        </div>
        ${getChartPanelHTML()}

        <div class="scribe-session-summary">
            <div class="scribe-session-patient">${activeScribeSession.patient_name || getPatientNameById(scribePatientId)}</div>
            <div class="scribe-session-meta">${(activeScribeSession.visit_type || scribeVisitType).replace(/_/g, ' ')} · Session ${activeScribeSession.session_id?.slice(0, 8)}…</div>
        </div>

        <div class="scribe-action-card" onclick="generateSOAPNote()">
            <div class="scribe-action-icon">🧠</div>
            <div class="scribe-action-text">
                <div class="scribe-action-title">Generate SOAP Note with AI</div>
                <div class="scribe-action-desc">AI will analyze the transcript and patient context to generate a structured SOAP note with ICD-10 and CPT codes.</div>
            </div>
            <div class="action-arrow">›</div>
        </div>

        ${activeScribeSession.has_note ? `
            <div class="scribe-action-card" onclick="openScribeSession('${activeScribeSession.session_id}', 'review')">
                <div class="scribe-action-icon">📋</div>
                <div class="scribe-action-text">
                    <div class="scribe-action-title">View Existing Note</div>
                    <div class="scribe-action-desc">Review the previously generated SOAP note.</div>
                </div>
                <div class="action-arrow">›</div>
            </div>
        ` : ''}

        <div class="scribe-transcript-preview">
            <h3>Transcript Preview</h3>
            <div class="transcript-text-preview">
                ${activeScribeSession.transcript_length > 0 ?
            `<p style="color:var(--text-secondary); font-size:13px;">${activeScribeSession.transcript_length.toLocaleString()} characters transcribed</p>` :
            '<p style="color:var(--text-tertiary);">No transcript available</p>'
        }
            </div>
        </div>

        <div style="margin-top:16px; text-align:center;">
            <button onclick="discardScribeSession()" class="scribe-discard-btn" style="background:transparent; border:1px solid var(--error-color,#ef4444); color:var(--error-color,#ef4444); padding:10px 24px; border-radius:8px; font-size:14px; cursor:pointer;">
                🗑 Discard Session
            </button>
        </div>
    `;
}

async function generateSOAPNote(regen = false) {
    if (!activeScribeSession) return;
    showPersistentToast(regen ? 'Regenerating SOAP note with AI…' : 'Generating SOAP note with AI… (30-60 sec)');

    try {
        // Fetch current medications from DoseSpot/prescriptions for SOAP context
        let currentMedications = [];
        const healthieId = scribePatientId || activeScribeSession.patient_id;
        if (healthieId) {
            try {
                const rxData = await apiFetch(`/ops/api/prescriptions/${healthieId}/`);
                const rxList = rxData?.prescriptions || rxData?.active || rxData?.categorized?.active || [];
                currentMedications = rxList.map(rx => ({
                    name: rx.product_name || rx.display_name,
                    dosage: rx.dosage,
                    directions: rx.directions,
                    schedule: rx.schedule,
                    prescriber: rx.prescriber_name,
                    date_written: rx.date_written,
                    route: rx.route,
                }));
            } catch (err) {
                console.warn('[Scribe] Failed to fetch medications for SOAP context (non-blocking):', err);
            }
        }

        // Use raw fetch to get full error details
        const resp = await fetch('/ops/api/scribe/generate-note/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: activeScribeSession.session_id,
                patient_id: healthieId,
                visit_type: scribeVisitType || activeScribeSession.visit_type,
                patient_name: scribePatientName || activeScribeSession.patient_name || '',
                regenerate: regen,
                current_medications: currentMedications,
            }),
            credentials: 'include',
        });
        const result = await resp.json();

        if (result?.success) {
            // Flatten nested soap structure for consistent access
            const noteData = result.data || {};
            if (noteData.soap) {
                noteData.soap_subjective = noteData.soap.subjective || '';
                noteData.soap_objective = noteData.soap.objective || '';
                noteData.soap_assessment = noteData.soap.assessment || '';
                noteData.soap_plan = noteData.soap.plan || '';
            }
            currentNote = noteData;
            dismissPersistentToast();
            showToast('SOAP note generated! ✅', 'success');
            await loadScribeSessions();
            activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession.session_id) || activeScribeSession;
            scribeView = 'review';
            renderCurrentTab();
            updateBadges();
        } else {
            const errMsg = result?.error || 'Note generation failed';
            console.error('[Scribe] Generate note error:', resp.status, errMsg);
            // If note already exists (409), auto-regenerate instead of showing confusing message
            if (resp.status === 409) {
                if (!regen) {
                    // User tapped Generate but note exists — auto-regenerate
                    updatePersistentToast('Note exists — regenerating with AI…');
                    const retryResp = await fetch('/ops/api/scribe/generate-note/', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            session_id: activeScribeSession.session_id,
                            patient_id: healthieId,
                            visit_type: scribeVisitType || activeScribeSession.visit_type,
                            patient_name: scribePatientName || activeScribeSession.patient_name || '',
                            regenerate: true,
                            current_medications: currentMedications,
                        }),
                        credentials: 'include',
                    });
                    const retryResult = await retryResp.json();
                    if (retryResult?.success) {
                        const noteData = retryResult.data || {};
                        if (noteData.soap) {
                            noteData.soap_subjective = noteData.soap.subjective || '';
                            noteData.soap_objective = noteData.soap.objective || '';
                            noteData.soap_assessment = noteData.soap.assessment || '';
                            noteData.soap_plan = noteData.soap.plan || '';
                        }
                        currentNote = noteData;
                        dismissPersistentToast();
                        showToast('SOAP note regenerated! ✅', 'success');
                        await loadScribeSessions();
                        activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession.session_id) || activeScribeSession;
                        scribeView = 'review';
                        renderCurrentTab();
                        updateBadges();
                    } else {
                        dismissPersistentToast();
                        showToast(retryResult?.error || 'Regeneration failed', 'error');
                    }
                } else {
                    dismissPersistentToast();
                    showToast('Could not regenerate — please try again', 'error');
                }
                return;
            } else {
                dismissPersistentToast();
                showToast(errMsg, 'error');
            }
        }
    } catch (e) {
        dismissPersistentToast();
        console.error('[Scribe] Generate note exception:', e);
        showToast('Note generation failed: ' + (e.message || 'network error'), 'error');
    }
}

function renderScribeReview(container) {
    if (!activeScribeSession) { scribeView = 'list'; renderCurrentTab(); return; }

    const note = currentNote || activeScribeSession;
    const noteData = note?.note || note;
    const isSubmitted = noteData?.healthie_status === 'submitted' || noteData?.healthie_status === 'locked' || noteData?.healthie_status === 'signed';

    container.innerHTML = `
        <div class="scribe-header-row">
            <button class="scribe-back-btn" onclick="scribeView='list'; renderCurrentTab();">← Back</button>
            <h1 style="font-size:24px;">SOAP Note Review</h1>
            ${getChartToggleBtn()}
        </div>
        ${getChartPanelHTML()}

        <div class="scribe-session-summary">
            <div class="scribe-session-patient">${activeScribeSession.patient_name || getPatientNameById(scribePatientId)}</div>
            <div class="scribe-session-meta">${(activeScribeSession.visit_type || '').replace(/_/g, ' ')} · ${activeScribeSession.encounter_date ? new Date(activeScribeSession.encounter_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' : ''}${isSubmitted ? '✅ Submitted to Healthie' : '📝 Draft'}</div>
        </div>

        <div class="soap-sections">
            ${renderSOAPSection('S', 'Subjective', noteData?.soap_subjective || noteData?.subjective || 'Not yet generated')}
            ${renderSOAPSection('O', 'Objective', noteData?.soap_objective || noteData?.objective || 'Not yet generated')}
            ${renderSOAPSection('A', 'Assessment', noteData?.soap_assessment || noteData?.assessment || 'Not yet generated')}
            ${renderSOAPSection('P', 'Plan', noteData?.soap_plan || noteData?.plan || 'Not yet generated')}
        </div>

        ${noteData?.icd10_codes?.length > 0 ? `
            <div class="soap-codes-section">
                <h3>ICD-10 Codes</h3>
                <div class="code-chips">
                    ${noteData.icd10_codes.map(c => `<span class="code-chip">[${c.code}] ${c.description || ''}</span>`).join('')}
                </div>
            </div>
        ` : ''}

        ${(noteData?.evidence_citations?.length > 0) ? `
            <div style="margin-top:12px; padding:12px; background:rgba(0,180,216,0.05); border:1px solid rgba(0,180,216,0.15); border-radius:10px;">
                <h3 style="font-size:13px; color:var(--cyan); margin:0 0 8px;">📚 Evidence-Based References</h3>
                <div style="font-size:11px; color:var(--text-tertiary); margin-bottom:6px; font-style:italic;">Clinical guidelines supporting the assessment and plan:</div>
                ${(() => {
                    const citations = noteData.evidence_citations;
                    const byDx = {};
                    citations.forEach(c => { if (!byDx[c.diagnosis]) byDx[c.diagnosis] = []; byDx[c.diagnosis].push(c); });
                    return Object.entries(byDx).map(([dx, cites]) =>
                        '<div style="margin:6px 0;"><strong style="font-size:11px; color:var(--text-secondary);">' + dx + ':</strong>' +
                        cites.map(c => '<div style="font-size:11px; color:var(--text-tertiary); padding:2px 0 2px 8px;">' + c.number + '. ' + (c.title || '') + ' <em>' + (c.journal || '') + '</em> ' + (c.year || '') + '. <a href="' + (c.url || '') + '" target="_blank" style="color:var(--cyan);">PMID:' + c.pmid + '</a></div>').join('') +
                        '</div>'
                    ).join('');
                })()}
            </div>
        ` : ''}

        ${noteData?.cpt_codes?.length > 0 ? `
            <div class="soap-codes-section">
                <h3>CPT Codes</h3>
                <div class="code-chips">
                    ${noteData.cpt_codes.map(c => `<span class="code-chip cpt">${c.code}: ${c.description || ''}</span>`).join('')}
                </div>
            </div>
        ` : ''}

        <!-- Spacer for floating AI edit bar -->
        <div style="height:100px;"></div>

        <!-- Supplementary Docs -->
        <div style="margin-top:16px;">
            <h3 style="font-size:14px; color:var(--text-secondary); margin-bottom:8px;">Generate Documents</h3>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <button class="btn-secondary" onclick="generateScribeDoc('work_note')">🏢 Work Note</button>
                <button class="btn-secondary" onclick="generateScribeDoc('school_note')">🏫 School Note</button>
                <button class="btn-secondary" onclick="generateScribeDoc('discharge_instructions')">📄 Discharge</button>
                <button class="btn-secondary" onclick="generateScribeDoc('care_plan')">💊 Care Plan</button>
            </div>
            <div id="scribeDocsOutput" style="margin-top:12px;"></div>
        </div>

        ${!isSubmitted ? `
            <div class="scribe-review-actions" style="margin-top:16px; padding-bottom:80px;">
                <button class="btn-primary scribe-submit-btn" onclick="submitNoteToHealthie()">
                    📤 Submit to Healthie
                </button>
                <button class="btn-secondary" onclick="previewSoapPdf()">
                    📄 Preview PDF
                </button>
                <button class="btn-secondary" onclick="generateSOAPNote(true)">
                    🔄 Regenerate Note
                </button>
                <button onclick="discardScribeSession()" style="background:transparent; border:1px solid var(--error-color,#ef4444); color:var(--error-color,#ef4444); padding:8px 16px; border-radius:8px; font-size:13px; cursor:pointer;">
                    🗑 Discard
                </button>
            </div>
        ` : `
            <div class="scribe-submitted-banner">
                <span>✅</span> Note submitted to Healthie${noteData?.healthie_note_id ? ` (ID: ${noteData.healthie_note_id})` : ''}
                <button class="btn-secondary" onclick="previewSoapPdf()" style="margin-left:12px; font-size:12px; padding:4px 12px;">
                    📄 Preview PDF
                </button>
            </div>
            ${(currentUser?.role === 'admin' || currentUser?.is_provider) ? `
                <div style="margin-top:12px; padding:12px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.3); border-radius:8px;">
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">
                        ⚠️ This note is <strong>${noteData?.healthie_status || 'locked'}</strong>. To make corrections:
                    </div>
                    <button class="btn-secondary" onclick="unlockScribeNote()" style="background:rgba(251,191,36,0.2); border:1px solid rgba(251,191,36,0.4); color:#fbbf24; font-size:13px;">
                        🔓 Unlock for Editing
                    </button>
                </div>
            ` : ''}
        `}
    `;

    // Add floating AI edit bar (only for draft notes)
    if (!isSubmitted) {
        // Remove any existing floating bar
        const existing = document.getElementById('floatingAiEdit');
        if (existing) existing.remove();

        const bar = document.createElement('div');
        bar.id = 'floatingAiEdit';
        bar.style.cssText = 'position:fixed; bottom:90px; left:12px; right:12px; z-index:150; padding:10px 14px; background:rgba(30,30,45,0.95); backdrop-filter:blur(12px); border-radius:14px; border:1px solid rgba(0,180,216,0.3); box-shadow:0 -4px 20px rgba(0,0,0,0.4); display:flex; gap:8px; align-items:flex-end;';
        bar.innerHTML = `
            <button id="aiEditMicBtn" onclick="toggleEditDictation()" style="padding:8px; background:none; border:1px solid var(--border); border-radius:8px; cursor:pointer; font-size:18px; min-width:40px; min-height:40px; display:flex; align-items:center; justify-content:center; flex-shrink:0; color:var(--text-secondary); align-self:flex-end;" title="Dictate edit">🎤</button>
            <textarea id="aiEditInput" placeholder="Dictate or type your edit…" rows="1"
                   style="flex:1; padding:10px 12px; border-radius:8px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); font-size:14px; resize:none; max-height:120px; overflow-y:auto; line-height:1.4; font-family:inherit;"
                   oninput="this.style.height='auto'; this.style.height=Math.min(this.scrollHeight,120)+'px';"
                   onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();aiEditNote();}"></textarea>
            <button onclick="aiEditNote()" style="padding:10px 16px; background:linear-gradient(135deg, var(--cyan), #0077b6); color:white; border:none; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; align-self:flex-end;">✨ Edit</button>
        `;
        document.body.appendChild(bar);
    }
}

// ==================== SPEECH-TO-TEXT FOR AI EDIT ====================
let _editRecognition = null;
let _editIsListening = false;

function toggleEditDictation() {
    if (_editIsListening) {
        stopEditDictation();
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Speech recognition not supported on this browser', 'error');
        return;
    }

    // Use shared dictation helper — only appends final words, never overwrites
    _editRecognition = _startDictation('aiEditInput', 'aiEditMicBtn', function() { stopEditDictation(); });
    if (_editRecognition) {
        _editIsListening = true;
    }
}

function stopEditDictation() {
    _editIsListening = false;
    _stopDictation(_editRecognition, 'aiEditInput', 'aiEditMicBtn', {
        bg: 'none', border: 'var(--border)', color: 'var(--text-secondary)',
        text: '🎤', placeholder: 'Dictate or type your edit…'
    });
    _editRecognition = null;
}

// Clean up floating edit bar when leaving scribe review
const _origRenderCurrentTab = typeof renderCurrentTab === 'function' ? null : null;
function removeFloatingEditBar() {
    stopEditDictation();
    const bar = document.getElementById('floatingAiEdit');
    if (bar) bar.remove();
}

function renderSOAPSection(letter, title, content) {
    const colorMap = { S: 'var(--cyan)', O: 'var(--purple)', A: 'var(--yellow)', P: 'var(--green)' };
    return `
        <div class="soap-section">
            <div class="soap-section-header">
                <span class="soap-letter" style="background:${colorMap[letter]}20; color:${colorMap[letter]}">${letter}</span>
                <span class="soap-title">${title}</span>
            </div>
            <div class="soap-content">${formatSOAPContent(content)}</div>
        </div>
    `;
}

function formatSOAPContent(text) {
    if (!text || text === 'Not yet generated') return `<span style="color:var(--text-tertiary); font-style:italic;">${text}</span>`;
    // Convert markdown-like formatting
    return text
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n- /g, '<br>• ')
        .replace(/\n/g, '<br>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([A-Z]\d{2}\.?\d*)\]/g, '<code class="icd-inline">$1</code>');
}

function previewSoapPdf() {
    if (!activeScribeSession?.session_id) {
        showToast('No active session', 'error');
        return;
    }
    window.open(`/ops/api/scribe/soap-pdf/?session_id=${activeScribeSession.session_id}`, '_blank');
}

async function submitNoteToHealthie() {
    if (!activeScribeSession?.note_id && !currentNote?.note_id) {
        showToast('No note to submit — generate one first', 'error');
        return;
    }
    const noteId = activeScribeSession?.note_id || currentNote?.note_id;

    showToast('Submitting to Healthie…', 'info');
    try {
        const result = await apiFetch('/ops/api/scribe/submit-to-healthie/', {
            method: 'POST',
            body: JSON.stringify({ note_id: noteId })
        });

        if (result?.success) {
            showToast('Note submitted to Healthie! ✅', 'success');

            // Auto-advance appointment to "Completed"
            var patId = activeScribeSession?.patient_id || '';
            var patHealthieId = activeScribeSession?.healthie_id || chartPanelData?.healthie_id || '';
            if (patId || patHealthieId) {
                // Load schedule data if not already loaded
                if (!scheduleAllData || scheduleAllData.length === 0) {
                    try {
                        var schedResp = await apiFetch('/ops/api/ipad/schedule/');
                        if (schedResp?.success) scheduleAllData = schedResp.patients || [];
                    } catch (e) { /* best effort */ }
                }
                if (scheduleAllData && scheduleAllData.length > 0) {
                    var completedAppt = scheduleAllData.find(function(a) {
                        return (a.patient_id === patId || a.healthie_id === patId ||
                                a.patient_id === patHealthieId || a.healthie_id === patHealthieId)
                            && a.appointment_status !== 'Completed' && a.appointment_status !== 'No Show' && a.appointment_status !== 'Cancelled';
                    });
                    if (completedAppt && completedAppt.appointment_id) {
                        updateApptStatus(completedAppt.appointment_id, 'Completed');
                    }
                }
            }

            await loadScribeSessions();
            activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession.session_id) || activeScribeSession;
            renderCurrentTab();
            updateBadges();
        } else {
            showToast(result?.error || 'Submit failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Submit failed — check connection', 'error');
    }
}

function renderScribeTranscript(container) {
    // Fallback — redirect to note view
    scribeView = 'note';
    renderCurrentTab();
}

async function aiEditNote() {
    const input = document.getElementById('aiEditInput');
    const instruction = input?.value?.trim();
    if (!instruction) { showToast('Enter an edit instruction', 'error'); return; }
    const noteId = activeScribeSession?.note_id || currentNote?.note_id;
    if (!noteId) { showToast('No note to edit', 'error'); return; }

    stopEditDictation();
    showPersistentToast('Applying AI edit…');
    try {
        const result = await apiFetch(`/ops/api/scribe/notes/${noteId}/edit-ai/`, {
            method: 'POST',
            body: JSON.stringify({ edit_instruction: instruction }),
            _timeout: 45000,
        });
        dismissPersistentToast();
        if (result?.success) {
            const n = result.data.updated_note;
            // Update all note references with fresh data from DB
            if (n) {
                if (currentNote) {
                    currentNote.soap_subjective = n.soap_subjective;
                    currentNote.soap_objective = n.soap_objective;
                    currentNote.soap_assessment = n.soap_assessment;
                    currentNote.soap_plan = n.soap_plan;
                    currentNote.icd10_codes = n.icd10_codes;
                    currentNote.full_note_text = n.full_note_text;
                    currentNote.supplementary_docs = n.supplementary_docs;
                }
                // Also update activeScribeSession note data so re-render picks it up
                if (activeScribeSession) {
                    activeScribeSession.soap_subjective = n.soap_subjective;
                    activeScribeSession.soap_objective = n.soap_objective;
                    activeScribeSession.soap_assessment = n.soap_assessment;
                    activeScribeSession.soap_plan = n.soap_plan;
                    activeScribeSession.icd10_codes = n.icd10_codes;
                    if (activeScribeSession.note) {
                        activeScribeSession.note.soap_subjective = n.soap_subjective;
                        activeScribeSession.note.soap_objective = n.soap_objective;
                        activeScribeSession.note.soap_assessment = n.soap_assessment;
                        activeScribeSession.note.soap_plan = n.soap_plan;
                    }
                }
            }
            input.value = '';

            // Show what changed in a detailed, scrollable toast
            const changes = result.data?.changes_summary || [];
            if (changes.length > 0) {
                const changeList = changes.map(c => {
                    const lines = c.description.split('\n').map(line => {
                        if (line.startsWith('❌')) return '<div style="color:#f87171; padding:2px 0;">' + line + '</div>';
                        if (line.startsWith('✅')) return '<div style="color:#34d399; padding:2px 0;">' + line + '</div>';
                        return '<div>' + line + '</div>';
                    }).join('');
                    return '<div style="margin:6px 0; padding:8px 10px; background:rgba(255,255,255,0.05); border-radius:8px; border-left:3px solid var(--cyan);"><strong style="font-size:13px;">' + c.section + '</strong>' + lines + '</div>';
                }).join('');
                showEditResultToast('AI Edit Applied ✅', changeList);
            } else {
                showToast('AI returned no changes — try being more specific', 'info', 5000);
            }

            // Re-render immediately with updated data
            renderCurrentTab();
        } else {
            console.error('[Scribe:AI-Edit] Server returned failure:', result?.error, JSON.stringify(result));
            dismissPersistentToast();
            showToast(result?.error || 'AI edit failed', 'error');
        }
    } catch (e) {
        dismissPersistentToast();
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.error('[Scribe:AI-Edit] Request failed:', e?.message, e?.stack);
        showToast('AI edit failed: ' + (e?.message || 'unknown error'), 'error');
    }
}

// ✅ NEW: Unlock a locked/signed note for editing
async function unlockScribeNote() {
    if (!currentNote?.note_id) {
        showToast('No note to unlock', 'error');
        return;
    }

    const status = currentNote.healthie_status;
    if (!confirm(`Unlock this ${status} note for editing?\n\nThis will change status to Draft and allow modifications.`)) {
        return;
    }

    console.log('[Scribe] Unlocking note:', currentNote.note_id);

    try {
        const resp = await fetch(`/ops/api/scribe/notes/${currentNote.note_id}/unlock`, {
            method: 'POST',
            credentials: 'include'
        });

        const result = await resp.json();
        if (result.success) {
            showToast(`✅ Note unlocked (was: ${result.previous_status})`, 'success');
            currentNote.healthie_status = 'draft';
            // Reload to refresh UI with edit buttons
            renderCurrentTab();
        } else {
            showToast(`Failed to unlock: ${result.error}`, 'error');
        }
    } catch (e) {
        console.error('[Scribe] Unlock error:', e);
        showToast('Error unlocking note', 'error');
    }
}

async function generateScribeDoc(docType) {
    if (!activeScribeSession?.session_id) { showToast('No active session', 'error'); return; }
    const labels = {
        work_note: 'Work Note', school_note: 'School Note',
        discharge_instructions: 'Discharge Instructions', care_plan: 'Care Plan'
    };

    // Prompt for number of days for work/school notes
    let numDays = null;
    if (docType === 'work_note' || docType === 'school_note') {
        const daysInput = prompt(`How many days should the patient be excused from ${docType === 'work_note' ? 'work' : 'school'}?`, '3');
        if (daysInput === null) return; // User cancelled
        numDays = parseInt(daysInput, 10);
        if (isNaN(numDays) || numDays < 1) {
            showToast('Please enter a valid number of days', 'error');
            return;
        }
    }

    showToast(`Generating ${labels[docType] || docType}…`, 'info', 8000);

    try {
        const body = {
            session_id: activeScribeSession.session_id,
            doc_type: docType,
        };
        if (numDays) body.num_days = numDays;

        const result = await apiFetch('/ops/api/scribe/generate-doc/', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (result?.success) {
            showToast(`${labels[docType]} generated!`, 'success');
            const output = document.getElementById('scribeDocsOutput');
            if (output) {
                const noteId = result.data?.note_id || currentNote?.note_id || activeScribeSession?.note_id;
                output.innerHTML += `
                    <div id="scribeDoc_${docType}" style="background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:12px; margin-top:8px;">
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                            <h4 style="margin:0; font-size:13px; color:var(--cyan);">${labels[docType] || docType}</h4>
                            <div style="display:flex; gap:6px;">
                                <button onclick="previewDocPdf('${noteId}', '${docType}')" style="padding:6px 12px; background:linear-gradient(135deg, #6366f1, #4f46e5); color:white; border:none; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">
                                    📄 Preview PDF
                                </button>
                                <button onclick="uploadDocToHealthie('${noteId}', '${docType}')" style="padding:6px 12px; background:linear-gradient(135deg, #10b981, #059669); color:white; border:none; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;">
                                    📤 Upload to Healthie
                                </button>
                            </div>
                        </div>
                        <div id="scribeDocContent_${docType}" style="font-size:13px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.5;">${formatSOAPContent(result.data?.content || '')}</div>
                        <div style="display:flex; gap:8px; margin-top:8px;">
                            <input type="text" id="docEditInput_${docType}" placeholder="Tell AI what to change…"
                                   style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid var(--border); background:var(--surface-2); color:var(--text-primary); font-size:13px;" />
                            <button onclick="aiEditDoc('${noteId}', '${docType}')" style="padding:8px 12px; background:var(--cyan); color:white; border:none; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;">✨ Edit</button>
                        </div>
                    </div>
                `;
            }
        } else {
            showToast(result?.error || 'Doc generation failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Doc generation failed', 'error');
    }
}

// ==================== PREVIEW SUPPLEMENTARY DOC PDF ====================
function previewDocPdf(noteId, docType) {
    if (!noteId) { showToast('No note found', 'error'); return; }
    window.open(`/ops/api/scribe/doc-pdf/?note_id=${noteId}&doc_type=${docType}`, '_blank');
}

// ==================== AI EDIT SUPPLEMENTARY DOC ====================
async function aiEditDoc(noteId, docType) {
    const input = document.getElementById('docEditInput_' + docType);
    const instruction = input?.value?.trim();
    if (!instruction) { showToast('Enter an edit instruction', 'error'); return; }
    if (!noteId) { showToast('No note found', 'error'); return; }

    const labels = {
        work_note: 'Work Note', school_note: 'School Note',
        discharge_instructions: 'Discharge Instructions', care_plan: 'Care Plan'
    };

    showToast('Applying AI edit to ' + (labels[docType] || docType) + '…', 'info');
    try {
        const result = await apiFetch('/ops/api/scribe/notes/' + noteId + '/edit-ai/', {
            method: 'POST',
            body: JSON.stringify({ edit_instruction: instruction, doc_type: docType })
        });
        if (result?.success) {
            input.value = '';
            showToast('AI edit applied!', 'success');
            // Update the displayed content
            const contentDiv = document.getElementById('scribeDocContent_' + docType);
            if (contentDiv && result.data?.updated_content) {
                contentDiv.innerHTML = formatSOAPContent(result.data.updated_content);
            }
        } else {
            showToast(result?.error || 'AI edit failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('AI edit failed: ' + (e?.message || 'unknown error'), 'error');
    }
}

// ==================== UPLOAD SUPPLEMENTARY DOC TO HEALTHIE ====================
async function uploadDocToHealthie(noteId, docType) {
    if (!noteId) { showToast('No note found', 'error'); return; }

    const labels = {
        work_note: 'Work Note', school_note: 'School Note',
        discharge_instructions: 'Discharge Instructions', care_plan: 'Care Plan'
    };
    const label = labels[docType] || docType;

    if (!confirm('Upload ' + label + ' to Healthie?\n\nThis will create a PDF visible to the patient in their Healthie portal.')) {
        return;
    }

    showToast('Uploading ' + label + ' to Healthie…', 'info');
    try {
        const result = await apiFetch('/ops/api/scribe/upload-doc/', {
            method: 'POST',
            body: JSON.stringify({ note_id: noteId, doc_type: docType })
        });
        if (result?.success) {
            showToast(label + ' uploaded to Healthie! ✅ (Shared with patient)', 'success');
            // Update button to show uploaded state
            const docDiv = document.getElementById('scribeDoc_' + docType);
            if (docDiv) {
                const btn = docDiv.querySelector('button[onclick*="uploadDocToHealthie"]');
                if (btn) {
                    btn.innerHTML = '✅ Uploaded';
                    btn.style.background = 'var(--surface-2)';
                    btn.style.color = 'var(--text-secondary)';
                    btn.disabled = true;
                }
            }
        } else {
            showToast(result?.error || 'Upload failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Upload failed: ' + (e?.message || 'unknown error'), 'error');
    }
}

// ============================================================
// PATIENT CHART REVIEW PANEL (Slide-out during Scribe)
// ============================================================
let chartPanelData = null;
let chartPanelOpen = false;
let chartPanelPatientId = null;
let chartPanelState = 'normal'; // 'normal' | 'minimized' | 'expanded'

function toggleChartPanel() {
    // Redirect to global chart panel
    const pid = scribePatientId || activeScribeSession?.patient_id;
    const pname = scribePatientName || activeScribeSession?.patient_name || 'Patient';
    const globalPanel = document.getElementById('globalChartPanel');
    if (globalPanel && globalPanel.classList.contains('open')) {
        closeGlobalChart();
    } else if (pid) {
        openChartForPatient(pid, pname);
    } else {
        toggleGlobalChart();
    }
}

function minimizeChartPanel() {
    // Redirect to global chart panel
    minimizeGlobalChart();
}

function expandChartPanel() {
    // Redirect to global chart panel
    expandGlobalChart();
}

// ==================== GLOBAL CHART PANEL ====================
// Opens a patient chart from ANY view (schedule, patients, etc.)
// Uses the global #globalChartPanel div in index.html
let globalChartState = 'normal'; // 'normal' | 'minimized' | 'expanded'

function openChartForPatient(patientId, patientName) {
    if (!patientId) return;
    let panel = document.getElementById('globalChartPanel');

    // Dynamically create the chart panel if it doesn't exist in index.html (cache issue)
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'globalChartPanel';
        panel.className = 'chart-panel';
        panel.style.zIndex = '200';
        panel.innerHTML = `
            <div class="chart-panel-minimized-tab" onclick="toggleGlobalChart()" title="Restore chart panel">
                <span>📋</span>
                <span class="minimized-patient-name" id="globalChartPatientName"></span>
            </div>
            <div class="chart-panel-header">
                <div class="chart-panel-title" id="globalChartTitle">📋 Patient Chart</div>
                <div class="chart-panel-actions">
                    <button class="chart-panel-btn" onclick="minimizeGlobalChart()" title="Minimize">⊟</button>
                    <button class="chart-panel-btn" onclick="expandGlobalChart()" title="Expand">⊞</button>
                    <button class="chart-panel-close" onclick="closeGlobalChart()" style="background:rgba(239,68,68,0.8); color:white; font-size:18px; font-weight:bold;">✕</button>
                </div>
            </div>
            <div id="globalChartContent" class="chart-panel-content">
                <div class="chart-loading"><div class="spinner"></div> Loading…</div>
            </div>
        `;
        document.body.appendChild(panel);
    }

    // ALWAYS ensure the header and close button exist dynamically (busts iPad HTML cache)
    let header = panel.querySelector('.chart-panel-header');
    if (!header) {
        header = document.createElement('div');
        header.className = 'chart-panel-header';
        panel.insertBefore(header, panel.firstChild);
    }

    // Completely overwrite the header HTML every time to guarantee buttons exist
    header.innerHTML = `
        <div class="chart-panel-title" id="globalChartTitle">📋 Patient Chart</div>
        <div class="chart-panel-actions">
            <button class="chart-panel-btn" onclick="minimizeGlobalChart()" title="Minimize">⊟</button>
            <button class="chart-panel-btn" onclick="expandGlobalChart()" title="Expand">⊞</button>
            <button class="chart-panel-close" onclick="closeGlobalChart()" style="background:rgba(239,68,68,0.8); color:white; font-size:18px; font-weight:bold;">✕</button>
        </div>
    `;

    console.log('[openChartForPatient] Chart panel header created with BIG RED close buttons');

    // Verify close button exists
    const closeBtn = panel.querySelector('.chart-panel-close');
    if (closeBtn) {
        console.log('[openChartForPatient] ✅ Close button verified in DOM');
    } else {
        console.error('[openChartForPatient] ❌ Close button NOT FOUND in DOM!');
    }

    // Update header
    const title = document.getElementById('globalChartTitle');
    const nameEl = document.getElementById('globalChartPatientName');
    if (title) title.textContent = '📋 ' + (patientName || 'Patient');
    if (nameEl) nameEl.textContent = (patientName || 'Patient').split(' ')[0];

    // Open panel - clear any inline styles and use CSS classes
    panel.style.right = ''; // Clear inline style to use CSS .open class
    panel.classList.add('open');
    panel.classList.remove('minimized', 'expanded');
    globalChartState = 'normal';

    // Load data (reuses existing loadChartData which looks for globalChartContent)
    chartPanelPatientId = patientId;
    chartPanelOpen = true;
    loadChartData(patientId);
}

function minimizeGlobalChart() {
    const panel = document.getElementById('globalChartPanel');
    if (!panel) return;
    panel.classList.add('minimized');
    panel.classList.remove('expanded');
    globalChartState = 'minimized';
}

function expandGlobalChart() {
    const panel = document.getElementById('globalChartPanel');
    if (!panel) return;
    if (globalChartState === 'expanded') {
        panel.classList.remove('expanded');
        globalChartState = 'normal';
    } else {
        panel.classList.add('expanded');
        panel.classList.remove('minimized');
        globalChartState = 'expanded';
    }
}

function closeGlobalChart() {
    console.log('[closeGlobalChart] Closing chart panel');
    const panel = document.getElementById('globalChartPanel');
    if (!panel) {
        console.warn('[closeGlobalChart] Panel not found!');
        return;
    }
    panel.classList.remove('open', 'minimized', 'expanded');
    // Force slide out animation by ensuring no open class
    panel.style.right = '-500px';
    globalChartState = 'closed';
    chartPanelOpen = false;
    console.log('[closeGlobalChart] Chart panel closed');
}

function toggleGlobalChart() {
    const panel = document.getElementById('globalChartPanel');
    if (!panel) return;
    if (panel.classList.contains('minimized')) {
        panel.classList.remove('minimized');
        globalChartState = 'normal';
    } else {
        panel.classList.add('open');
        panel.classList.remove('minimized');
        globalChartState = 'normal';
    }
}

let _chartLoadId = 0; // guard against concurrent chart loads

async function loadChartData(patientId) {
    chartPanelPatientId = patientId;
    const thisLoadId = ++_chartLoadId; // capture load ID to detect stale loads

    // Find the correct chart panel content element:
    // 1. If the global chart panel is open, use #globalChartContent
    // 2. If scribe panel exists (still in DOM), use it
    // 3. If NEITHER is open/present, silently return — don't auto-open
    const globalPanel = document.getElementById('globalChartPanel');
    const globalContent = document.getElementById('globalChartContent');
    const scribeContent = document.getElementById('chartPanelContent');

    var content;
    if (globalPanel && globalPanel.classList.contains('open') && globalContent) {
        content = globalContent;
    } else if (scribeContent) {
        content = scribeContent;
    } else {
        // No panel is open — don't force-open one, just return
        return;
    }
    content.innerHTML = '<div class="chart-loading"><div class="spinner"></div> Loading chart…</div>';

    // Helper: fetch with a hard timeout (AbortController)
    async function timedFetch(url, timeoutMs) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs || 15000);
        try {
            const resp = await fetch(url, { credentials: 'include', signal: controller.signal });
            clearTimeout(tid);
            if (resp.status === 401 || resp.status === 403) return null;
            if (!resp.ok) return null;
            const data = await resp.json();
            return data?.success ? data.data : null;
        } catch (e) {
            clearTimeout(tid);
            return null;
        }
    }

    try {
        // FAST PATH: Load patient-chart first (has everything for initial render)
        // Then lazy-load 360 data in background for labs/visits/alerts
        const healthieChart = await timedFetch(`/ops/api/ipad/patient-chart/?patient_id=${patientId}`, 20000);

        // Guard: if another loadChartData() was called while we were waiting, abort this stale one
        if (thisLoadId !== _chartLoadId) { console.log('[Chart] Stale load aborted for', patientId); return; }

        // Render immediately with patient-chart data
        chartPanelData = {
            demographics: healthieChart?.demographics || {},
            medications: {},
            labs: {},
            visits: [],
            alerts: [],
            controlled_substances: [],
            healthie_meds: healthieChart?.medications || [],
            healthie_allergies: healthieChart?.allergies || [],
            healthie_chart_notes: healthieChart?.chart_notes || [],
            healthie_documents: healthieChart?.documents || [],
            healthie_vitals: healthieChart?.vitals || [],
            healthie_appointments: healthieChart?.appointments || [],
            scribe_history: healthieChart?.scribe_history || [],
            avatar_url: healthieChart?.avatar_url || null,
            healthie_id: healthieChart?.healthie_id || '',
            // Financial & dispense data
            last_payments: healthieChart?.last_payments || [],
            trt_dispenses: healthieChart?.trt_dispenses || [],
            peptide_dispenses: healthieChart?.peptide_dispenses || [],
            payment_methods: healthieChart?.payment_methods || [],
            subscriptions: healthieChart?.subscriptions || [],
            recurring_payment: healthieChart?.recurring_payment || null,
            pending_forms: healthieChart?.pending_forms || [],
        };
        renderChartPanel(content);

        // BACKGROUND: Load 360 data for labs/visits/alerts (non-blocking)
        timedFetch(`/ops/api/patients/${patientId}/360/`, 20000).then(local360 => {
            if (local360 && chartPanelPatientId === patientId && thisLoadId === _chartLoadId) {
                // FIX(2026-03-19): Merge 360 demographics INTO existing (don't overwrite Healthie-enriched data)
                const existingDemo = chartPanelData.demographics || {};
                const newDemo = local360.demographics || {};
                chartPanelData.demographics = { ...existingDemo, ...newDemo };
                // Restore Healthie fields that 360 doesn't have
                if (existingDemo.address_line1 && !newDemo.address_line1) chartPanelData.demographics.address_line1 = existingDemo.address_line1;
                if (existingDemo.address_line_1 && !newDemo.address_line_1) chartPanelData.demographics.address_line_1 = existingDemo.address_line_1;
                if (existingDemo.city && !newDemo.city) chartPanelData.demographics.city = existingDemo.city;
                if (existingDemo.state && !newDemo.state) chartPanelData.demographics.state = existingDemo.state;
                if (existingDemo.zip && !newDemo.zip) chartPanelData.demographics.zip = existingDemo.zip;
                chartPanelData.medications = local360.medications || chartPanelData.medications;
                chartPanelData.labs = local360.labs || {};
                chartPanelData.visits = local360.visits || [];
                chartPanelData.alerts = local360.alerts || [];
                chartPanelData.controlled_substances = local360.controlled_substances || [];
                chartPanelData.healthie_id = chartPanelData.healthie_id || local360.demographics?.healthie_client_id || '';
                // Re-render with full data if chart is still open for this patient
                const refreshContent = document.getElementById('globalChartContent') || document.getElementById('chartPanelContent');
                if (refreshContent) renderChartPanel(refreshContent);
            }
        });
    } catch (e) {
        console.error('Chart load error:', e);
        // Absolute fallback — always render, never leave spinner stuck
        chartPanelData = chartPanelData || {
            demographics: {}, medications: {}, labs: {}, visits: [], alerts: [],
            controlled_substances: [], healthie_meds: [], healthie_allergies: [],
            healthie_chart_notes: [], healthie_documents: [], healthie_vitals: [],
            healthie_appointments: [], scribe_history: [], avatar_url: null,
        };
        renderChartPanel(content);
    }
}

// ==================== ALLERGIES ====================
async function markNKDA() {
    const healthieId = chartPanelData?.healthie_id || chartPanelData?.demographics?.healthie_client_id || chartPanelPatientId;
    if (!healthieId) { showToast('No patient ID', 'error'); return; }
    if (!confirm('Mark this patient as NKDA (No Known Drug Allergies)?')) return;

    const enteredBy = currentUser?.display_name || currentUser?.email?.split('@')[0] || 'Staff';
    try {
        const resp = await apiFetch('/ops/api/ipad/patient-data/', {
            method: 'POST',
            body: JSON.stringify({
                action: 'add_allergy',
                healthie_id: healthieId,
                is_nkda: true,
                entered_by: enteredBy,
            })
        });
        if (resp?.success) {
            showToast('✅ NKDA documented by ' + enteredBy, 'success');
            if (chartPanelPatientId) loadChartData(chartPanelPatientId);
        } else {
            showToast('Failed: ' + (resp?.error || 'Unknown'), 'error');
        }
    } catch (e) {
        showToast('Failed to save NKDA', 'error');
    }
}

function showAllergyForm() {
    const area = document.getElementById('allergyFormArea');
    if (!area) return;
    if (area.innerHTML.trim()) { area.innerHTML = ''; return; } // toggle

    area.innerHTML = `
        <div style="padding:8px; margin-top:6px; background:var(--surface-2); border-radius:8px; border:1px solid var(--border);">
            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <input id="allergyName" type="text" placeholder="Allergy name (e.g., Penicillin)" style="flex:2; padding:6px 8px; border-radius:6px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:12px; font-family:inherit;">
                <select id="allergyCategory" style="flex:1; padding:6px 4px; border-radius:6px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:11px;">
                    <option value="Drug">Drug</option>
                    <option value="Food">Food</option>
                    <option value="Environmental">Environmental</option>
                    <option value="Pet">Pet</option>
                    <option value="Latex">Latex</option>
                </select>
            </div>
            <div style="display:flex; gap:6px; margin-bottom:6px;">
                <input id="allergyReaction" type="text" placeholder="Reaction (e.g., Rash, Hives)" style="flex:1; padding:6px 8px; border-radius:6px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:12px; font-family:inherit;">
                <select id="allergySeverity" style="width:100px; padding:6px 4px; border-radius:6px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:11px;">
                    <option value="">Severity</option>
                    <option value="Mild">Mild</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Severe">Severe</option>
                </select>
            </div>
            <div style="display:flex; gap:6px;">
                <button onclick="submitAllergy()" style="flex:1; padding:6px; border-radius:6px; background:linear-gradient(135deg,#ef4444,#dc2626); border:none; color:white; font-size:11px; font-weight:600; cursor:pointer;">Add Allergy</button>
                <button onclick="document.getElementById('allergyFormArea').innerHTML=''" style="padding:6px 12px; border-radius:6px; background:var(--surface); border:1px solid var(--border); color:var(--text-tertiary); font-size:11px; cursor:pointer;">Cancel</button>
            </div>
        </div>
    `;
    document.getElementById('allergyName')?.focus();
}

async function submitAllergy() {
    const name = document.getElementById('allergyName')?.value?.trim();
    if (!name) { showToast('Enter allergy name', 'error'); return; }

    const healthieId = chartPanelData?.healthie_id || chartPanelData?.demographics?.healthie_client_id || chartPanelPatientId;
    if (!healthieId) { showToast('No patient ID', 'error'); return; }

    const enteredBy = currentUser?.display_name || currentUser?.email?.split('@')[0] || 'Staff';
    try {
        const resp = await apiFetch('/ops/api/ipad/patient-data/', {
            method: 'POST',
            body: JSON.stringify({
                action: 'add_allergy',
                healthie_id: healthieId,
                name: name,
                category: document.getElementById('allergyCategory')?.value || 'Drug',
                reaction: document.getElementById('allergyReaction')?.value?.trim() || '',
                severity: document.getElementById('allergySeverity')?.value || '',
                entered_by: enteredBy,
            })
        });
        if (resp?.success) {
            showToast('✅ Allergy added: ' + name, 'success');
            document.getElementById('allergyFormArea').innerHTML = '';
            if (chartPanelPatientId) loadChartData(chartPanelPatientId);
        } else {
            showToast('Failed: ' + (resp?.error || 'Unknown'), 'error');
        }
    } catch (e) {
        showToast('Failed to save allergy', 'error');
    }
}

// ==================== INTERESTING FACTS ====================
function toggleInterestingPanel() {
    const panel = document.getElementById('interestingPanel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}

// ============ GROUP & TAG MANAGEMENT ============

// Cache for groups list
let _cachedGroups = null;

async function fetchGroups() {
    if (_cachedGroups) return _cachedGroups;
    try {
        const resp = await fetch('/ops/api/ipad/patient?action=groups', { credentials: 'include' });
        const data = await resp.json();
        if (data.success) {
            _cachedGroups = data.groups;
            return data.groups;
        }
    } catch (e) {
        console.error('[Tags] Failed to fetch groups:', e);
    }
    return [];
}

function getChartHealthieId() {
    return chartPanelData?.healthie_id || null;
}

async function showGroupPicker() {
    const healthieId = getChartHealthieId();
    if (!healthieId) return showToast('No Healthie ID found', 'error');

    const groups = await fetchGroups();
    if (!groups.length) return showToast('Failed to load groups', 'error');

    const currentGroup = document.getElementById('patientGroupDisplay')?.textContent?.trim() || '';

    const overlay = document.createElement('div');
    overlay.id = 'groupPickerOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:var(--surface-1,#1a1d23);border-radius:12px;padding:16px;min-width:280px;max-width:360px;border:1px solid var(--border,#333);">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);margin-bottom:12px;">Change Patient Group</div>
            <div style="font-size:10px;color:var(--text-tertiary,#888);margin-bottom:10px;">Current: <strong style="color:var(--cyan,#00d4ff);">${currentGroup || 'None'}</strong></div>
            <div style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow-y:auto;">
                ${groups.map(g => `
                    <button onclick="changePatientGroup('${g.id}', '${g.name.replace(/'/g, "\\'")}')"
                        style="text-align:left;padding:10px 12px;border-radius:8px;border:1px solid ${g.name === currentGroup ? 'var(--cyan,#00d4ff)' : 'var(--border,#333)'};
                        background:${g.name === currentGroup ? 'rgba(0,212,255,0.1)' : 'var(--surface-2,#252830)'};
                        color:var(--text-primary,#fff);font-size:12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-weight:${g.name === currentGroup ? '600' : '400'};">${g.name}</span>
                        <span style="font-size:10px;color:var(--text-tertiary,#888);">${g.count} pts</span>
                    </button>
                `).join('')}
            </div>
            <button onclick="document.getElementById('groupPickerOverlay').remove()" style="width:100%;margin-top:10px;padding:8px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-secondary,#ccc);font-size:11px;cursor:pointer;">Cancel</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function changePatientGroup(groupId, groupName) {
    const healthieId = getChartHealthieId();
    if (!healthieId) return;

    document.getElementById('groupPickerOverlay')?.remove();
    showToast('Changing group...', 'info');

    try {
        const resp = await fetch('/ops/api/ipad/patient', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'change_group', healthie_id: healthieId, group_id: groupId }),
        });
        const data = await resp.json();
        if (data.success) {
            const display = document.getElementById('patientGroupDisplay');
            if (display) display.textContent = groupName;
            showToast(`Group changed to ${groupName}`, 'success');
        } else {
            showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error('[Tags] changePatientGroup error:', e);
        showToast('Failed to change group', 'error');
    }
}

// Common service tags for quick-add
const COMMON_TAGS = ['pelleting', 'weight-loss', 'peptides', 'iv-therapy', 'telehealth', 'first-responder'];

async function showTagPicker() {
    const healthieId = getChartHealthieId();
    if (!healthieId) return showToast('No Healthie ID found', 'error');

    const overlay = document.createElement('div');
    overlay.id = 'tagPickerOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:var(--surface-1,#1a1d23);border-radius:12px;padding:16px;min-width:280px;max-width:360px;border:1px solid var(--border,#333);">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary,#fff);margin-bottom:12px;">Add Tag</div>
            <div style="font-size:10px;color:var(--text-tertiary,#888);margin-bottom:10px;">Quick tags (service access):</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
                ${COMMON_TAGS.map(tag => `
                    <button onclick="addTagToPatient('${tag}')"
                        style="padding:6px 12px;border-radius:6px;background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.3);color:#a855f7;font-size:11px;font-weight:500;cursor:pointer;">
                        ${tag}
                    </button>
                `).join('')}
            </div>
            <div style="font-size:10px;color:var(--text-tertiary,#888);margin-bottom:6px;">Or enter custom tag:</div>
            <div style="display:flex;gap:6px;">
                <input id="customTagInput" type="text" placeholder="Custom tag name..."
                    style="flex:1;padding:8px 10px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:12px;outline:none;"
                    onkeydown="if(event.key==='Enter'){addTagToPatient(this.value);}" />
                <button onclick="addTagToPatient(document.getElementById('customTagInput').value)"
                    style="padding:8px 14px;border-radius:8px;background:linear-gradient(135deg,#a855f7,#7c3aed);border:none;color:white;font-size:11px;font-weight:600;cursor:pointer;">Add</button>
            </div>
            <button onclick="document.getElementById('tagPickerOverlay').remove()" style="width:100%;margin-top:10px;padding:8px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-secondary,#ccc);font-size:11px;cursor:pointer;">Cancel</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function addTagToPatient(tagName) {
    tagName = (tagName || '').trim().toLowerCase();
    if (!tagName) return;

    const healthieId = getChartHealthieId();
    if (!healthieId) return;

    document.getElementById('tagPickerOverlay')?.remove();
    showToast(`Adding tag "${tagName}"...`, 'info');

    try {
        const resp = await fetch('/ops/api/ipad/patient', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add_tag', healthie_id: healthieId, tag_name: tagName }),
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            // FIX(2026-04-01): Show actual error from Healthie API instead of generic message
            showToast('Tag error: ' + (data.error || 'Unknown error — check Healthie'), 'error');
            console.error('[Tags] API error:', data);
            return;
        }
        if (data.tag) {
            // Add tag badge to the UI
            const section = document.getElementById('patientTagsSection');
            if (section) {
                const addBtn = section.querySelector('[onclick="showTagPicker()"]');
                const badge = document.createElement('span');
                badge.className = 'patient-tag-badge';
                badge.dataset.tagId = data.tag.id;
                badge.dataset.tagName = data.tag.name;
                badge.style.cssText = 'font-size:9px;padding:2px 6px;border-radius:4px;background:rgba(168,85,247,0.15);color:#a855f7;cursor:pointer;display:inline-flex;align-items:center;gap:3px;';
                badge.onclick = () => confirmRemoveTag(data.tag.id, data.tag.name);
                badge.innerHTML = `${data.tag.name} <span style="opacity:0.5;">\u00d7</span>`;
                badge.title = 'Click to remove';
                if (addBtn) addBtn.parentNode.insertBefore(badge, addBtn);
            }
            showToast(`Tag "${tagName}" added`, 'success');
        } else {
            showToast('Tag created but no ID returned', 'warning');
        }
    } catch (e) {
        console.error('[Tags] addTagToPatient error:', e);
        showToast('Tag failed: ' + (e.message || 'Network error'), 'error');
    }
}

function confirmRemoveTag(tagId, tagName) {
    if (confirm(`Remove tag "${tagName}" from this patient?`)) {
        removeTagFromPatient(tagId, tagName);
    }
}

async function removeTagFromPatient(tagId, tagName) {
    const healthieId = getChartHealthieId();
    if (!healthieId) return;

    showToast(`Removing tag "${tagName}"...`, 'info');

    try {
        const resp = await fetch('/ops/api/ipad/patient', {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove_tag', healthie_id: healthieId, tag_id: tagId }),
        });
        const data = await resp.json();
        if (data.success) {
            // Remove badge from UI
            const badge = document.querySelector(`.patient-tag-badge[data-tag-id="${tagId}"]`);
            if (badge) badge.remove();
            showToast(`Tag "${tagName}" removed`, 'success');
        } else {
            showToast('Failed to remove tag', 'error');
        }
    } catch (e) {
        console.error('[Tags] removeTagFromPatient error:', e);
        showToast('Failed to remove tag', 'error');
    }
}

// ============ PROVIDER VIDEO CALL ============

// FIX(2026-03-26): Opens native Vonage/OpenTok video page instead of broken Healthie portal URL.
// Healthie portal URLs (secure.gethealthie.com/video_calls/) require Healthie login which iPad doesn't have.
// Now uses session_id + generated_token from Healthie API with Vonage Web SDK.
// FIX(2026-03-31): Pass patient_id to video page for chart access and scribe recording
async function startProviderVideoCall(appointmentId, patientName, patientId) {
    showToast('Launching video call...', 'info');
    var encodedName = encodeURIComponent(patientName || 'Patient');
    var videoUrl = '/ops/ipad/video.html?appointment_id=' + appointmentId + '&patient_name=' + encodedName + '&patient_id=' + encodeURIComponent(patientId || '');
    window.open(videoUrl, '_blank', 'width=900,height=700,toolbar=no,menubar=no');
}

// ============ END GROUP & TAG MANAGEMENT ============

async function saveInterestingFacts() {
    const input = document.getElementById('interestingInput');
    const text = input?.value?.trim() || '';
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    if (!patientId) { showToast('No patient ID', 'error'); return; }

    try {
        const resp = await apiFetch(`/ops/api/ipad/patient/${patientId}/demographics`, {
            method: 'PUT',
            body: JSON.stringify({
                first_name: chartPanelData?.demographics?.first_name || chartPanelData?.demographics?.full_name?.split(' ')[0] || 'Patient',
                last_name: chartPanelData?.demographics?.last_name || chartPanelData?.demographics?.full_name?.split(' ').slice(1).join(' ') || '',
                interesting_facts: text,
            })
        });
        if (resp?.success) {
            showToast('⭐ Saved!', 'success');
            if (chartPanelData?.demographics) chartPanelData.demographics.interesting_facts = text;
            // Refresh chart
            const content = document.getElementById('globalChartContent') || document.getElementById('chartPanelContent');
            if (content) renderChartPanel(content);
        } else {
            showToast('Failed to save: ' + (resp?.error || 'Unknown'), 'error');
        }
    } catch (e) {
        showToast('Failed to save', 'error');
    }
}

// Calculate age from DOB string (YYYY-MM-DD)
function calcAge(dob) {
    if (!dob) return '';
    try {
        const d = new Date(dob + 'T12:00:00Z');
        const now = new Date();
        let age = now.getFullYear() - d.getFullYear();
        const m = now.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
        return age;
    } catch { return ''; }
}

// Clean up vital value — strip trailing .0, remove embedded units
function formatVitalValue(val) {
    if (val == null) return '—';
    let s = String(val);
    // Strip trailing .0 (e.g., 111.0 → 111)
    if (/^\d+\.0$/.test(s)) s = s.replace('.0', '');
    // Strip embedded unit text that getVitalUnit will add (prevent "111 bpm bpm")
    s = s.replace(/\s*(bpm|mmhg|°f|breaths\/min|%|lbs|in|mg\/dl)\s*$/i, '');
    return s || '—';
}

// Get display unit for a vital sign category (includes measurement method if available)
function getVitalUnit(category, description) {
    const cat = (category || '').toLowerCase();
    const desc = (description || '').trim();

    if (cat.includes('blood pressure') || cat === 'bp') {
        // Check for method in description (Auto, Manual, A-Line)
        if (desc && /auto|manual|a-line|arterial/i.test(desc)) return 'mmHg (' + desc + ')';
        return 'mmHg';
    }
    if (cat.includes('heart rate') || cat === 'pulse' || cat === 'hr') return 'bpm';
    if (cat.includes('respiration') || cat.includes('respiratory') || cat === 'rr') return 'breaths/min';
    if (cat.includes('temperature') || cat === 'temp') {
        // Check for method in description (Tympanic, Oral, Rectal, etc.)
        if (desc && /tympanic|oral|rectal|temporal|axillary/i.test(desc)) return '°F (' + desc + ')';
        return '°F';
    }
    if (cat.includes('oxygen') || cat.includes('spo2') || cat.includes('o2')) {
        // Check for O2 source in description
        if (desc && /on\s+\w|^RA$|NC|NRB|vent/i.test(desc)) {
            const source = desc.replace(/^on\s+/i, '');
            return '% on ' + source;
        }
        return '% on RA';
    }
    if (cat === 'weight') return 'lbs';
    if (cat === 'height') return 'in';
    if (cat === 'bmi') return '';
    if (cat.includes('glucose') || cat.includes('blood sugar')) return 'mg/dL';
    return '';
}

// Vital sign normal ranges — returns true if out of range
function isVitalOutOfRange(category, value) {
    if (!category || !value) return false;
    const cat = (category || '').toLowerCase().replace(/[_\s]+/g, ' ').trim();
    const val = String(value).trim();

    // Blood Pressure: systolic/diastolic
    if (cat.includes('blood pressure') || cat === 'bp') {
        const match = val.match(/(\d+)\s*\/\s*(\d+)/);
        if (match) {
            const sys = parseInt(match[1]), dia = parseInt(match[2]);
            return sys > 140 || sys < 90 || dia > 90 || dia < 60;
        }
        return false;
    }

    const num = parseFloat(val);
    if (isNaN(num)) return false;

    // Heart Rate / Pulse
    if (cat.includes('heart rate') || cat === 'pulse' || cat === 'hr') {
        return num > 100 || num < 60;
    }
    // Temperature (Fahrenheit)
    if (cat.includes('temperature') || cat === 'temp') {
        return num > 100.4 || num < 96.0;
    }
    // Oxygen Saturation (SpO2)
    if (cat.includes('oxygen') || cat.includes('spo2') || cat.includes('o2 sat')) {
        return num < 95;
    }
    // Respiration Rate
    if (cat.includes('respiration') || cat.includes('respiratory') || cat === 'rr') {
        return num > 20 || num < 12;
    }
    // Weight (flag extremes)
    if (cat === 'weight') {
        return num > 400 || num < 80;
    }
    // Blood Glucose
    if (cat.includes('glucose') || cat.includes('blood sugar')) {
        return num > 200 || num < 70;
    }

    return false;
}

// Delete an erroneous vital from Healthie/local DB (also removes duplicates)
async function deleteVital(vitalId, source, btnEl, patientId, category, value, diaId) {
    if (!vitalId) { showToast('No vital ID', 'error'); return; }
    if (!confirm('Remove this vital reading and any duplicates? This cannot be undone.')) return;

    const card = btnEl.closest('[data-vital-id]');
    if (card) {
        card.style.opacity = '0.4';
        card.style.pointerEvents = 'none';
    }

    try {
        let url = `/ops/api/ipad/vitals?id=${encodeURIComponent(vitalId)}&source=${source}`;
        if (patientId) url += `&patient_id=${encodeURIComponent(patientId)}`;
        if (category) url += `&category=${encodeURIComponent(category)}`;
        if (value) url += `&value=${encodeURIComponent(value)}`;
        const resp = await fetch(url, {
            method: 'DELETE',
            credentials: 'include',
        });
        const result = await resp.json();

        if (result.success) {
            // Also delete the paired diastolic entry if this was a BP
            if (diaId && diaId !== 'null' && diaId !== '') {
                fetch(`/ops/api/ipad/vitals?id=${encodeURIComponent(diaId)}&source=${source}&patient_id=${encodeURIComponent(patientId || '')}&category=Blood Pressure Diastolic&value=`, {
                    method: 'DELETE', credentials: 'include'
                }).catch(() => {});
            }
            const count = result.deleted_count || 1;
            showToast(`✅ Removed ${count > 1 ? count + ' vitals (incl. duplicates)' : 'vital'}`, 'success');
            // Remove from cached data — remove all matching category+value (duplicates)
            if (chartPanelData?.healthie_vitals) {
                if (category && value) {
                    const numVal = parseFloat(value);
                    chartPanelData.healthie_vitals = chartPanelData.healthie_vitals.filter(v =>
                        !(v.category === category && parseFloat(v.metric_stat) === numVal)
                    );
                } else {
                    chartPanelData.healthie_vitals = chartPanelData.healthie_vitals.filter(v => v.id !== vitalId);
                }
            }
            // Fade out and remove the card
            if (card) {
                card.style.transition = 'all 0.3s';
                card.style.opacity = '0';
                card.style.transform = 'scale(0.8)';
                setTimeout(() => card.remove(), 300);
            }
        } else {
            showToast('❌ ' + (result.error || 'Failed to remove'), 'error');
            if (card) { card.style.opacity = '1'; card.style.pointerEvents = 'auto'; }
        }
    } catch (e) {
        showToast('❌ Network error removing vital', 'error');
        if (card) { card.style.opacity = '1'; card.style.pointerEvents = 'auto'; }
    }
}

function renderChartPanel(content) {
    const d = chartPanelData;
    if (!d) return;

    // Default to notes tab
    if (!window._chartTab || window._chartTab === 'charting') window._chartTab = 'notes';

    const demo = d.demographics || {};
    const hAllergies = d.healthie_allergies || [];
    // FIX(2026-04-01): Filter to only show active medications — inactive/discontinued meds should not display
    const hMeds = (d.healthie_meds || []).filter(m => m.active !== false);
    const hVitals = d.healthie_vitals || [];
    const peptides = (d.medications || {}).peptides || d.peptides || [];
    const trt = (d.medications || {}).trt || d.trt || [];

    // ICD-10 code lookup — comprehensive clinical reference
    const ICD10_LOOKUP = {
        // Endocrine / Metabolic
        'E11.9': 'Type 2 Diabetes', 'E11.65': 'Type 2 Diabetes with Hyperglycemia',
        'E11.22': 'Type 2 Diabetes with CKD', 'E11.40': 'Type 2 Diabetes with Neuropathy',
        'E78.5': 'Hyperlipidemia', 'E78.0': 'Pure Hypercholesterolemia', 'E78.1': 'Hypertriglyceridemia',
        'E78.2': 'Mixed Hyperlipidemia',
        'E66.9': 'Obesity', 'E66.01': 'Morbid Obesity', 'E66.3': 'Overweight',
        'E29.1': 'Testicular Hypofunction', 'E03.9': 'Hypothyroidism',
        'E05.90': 'Hyperthyroidism', 'E55.9': 'Vitamin D Deficiency',
        'E61.1': 'Iron Deficiency', 'E53.8': 'Vitamin B12 Deficiency',
        'R73.03': 'Prediabetes', 'E13.9': 'Other Specified Diabetes',
        // Cardiovascular
        'I10': 'Essential Hypertension', 'I11.9': 'Hypertensive Heart Disease',
        'I25.10': 'Coronary Artery Disease', 'I48.91': 'Atrial Fibrillation',
        'I48.0': 'Paroxysmal Atrial Fibrillation', 'I34.1': 'Mitral Valve Prolapse',
        'I50.9': 'Heart Failure', 'I63.9': 'Cerebral Infarction (Stroke)',
        'I73.9': 'Peripheral Vascular Disease', 'I83.90': 'Varicose Veins',
        'R00.0': 'Tachycardia', 'R00.1': 'Bradycardia', 'R03.0': 'Elevated Blood Pressure',
        // Respiratory
        'J20.9': 'Acute Bronchitis', 'J06.9': 'Upper Respiratory Infection',
        'J15.9': 'Pneumonia', 'J18.9': 'Pneumonia, Unspecified', 'J12.9': 'Viral Pneumonia',
        'J44.1': 'COPD with Acute Exacerbation', 'J44.9': 'COPD',
        'J45.20': 'Mild Intermittent Asthma', 'J45.30': 'Mild Persistent Asthma',
        'J45.40': 'Moderate Persistent Asthma', 'J45.50': 'Severe Persistent Asthma',
        'J45.909': 'Asthma, Unspecified', 'J30.9': 'Allergic Rhinitis',
        'J02.9': 'Acute Pharyngitis', 'J01.90': 'Acute Sinusitis',
        'J32.9': 'Chronic Sinusitis', 'J40': 'Bronchitis',
        'R06.02': 'Shortness of Breath', 'R05.9': 'Cough', 'R05': 'Cough',
        // GI
        'K21.9': 'GERD', 'K21.0': 'GERD with Esophagitis',
        'K58.9': 'Irritable Bowel Syndrome', 'K50.90': "Crohn's Disease",
        'K51.90': 'Ulcerative Colitis', 'K76.0': 'Fatty Liver Disease',
        'K80.20': 'Gallstones', 'R10.9': 'Abdominal Pain',
        'R11.2': 'Nausea with Vomiting', 'R11.0': 'Nausea',
        'K30': 'Dyspepsia', 'R19.7': 'Diarrhea',
        // Musculoskeletal
        'M25.50': 'Joint Pain', 'M54.5': 'Low Back Pain', 'M54.2': 'Cervicalgia (Neck Pain)',
        'M79.3': 'Panniculitis', 'M79.1': 'Myalgia', 'M79.7': 'Fibromyalgia',
        'M17.9': 'Knee Osteoarthritis', 'M19.90': 'Osteoarthritis',
        'M81.0': 'Osteoporosis', 'G89.29': 'Chronic Pain',
        // Mental Health
        'F41.1': 'Generalized Anxiety Disorder', 'F41.9': 'Anxiety Disorder',
        'F32.9': 'Major Depressive Disorder', 'F33.9': 'Recurrent Depressive Disorder',
        'F32.1': 'Major Depression, Moderate', 'F43.10': 'PTSD',
        'F51.01': 'Insomnia', 'F10.20': 'Alcohol Use Disorder',
        'F17.210': 'Nicotine Dependence', 'F90.9': 'ADHD',
        // Neurological
        'G47.33': 'Obstructive Sleep Apnea', 'G43.909': 'Migraine',
        'G40.909': 'Epilepsy', 'G20': "Parkinson's Disease",
        'R51': 'Headache', 'R51.9': 'Headache',
        // Genitourinary
        'N52.9': 'Erectile Dysfunction', 'N40.0': 'Benign Prostatic Hyperplasia',
        'N40.1': 'BPH with LUTS', 'N39.0': 'Urinary Tract Infection',
        'N18.3': 'CKD Stage 3', 'N18.9': 'Chronic Kidney Disease',
        // Infectious
        'B34.9': 'Viral Infection', 'A49.9': 'Bacterial Infection',
        'U07.1': 'COVID-19', 'B97.29': 'Coronavirus',
        'J11.1': 'Influenza with Respiratory Symptoms',
        // Skin
        'L30.9': 'Dermatitis', 'L70.0': 'Acne Vulgaris', 'L40.9': 'Psoriasis',
        'L50.9': 'Urticaria', 'B35.1': 'Tinea (Fungal Infection)',
        // General / Symptoms
        'R50.9': 'Fever', 'R53.83': 'Fatigue', 'R53.1': 'Weakness',
        'R63.4': 'Weight Loss', 'R63.5': 'Weight Gain',
        'R42': 'Dizziness', 'R55': 'Syncope',
        // Administrative
        'Z79.4': 'Long-term Testosterone Use', 'Z79.899': 'Long-term Medication Use',
        'Z68.41': 'BMI 40.0-44.9 (Adult)', 'Z68.42': 'BMI 45.0-49.9 (Adult)',
        'Z87.891': 'Personal History of Nicotine Dependence',
        'Z00.00': 'General Adult Medical Exam', 'Z23': 'Immunization Encounter',
    };

    // Extract working diagnoses (ICD-10 codes) from scribe history and SOAP notes
    // Filter out any diagnoses the provider has explicitly removed
    const removedDxCodes = new Set((d.removed_diagnoses || []).map(c => typeof c === 'string' ? c : c));
    const workingDiagnoses = [];
    const seenICD = new Set();

    // FIX(2026-03-19): Extract diagnosis descriptions from SOAP assessment text
    // The assessment often has "1. Acute bronchitis (J20.9)" format
    function extractDescFromAssessment(assessment, code) {
        if (!assessment) return null;
        // Match patterns like "Pneumonia, unspecified (J15.9)" or "1. Acute bronchitis (J20.9)"
        const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`([\\w][^\\n(]*?)\\s*\\(${escaped}\\)`, 'i');
        const match = assessment.match(regex);
        if (match) {
            // Clean up: remove leading numbers/dots like "1. " or "2. "
            return match[1].replace(/^\d+\.\s*/, '').trim();
        }
        return null;
    }

    // From scribe history
    (d.scribe_history || []).forEach(s => {
        if (s.icd10_codes) {
            const codes = Array.isArray(s.icd10_codes) ? s.icd10_codes : [s.icd10_codes];
            codes.forEach(codeObj => {
                const codeStr = typeof codeObj === 'string' ? codeObj : (codeObj.code || String(codeObj));
                const cleanCode = codeStr.trim();
                if (cleanCode && !seenICD.has(cleanCode) && !removedDxCodes.has(cleanCode)) {
                    seenICD.add(cleanCode);
                    // Priority: 1) codeObj.description, 2) lookup table, 3) extract from SOAP, 4) code itself
                    const desc = (codeObj.description && codeObj.description !== '') ? codeObj.description
                        : ICD10_LOOKUP[cleanCode]
                        || extractDescFromAssessment(s.soap_assessment, cleanCode)
                        || cleanCode;
                    workingDiagnoses.push({
                        code: cleanCode,
                        description: desc,
                        date: s.created_at || s.visit_date
                    });
                }
            });
        }
    });

    // Sort by most recent first
    workingDiagnoses.sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
    });

    // Safe date formatter for vitals
    function fmtVitalDate(dt) {
        if (!dt) return '';
        try {
            const d = new Date(dt);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: CLINIC_TIMEZONE });
        } catch { return ''; }
    }

    // Clean metric_stat values — strip embedded units, trailing .0
    hVitals.forEach(v => {
        if (v.metric_stat != null) {
            let s = String(v.metric_stat);
            s = s.replace(/\s*(bpm|mmhg|°f|breaths\/min|%|lbs|in|mg\/dl)\s*$/i, '');
            if (/^\d+\.0$/.test(s)) s = s.replace('.0', '');
            v.metric_stat = s;
        }
    });

    // Deduplicate: same category + cleaned value within 5 min = duplicate (across local + Healthie)
    const deduped = [];
    const seenVitals = new Set();
    for (const v of hVitals) {
        const cat = (v.category || '').toLowerCase();
        const val = String(v.metric_stat || '');
        const ts = v.created_at ? new Date(v.created_at).getTime() : 0;
        const bucket = Math.floor(ts / 300000);
        const key = `${cat}_${val}_${bucket}`;
        if (!seenVitals.has(key)) {
            seenVitals.add(key);
            deduped.push(v);
        }
    }

    // Merge BP Systolic + Diastolic into one "Blood Pressure" card
    const merged = [];
    const bpSysEntries = {};
    const bpDiaEntries = {};
    const bpUsed = new Set();
    for (const v of deduped) {
        const cat = (v.category || '').toLowerCase();
        const ts = v.created_at ? new Date(v.created_at).getTime() : 0;
        const bucket = Math.floor(ts / 300000);
        if (cat.includes('systolic') || (cat === 'blood pressure' && !cat.includes('diastolic'))) {
            if (!bpSysEntries[bucket]) bpSysEntries[bucket] = v;
        } else if (cat.includes('diastolic')) {
            if (!bpDiaEntries[bucket]) bpDiaEntries[bucket] = v;
        }
    }
    for (const v of deduped) {
        const cat = (v.category || '').toLowerCase();
        if (cat.includes('systolic') || (cat === 'blood pressure' && !cat.includes('diastolic'))) {
            if (bpUsed.has(v.id)) continue;
            const ts = v.created_at ? new Date(v.created_at).getTime() : 0;
            const bucket = Math.floor(ts / 300000);
            const dia = bpDiaEntries[bucket];
            const sysVal = Math.round(parseFloat(v.metric_stat));
            const diaVal = dia ? Math.round(parseFloat(dia.metric_stat)) : null;
            merged.push({
                ...v,
                id: v.id,
                _diaId: dia?.id || null,
                category: 'Blood Pressure',
                metric_stat: diaVal ? `${sysVal}/${diaVal}` : `${sysVal}`,
                description: v.description || dia?.description || null,
            });
            bpUsed.add(v.id);
            if (dia) bpUsed.add(dia.id);
        } else if (cat.includes('diastolic')) {
            // Skip — handled above with systolic
            if (!bpUsed.has(v.id)) bpUsed.add(v.id); // orphan, skip it
        } else {
            merged.push(v);
        }
    }

    // Get last 8 vitals (most recent, deduplicated, BP merged)
    const recentVitals = merged.slice(0, 8);

    content.innerHTML = `
        <!-- Patient Photo + Demographics -->
        <div style="padding:0 4px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:0;">
            <div style="display:flex; align-items:center; gap:12px; padding:10px 0 6px;">
                ${d.avatar_url ? `<img src="${d.avatar_url}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; border:2px solid var(--cyan);" />` : `<div style="width:48px; height:48px; border-radius:50%; background:var(--surface-2); display:flex; align-items:center; justify-content:center; font-size:20px; border:2px solid var(--border);">\ud83d\udc64</div>`}
                <div style="flex:1;">
                    <div style="font-size:15px; font-weight:600; color:var(--text-primary);">${demo.full_name || 'Unknown'}</div>
                    <div style="font-size:11px; color:var(--text-tertiary);">${demo.dob && isNaN(Number(demo.dob)) && demo.dob.includes('-') ? `DOB: ${formatDateDisplay(demo.dob)} (${calcAge(demo.dob)}yo)` : ''} ${demo.gender ? '\u00b7 ' + demo.gender : ''} ${demo.pronouns ? '(' + demo.pronouns + ')' : ''} ${d.healthie_id ? '\u00b7 <span style="font-family:monospace; font-size:10px; opacity:0.6;">HID: ' + d.healthie_id + '</span>' : ''}</div>
                </div>
                <div style="display:flex; gap:6px; align-items:center;">
                    <button onclick="showEditDemographicsForm()" style="padding:4px 10px; border-radius:6px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); font-size:11px; font-weight:600; cursor:pointer;" title="Edit demographics">✏️ Edit</button>
                    <button onclick="showResetPasswordDialog()" style="padding:4px 10px; border-radius:6px; background:rgba(245,158,11,0.1); border:1px solid rgba(245,158,11,0.2); color:var(--yellow); font-size:11px; font-weight:600; cursor:pointer;" title="Reset patient Healthie password">🔑 Password</button>
                    <button onclick="toggleInterestingPanel()" style="padding:4px 10px; border-radius:6px; background:rgba(168,85,247,0.1); border:1px solid rgba(168,85,247,0.2); color:#a855f7; font-size:11px; font-weight:600; cursor:pointer;" title="Interesting facts about this patient">⭐ Interesting</button>
                    <button onclick="closeGlobalChart()" style="padding:4px 10px; border-radius:6px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#ef4444; font-size:11px; font-weight:600; cursor:pointer;" title="Close chart">✕</button>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 12px; padding:4px 0 4px; font-size:11px;">
                ${demo.phone_primary ? `<div><span style="color:var(--text-tertiary);">Phone:</span> <span style="color:var(--text-secondary);">${demo.phone_primary}</span></div>` : ''}
                ${demo.email ? `<div><span style="color:var(--text-tertiary);">Email:</span> <span style="color:var(--text-secondary);">${demo.email}</span></div>` : ''}
                ${demo.height ? `<div><span style="color:var(--text-tertiary);">Height:</span> <span style="color:var(--text-secondary);">${demo.height}</span></div>` : ''}
                ${demo.weight ? `<div><span style="color:var(--text-tertiary);">Weight:</span> <span style="color:var(--text-secondary);">${demo.weight}</span></div>` : ''}
                ${demo.regimen ? `<div><span style="color:var(--text-tertiary);">Regimen:</span> <span style="color:var(--text-secondary);">${demo.regimen}</span></div>` : ''}
                <div><span style="color:var(--text-tertiary);">Group:</span> <span id="patientGroupDisplay" style="color:var(--cyan); cursor:pointer; text-decoration:underline dotted; font-weight:500;" onclick="showGroupPicker()" title="Click to change group">${demo.user_group || demo.client_type_key || 'None'}</span></div>
            </div>
            ${demo.address_line1 || demo.city ? `
            <div style="padding:2px 0 4px; font-size:11px;">
                <span style="color:var(--text-tertiary);">Address:</span>
                <span style="color:var(--text-secondary);">${demo.address_line1 || ''}${demo.address_line2 ? ', ' + demo.address_line2 : ''}${demo.city ? ', ' + demo.city : ''}${demo.state ? ', ' + demo.state : ''} ${demo.zip || ''}</span>
            </div>` : ''}
            ${demo.insurance ? `
            <div style="padding:2px 0 4px; font-size:11px;">
                <span style="color:var(--text-tertiary);">Insurance:</span>
                <span style="color:var(--text-secondary);">${demo.insurance.payer_name || 'None'}${demo.insurance.plan_name ? ' — ' + demo.insurance.plan_name : ''}${demo.insurance.member_id ? ' (ID: ' + demo.insurance.member_id + ')' : ''}</span>
            </div>` : ''}
            <div id="patientTagsSection" style="padding:2px 0 6px;">
                <div style="display:flex; flex-wrap:wrap; gap:3px; align-items:center;">
                    ${(demo.tags || []).map(t => `<span class="patient-tag-badge" data-tag-id="${t.id}" data-tag-name="${t.name}" style="font-size:9px; padding:2px 6px; border-radius:4px; background:rgba(168,85,247,0.15); color:#a855f7; cursor:pointer; display:inline-flex; align-items:center; gap:3px;" onclick="confirmRemoveTag('${t.id}', '${t.name}')" title="Click to remove">${t.name} <span style="opacity:0.5;">\u00d7</span></span>`).join('')}
                    <span onclick="showTagPicker()" style="font-size:9px; padding:2px 6px; border-radius:4px; background:rgba(0,212,255,0.1); color:var(--cyan); cursor:pointer; border:1px dashed rgba(0,212,255,0.3);" title="Add tag">+ Tag</span>
                </div>
            </div>
        </div>

        <!-- INTERESTING FACTS (collapsible panel) -->
        <div id="interestingPanel" style="display:none; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.08); background:rgba(168,85,247,0.04);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:#a855f7; font-weight:600; margin-bottom:6px;">⭐ Interesting Facts</div>
            ${demo.interesting_facts ? `<div id="interestingDisplay" style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.5; margin-bottom:6px;">${demo.interesting_facts}</div>` : ''}
            <div id="interestingInputArea" style="${demo.interesting_facts ? 'display:none;' : ''}">
                <textarea id="interestingInput" placeholder="Pet names, kids, occupation, hobbies, fun facts..." style="width:100%; padding:8px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:12px; font-family:inherit; resize:vertical; min-height:60px; box-sizing:border-box;">${demo.interesting_facts || ''}</textarea>
                <div style="display:flex; gap:6px; margin-top:4px;">
                    <button onclick="saveInterestingFacts()" style="flex:1; padding:6px; border-radius:6px; background:linear-gradient(135deg,#a855f7,#7c3aed); border:none; color:white; font-size:11px; font-weight:600; cursor:pointer;">Save</button>
                    <button onclick="document.getElementById('interestingPanel').style.display='none'" style="padding:6px 12px; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:11px; cursor:pointer;">Cancel</button>
                </div>
            </div>
            ${demo.interesting_facts ? `<button onclick="document.getElementById('interestingInputArea').style.display='block'; document.getElementById('interestingDisplay').style.display='none';" style="font-size:10px; background:none; border:none; color:#a855f7; cursor:pointer; padding:0;">✏️ Edit</button>` : ''}
        </div>

        <!-- Show interesting facts inline if they exist (compact) -->
        ${demo.interesting_facts ? `
        <div id="interestingBadge" style="padding:2px 8px 4px; border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:10px; display:flex; align-items:center; gap:4px; cursor:pointer;" onclick="toggleInterestingPanel()">
                <span style="color:#a855f7;">⭐</span>
                <span style="color:var(--text-tertiary); font-style:italic;">${demo.interesting_facts.substring(0, 80)}${demo.interesting_facts.length > 80 ? '...' : ''}</span>
            </div>
        </div>` : ''}

        <!-- ALLERGIES (always visible) -->
        <div id="allergies-section" style="padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-tertiary); font-weight:600; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
                <span>\ud83d\udea8 Allergies</span>
                <div style="display:flex; gap:4px; align-items:center;">
                    ${!hAllergies.some(a => a.is_nkda) ? `<button onclick="markNKDA()" style="font-size:9px; padding:2px 6px; border-radius:4px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); color:#22c55e; cursor:pointer; font-weight:600;" title="Mark No Known Drug Allergies">NKDA</button>` : ''}
                    <button class="chart-add-btn" onclick="showAllergyForm()" title="Add Allergy" style="font-size:12px; background:none; border:none; color:var(--cyan); cursor:pointer; padding:0 4px;">＋</button>
                </div>
            </div>
            ${hAllergies.length > 0
                ? `<div style="display:flex; flex-wrap:wrap; gap:4px;">${hAllergies.map(a => {
                    if (a.is_nkda) {
                        const ts = a.created_at ? new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TIMEZONE }) : '';
                        return `<span style="font-size:11px; padding:2px 8px; border-radius:10px; background:rgba(34,197,94,0.15); color:#22c55e; border:1px solid rgba(34,197,94,0.2);">✅ NKDA${a.entered_by ? ' — ' + a.entered_by : ''}${ts ? ' · ' + ts : ''}</span>`;
                    }
                    const severityColors = { severe: '#ef4444', moderate: '#f59e0b', mild: '#22c55e' };
                    const sev = (a.severity || '').toLowerCase();
                    const sevColor = severityColors[sev] || '#f87171';
                    return `<span style="font-size:11px; padding:2px 8px; border-radius:10px; background:rgba(239,68,68,0.15); color:${sevColor}; border:1px solid rgba(239,68,68,0.2);">${a.name || 'Unknown'}${a.severity ? ' (' + a.severity + ')' : ''}${a.reaction ? ' — ' + a.reaction : ''}</span>`;
                }).join('')}</div>`
                : `<div style="font-size:11px; color:var(--text-tertiary); font-style:italic;">No allergies documented</div>`}
            <div id="allergyFormArea"></div>
        </div>

        <!-- WORKING DIAGNOSES (ICD-10 codes from chart notes) -->
        <div id="diagnoses-section" style="padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-tertiary); font-weight:600; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
                <span>\ud83c\udff7\ufe0f Working Diagnoses (${workingDiagnoses.length})</span>
                <div style="display:flex; gap:4px; align-items:center;">
                    ${workingDiagnoses.length > 3 ? `<button onclick="document.getElementById('diagnoses-expanded').classList.toggle('hidden'); this.textContent = this.textContent.includes('more') ? 'Show less' : 'Show ${workingDiagnoses.length - 3} more'" style="font-size:10px; background:none; border:none; color:var(--cyan); cursor:pointer; padding:0 4px;">Show ${workingDiagnoses.length - 3} more</button>` : ''}
                    <button class="chart-add-btn" onclick="showPatientDataForm('diagnosis')" title="Add Diagnosis" style="font-size:12px; background:none; border:none; color:var(--cyan); cursor:pointer; padding:0 4px;">＋</button>
                </div>
            </div>
            ${workingDiagnoses.length > 0 ? `
            <div style="display:flex; flex-wrap:wrap; gap:4px;">
                ${workingDiagnoses.slice(0, 3).map(dx => `<span style="font-size:11px; padding:3px 6px 3px 8px; border-radius:6px; background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.2); line-height:1.4; display:inline-flex; align-items:center; gap:6px;"><span><span style="font-family:monospace; font-weight:600;">${dx.code}</span> — ${dx.description}</span>${(currentUser?.role === 'admin' || currentUser?.is_provider) ? `<button onclick="removeDiagnosis('${dx.code}', '${dx.description.replace(/'/g, "\\'")}')" style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#ef4444; cursor:pointer; padding:4px 7px; font-size:11px; line-height:1; border-radius:4px; margin-left:2px; min-width:24px; min-height:24px; display:inline-flex; align-items:center; justify-content:center;" title="Remove diagnosis">✕</button>` : ''}</span>`).join('')}
            </div>
            ${workingDiagnoses.length > 3 ? `
            <div id="diagnoses-expanded" class="hidden" style="display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; padding-top:4px; border-top:1px solid rgba(168,85,247,0.1);">
                ${workingDiagnoses.slice(3).map(dx => `<span style="font-size:11px; padding:3px 6px 3px 8px; border-radius:6px; background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.2); line-height:1.4; display:inline-flex; align-items:center; gap:6px;"><span><span style="font-family:monospace; font-weight:600;">${dx.code}</span> — ${dx.description}</span>${(currentUser?.role === 'admin' || currentUser?.is_provider) ? `<button onclick="removeDiagnosis('${dx.code}', '${dx.description.replace(/'/g, "\\'")}')" style="background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); color:#ef4444; cursor:pointer; padding:4px 7px; font-size:11px; line-height:1; border-radius:4px; margin-left:2px; min-width:24px; min-height:24px; display:inline-flex; align-items:center; justify-content:center;" title="Remove diagnosis">✕</button>` : ''}</span>`).join('')}
            </div>` : ''}` : '<div style="font-size:11px; color:var(--text-tertiary); font-style:italic;">No working diagnoses</div>'}
        </div>

        <!-- MEDICATIONS (always visible — upgraded with prescriptions + controlled substance badges) -->
        <div id="medications-section" style="padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
            ${renderMedicationsSection(d, hMeds, peptides, trt)}
        </div>

        <!-- LAST VITALS (always visible) -->
        <div style="padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.08);">
            <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-tertiary); font-weight:600; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
                <span>\ud83d\udcca Last Vitals</span>
                <button class="chart-add-btn" onclick="showQuickVitalsForm()" title="Quick Vitals" style="font-size:12px; background:none; border:none; color:var(--cyan); cursor:pointer; padding:0 4px;">＋</button>
            </div>
            <div id="quickVitalsFormArea"></div>
            ${recentVitals.length > 0
                ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:6px;">${recentVitals.map(v => {
                    const recordedBy = v.created_by?.full_name || v.created_by?.email || (v.description && v.description.includes('by ') ? v.description.split('by ').pop().split(')')[0] : '');
                    const outOfRange = isVitalOutOfRange(v.category, v.metric_stat);
                    const bgStyle = outOfRange ? 'background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4);' : 'background:var(--surface-2); border:1px solid var(--border);';
                    const valueColor = outOfRange ? 'color:#f87171; font-weight:700;' : 'color:var(--text-primary); font-weight:600;';
                    const vitalId = v.id || '';
                    const vitalDiaId = v._diaId || '';
                    const vitalSource = String(vitalId).startsWith('local_') ? 'local' : 'healthie';
                    const vCat = (v.category || '').replace(/'/g, "\\'");
                    const vVal = String(v.metric_stat || '').replace(/'/g, "\\'");
                    const vPatId = chartPanelData?.healthie_id || '';
                    return `<div style="font-size:11px; padding:4px 8px; border-radius:6px; ${bgStyle} position:relative;" data-vital-id="${vitalId}">
                    <button onclick="deleteVital('${vitalId}', '${vitalSource}', this, '${vPatId}', '${vCat}', '${vVal}', '${vitalDiaId}')" style="position:absolute; top:2px; right:4px; background:none; border:none; color:var(--text-tertiary); font-size:10px; cursor:pointer; padding:0 2px; opacity:0.5;" title="Remove this vital" onmouseover="this.style.opacity='1';this.style.color='#ef4444'" onmouseout="this.style.opacity='0.5';this.style.color='var(--text-tertiary)'">✕</button>
                    <div style="color:var(--text-tertiary); font-size:9px; text-transform:uppercase; padding-right:14px;">${v.category || v.type || '?'}${outOfRange ? ' ⚠️' : ''}</div>
                    <div style="${valueColor}">${formatVitalValue(v.metric_stat)} <span style="font-weight:400; font-size:9px; color:var(--text-tertiary);">${getVitalUnit(v.category, v.description)}</span></div>
                    <div style="color:var(--text-tertiary); font-size:9px;">${fmtVitalDate(v.created_at)}</div>
                    ${recordedBy ? `<div style="color:var(--cyan); font-size:9px;">by ${recordedBy.split('@')[0]}</div>` : ''}
                </div>`;
                }).join('')}</div>`
                : `<div style="font-size:11px; color:var(--text-tertiary); font-style:italic;">No vitals on file</div>`}
        </div>

        <!-- Controlled Substance Alert (if any) -->
        ${renderControlledSubstanceAlert(d)}

        <!-- Kiosk Mode: Hand iPad to Patient (chart header) -->
        ${(d.pending_forms || []).filter(f => f.status !== 'completed').length > 0 ? `
        <div style="padding:6px 12px;">
            <button class="kiosk-launch-btn" onclick="launchKioskMode('${chartPanelPatientId}', '${d.healthie_id || ''}', ${JSON.stringify((d.pending_forms || []).filter(f => f.status !== 'completed')).replace(/"/g, '&quot;')}, '${(demo.full_name || 'Patient').replace(/'/g, "\\'")}')" style="width:100%; justify-content:center; padding:10px 16px; font-size:13px;">
                📋 Hand iPad to Patient <span class="kiosk-badge">${(d.pending_forms || []).filter(f => f.status !== 'completed').length}</span>
            </button>
        </div>` : ''}

        <!-- Consolidated Tabs -->
        <div class="chart-tab-nav" style="gap:0; padding:4px 8px;">
            <button class="chart-tab-btn ${window._chartTab === 'notes' || window._chartTab === 'charting' ? 'active' : ''}" data-tab="notes" onclick="switchChartTab('notes')" style="flex:1; font-size:12px;">📋 Notes</button>
            <button class="chart-tab-btn ${window._chartTab === 'meds' || window._chartTab === 'prescriptions' || window._chartTab === 'erx' || window._chartTab === 'dispense' ? 'active' : ''}" data-tab="meds" onclick="switchChartTab('meds')" style="flex:1; font-size:12px;">💊 Meds & Rx</button>
            <button class="chart-tab-btn ${window._chartTab === 'files' || window._chartTab === 'forms' || window._chartTab === 'documents' ? 'active' : ''}" data-tab="files" onclick="switchChartTab('files')" style="flex:1; font-size:12px;">📁 Files</button>
            <button class="chart-tab-btn ${window._chartTab === 'financial' ? 'active' : ''}" data-tab="financial" onclick="switchChartTab('financial')" style="flex:1; font-size:12px;">💰 Financial</button>
        </div>
        <div id="chartTabContent"></div>
    `;

    renderChartTabContent();
}

function switchChartTab(tab) {
    window._chartTab = tab;
    // Update button active states
    document.querySelectorAll('.chart-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    renderChartTabContent();
}

function renderChartTabContent() {
    const container = document.getElementById('chartTabContent');
    if (!container || !chartPanelData) return;
    const d = chartPanelData;

    // Map legacy tab names to consolidated tabs
    const tab = window._chartTab;
    if (tab === 'notes' || tab === 'charting') {
        renderNotesTab(container, d);
    } else if (tab === 'meds' || tab === 'prescriptions' || tab === 'erx' || tab === 'dispense') {
        renderMedsRxTab(container, d);
    } else if (tab === 'files' || tab === 'forms' || tab === 'documents') {
        renderFilesTab(container, d);
    } else if (tab === 'financial') {
        renderFinancialTab(container, d);
    }
}

// ==================== CONSOLIDATED NOTES TAB ====================
// Combines Charting (SOAP notes) + inline scribe recording
function renderNotesTab(container, d) {
    const patientId = d.demographics?.patient_id || d.healthie_id || chartPanelPatientId || '';
    const patientName = (d.demographics?.full_name || 'Patient').replace(/'/g, "\\'");
    const healthieId = d.healthie_id || '';

    // Check if a recording is already in progress (user navigated away and back)
    const isCurrentlyRecording = window._inlineRecording;
    const btnLabel = isCurrentlyRecording ? '⏹️ Stop Recording' : '🎤 Record Visit';
    const btnBg = isCurrentlyRecording
        ? 'linear-gradient(135deg, #f59e0b, #d97706)'
        : 'linear-gradient(135deg, #ef4444, #dc2626)';
    const btnAction = isCurrentlyRecording
        ? 'stopInlineRecording()'
        : `startInlineRecording('${patientId}', '${patientName}', '${healthieId}')`;
    const btnShadow = isCurrentlyRecording
        ? '0 2px 8px rgba(245,158,11,0.3)'
        : '0 2px 8px rgba(239,68,68,0.3)';

    container.innerHTML = `
        <div style="padding:8px 12px;">
            <!-- Inline Record Action -->
            <div style="margin-bottom:12px;">
                <button id="chartRecordBtn" onclick="${btnAction}" style="width:100%; padding:14px; background:${btnBg}; color:white; border:none; border-radius:10px; font-size:15px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:${btnShadow};">
                    ${btnLabel}
                </button>
            </div>
            <div id="inlineRecordingArea"></div>
        </div>
    `;

    // Restore recording UI if recording is active
    if (isCurrentlyRecording && inlineRecordingStart) {
        const area = document.getElementById('inlineRecordingArea');
        if (area) {
            const elapsed = Math.floor((Date.now() - inlineRecordingStart) / 1000);
            const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
            const sec = String(elapsed % 60).padStart(2, '0');
            area.innerHTML = `
                <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; margin-bottom:8px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <div style="width:10px; height:10px; border-radius:50%; background:#ef4444; animation:pulse 1.5s infinite;"></div>
                        <span style="color:#f87171; font-weight:600; font-size:14px;">Recording</span>
                        <span id="inlineRecTimer" style="color:var(--text-tertiary); font-size:13px; font-family:monospace; margin-left:auto;">${min}:${sec}</span>
                    </div>
                    <div style="font-size:11px; color:var(--text-tertiary);">Speak naturally. Press Stop when done.</div>
                </div>
            `;
            // Restart the timer interval if it was lost during re-render
            if (!inlineRecordingTimer) {
                inlineRecordingTimer = setInterval(() => {
                    const el = document.getElementById('inlineRecTimer');
                    if (el) {
                        const elapsed = Math.floor((Date.now() - inlineRecordingStart) / 1000);
                        const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
                        const sec = String(elapsed % 60).padStart(2, '0');
                        el.textContent = `${min}:${sec}`;
                    }
                }, 1000);
            }
        }
    }

    // Render the charting content below the action buttons
    const chartingContainer = document.createElement('div');
    container.appendChild(chartingContainer);
    renderChartingTab(chartingContainer, d);
}

// ==================== INLINE CHART RECORDING ====================
// Full recording system within the patient chart — same flow as scribe but stays in chart

let inlineMediaRecorder = null;
let inlineAudioChunks = [];
let inlineRecordingTimer = null;
let inlineRecordingStart = 0;
let inlineSessionId = null;

async function startInlineRecording(patientId, patientName, healthieId) {
    const btn = document.getElementById('chartRecordBtn');
    const area = document.getElementById('inlineRecordingArea');
    if (!area) return;

    if (window._inlineRecording) {
        stopInlineRecording();
        return;
    }

    // Request microphone
    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        showToast('Microphone access denied. Check Settings → Safari → Microphone.', 'error');
        return;
    }

    try {
        inlineAudioChunks = [];
        const mimeType = getRecordingMimeType();
        const opts = mimeType ? { mimeType } : {};
        inlineMediaRecorder = new MediaRecorder(stream, opts);
        inlineMediaRecorder.ondataavailable = e => { if (e.data.size > 0) inlineAudioChunks.push(e.data); };
        inlineMediaRecorder.onstop = () => handleInlineRecordingComplete(patientId, patientName);
        inlineMediaRecorder.start(1000);

        window._inlineRecording = true;
        window._inlineRecordingMime = inlineMediaRecorder.mimeType || mimeType;
        inlineRecordingStart = Date.now();

        btn.innerHTML = '⏹️ Stop Recording';
        btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        btn.setAttribute('onclick', 'stopInlineRecording()');

        // Disable generate button while recording
        const genBtn = btn.nextElementSibling;
        if (genBtn) { genBtn.style.opacity = '0.4'; genBtn.style.pointerEvents = 'none'; }

        area.innerHTML = `
            <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; margin-bottom:8px;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                    <div style="width:10px; height:10px; border-radius:50%; background:#ef4444; animation:pulse 1.5s infinite;"></div>
                    <span style="color:#f87171; font-weight:600; font-size:14px;">Recording</span>
                    <span id="inlineRecTimer" style="color:var(--text-tertiary); font-size:13px; font-family:monospace; margin-left:auto;">00:00</span>
                </div>
                <div style="font-size:11px; color:var(--text-tertiary);">Speak naturally. Press Stop when done.</div>
            </div>
        `;

        inlineRecordingTimer = setInterval(() => {
            const el = document.getElementById('inlineRecTimer');
            if (el) {
                const elapsed = Math.floor((Date.now() - inlineRecordingStart) / 1000);
                const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
                const sec = String(elapsed % 60).padStart(2, '0');
                el.textContent = `${min}:${sec}`;
            }
        }, 1000);

        showToast('🎤 Recording started', 'success');

        // Auto-advance appointment to "In Progress" if patient has one today
        if (patientId || healthieId) {
            var matchAppt = scheduleAllData?.find(function(a) {
                return (a.patient_id === patientId || a.healthie_id === healthieId || a.healthie_id === patientId)
                    && a.appointment_status !== 'Completed' && a.appointment_status !== 'No Show' && a.appointment_status !== 'Cancelled';
            });
            if (matchAppt && matchAppt.appointment_id && matchAppt.appointment_status !== 'In Progress') {
                updateApptStatus(matchAppt.appointment_id, 'In Progress');
            }
        }
    } catch (err) {
        stream.getTracks().forEach(t => t.stop());
        showToast('Could not start recording: ' + (err.message || 'unsupported'), 'error');
    }
}

function stopInlineRecording() {
    if (inlineRecordingTimer) { clearInterval(inlineRecordingTimer); inlineRecordingTimer = null; }
    if (inlineMediaRecorder && (inlineMediaRecorder.state === 'recording' || inlineMediaRecorder.state === 'paused')) {
        if (inlineMediaRecorder.state === 'paused') inlineMediaRecorder.resume();
        inlineMediaRecorder.stop();
        inlineMediaRecorder.stream?.getTracks().forEach(t => t.stop());
    }
    window._inlineRecording = false;

    const btn = document.getElementById('chartRecordBtn');
    if (btn) {
        const patientId = chartPanelData?.demographics?.patient_id || chartPanelData?.healthie_id || '';
        const patientName = (chartPanelData?.demographics?.full_name || 'Patient').replace(/'/g, "\\'");
        const healthieId = chartPanelData?.healthie_id || '';
        btn.innerHTML = '🎤 Record Visit';
        btn.style.background = 'linear-gradient(135deg, #ef4444, #dc2626)';
        btn.setAttribute('onclick', `startInlineRecording('${patientId}', '${patientName}', '${healthieId}')`);
        // Re-enable generate button
        const genBtn = btn.nextElementSibling;
        if (genBtn) { genBtn.style.opacity = '1'; genBtn.style.pointerEvents = 'auto'; }
    }
}

async function handleInlineRecordingComplete(patientId, patientName) {
    const area = document.getElementById('inlineRecordingArea');
    if (!area) return;

    const mimeType = window._inlineRecordingMime || 'audio/webm';
    const blob = new Blob(inlineAudioChunks, { type: mimeType });
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';
    const elapsed = Math.floor((Date.now() - inlineRecordingStart) / 1000);
    const sizeKB = (blob.size / 1024).toFixed(0);

    area.innerHTML = `
        <div style="padding:12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                <div class="loading-spinner" style="width:16px; height:16px; border-width:2px;"></div>
                <span style="color:#f59e0b; font-weight:600; font-size:13px;">Uploading & Transcribing...</span>
            </div>
            <div style="font-size:11px; color:var(--text-tertiary);">Duration: ${Math.floor(elapsed/60)}m ${elapsed%60}s · Size: ${sizeKB}KB</div>
        </div>
    `;

    // Upload to scribe transcribe endpoint
    const formData = new FormData();
    formData.append('audio', blob, `visit-recording.${ext}`);
    formData.append('patient_id', patientId);
    formData.append('visit_type', 'follow_up');
    formData.append('patient_name', patientName || '');

    try {
        const resp = await fetch('/ops/api/scribe/transcribe/', {
            method: 'POST', body: formData, credentials: 'include',
        });
        if (!resp.ok) throw new Error(`Upload failed (HTTP ${resp.status})`);
        const data = await resp.json();

        if (data.success) {
            inlineSessionId = data.data?.session_id;
            const status = data.data?.status;

            if (status === 'transcribing') {
                // Poll for completion
                area.innerHTML = `
                    <div style="padding:12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:10px; margin-bottom:8px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                            <div class="loading-spinner" style="width:16px; height:16px; border-width:2px;"></div>
                            <span style="color:#f59e0b; font-weight:600; font-size:13px;">Transcribing in progress...</span>
                        </div>
                        <div style="font-size:11px; color:var(--text-tertiary);">This usually takes 30-60 seconds. The Generate button will activate when ready.</div>
                    </div>
                `;
                pollInlineTranscription(inlineSessionId, area, patientId, patientName);
            } else if (status === 'transcribed') {
                showInlineTranscriptionReady(area, data.data, patientId, patientName);
            }
        } else {
            throw new Error(data.error || 'Transcription failed');
        }
    } catch (err) {
        area.innerHTML = `
            <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; margin-bottom:8px;">
                <div style="color:#f87171; font-weight:600; font-size:13px;">❌ Upload failed: ${sanitize(err.message)}</div>
                <button onclick="startInlineRecording('${sanitize(patientId)}', '${sanitize(patientName).replace(/'/g, "\\'")}', '')" style="margin-top:8px; padding:6px 12px; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:11px; cursor:pointer;">Try Again</button>
            </div>
        `;
    }
}

function pollInlineTranscription(sessionId, area, patientId, patientName) {
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes max
    const poll = setInterval(async () => {
        attempts++;
        // FIX: Stop polling if the target element was removed from DOM
        if (!area || !area.isConnected) { clearInterval(poll); return; }
        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);
            if (data?.success && data.data?.status === 'transcribed') {
                clearInterval(poll);
                showInlineTranscriptionReady(area, data.data, patientId, patientName);
            } else if (attempts >= maxAttempts) {
                clearInterval(poll);
                area.innerHTML = `
                    <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; margin-bottom:8px;">
                        <div style="color:#f87171; font-weight:600; font-size:13px;">⏱️ Transcription is taking longer than expected.</div>
                        <button onclick="pollInlineTranscription('${sanitize(sessionId)}', document.getElementById('inlineRecordingArea'), '${sanitize(patientId)}', '${sanitize(patientName).replace(/'/g, "\\'")}')" style="margin-top:6px; padding:6px 12px; border-radius:6px; background:var(--cyan); border:none; color:#000; font-size:11px; font-weight:600; cursor:pointer;">Check Again</button>
                    </div>
                `;
            }
        } catch (e) {
            console.warn('[Scribe] Poll error for session', sessionId, e.message || e);
        }
    }, 3000);
}

function showInlineTranscriptionReady(area, sessionData, patientId, patientName) {
    const transcript = sessionData.raw_transcript || sessionData.transcript || '';
    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    inlineSessionId = sessionData.session_id;

    showToast('✅ Transcription complete!', 'success');

    area.innerHTML = `
        <div style="padding:12px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.2); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                <span style="color:#22c55e; font-weight:700; font-size:13px;">✅ Transcription Ready</span>
                <span style="color:var(--text-tertiary); font-size:11px;">${wordCount} words</span>
            </div>
            <div style="max-height:120px; overflow-y:auto; font-size:11px; color:var(--text-secondary); line-height:1.5; padding:8px; background:var(--surface-2); border-radius:6px; margin-bottom:10px; white-space:pre-wrap;">${sanitize(transcript.substring(0, 500))}${transcript.length > 500 ? '...' : ''}</div>
            <button onclick="generateInlineNote('${patientId}', '${patientName}')" style="width:100%; padding:12px; background:linear-gradient(135deg, #8b5cf6, #6d28d9); color:white; border:none; border-radius:8px; font-size:14px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
                ✨ Generate SOAP Note
            </button>
        </div>
    `;
}

async function generateInlineNote(patientId, patientName) {
    const area = document.getElementById('inlineRecordingArea');
    if (!area || !inlineSessionId) {
        showToast('No transcription session found', 'error');
        return;
    }

    area.innerHTML = `
        <div style="padding:12px; background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.2); border-radius:10px; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <div class="loading-spinner" style="width:16px; height:16px; border-width:2px;"></div>
                <span style="color:#a855f7; font-weight:600; font-size:13px;">Generating SOAP note with AI...</span>
            </div>
            <div style="font-size:11px; color:var(--text-tertiary); margin-top:4px;">This takes 15-30 seconds.</div>
        </div>
    `;

    try {
        const resp = await fetch('/ops/api/scribe/generate-note/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: inlineSessionId, patient_id: patientId }),
            credentials: 'include',
        });
        const data = await resp.json();

        if (data.success && data.data) {
            const note = data.data;
            showToast('✅ SOAP note generated!', 'success');

            area.innerHTML = `
                <div style="padding:12px; background:rgba(34,197,94,0.06); border:1px solid rgba(34,197,94,0.2); border-radius:10px; margin-bottom:8px;">
                    <div style="color:#22c55e; font-weight:700; font-size:13px; margin-bottom:8px;">✅ SOAP Note Generated</div>
                    ${note.soap_subjective ? `<div style="margin-bottom:8px;"><div style="font-size:10px; text-transform:uppercase; color:var(--cyan); font-weight:700;">SUBJECTIVE</div><div style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.4;">${note.soap_subjective.substring(0, 300)}${note.soap_subjective.length > 300 ? '...' : ''}</div></div>` : ''}
                    ${note.soap_assessment ? `<div style="margin-bottom:8px;"><div style="font-size:10px; text-transform:uppercase; color:var(--cyan); font-weight:700;">ASSESSMENT</div><div style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.4;">${note.soap_assessment.substring(0, 300)}${note.soap_assessment.length > 300 ? '...' : ''}</div></div>` : ''}
                    <div style="display:flex; gap:8px; margin-top:10px;">
                        <button onclick="window.location.hash='#scribe'; setTimeout(() => { if (typeof loadScribeSessions === 'function') loadScribeSessions(); }, 300);" style="flex:1; padding:8px; border-radius:6px; background:var(--cyan); border:none; color:#000; font-size:12px; font-weight:600; cursor:pointer;">View Full Note in Scribe</button>
                        <button onclick="document.getElementById('inlineRecordingArea').innerHTML=''; loadChartData(chartPanelPatientId);" style="padding:8px 12px; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:12px; cursor:pointer;">Dismiss</button>
                    </div>
                </div>
            `;

            // Reload chart data to show the new note in the timeline
            if (chartPanelPatientId) {
                setTimeout(() => loadChartData(chartPanelPatientId), 2000);
            }
        } else {
            throw new Error(data.error || 'Generation failed');
        }
    } catch (err) {
        area.innerHTML = `
            <div style="padding:12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:10px; margin-bottom:8px;">
                <div style="color:#f87171; font-weight:600; font-size:13px;">❌ Note generation failed: ${err.message}</div>
                <button onclick="generateInlineNote('${patientId}', '${patientName}')" style="margin-top:6px; padding:6px 12px; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:11px; cursor:pointer;">Retry</button>
            </div>
        `;
    }
}

function generateNoteFromChart(patientId, patientName) {
    // If we have an inline session ready, generate from it
    if (inlineSessionId) {
        generateInlineNote(patientId, patientName);
        return;
    }
    // Otherwise open scribe
    startScribeFromChart(patientId, patientName);
    showToast('Opening Scribe to generate note...', 'info');
}

// ==================== CONSOLIDATED MEDS & RX TAB ====================
// Combines Prescriptions + E-Rx + Dispense History
function renderMedsRxTab(container, d) {
    // Sub-tabs within Meds & Rx
    const subTab = window._medsSubTab || 'rx';

    container.innerHTML = `
        <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
            <button class="chart-subtab ${subTab === 'rx' ? 'active' : ''}" onclick="window._medsSubTab='rx'; renderChartTabContent();" style="flex:1; padding:6px 8px; font-size:11px; font-weight:600; border:none; border-radius:6px; cursor:pointer; ${subTab === 'rx' ? 'background:var(--cyan); color:white;' : 'background:var(--surface-2); color:var(--text-secondary);'}">💊 Medications</button>
            <button class="chart-subtab ${subTab === 'erx' ? 'active' : ''}" onclick="window._medsSubTab='erx'; renderChartTabContent();" style="flex:1; padding:6px 8px; font-size:11px; font-weight:600; border:none; border-radius:6px; cursor:pointer; ${subTab === 'erx' ? 'background:var(--cyan); color:white;' : 'background:var(--surface-2); color:var(--text-secondary);'}">📝 E-Prescribe</button>
            <button class="chart-subtab ${subTab === 'dispense' ? 'active' : ''}" onclick="window._medsSubTab='dispense'; renderChartTabContent();" style="flex:1; padding:6px 8px; font-size:11px; font-weight:600; border:none; border-radius:6px; cursor:pointer; ${subTab === 'dispense' ? 'background:var(--cyan); color:white;' : 'background:var(--surface-2); color:var(--text-secondary);'}">💉 Dispense Hx</button>
        </div>
    `;

    const subContainer = document.createElement('div');
    container.appendChild(subContainer);

    if (subTab === 'rx') {
        renderPrescriptionsTab(subContainer, d);
    } else if (subTab === 'erx') {
        renderERxTab(subContainer, d);
    } else if (subTab === 'dispense') {
        renderDispenseTab(subContainer, d);
    }
}

// ==================== CONSOLIDATED FILES TAB ====================
// Combines Forms + Documents
function renderFilesTab(container, d) {
    const subTab = window._filesSubTab || 'forms';

    container.innerHTML = `
        <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid rgba(255,255,255,0.06);">
            <button class="chart-subtab ${subTab === 'forms' ? 'active' : ''}" onclick="window._filesSubTab='forms'; renderChartTabContent();" style="flex:1; padding:6px 8px; font-size:11px; font-weight:600; border:none; border-radius:6px; cursor:pointer; ${subTab === 'forms' ? 'background:var(--cyan); color:white;' : 'background:var(--surface-2); color:var(--text-secondary);'}">📝 Intake Forms</button>
            <button class="chart-subtab ${subTab === 'docs' ? 'active' : ''}" onclick="window._filesSubTab='docs'; renderChartTabContent();" style="flex:1; padding:6px 8px; font-size:11px; font-weight:600; border:none; border-radius:6px; cursor:pointer; ${subTab === 'docs' ? 'background:var(--cyan); color:white;' : 'background:var(--surface-2); color:var(--text-secondary);'}">📁 Documents</button>
        </div>
    `;

    const subContainer = document.createElement('div');
    container.appendChild(subContainer);

    if (subTab === 'forms') {
        renderFormsTab(subContainer, d);
    } else if (subTab === 'docs') {
        renderDocumentsTab(subContainer, d);
    }
}

// ==================== PRESCRIPTIONS TAB ====================
// ─── UPGRADED MEDICATIONS SECTION (chart panel, always visible) ────────
function renderMedicationsSection(d, hMeds, peptides, trt) {
    const rxActive = d.prescriptions?.active || [];
    const rxControlled = rxActive.filter(p => p.schedule != null);
    const totalCount = hMeds.length + peptides.length + trt.length + rxActive.length;

    let html = `
        <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-tertiary); font-weight:600; margin-bottom:3px; display:flex; justify-content:space-between; align-items:center;">
            <span>💊 Medications (${totalCount})${rxControlled.length > 0
                ? ` <span style="color:var(--orange);font-size:9px;margin-left:4px;">⚠️ ${rxControlled.length} Controlled</span>`
                : ''}</span>
            <button class="chart-add-btn" onclick="showPatientDataForm('medication')" title="Add Medication" style="font-size:12px; background:none; border:none; color:var(--cyan); cursor:pointer; padding:0 4px;">＋</button>
        </div>`;

    // DoseSpot active prescriptions (shown first with controlled substance indicators)
    if (rxActive.length > 0) {
        html += '<div style="margin-bottom:4px;">';
        for (const rx of rxActive) {
            const borderColor = rx.schedule === 'II' ? 'var(--red)'
                : rx.schedule === 'III' ? 'var(--orange)'
                : rx.schedule === 'IV' ? 'var(--yellow)'
                : rx.schedule === 'V' ? 'var(--green)'
                : 'transparent';
            const hasBorder = rx.schedule != null;
            html += `
                <div class="rx-med-chip" style="${hasBorder ? `border-left:3px solid ${borderColor};` : ''}">
                    ${rx.product_name || rx.display_name || '?'}
                    ${rx.dosage ? `<span style="color:var(--text-tertiary);font-size:11px;">${rx.dosage}</span>` : ''}
                    ${rx.schedule ? `<span class="rx-schedule-badge rx-schedule-badge-${rx.schedule.toLowerCase()}">C-${rx.schedule}</span>` : ''}
                    ${rx.last_fill_date ? `<span style="color:var(--text-tertiary);font-size:9px;">filled ${formatRxDate(rx.last_fill_date)}</span>` : ''}
                </div>`;
        }
        html += '</div>';
    }

    // Existing hMeds — each one is tappable to edit
    // FIX(2026-04-01): Made medications editable (tap to change dose, frequency, etc.)
    if (hMeds.length > 0) {
        html += '<div style="margin-top:4px;">';
        for (const m of hMeds) {
            const name = m.name || '?';
            const dosage = m.dosage || '';
            const freq = m.frequency || '';
            const route = m.route || '';
            const directions = m.directions || '';
            const medId = m.id || '';
            const hasDosageInName = dosage && name.toLowerCase().includes(dosage.toLowerCase());
            let display = name;
            if (dosage && !hasDosageInName) display += ' ' + dosage;
            if (route) display += ' ' + route;
            if (freq) display += ' · ' + freq;

            const escapedName = (name || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const escapedDosage = (dosage || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const escapedFreq = (freq || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const escapedDir = (directions || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const escapedRoute = (route || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

            html += `<div onclick="showEditMedicationForm('${medId}', '${escapedName}', '${escapedDosage}', '${escapedFreq}', '${escapedDir}', '${escapedRoute}')"
                style="display:flex; align-items:center; justify-content:space-between; padding:4px 6px; margin-bottom:2px; border-radius:6px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); cursor:pointer; font-size:11px;"
                onmouseover="this.style.background='rgba(0,212,255,0.06)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                <div style="flex:1; min-width:0;">
                    <span style="color:var(--text-primary); font-weight:500;">${display}</span>
                    ${directions ? `<div style="font-size:9px; color:var(--text-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${directions}</div>` : ''}
                </div>
                <span style="font-size:9px; color:var(--cyan); flex-shrink:0; margin-left:4px;">✏️</span>
            </div>`;
        }
        html += '</div>';
    }

    // Peptides & TRT (not editable via Healthie — separate systems)
    const otherMeds = [
        ...peptides.map(m => m.medication_name || m.product_name || '?'),
        ...trt.map(m => m.medication_name || '?'),
    ].filter(Boolean);

    if (otherMeds.length > 0) {
        html += `<div style="font-size:11px; color:var(--text-secondary); line-height:1.5; margin-top:4px;">${otherMeds.join(' · ')}</div>`;
    }

    if (totalCount === 0) {
        html += '<div style="font-size:11px; color:var(--text-tertiary); font-style:italic;">No medications on file</div>';
    }

    return html;
}

// ─── CONTROLLED SUBSTANCE ALERT BANNER (above chart tabs) ─────────────
// FIX(2026-04-01): Edit medication form — allows changing dose, frequency, directions, route
function showEditMedicationForm(medId, name, dosage, frequency, directions, route) {
    // Remove any existing edit form
    document.getElementById('editMedOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'editMedOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:var(--surface-1,#1a1d23);border-radius:12px;padding:16px;min-width:320px;max-width:420px;border:1px solid var(--border,#333);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div style="font-size:14px;font-weight:600;color:var(--text-primary,#fff);">Edit Medication</div>
                <button onclick="document.getElementById('editMedOverlay').remove()" style="background:none;border:none;color:var(--text-tertiary);font-size:18px;cursor:pointer;">✕</button>
            </div>
            <div style="font-size:11px;color:var(--cyan);margin-bottom:12px;font-weight:600;">${name}</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <div>
                    <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:2px;">Dosage</label>
                    <input id="editMedDosage" type="text" value="${dosage}" placeholder="e.g. 10mg, 200 IU, 0.5mL"
                        style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:13px;outline:none;box-sizing:border-box;" />
                </div>
                <div>
                    <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:2px;">Frequency</label>
                    <input id="editMedFrequency" type="text" value="${frequency}" placeholder="e.g. Once daily, BID, Weekly"
                        style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:13px;outline:none;box-sizing:border-box;" />
                </div>
                <div>
                    <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:2px;">Route</label>
                    <select id="editMedRoute"
                        style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:13px;outline:none;box-sizing:border-box;">
                        <option value="" ${!route ? 'selected' : ''}>Select route...</option>
                        <option value="Oral" ${route === 'Oral' ? 'selected' : ''}>Oral</option>
                        <option value="Subcutaneous" ${route === 'Subcutaneous' ? 'selected' : ''}>Subcutaneous</option>
                        <option value="Intramuscular" ${route === 'Intramuscular' ? 'selected' : ''}>Intramuscular</option>
                        <option value="Topical" ${route === 'Topical' ? 'selected' : ''}>Topical</option>
                        <option value="Intravenous" ${route === 'Intravenous' ? 'selected' : ''}>Intravenous</option>
                        <option value="Sublingual" ${route === 'Sublingual' ? 'selected' : ''}>Sublingual</option>
                        <option value="Inhalation" ${route === 'Inhalation' ? 'selected' : ''}>Inhalation</option>
                        <option value="Transdermal" ${route === 'Transdermal' ? 'selected' : ''}>Transdermal</option>
                        <option value="Rectal" ${route === 'Rectal' ? 'selected' : ''}>Rectal</option>
                        <option value="Nasal" ${route === 'Nasal' ? 'selected' : ''}>Nasal</option>
                        <option value="Ophthalmic" ${route === 'Ophthalmic' ? 'selected' : ''}>Ophthalmic</option>
                        <option value="Otic" ${route === 'Otic' ? 'selected' : ''}>Otic</option>
                    </select>
                </div>
                <div>
                    <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:2px;">Directions</label>
                    <input id="editMedDirections" type="text" value="${directions}" placeholder="e.g. Take with food, Apply to affected area"
                        style="width:100%;padding:8px 10px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:13px;outline:none;box-sizing:border-box;" />
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px;">
                <button id="editMedSaveBtn" onclick="submitEditMedication('${medId}')" style="flex:1;padding:10px;border-radius:8px;background:linear-gradient(135deg,#0891b2,#22d3ee);border:none;color:#0a0f1a;font-weight:700;font-size:13px;cursor:pointer;">Save Changes</button>
                <button onclick="confirmDeactivateMedication('${medId}', '${name}')" style="padding:10px 14px;border-radius:8px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;font-size:12px;font-weight:600;cursor:pointer;" title="Discontinue this medication">Stop</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function submitEditMedication(medId) {
    const dosage = document.getElementById('editMedDosage')?.value?.trim() || '';
    const frequency = document.getElementById('editMedFrequency')?.value?.trim() || '';
    const directions = document.getElementById('editMedDirections')?.value?.trim() || '';
    const route = document.getElementById('editMedRoute')?.value || '';

    const btn = document.getElementById('editMedSaveBtn');
    if (btn) { btn.textContent = 'Saving...'; btn.disabled = true; }

    try {
        const resp = await apiFetch('/ops/api/ipad/patient-data/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'update_medication',
                healthie_id: chartPanelData?.healthie_id,
                medication_id: medId,
                dosage,
                frequency,
                directions,
                route,
            }),
        });

        if (resp.success) {
            showToast('Medication updated', 'success');
            document.getElementById('editMedOverlay')?.remove();
            loadChartData(chartPanelPatientId);
        } else {
            showToast('Update failed: ' + (resp.error || 'Unknown error'), 'error');
            if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
        }
    } catch (e) {
        showToast('Error: ' + (e.message || 'Network error'), 'error');
        if (btn) { btn.textContent = 'Retry'; btn.disabled = false; }
    }
}

function confirmDeactivateMedication(medId, name) {
    if (!confirm('Discontinue "' + name + '"? This will mark it as inactive in Healthie.')) return;

    apiFetch('/ops/api/ipad/patient-data/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'deactivate_medication',
            healthie_id: chartPanelData?.healthie_id,
            medication_id: medId,
        }),
    }).then(resp => {
        if (resp.success) {
            showToast('"' + name + '" discontinued', 'success');
            document.getElementById('editMedOverlay')?.remove();
            loadChartData(chartPanelPatientId);
        } else {
            showToast('Failed: ' + (resp.error || 'Unknown'), 'error');
        }
    }).catch(e => {
        showToast('Error: ' + (e.message || 'Network error'), 'error');
    });
}

function renderControlledSubstanceAlert(d) {
    const rxActive = d.prescriptions?.active || [];
    const controlled = rxActive.filter(p => p.schedule != null);
    if (controlled.length === 0) return '';

    const hasScheduleII = controlled.some(p => p.schedule === 'II');
    const schedules = [...new Set(controlled.map(p => p.schedule))].sort();
    const lastFill = controlled
        .map(p => p.last_fill_date)
        .filter(Boolean)
        .sort()
        .reverse()[0];

    return `
        <div class="rx-alert-banner" style="margin:4px 8px 8px;${hasScheduleII ? 'animation:rx-pulse 2s ease-in-out infinite;' : ''}">
            ⚠️ <strong>${controlled.length} Active Controlled Substance${controlled.length > 1 ? 's' : ''}</strong>
            — Schedule ${schedules.join(', ')}
            ${lastFill ? `<span style="color:var(--text-tertiary);font-size:12px;margin-left:8px;">Last fill: ${formatRxDate(lastFill)}</span>` : ''}
        </div>`;
}

function renderPrescriptionsTab(container, d) {
    const rxData = d.prescriptions || {};
    const active = rxData.active || rxData.categorized?.active || [];
    const controlled = rxData.controlled || rxData.categorized?.controlled_active || [];
    const errors = rxData.categorized?.errors || [];
    const all = rxData.all || rxData.categorized?.all || [];
    const healthieId = d.healthie_id || '';

    let html = '';

    // Controlled Substance Alert Banner
    if (controlled.length > 0) {
        const schedules = [...new Set(controlled.map(p => p.schedule))].sort();
        html += `
            <div class="rx-alert-banner">
                ⚠️ <strong>${controlled.length} Controlled Substance${controlled.length > 1 ? 's' : ''}</strong>
                — Schedule ${schedules.join(', ')}
            </div>`;
    }

    // Error Banner
    if (errors.length > 0) {
        html += `
            <div class="rx-error-banner">
                🔴 <strong>${errors.length} Prescription Error${errors.length > 1 ? 's' : ''}</strong>
                — Review in DoseSpot
            </div>`;
    }

    // Toolbar
    html += `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
            <div style="font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:600;color:var(--text-primary);">
                Active Prescriptions (${active.length})
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="refreshPrescriptions('${healthieId}')"
                    class="rx-toolbar-btn">
                    ↻ Refresh
                </button>
                <button onclick="togglePrescriptionHistory()"
                    class="rx-toolbar-btn" id="rx-history-toggle">
                    View Full History
                </button>
            </div>
        </div>`;

    // Active Prescriptions List
    if (active.length === 0) {
        html += `
            <div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);font-size:14px;">
                No active prescriptions found
            </div>`;
    } else {
        html += '<div class="rx-list" id="rx-active-list">';
        for (const rx of active) {
            html += renderPrescriptionCard(rx);
        }
        html += '</div>';
    }

    // Full History (hidden by default)
    const inactive = all.filter(p => p.normalized_status !== 'active');
    html += `
        <div id="rx-history-section" style="display:none;margin-top:20px;">
            <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:600;color:var(--text-secondary);margin-bottom:12px;">
                Prescription History (${inactive.length})
            </div>
            <div class="rx-list">
                ${inactive.length === 0
                    ? '<div style="padding:20px;color:var(--text-tertiary);font-size:13px;">No history</div>'
                    : inactive.map(rx => renderPrescriptionCard(rx, true)).join('')}
            </div>
        </div>`;

    container.innerHTML = html;
}

function renderPrescriptionCard(rx, isHistory = false) {
    const scheduleClass = rx.schedule ? `rx-controlled-${rx.schedule.toLowerCase()}` : '';
    const statusClass = rx.normalized_status === 'active' ? 'rx-active'
        : rx.normalized_status === 'error' ? 'rx-error'
        : 'rx-inactive';

    const scheduleBadgeColors = {
        'II': { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
        'III': { bg: 'rgba(249,115,22,0.15)', text: '#f97316' },
        'IV': { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
        'V': { bg: 'rgba(34,197,94,0.15)', text: '#22c55e' },
    };

    const scheduleBadge = rx.schedule && scheduleBadgeColors[rx.schedule]
        ? `<span style="background:${scheduleBadgeColors[rx.schedule].bg};color:${scheduleBadgeColors[rx.schedule].text};font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;margin-left:6px;">
            C-${rx.schedule}
          </span>`
        : '';

    const statusBadgeColors = {
        'active': { bg: 'rgba(34,211,238,0.15)', text: 'var(--cyan)' },
        'pending': { bg: 'rgba(234,179,8,0.15)', text: '#eab308' },
        'inactive': { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' },
        'error': { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
        'hidden': { bg: 'rgba(156,163,175,0.1)', text: '#6b7280' },
    };
    const statusColors = statusBadgeColors[rx.normalized_status] || statusBadgeColors.inactive;
    const statusBadge = `<span style="background:${statusColors.bg};color:${statusColors.text};font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px;text-transform:uppercase;">
        ${rx.normalized_status}
    </span>`;

    return `
        <div class="rx-card ${scheduleClass} ${statusClass}" style="
            background:var(--surface);
            border:1px solid var(--border);
            border-radius:12px;
            padding:14px 16px;
            margin-bottom:8px;
            ${isHistory ? 'opacity:0.65;' : ''}
        ">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
                <div style="font-family:'DM Sans',sans-serif;font-weight:600;font-size:14px;color:var(--text-primary);flex:1;">
                    ${rx.product_name || rx.display_name || 'Unknown Medication'}
                    ${scheduleBadge}
                </div>
                <div style="display:flex;gap:4px;align-items:center;">
                    ${statusBadge}
                </div>
            </div>

            ${rx.dosage || rx.dose_form
                ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:4px;">
                    ${[rx.dosage, rx.dose_form].filter(Boolean).join(' · ')}
                  </div>`
                : ''}

            ${rx.directions
                ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;font-style:italic;">
                    Sig: ${rx.directions}
                  </div>`
                : ''}

            <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--text-tertiary);">
                ${rx.prescriber_name ? `<span>✍️ ${rx.prescriber_name}</span>` : ''}
                ${rx.date_written ? `<span>📅 Written ${formatRxDate(rx.date_written)}</span>` : ''}
                ${rx.last_fill_date ? `<span>💊 Filled ${formatRxDate(rx.last_fill_date)}</span>` : ''}
                ${rx.quantity ? `<span>Qty: ${rx.quantity}${rx.unit ? ' ' + rx.unit : ''}</span>` : ''}
                ${rx.refills != null ? `<span>Refills: ${rx.refills}</span>` : ''}
                ${rx.days_supply ? `<span>${rx.days_supply}d supply</span>` : ''}
            </div>

            ${rx.pharmacy_name
                ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">
                    🏥 ${rx.pharmacy_name}${rx.pharmacy_city ? ', ' + rx.pharmacy_city : ''}${rx.pharmacy_state ? ' ' + rx.pharmacy_state : ''}
                  </div>`
                : ''}
        </div>`;
}

function formatRxDate(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

async function refreshPrescriptions(healthieId) {
    if (!healthieId) {
        showToast('No Healthie ID available', 'error');
        return;
    }
    try {
        showToast('Refreshing prescriptions...', 'info');
        const data = await apiFetch(`/ops/api/prescriptions/${healthieId}/`);
        if (chartPanelData) {
            chartPanelData.prescriptions = data;
        }
        if (window._chartTab === 'prescriptions') {
            renderChartTabContent();
        }
        showToast('Prescriptions updated', 'success');
    } catch (err) {
        console.error('[Rx] Failed to refresh prescriptions:', err);
        if (err.message !== 'AUTH_EXPIRED') {
            showToast('Failed to refresh prescriptions', 'error');
        }
    }
}

function togglePrescriptionHistory() {
    const section = document.getElementById('rx-history-section');
    const toggle = document.getElementById('rx-history-toggle');
    if (!section) return;
    const isHidden = section.style.display === 'none';
    section.style.display = isHidden ? 'block' : 'none';
    if (toggle) toggle.textContent = isHidden ? 'Hide History' : 'View Full History';
}

// ==================== E-RX (DOSESPOT IFRAME) TAB ====================
function renderERxTab(container, d) {
    const healthieId = d?.healthie_id || d?.demographics?.healthie_client_id || '';

    if (!healthieId) {
        container.innerHTML = `
            <div style="padding:40px 20px; text-align:center;">
                <div style="font-size:36px; margin-bottom:12px;">⚠️</div>
                <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Patient Not Linked to Healthie</div>
                <div style="font-size:12px; color:var(--text-tertiary);">This patient needs a Healthie account to use e-prescribing.</div>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <div id="erxLoadingState" style="padding:40px 20px; text-align:center;">
            <div class="loading-spinner" style="margin:0 auto 16px;"></div>
            <div style="font-size:13px; color:var(--text-secondary);">Loading DoseSpot prescribing interface…</div>
        </div>
        <div id="erxIframeContainer" style="display:none; width:100%; height:calc(100vh - 280px); min-height:500px;"></div>
        <div id="erxErrorState" style="display:none; padding:40px 20px; text-align:center;"></div>
    `;

    loadDoseSpotIframe(healthieId);
}

async function loadDoseSpotIframe(healthiePatientId) {
    const loadingEl = document.getElementById('erxLoadingState');
    const iframeContainer = document.getElementById('erxIframeContainer');
    const errorEl = document.getElementById('erxErrorState');

    try {
        const result = await apiFetch(`/ops/api/prescriptions/${healthiePatientId}/iframe-url/`);

        if (result?.success && result?.data?.iframe_url) {
            if (loadingEl) loadingEl.style.display = 'none';
            if (iframeContainer) {
                iframeContainer.style.display = 'block';
                iframeContainer.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background:var(--surface); border-radius:8px 8px 0 0; border:1px solid var(--border); border-bottom:none;">
                        <span style="font-size:11px; color:var(--text-tertiary);">💊 DoseSpot E-Prescribing</span>
                        <div style="display:flex; gap:6px;">
                            <button onclick="loadDoseSpotIframe('${healthiePatientId}')" style="font-size:10px; padding:3px 8px; border-radius:4px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); cursor:pointer; font-family:inherit;">🔄 Reload</button>
                            <button onclick="openDoseSpotFullscreen('${healthiePatientId}')" style="font-size:10px; padding:3px 8px; border-radius:4px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); cursor:pointer; font-family:inherit;">⊞ Fullscreen</button>
                        </div>
                    </div>
                    <iframe
                        src="${result.data.iframe_url}"
                        style="width:100%; height:calc(100% - 32px); border:1px solid var(--border); border-radius:0 0 8px 8px; background:#fff;"
                        allow="clipboard-write"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                    ></iframe>
                `;
            }
        } else {
            throw new Error(result?.error || 'Failed to load DoseSpot');
        }
    } catch (err) {
        console.error('[E-Rx] Failed to load DoseSpot iframe:', err);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) {
            errorEl.style.display = 'block';
            errorEl.innerHTML = `
                <div style="font-size:36px; margin-bottom:12px;">❌</div>
                <div style="font-size:14px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">Could Not Load E-Prescribing</div>
                <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:16px;">${err.message || 'Unknown error. Check that this patient has complete demographics in Healthie (phone, DOB, address).'}</div>
                <button onclick="loadDoseSpotIframe('${healthiePatientId}')" style="padding:10px 20px; border-radius:8px; background:var(--cyan); color:#0a0f1a; border:none; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit;">Retry</button>
            `;
        }
    }
}

// ==================== FULLSCREEN DOSESPOT MODAL ====================
function openDoseSpotFullscreen(healthiePatientId) {
    const existing = document.getElementById('doseSpotFullscreenModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'doseSpotFullscreenModal';
    modal.className = 'dosespot-fullscreen-modal';
    modal.innerHTML = `
        <div class="dosespot-fullscreen-header">
            <span style="font-size:14px; font-weight:600; color:#fff;">💊 DoseSpot E-Prescribing</span>
            <button onclick="closeDoseSpotFullscreen()" class="dosespot-fullscreen-close">✕ Close</button>
        </div>
        <div class="dosespot-fullscreen-body">
            <div id="doseSpotFullscreenLoading" style="display:flex; align-items:center; justify-content:center; height:100%;">
                <div class="loading-spinner" style="margin-right:12px;"></div>
                <span style="color:var(--text-secondary);">Loading DoseSpot…</span>
            </div>
            <iframe id="doseSpotFullscreenIframe" style="display:none; width:100%; height:100%; border:none; background:#fff;"
                    allow="clipboard-write"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"></iframe>
        </div>
    `;
    document.body.appendChild(modal);

    requestAnimationFrame(() => modal.classList.add('visible'));

    apiFetch(`/ops/api/prescriptions/${healthiePatientId}/iframe-url/`)
        .then(result => {
            if (result?.success && result?.data?.iframe_url) {
                const loading = document.getElementById('doseSpotFullscreenLoading');
                const iframe = document.getElementById('doseSpotFullscreenIframe');
                if (loading) loading.style.display = 'none';
                if (iframe) {
                    iframe.src = result.data.iframe_url;
                    iframe.style.display = 'block';
                }
            } else {
                throw new Error(result?.error || 'Failed to load');
            }
        })
        .catch(err => {
            const loading = document.getElementById('doseSpotFullscreenLoading');
            if (loading) loading.innerHTML = `
                <div style="text-align:center;">
                    <div style="font-size:36px; margin-bottom:12px;">❌</div>
                    <div style="color:var(--text-primary); font-weight:600; margin-bottom:8px;">Could Not Load DoseSpot</div>
                    <div style="color:var(--text-tertiary); font-size:13px;">${err.message}</div>
                </div>
            `;
        });
}

function closeDoseSpotFullscreen() {
    const modal = document.getElementById('doseSpotFullscreenModal');
    if (modal) {
        modal.classList.remove('visible');
        setTimeout(() => modal.remove(), 300);
    }
}

// ==================== CHARTING TAB ====================
// Shows: all SOAP notes (scribe + Healthie) in one unified timeline
function renderChartingTab(container, d) {
    const hAppts = d.healthie_appointments || [];
    const controlled = d.controlled_substances || [];
    const alerts = d.alerts || [];
    const scribeHist = d.scribe_history || [];

    function fmtDate(dt) {
        if (!dt) return '—';
        try { const dd = new Date(dt); return isNaN(dd.getTime()) ? '—' : dd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CLINIC_TIMEZONE }); } catch { return '—'; }
    }

    // Merge ALL notes into one timeline: scribe SOAP notes + Healthie chart notes
    const allNotes = [];

    // Scribe notes (have full SOAP structure)
    scribeHist.forEach(s => {
        // Skip sessions with no SOAP content (transcribed but never generated, failed recordings, etc.)
        const hasContent = s.soap_subjective || s.soap_objective || s.soap_assessment || s.soap_plan;
        if (!hasContent) return;

        // Build follow-up summary from the Plan section
        let followUpSummary = '';
        if (s.soap_plan) {
            // Extract action items from plan (lines starting with numbers or bullets)
            const planLines = s.soap_plan.split('\n').filter(l => l.trim());
            const actionItems = planLines.filter(l => /^\d+\.|^[-•*]|^Follow|^Return|^Recheck|^Schedule|^Refer/i.test(l.trim()));
            if (actionItems.length > 0) {
                followUpSummary = actionItems.map(l => l.replace(/^\d+\.\s*/, '').trim()).join(' · ');
            }
        }

        allNotes.push({
            type: 'scribe',
            title: (s.visit_type || 'Visit Note').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            date: s.created_at,
            status: s.status,
            soap: { s: s.soap_subjective, o: s.soap_objective, a: s.soap_assessment, p: s.soap_plan },
            icd10: s.icd10_codes,
            followUp: followUpSummary,
            preview: s.soap_subjective ? s.soap_subjective.substring(0, 100) : 'No subjective recorded',
        });
    });

    // Healthie chart notes — deduplicate against scribe notes by content matching
    // Notes submitted from Scribe to Healthie appear in BOTH sources.
    // Build a set of subjective text snippets from scribe notes to match against.
    const scribeSubjectiveSnippets = new Set();
    scribeHist.forEach(s => {
        if (s.soap_subjective) {
            // Use first 50 chars of subjective as a fingerprint (strip HTML tags)
            const clean = s.soap_subjective.replace(/<[^>]*>/g, '').trim().substring(0, 50).toLowerCase();
            if (clean.length > 10) scribeSubjectiveSnippets.add(clean);
        }
    });

    (d.healthie_chart_notes || []).forEach(n => {
        const name = (n.name || '').toLowerCase();
        // Skip intake/admin forms — those go in the Files tab
        if (name.includes('consent') || name.includes('hipaa') || name.includes('intake') ||
            name.includes('agreement') || name.includes('health concern') || name.includes('medical history') ||
            name.includes('patient info') || name.includes('registration') || name.includes('demographics') ||
            name.includes('insurance') || name.includes('privacy') || name.includes('authorization') ||
            name.includes('consent to treat')) return;

        // Skip if this is a SOAP note that duplicates a scribe note (content match)
        if (name.includes('soap') || name.includes('chart note') || name.includes('progress note') || name.includes('visit note')) {
            const answers = n.form_answers || [];
            // Check if any answer content matches scribe subjective
            const isDuplicate = answers.some(a => {
                const text = (a.displayed_answer || a.answer || '').replace(/<[^>]*>/g, '').trim().substring(0, 50).toLowerCase();
                return text.length > 10 && scribeSubjectiveSnippets.has(text);
            });
            if (isDuplicate) return; // Skip — this is the Healthie copy of a scribe note
        }

        const answers = n.form_answers || [];
        allNotes.push({
            type: 'healthie',
            title: n.name || 'Chart Note',
            date: n.created_at,
            status: n.finished ? 'completed' : 'draft',
            answers: answers,
            preview: answers.length > 0 ? `${answers[0].label}: ${(answers[0].displayed_answer || answers[0].answer || '').substring(0, 80)}` : 'No content',
        });
    });

    // Sort by date (newest first)
    allNotes.sort((a, b) => {
        const da = a.date ? new Date(a.date).getTime() : 0;
        const db = b.date ? new Date(b.date).getTime() : 0;
        return db - da;
    });

    container.innerHTML = `
        <!-- All Clinical Notes (unified timeline) -->
        <div class="chart-section">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📋 Clinical Notes (${allNotes.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${allNotes.length > 0 ? allNotes.map((n, i) => {
                    const icon = n.type === 'scribe' ? '🎙️' : '📝';
                    const statusBadge = n.status === 'submitted' || n.status === 'completed'
                        ? '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:rgba(34,197,94,0.15); color:#22c55e; margin-left:6px;">✓</span>'
                        : n.status === 'draft' ? '<span style="font-size:9px; padding:1px 5px; border-radius:3px; background:rgba(245,158,11,0.15); color:#f59e0b; margin-left:6px;">Draft</span>' : '';

                    let expandedContent = '';
                    if (n.type === 'scribe' && n.soap) {
                        const sections = [
                            n.soap.s ? { label: 'SUBJECTIVE', text: n.soap.s } : null,
                            n.soap.o ? { label: 'OBJECTIVE', text: n.soap.o } : null,
                            n.soap.a ? { label: 'ASSESSMENT', text: n.soap.a } : null,
                            n.soap.p ? { label: 'PLAN', text: n.soap.p } : null,
                        ].filter(Boolean);
                        expandedContent = sections.map(sec => `
                            <div style="margin-bottom:10px;">
                                <div style="font-size:10px; text-transform:uppercase; color:var(--cyan); font-weight:700; letter-spacing:0.05em; margin-bottom:2px;">${sec.label}</div>
                                <div style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.5;">${sec.text}</div>
                            </div>
                        `).join('');
                        if (n.icd10) {
                            const codes = Array.isArray(n.icd10) ? n.icd10 : [];
                            if (codes.length > 0) {
                                expandedContent += `<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:4px;">${codes.map(c => {
                                    const code = typeof c === 'string' ? c : c.code;
                                    return `<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(168,85,247,0.15); color:#a855f7; font-family:monospace;">${code}</span>`;
                                }).join('')}</div>`;
                            }
                        }
                    } else if (n.answers) {
                        expandedContent = n.answers.map(a => `
                            <div style="margin-bottom:6px;">
                                <div style="font-size:10px; text-transform:uppercase; color:var(--text-tertiary); font-weight:600;">${a.label || 'Field'}</div>
                                <div style="font-size:12px; color:var(--text-secondary); white-space:pre-wrap;">${a.displayed_answer || a.answer || '—'}</div>
                            </div>
                        `).join('');
                    }

                    return `
                    <div class="chart-lab-card" style="cursor:pointer; transition:all 0.15s;" onclick="this.querySelector('.note-full').style.display = this.querySelector('.note-full').style.display === 'none' ? 'block' : 'none'; this.querySelector('.note-preview').style.display = this.querySelector('.note-full').style.display === 'none' ? 'block' : 'none';">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div class="chart-lab-name" style="display:flex; align-items:center; gap:4px;">
                                ${icon} ${n.title}${statusBadge}
                            </div>
                            <div class="chart-lab-detail">${fmtDate(n.date)}</div>
                        </div>
                        <div class="note-preview" style="margin-top:4px;">
                            <div style="font-size:11px; color:var(--text-tertiary); font-style:italic;">${n.preview}...</div>
                            ${n.followUp ? `<div style="font-size:10px; color:#22c55e; margin-top:3px; display:flex; align-items:start; gap:4px;"><span style="flex-shrink:0;">📌</span><span>${n.followUp.substring(0, 120)}${n.followUp.length > 120 ? '...' : ''}</span></div>` : ''}
                        </div>
                        <div class="note-full" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid var(--border);">
                            ${expandedContent || '<div style="color:var(--text-tertiary); font-size:12px;">No content</div>'}
                        </div>
                    </div>`;
                }).join('') : '<div class="chart-empty" style="padding:16px; text-align:center;">No clinical notes yet. Click Record Visit to create one.</div>'}
            </div>
        </div>
<!-- Appointments -->
        ${hAppts.length > 0 ? `
        <div class="chart-section collapsed">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>\ud83d\udcc5 Appointments (${hAppts.length})</span>
                <span class="chart-chevron">\u203a</span>
            </div>
            <div class="chart-section-body">
                ${hAppts.slice(0, 10).map(a => `
                    <div class="chart-visit-card">
                        <div class="chart-visit-date">${fmtDate(a.date)}</div>
                        <div style="flex:1">
                            <div class="chart-med-name">${a.appointment_type?.name || 'Appointment'}</div>
                            <div class="chart-med-detail">${a.provider?.full_name || ''} \u00b7 ${a.pm_status || a.status || ''}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        <!-- Alerts -->
        ${alerts.length > 0 ? `
        <div class="chart-section collapsed">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>⚠️ Alerts (${alerts.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${alerts.map(a => `
                    <div class="chart-alert-card">
                        <div class="chart-alert-type">${a.issue_type || a.alert_type || 'Alert'}</div>
                        <div class="chart-alert-detail">${a.amount_owed ? `$${parseFloat(a.amount_owed).toFixed(2)}` : ''} ${a.days_overdue ? `· ${a.days_overdue}d overdue` : ''}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
    `;
}

// ==================== FORMS TAB ====================
// Shows: Patient intake/medical forms (NOT SOAP notes — those go in Charting)
function renderFormsTab(container, d) {
    // Kiosk launch button in Intake Forms tab
    const pendingKioskForms = (d.pending_forms || []).filter(f => f.status !== 'completed');
    if (pendingKioskForms.length > 0) {
        const kioskBtnDiv = document.createElement('div');
        kioskBtnDiv.style.cssText = 'padding:8px 12px;';
        kioskBtnDiv.innerHTML = `
            <button class="kiosk-launch-btn-large" onclick="launchKioskMode('${chartPanelPatientId}', '${d.healthie_id || ''}', ${JSON.stringify(pendingKioskForms).replace(/"/g, '&quot;')}, '${((d.demographics || {}).full_name || 'Patient').replace(/'/g, "\\'")}')">
                📋 Hand iPad to Patient — ${pendingKioskForms.length} form${pendingKioskForms.length > 1 ? 's' : ''} pending
            </button>
        `;
        container.appendChild(kioskBtnDiv);
    }

    const allForms = d.healthie_chart_notes || [];
    const cleanAnswer = (txt) => (txt || '').replace(/Invalid Date/gi, '').replace(/&nbsp;/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim() || '—';
    // Filter OUT SOAP/chart notes — keep only patient-filled forms (intake, consent, history, etc.)
    const patientForms = allForms.filter(n => {
        const name = (n.name || '').toLowerCase();
        return !name.includes('soap') && !name.includes('chart note') && !name.includes('progress note') && !name.includes('visit note') && !name.includes('encounter');
    });

    // Sort: intake forms first, then by date (newest)
    const isIntake = (name) => {
        const n = (name || '').toLowerCase();
        return n.includes('intake') || n.includes('new patient') || n.includes('patient history') || n.includes('health history') || n.includes('medical history');
    };
    patientForms.sort((a, b) => {
        const aIntake = isIntake(a.name) ? 0 : 1;
        const bIntake = isIntake(b.name) ? 0 : 1;
        if (aIntake !== bIntake) return aIntake - bIntake;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

    container.innerHTML = `
        ${patientForms.length > 0 ? patientForms.slice(0, 20).map((n, idx) => {
            const intake = isIntake(n.name);
            // Auto-expand first intake form
            const expanded = intake && idx === 0;
            return `
            <div class="chart-lab-card" data-form-idx="${idx}" style="margin:6px 12px; padding:12px 14px; border-radius:10px; background:var(--surface); border:1px solid ${intake ? 'rgba(0,212,255,0.25)' : 'var(--border-light)'}; ${intake ? 'border-left:3px solid var(--cyan);' : ''} cursor:pointer;">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                    <div>
                        <div style="font-size:14px; font-weight:600; color:${intake ? 'var(--cyan)' : 'var(--text-primary)'};">${intake ? '⭐ ' : ''}${n.name || 'Form'}</div>
                        <div style="font-size:11px; color:var(--text-tertiary); margin-top:2px;">${formatDateDisplay(n.created_at)}${n.form_answers?.length ? ' · ' + n.form_answers.length + ' fields' : ''}</div>
                    </div>
                    <span style="font-size:14px; color:var(--text-tertiary); transition:transform 0.2s;" class="form-chevron">${expanded ? '▼' : '▶'}</span>
                </div>
                ${!expanded && n.form_answers?.length > 0 ? `<div style="margin-top:6px; font-size:12px; color:var(--text-tertiary); line-height:1.4;">${n.form_answers.slice(0, 3).map(a => '<b>' + (a.label || '') + ':</b> ' + cleanAnswer(a.displayed_answer || a.answer).substring(0, 60)).join(' · ')}${n.form_answers.length > 3 ? ' …' : ''}</div>` : ''}
                <div class="chart-note-full" style="display:${expanded ? 'block' : 'none'}; margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06);">
                    ${(n.form_answers || []).map(a => `
                        <div style="margin-bottom:10px;">
                            <div style="font-size:11px; text-transform:uppercase; color:var(--cyan); font-weight:700; letter-spacing:0.04em; margin-bottom:2px;">${a.label || 'Field'}</div>
                            <div style="font-size:13px; color:var(--text-primary); line-height:1.5; white-space:pre-wrap;">${cleanAnswer(a.displayed_answer || a.answer)}</div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
        }).join('') : '<div class="chart-empty" style="padding:24px; text-align:center;">No patient forms on file</div>'}
    `;

    // Make form cards clickable to expand/collapse
    container.querySelectorAll('.chart-lab-card').forEach(card => {
        const full = card.querySelector('.chart-note-full');
        const chevron = card.querySelector('.form-chevron');
        if (full) {
            card.addEventListener('click', () => {
                const showing = full.style.display !== 'none';
                full.style.display = showing ? 'none' : 'block';
                if (chevron) chevron.textContent = showing ? '▶' : '▼';
            });
        }
    });
}

// ==================== DOB HELPERS ====================
// Convert YYYY-MM-DD → MM/DD/YYYY for display in edit forms
function formatDobForEdit(isoDate) {
    if (!isoDate) return '';
    const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return `${m[2]}/${m[3]}/${m[1]}`;
}

// Convert MM/DD/YYYY → YYYY-MM-DD for saving to DB/Healthie
function parseDobToISO(display) {
    if (!display) return '';
    const m = String(display).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return display; // fallback: return as-is if already ISO or unrecognized
    return `${m[3]}-${m[1]}-${m[2]}`;
}

// Auto-insert slashes as user types: 01 → 01/, 01/15 → 01/15/
function autoFormatDob(input) {
    let v = input.value.replace(/[^\d]/g, '');
    if (v.length > 8) v = v.slice(0, 8);
    if (v.length >= 4) {
        v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
    } else if (v.length >= 2) {
        v = v.slice(0, 2) + '/' + v.slice(2);
    }
    input.value = v;
}

// ==================== EDIT DEMOGRAPHICS FORM ====================
// Complete replacement for showEditDemographicsForm() in app.js

function showEditDemographicsForm() {
    const demo = chartPanelData?.demographics || {};
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    if (!patientId) { showToast('No patient ID available', 'error'); return; }

    const container = document.getElementById('globalChartContent');
    if (!container) return;

    // Save current content so we can restore on cancel
    const previousHTML = container.innerHTML;

    container.innerHTML = `
        <div style="padding:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="margin:0; color:var(--text-primary); font-size:18px; font-weight:700;">✏️ Edit Patient Profile</h3>
                <button onclick="cancelEditDemographics()" style="padding:6px 14px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:13px; cursor:pointer; font-weight:600;">Cancel</button>
            </div>

            <div style="background:rgba(0,212,255,0.08); border:1px solid rgba(0,212,255,0.2); border-radius:8px; padding:10px 12px; margin-bottom:16px;">
                <div style="font-size:11px; color:var(--cyan); font-weight:600;">🔄 Full Integration</div>
                <div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">Changes sync to: GMH Dashboard • Healthie • GHL • Mobile App</div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px; margin-bottom:16px;">
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">First Name *</label>
                    <input id="editFirstName" value="${(demo.full_name || '').split(' ')[0] || ''}" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;" required>
                </div>
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">Last Name *</label>
                    <input id="editLastName" value="${(demo.full_name || '').split(' ').slice(1).join(' ') || ''}" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;" required>
                </div>
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">Preferred Name</label>
                    <input id="editPreferredName" value="${demo.preferred_name || ''}" placeholder="Nickname / goes by" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                </div>
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">Date of Birth</label>
                    <input id="editDob" type="text" inputmode="numeric" value="${demo.dob ? formatDobForEdit(demo.dob) : ''}" placeholder="MM/DD/YYYY" maxlength="10" oninput="autoFormatDob(this)" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                </div>
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">Gender</label>
                    <select id="editGender" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px;">
                        <option value="">—</option>
                        <option value="Male" ${demo.gender === 'Male' ? 'selected' : ''}>Male</option>
                        <option value="Female" ${demo.gender === 'Female' ? 'selected' : ''}>Female</option>
                        <option value="Non-binary" ${demo.gender === 'Non-binary' ? 'selected' : ''}>Non-binary</option>
                        <option value="Other" ${demo.gender === 'Other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div>
                    <label style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; display:block; margin-bottom:4px; font-weight:600;">Regimen</label>
                    <input id="editRegimen" value="${demo.regimen || ''}" placeholder="e.g., Test Cyp 200mg/week" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                </div>
            </div>

            <div style="background:var(--surface-2); border-radius:10px; padding:14px; margin-bottom:16px;">
                <h4 style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; margin:0 0 10px; font-weight:700;">📞 Contact Information</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="color:var(--text-tertiary); font-size:11px; display:block; margin-bottom:4px; font-weight:600;">Phone</label>
                        <input id="editPhone" value="${demo.phone_primary || ''}" placeholder="(555) 123-4567" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="color:var(--text-tertiary); font-size:11px; display:block; margin-bottom:4px; font-weight:600;">Email</label>
                        <input id="editEmail" type="email" value="${demo.email || ''}" placeholder="email@example.com" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    </div>
                </div>
            </div>

            <div style="background:var(--surface-2); border-radius:10px; padding:14px; margin-bottom:16px;">
                <h4 style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; margin:0 0 10px; font-weight:700;">📍 Address</h4>
                <div style="display:grid; gap:10px;">
                    <input id="editLine1" value="${demo.address_line1 || ''}" placeholder="Street address" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    <input id="editLine2" value="${demo.address_line2 || ''}" placeholder="Apt, suite, unit, etc." style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    <div style="display:grid; grid-template-columns:2fr 1fr 1.2fr; gap:10px;">
                        <input id="editCity" value="${demo.city || ''}" placeholder="City" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                        <input id="editState" value="${demo.state || ''}" placeholder="State" maxlength="2" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box; text-transform:uppercase;">
                        <input id="editZip" value="${demo.postal_code || demo.zip || ''}" placeholder="ZIP" maxlength="10" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    </div>
                </div>
            </div>

            <div style="background:var(--surface-2); border-radius:10px; padding:14px; margin-bottom:20px;">
                <h4 style="color:var(--text-tertiary); font-size:11px; text-transform:uppercase; margin:0 0 10px; font-weight:700;">📊 Vitals</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                    <div>
                        <label style="color:var(--text-tertiary); font-size:11px; display:block; margin-bottom:4px; font-weight:600;">Height</label>
                        <input id="editHeight" value="${demo.height || ''}" placeholder="e.g., 5'10&quot; or 70 inches" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="color:var(--text-tertiary); font-size:11px; display:block; margin-bottom:4px; font-weight:600;">Weight</label>
                        <input id="editWeight" value="${demo.weight || ''}" placeholder="e.g., 180 lbs" style="width:100%; padding:8px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--border); color:var(--text-primary); font-size:14px; box-sizing:border-box;">
                    </div>
                </div>
            </div>

            <div style="display:flex; gap:10px;">
                <button onclick="saveEditedDemographics()" style="flex:1; padding:14px; border-radius:10px; background:linear-gradient(135deg, #10b981, #059669); border:none; color:white; font-size:15px; font-weight:700; cursor:pointer; box-shadow:0 2px 8px rgba(16,185,129,0.3); transition:transform 0.15s;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0px)'">
                    💾 Save Changes
                </button>
                <button onclick="cancelEditDemographics()" style="padding:14px 20px; border-radius:10px; background:var(--surface-2); border:1px solid var(--border); color:var(--text-secondary); font-size:15px; font-weight:600; cursor:pointer;">
                    Cancel
                </button>
            </div>

            <div style="margin-top:12px; font-size:10px; color:var(--text-tertiary); text-align:center;">
                * Required fields
            </div>
        </div>
    `;

    // Store previous HTML for cancel and patient ID
    window._editDemoPreviousHTML = previousHTML;
    window._editDemoPatientId = patientId;
}


function cancelEditDemographics() {
    const container = document.getElementById('globalChartContent');
    if (container && window._editDemoPreviousHTML) {
        container.innerHTML = window._editDemoPreviousHTML;
    } else if (chartPanelPatientId) {
        loadChartData(chartPanelPatientId);
    }
}

// Replacement for saveEditedDemographics() in app.js

async function saveEditedDemographics() {
    const patientId = window._editDemoPatientId || chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    if (!patientId) { showToast('No patient ID', 'error'); return; }

    const firstName = document.getElementById('editFirstName')?.value?.trim() || '';
    const lastName = document.getElementById('editLastName')?.value?.trim() || '';

    if (!firstName || !lastName) {
        showToast('First and last name are required', 'error');
        return;
    }

    const payload = {
        first_name: firstName,
        last_name: lastName,
        preferred_name: document.getElementById('editPreferredName')?.value?.trim() || '',
        dob: parseDobToISO(document.getElementById('editDob')?.value) || '',
        gender: document.getElementById('editGender')?.value || '',
        phone_primary: document.getElementById('editPhone')?.value?.trim() || '',
        email: document.getElementById('editEmail')?.value?.trim() || '',
        address_line_1: document.getElementById('editLine1')?.value?.trim() || '',
        address_line_2: document.getElementById('editLine2')?.value?.trim() || '',
        city: document.getElementById('editCity')?.value?.trim() || '',
        state: document.getElementById('editState')?.value?.trim()?.toUpperCase() || '',
        zip: document.getElementById('editZip')?.value?.trim() || '',
        regimen: document.getElementById('editRegimen')?.value?.trim() || '',
        height: document.getElementById('editHeight')?.value?.trim() || '',
        weight: document.getElementById('editWeight')?.value?.trim() || '',
    };

    try {
        showToast('💾 Saving to all systems...', 'info');

        // Use the correct API endpoint: /api/ipad/patient/[id]/demographics
        const response = await fetch(`/ops/api/ipad/patient/${patientId}/demographics`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const result = await response.json();

        if (result?.success) {
            const syncStatus = [];
            if (result.gmh_synced) syncStatus.push('GMH ✅');
            if (result.healthie_synced) syncStatus.push('Healthie ✅');
            else if (result.healthie_error) syncStatus.push('Healthie ❌');
            if (result.ghl_synced) syncStatus.push('GHL ✅');

            if (result.healthie_error) {
                showToast(`⚠️ Saved locally but Healthie error: ${result.healthie_error}`, 'error');
            } else {
                showToast(`✅ Saved to: ${syncStatus.join(', ')}`, 'success');
            }

            // Reload chart data to show updated info
            if (chartPanelPatientId) {
                await loadChartData(chartPanelPatientId);
            }
        } else {
            showToast('❌ Error: ' + (result?.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        console.error('[saveEditedDemographics] Error:', e);
        showToast('❌ Failed to save: ' + (e.message || 'Network error'), 'error');
    }
}



// ==================== PATIENT DATA ENTRY ====================

function showPatientDataForm(type, clickedElement) {
    console.log('[showPatientDataForm] + button clicked, type:', type, 'clickedElement:', clickedElement);
    const healthieId = chartPanelData?.healthie_id;
    console.log('[showPatientDataForm] healthie_id:', healthieId);
    if (!healthieId) {
        showToast('Cannot add ' + type + ' — this patient is not linked to Healthie. Connect them first via the Patients tab.', 'error');
        return;
    }

    const container = document.getElementById('chartTabContent');
    if (!container) {
        console.warn('[showPatientDataForm] chartTabContent container not found');
        return;
    }

    // Close any existing form first
    closePatientDataForm();

    let formHTML = '';
    let sectionId = '';

    // Determine which section to insert after
    if (type === 'allergy') {
        sectionId = 'allergies-section';
    } else if (type === 'medication') {
        sectionId = 'medications-section';
    } else if (type === 'vital') {
        sectionId = 'vitals-section';
    } else if (type === 'diagnosis') {
        sectionId = 'diagnoses-section';
    }

    if (type === 'vital') {
        formHTML = `
            <div class="chart-data-form" id="patientDataForm">
                <div class="chart-data-form-header">
                    <span>📊 Add Vital</span>
                    <button class="chart-data-form-close" onclick="closePatientDataForm()">✕</button>
                </div>
                <div class="chart-data-form-body">
                    <select id="vitalCategory" class="chart-data-input">
                        <option value="">Select type…</option>
                        <option value="Blood Pressure">Blood Pressure</option>
                        <option value="Weight">Weight (lbs)</option>
                        <option value="Height">Height (in)</option>
                        <option value="Temperature">Temperature (°F)</option>
                        <option value="Heart Rate">Heart Rate (bpm)</option>
                        <option value="SpO2">SpO2 (%)</option>
                        <option value="BMI">BMI</option>
                        <option value="Waist">Waist (in)</option>
                    </select>
                    <input type="text" id="vitalValue" class="chart-data-input" placeholder="Value (e.g. 120/80, 165, 98.6)" />
                    <input type="text" id="vitalNotes" class="chart-data-input" placeholder="Notes (optional)" />
                    <button class="chart-data-submit" onclick="submitPatientData('vital')">
                        <span id="vitalSubmitText">Save Vital</span>
                    </button>
                </div>
            </div>
        `;
    } else if (type === 'allergy') {
        formHTML = `
            <div class="chart-data-form" id="patientDataForm">
                <div class="chart-data-form-header">
                    <span>🚨 Add Allergy</span>
                    <button class="chart-data-form-close" onclick="closePatientDataForm()">✕</button>
                </div>
                <div class="chart-data-form-body">
                    <input type="text" id="allergyName" class="chart-data-input" placeholder="Allergy name (e.g. Penicillin, Pollen)" />
                    <select id="allergyCategory" class="chart-data-input">
                        <option value="">Category…</option>
                        <option value="Medication">Medication</option>
                        <option value="Environmental">Environmental</option>
                        <option value="Food">Food</option>
                        <option value="Other">Other</option>
                    </select>
                    <select id="allergySeverity" class="chart-data-input">
                        <option value="">Severity…</option>
                        <option value="Mild">Mild</option>
                        <option value="Moderate">Moderate</option>
                        <option value="Severe">Severe</option>
                    </select>
                    <input type="text" id="allergyReaction" class="chart-data-input" placeholder="Reaction (e.g. Hives, Anaphylaxis)" />
                    <select id="allergyType" class="chart-data-input">
                        <option value="Allergy">Allergy</option>
                        <option value="Sensitivity">Sensitivity</option>
                        <option value="Intolerance">Intolerance</option>
                    </select>
                    <button class="chart-data-submit" onclick="submitPatientData('allergy')">
                        <span id="allergySubmitText">Save Allergy</span>
                    </button>
                </div>
            </div>
        `;
    } else if (type === 'medication') {
        formHTML = `
            <div class="chart-data-form" id="patientDataForm">
                <div class="chart-data-form-header">
                    <span>💊 Add Medication</span>
                    <button class="chart-data-form-close" onclick="closePatientDataForm()">✕</button>
                </div>
                <div class="chart-data-form-body">
                    <input type="text" id="medName" class="chart-data-input" placeholder="Medication name" />
                    <input type="text" id="medDosage" class="chart-data-input" placeholder="Dosage (e.g. 10mg, 200 IU)" />
                    <input type="text" id="medFrequency" class="chart-data-input" placeholder="Frequency (e.g. Once daily, BID)" />
                    <input type="text" id="medDirections" class="chart-data-input" placeholder="Directions (e.g. Take with food)" />
                    <button class="chart-data-submit" onclick="submitPatientData('medication')">
                        <span id="medSubmitText">Save Medication</span>
                    </button>
                </div>
            </div>
        `;
    } else if (type === 'diagnosis') {
        formHTML = `
            <div class="chart-data-form" id="patientDataForm">
                <div class="chart-data-form-header">
                    <span>🏷️ Add Diagnosis</span>
                    <button class="chart-data-form-close" onclick="closePatientDataForm()">✕</button>
                </div>
                <div class="chart-data-form-body">
                    <input type="text" id="diagnosisSearch" class="chart-data-input" placeholder="Search ICD-10 (e.g. diabetes, hypertension)" oninput="searchICD10(this.value)" autocomplete="off" />
                    <div id="icd10Results" style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:6px; margin-top:4px; display:none;"></div>
                    <input type="hidden" id="selectedICD10Code" />
                    <input type="hidden" id="selectedICD10Desc" />
                    <div id="selectedDiagnosis" style="margin-top:8px; padding:8px; background:rgba(168,85,247,0.1); border-radius:6px; display:none;">
                        <div style="font-size:10px; color:var(--text-tertiary); margin-bottom:2px;">SELECTED:</div>
                        <div id="selectedDiagnosisText" style="font-size:12px; color:var(--text-primary);"></div>
                    </div>
                    <button class="chart-data-submit" onclick="submitPatientData('diagnosis')" id="diagnosisSubmitBtn" disabled style="opacity:0.5;">
                        <span id="diagnosisSubmitText">Select a diagnosis first</span>
                    </button>
                </div>
            </div>
        `;
    }

    // Insert form right after the relevant section
    const formDiv = document.createElement('div');
    formDiv.id = 'patientDataFormWrapper';
    formDiv.innerHTML = formHTML;
    formDiv.style.margin = '8px 0';

    // Find the section element and insert after it
    let section = document.getElementById(sectionId);
    if (!section) {
        console.warn('[showPatientDataForm] Section not found by getElementById, trying fallbacks for:', sectionId);
        section = document.querySelector('#globalChartContent #' + sectionId)
            || document.querySelector('[id="' + sectionId + '"]');
    }
    console.log('[showPatientDataForm] section found:', !!section, section);

    if (section && section.nextSibling) {
        section.parentNode.insertBefore(formDiv, section.nextSibling);
        console.log('[showPatientDataForm] Inserted form after section.nextSibling');
    } else if (section) {
        section.parentNode.appendChild(formDiv);
        console.log('[showPatientDataForm] Appended form to section.parentNode');
    } else {
        // Fallback: insert into globalChartContent or chartTabContent
        const globalChart = document.getElementById('globalChartContent');
        const fallbackTarget = globalChart?.firstElementChild || globalChart || container;
        console.warn('[showPatientDataForm] No section found, using fallback target:', fallbackTarget);
        fallbackTarget.prepend(formDiv);
    }

    // Focus first input and scroll to form
    setTimeout(() => {
        const firstInput = formDiv.querySelector('input[type="text"], select');
        if (firstInput) {
            firstInput.focus();
            formDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
            console.log('[showPatientDataForm] Form scrolled into view and focused');
        }
    }, 100);
}

function closePatientDataForm() {
    const wrapper = document.getElementById('patientDataFormWrapper');
    if (wrapper) wrapper.remove();
}

// ==================== QUICK VITALS ENTRY ====================
// Parses natural input like: "BP 120/80, SPO2 96%, P 66, T 98.6, RR 18"
function showQuickVitalsForm() {
    // Open the proper vitals modal with individual fields
    const pid = chartPanelPatientId || '';
    const patName = chartPanelData?.demographics?.full_name || 'Patient';
    if (pid) {
        openVitalsModal(pid, patName);
    } else {
        showToast('No patient selected', 'error');
    }
}

async function submitQuickVitals() {
    const input = document.getElementById('quickVitalsInput')?.value?.trim();
    if (!input) { showToast('Enter vitals first', 'error'); return; }

    const healthieId = chartPanelData?.healthie_id;
    if (!healthieId) { showToast('No Healthie ID — cannot save vitals', 'error'); return; }

    // Parse the input string into individual vital entries
    const vitals = parseVitalsString(input);
    if (vitals.length === 0) {
        showToast('Could not parse vitals — use format: BP 120/80, P 66, T 98.6', 'error');
        return;
    }

    const area = document.getElementById('quickVitalsFormArea');
    if (area) area.innerHTML = '<div style="font-size:11px; color:var(--cyan); padding:4px 0;">Saving ' + vitals.length + ' vitals…</div>';

    let saved = 0;
    for (const vital of vitals) {
        try {
            const resp = await fetch('/ops/api/ipad/patient-data/', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    healthie_id: healthieId,
                    type: 'vital',
                    category: vital.category,
                    value: vital.value,
                }),
            });
            if (resp.ok) saved++;
        } catch (e) { /* continue with next vital */ }
    }

    if (area) area.innerHTML = '';
    showToast(`Saved ${saved}/${vitals.length} vitals`, saved === vitals.length ? 'success' : 'warning');

    // Refresh chart data
    if (chartPanelPatientId) loadChartData(chartPanelPatientId);
}

function parseVitalsString(input) {
    const vitals = [];
    // Normalize: remove extra spaces, split by comma or semicolon
    const parts = input.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    
    for (const part of parts) {
        const p = part.toUpperCase();
        
        // Blood Pressure: "BP 120/80" or "120/80"
        const bpMatch = p.match(/(?:BP|BLOOD\s*PRESSURE)?\s*(\d{2,3})\s*\/\s*(\d{2,3})/);
        if (bpMatch) { vitals.push({ category: 'Blood Pressure', value: `${bpMatch[1]}/${bpMatch[2]}` }); continue; }
        
        // SPO2: "SPO2 96" or "O2 SAT 96" or "SAT 96"
        const spo2Match = p.match(/(?:SPO2|O2\s*SAT|SAT|SP02)\s*:?\s*(\d{2,3})%?/);
        if (spo2Match) { vitals.push({ category: 'SpO2', value: spo2Match[1] + '%' }); continue; }
        
        // Pulse/Heart Rate: "P 66" or "HR 66" or "PULSE 66"
        const pulseMatch = p.match(/(?:^P|HR|PULSE|HEART\s*RATE)\s*:?\s*(\d{2,3})\b/);
        if (pulseMatch) { vitals.push({ category: 'Heart Rate', value: pulseMatch[1] + ' bpm' }); continue; }
        
        // Temperature: "T 98.6" or "TEMP 98.6"
        const tempMatch = p.match(/(?:^T|TEMP|TEMPERATURE)\s*:?\s*(\d{2,3}\.?\d*)/);
        if (tempMatch) { vitals.push({ category: 'Temperature', value: tempMatch[1] + '°F' }); continue; }
        
        // Respiratory Rate: "RR 18" or "RESP 18"
        const rrMatch = p.match(/(?:RR|RESP|RESPIRATORY)\s*:?\s*(\d{1,3})/);
        if (rrMatch) { vitals.push({ category: 'Respiratory Rate', value: rrMatch[1] }); continue; }
        
        // Weight: "Wt 185" or "WEIGHT 185"
        const wtMatch = p.match(/(?:WT|WEIGHT|WGT)\s*:?\s*(\d{2,4}\.?\d*)\s*(?:LBS?|KG)?/);
        if (wtMatch) { vitals.push({ category: 'Weight', value: wtMatch[1] + ' lbs' }); continue; }
        
        // Height: "Ht 72" or "HEIGHT 72"
        const htMatch = p.match(/(?:HT|HEIGHT|HGT)\s*:?\s*(\d{2,3}\.?\d*)\s*(?:IN)?/);
        if (htMatch) { vitals.push({ category: 'Height', value: htMatch[1] + ' in' }); continue; }
        
        // BMI: "BMI 24.5"
        const bmiMatch = p.match(/BMI\s*:?\s*(\d{1,3}\.?\d*)/);
        if (bmiMatch) { vitals.push({ category: 'BMI', value: bmiMatch[1] }); continue; }
        
        // Waist: "WAIST 34"
        const waistMatch = p.match(/WAIST\s*:?\s*(\d{2,3}\.?\d*)/);
        if (waistMatch) { vitals.push({ category: 'Waist', value: waistMatch[1] + ' in' }); continue; }
    }
    
    return vitals;
}

async function submitPatientData(type) {
    const healthieId = chartPanelData?.healthie_id;
    if (!healthieId) { showToast('No Healthie ID', 'error'); return; }

    let payload = { healthie_id: healthieId };
    let submitBtn;

    if (type === 'vital') {
        const category = document.getElementById('vitalCategory')?.value;
        const value = document.getElementById('vitalValue')?.value?.trim();
        const notes = document.getElementById('vitalNotes')?.value?.trim();
        if (!category || !value) { showToast('Select a type and enter a value', 'error'); return; }
        payload.action = 'add_vital';
        payload.category = category;
        payload.value = value;
        payload.description = notes || '';
        submitBtn = document.getElementById('vitalSubmitText');
    } else if (type === 'allergy') {
        const name = document.getElementById('allergyName')?.value?.trim();
        const category = document.getElementById('allergyCategory')?.value;
        const severity = document.getElementById('allergySeverity')?.value;
        const reaction = document.getElementById('allergyReaction')?.value?.trim();
        const categoryType = document.getElementById('allergyType')?.value;
        if (!name) { showToast('Enter an allergy name', 'error'); return; }
        payload.action = 'add_allergy';
        payload.name = name;
        payload.severity = severity || '';
        payload.reaction = reaction || '';
        payload.category_type = category || categoryType || 'Allergy';
        submitBtn = document.getElementById('allergySubmitText');
    } else if (type === 'medication') {
        const name = document.getElementById('medName')?.value?.trim();
        const dosage = document.getElementById('medDosage')?.value?.trim();
        const frequency = document.getElementById('medFrequency')?.value?.trim();
        const directions = document.getElementById('medDirections')?.value?.trim();
        if (!name) { showToast('Enter a medication name', 'error'); return; }
        payload.action = 'add_medication';
        payload.name = name;
        payload.dosage = dosage || '';
        payload.frequency = frequency || '';
        payload.directions = directions || '';
        submitBtn = document.getElementById('medSubmitText');
    } else if (type === 'diagnosis') {
        const code = document.getElementById('selectedICD10Code')?.value?.trim();
        const description = document.getElementById('selectedICD10Desc')?.value?.trim();
        if (!code || !description) { showToast('Please select a diagnosis', 'error'); return; }
        payload.action = 'add_diagnosis';
        payload.code = code;
        payload.description = description;
        submitBtn = document.getElementById('diagnosisSubmitText');
    }

    // Show loading
    if (submitBtn) submitBtn.textContent = 'Saving…';
    const btns = document.querySelectorAll('.chart-data-submit');
    btns.forEach(b => b.disabled = true);

    try {
        const resp = await apiFetch('/ops/api/ipad/patient-data/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (resp.success) {
            const typeLabel = type === 'vital' ? 'Vital' : type === 'allergy' ? 'Allergy' : type === 'medication' ? 'Medication' : 'Diagnosis';
            showToast(`${typeLabel} added to Healthie! ✅`, 'success');
            closePatientDataForm();
            // Reload chart data to show the new entry
            loadChartData(chartPanelPatientId);
        } else {
            showToast(resp.error || 'Failed to save', 'error');
            if (submitBtn) submitBtn.textContent = 'Retry';
            btns.forEach(b => b.disabled = false);
        }
    } catch (e) {
        showToast('Error: ' + (e.message || 'Network error'), 'error');
        if (submitBtn) submitBtn.textContent = 'Retry';
        btns.forEach(b => b.disabled = false);
    }
}

// ==================== FINANCIAL TAB ====================
function renderFinancialTab(container, d) {
    const payments = d.last_payments || [];
    const paymentMethods = d.payment_methods || []; // PLURAL - array
    const activePackages = d.active_packages || []; // Active packages from healthie_package_mapping
    const subscriptions = d.subscriptions || []; // Legacy - now using active_packages
    const recurring = d.recurring_payment || null; // Legacy - now using active_packages

    const formatDate = (dateStr) => {
        try {
            if (!dateStr) return '';
            const dt = new Date(dateStr);
            return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CLINIC_TIMEZONE });
        } catch { return ''; }
    };

    const formatCurrency = (amount) => {
        if (!amount) return '$0.00';
        const cleaned = String(amount).replace(/[^0-9.\-]/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num)) return String(amount);
        return `$${num.toFixed(2)}`;
    };

    container.innerHTML = `
        <!-- Payment Methods on File -->
        <div class="chart-section">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>💳 Payment Methods (${paymentMethods.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${paymentMethods.length > 0 ? paymentMethods.map(pm => `
                    <div class="chart-lab-card">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="flex:1;">
                                <div class="chart-lab-name">${pm.card_type_label || pm.card_type || 'Card'} ending in ${pm.last_four || '****'}</div>
                                <div class="chart-lab-detail">Exp: ${pm.expiration || 'N/A'} ${pm.zip ? '· ZIP: ' + pm.zip : ''}</div>
                            </div>
                        </div>
                    </div>
                `).join('') : `
                    <div class="chart-empty">No payment methods on file</div>
                `}
                <button onclick="updateBillingInfo()" style="width:100%; margin-top:8px; padding:8px 16px; background:rgba(0,212,255,0.1); color:var(--cyan); border:1px solid var(--cyan); border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;">
                    ${paymentMethods.length > 0 ? '✏️ Manage Cards' : '➕ Add Payment Method'}
                </button>
            </div>
        </div>

        <!-- Active Packages -->
        <div class="chart-section${activePackages.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📦 Active Packages</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${activePackages.length > 0 ? activePackages.map(pkg => `
                    <div class="chart-lab-card" style="border-left:3px solid var(--green);">
                        <div class="chart-lab-name">💚 ${pkg.package_name || 'Package'}</div>
                        <div class="chart-lab-detail">
                            ${formatCurrency(pkg.amount)} ${pkg.frequency || pkg.billing_frequency}
                            ${pkg.next_charge_date ? ` · Next charge: ${formatDate(pkg.next_charge_date)}` : ''}
                        </div>
                        ${pkg.description ? `<div class="chart-lab-notes" style="font-size:11px; color:var(--text-tertiary); margin-top:4px;">${pkg.description}</div>` : ''}
                    </div>
                `).join('') : '<div class="chart-empty">No active packages</div>'}
                <button onclick="showAssignPackageModal()" style="width:100%; margin:8px 0; padding:12px; background:rgba(124,58,237,0.15); color:var(--purple); border:1px solid var(--purple); border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;">
                    📦 Assign Healthie Package
                </button>
            </div>
        </div>

        <!-- Recent Payments (Last 4) -->
        <div class="chart-section${payments.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>💸 Recent Payments</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${payments.length > 0 ? payments.slice(0, 4).map(p => `
                    <div class="chart-lab-card">
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div style="flex:1;">
                                <div class="chart-lab-name">${formatCurrency(p.amount)} — ${p.payment_type || 'Payment'}</div>
                                <div class="chart-lab-detail">${formatDate(p.payment_date)} · ${p.status || 'completed'}</div>
                                ${p.description ? `<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${p.description}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="chart-empty">No payment history</div>'}
            </div>
        </div>

        <!-- Actions -->
        <div style="padding:16px 16px 80px 16px; border-top:1px solid rgba(255,255,255,0.06);">
            <button onclick="chargePatient()" style="width:100%; padding:14px; background:linear-gradient(135deg, #10b981, #059669); color:white; border:none; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer;">
                💳 Charge Patient
            </button>
        </div>
    `;
}

// ==================== DISPENSE HX TAB ====================
function renderDispenseTab(container, d) {
    const trtDispenses = d.trt_dispenses || [];
    const peptideDispenses = d.peptide_dispenses || [];
    const controlled = d.controlled_substances || [];

    const formatDate = (dateStr) => {
        try {
            if (!dateStr) return '';
            const dt = new Date(dateStr);
            return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CLINIC_TIMEZONE });
        } catch { return ''; }
    };

    const formatCurrency = (amount) => {
        if (!amount) return '$0.00';
        const cleaned = String(amount).replace(/[^0-9.\-]/g, '');
        const num = parseFloat(cleaned);
        if (isNaN(num)) return String(amount);
        return `$${num.toFixed(2)}`;
    };

    container.innerHTML = `
        <!-- TRT Dispenses -->
        <div class="chart-section${trtDispenses.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>💉 TRT Dispense History (${trtDispenses.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${trtDispenses.length > 0 ? trtDispenses.map(dispense => `
                    <div class="chart-lab-card">
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div style="flex:1;">
                                <div style="display:flex; justify-content:space-between; align-items:center;">
                                    <div class="chart-lab-name">${dispense.dea_drug_name || 'Testosterone Cypionate'}</div>
                                    <div style="font-size:16px; font-weight:700; color:var(--cyan);">${dispense.total_dispensed_ml}mL</div>
                                </div>
                                <div class="chart-lab-detail">
                                    ${formatDate(dispense.dispense_date)} ·
                                    ${dispense.dose_per_syringe_ml}mL × ${dispense.syringe_count} syringe${dispense.syringe_count > 1 ? 's' : ''}
                                    ${dispense.waste_ml > 0 ? ` (+${dispense.waste_ml}mL waste)` : ''}
                                </div>
                                <div style="font-size:11px; color:var(--text-secondary); margin-top:4px; font-weight:600;">
                                    📦 ${dispense.vial_source || 'Unknown Source'}
                                </div>
                                <div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">
                                    Rx: ${dispense.prescriber || 'N/A'}${dispense.signature_status ? ` · ${dispense.signature_status}` : ''}
                                </div>
                                ${dispense.notes ? `<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${dispense.notes}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="chart-empty">No TRT dispense history</div>'}
            

        <!-- Peptide Dispenses -->
        <div class="chart-section${peptideDispenses.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>🧪 Peptide Dispense History (${peptideDispenses.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${peptideDispenses.length > 0 ? peptideDispenses.map(dispense => `
                    <div class="chart-lab-card">
                        <div style="display:flex; justify-content:space-between; align-items:start;">
                            <div style="flex:1;">
                                <div class="chart-lab-name">
                                    ${dispense.product_name || 'Peptide'}
                                    ${dispense.dosage_mg ? `(${dispense.dosage_mg}mg` : ''}${dispense.vial_size_ml ? ` / ${dispense.vial_size_ml}mL)` : ''}
                                </div>
                                <div class="chart-lab-detail">
                                    ${formatDate(dispense.sale_date)} ·
                                    Qty: ${dispense.quantity} ·
                                    ${dispense.amount_charged ? formatCurrency(dispense.amount_charged) : ''} ·
                                    ${dispense.status || 'Pending'}
                                </div>
                                ${dispense.notes ? `<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${dispense.notes}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="chart-empty">No peptide dispense history</div>'}
            </div>
        </div>

        ${trtDispenses.length === 0 && peptideDispenses.length === 0 ?
            '<div class="chart-empty" style="padding:24px; text-align:center;">No dispense history</div>' : ''}
    `;
}


function renderDocumentsTab(container, d) {
    const hDocs = d.healthie_documents || [];
    const labs = d.labs || {};
    const labItems = labs.queue_items || d.queue_items || [];
    const healthieLabs = labs.healthie_labs || d.healthie_labs || [];

    container.innerHTML = `
        <!-- Documents -->
        <div class="chart-section${hDocs.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📁 Documents (${hDocs.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${hDocs.length > 0 ? hDocs.slice(0, 30).map(doc => {
                    const formatDate = (d) => { try { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: CLINIC_TIMEZONE }); } catch { return ''; } };
                    return `<div class="chart-lab-card" style="cursor:pointer;" onclick="window.open('/ops/api/ipad/document/${doc.id}', '_blank')">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:18px;">${(doc.file_content_type || '').includes('pdf') ? '📄' : (doc.file_content_type || '').includes('image') ? '🖼️' : '📎'}</span>
                            <div style="flex:1;">
                                <div class="chart-lab-name">${doc.display_name || 'Document'}</div>
                                <div class="chart-lab-detail">${doc.friendly_type || 'Document'} · ${formatDate(doc.created_at)}</div>
                            </div>
                        </div>
                    </div>`;
                }).join('') : '<div class="chart-empty">No documents</div>'}
            </div>
        </div>

        <!-- Labs -->
        <div class="chart-section${labItems.length + healthieLabs.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>🧪 Lab Results (${labItems.length + healthieLabs.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${labItems.map(l => `
                    <div class="chart-lab-card">
                        <div class="chart-lab-name">${l.panel_names || l.lab_type || 'Lab Panel'}</div>
                        <div class="chart-lab-detail">${l.ordered_date ? new Date(l.ordered_date).toLocaleDateString() : ''} · ${l.status || 'pending'}</div>
                    </div>
                `).join('')}
                ${labItems.length === 0 && healthieLabs.length === 0 ? '<div class="chart-empty">No labs on file</div>' : ''}
            </div>
        </div>

        ${hDocs.length === 0 && labItems.length === 0 ? '<div class="chart-empty" style="padding:24px; text-align:center;">No documents or records on file</div>' : ''}
    `;
}

// HTML for the chart panel (Scribe local view) -> Now deprecated to prevent zombie cache panels.
// We strictly use the dynamic globalChartPanel for everything to bypass iPad caching.
function getChartPanelHTML() {
    return ``; // Empty to prevent rendering a broken duplicate chart panel
}

// Chart toggle button HTML (used in scribe header rows)
function getChartToggleBtn() {
    const pid = scribePatientId || activeScribeSession?.patient_id;
    const pname = scribePatientName || activeScribeSession?.patient_name || 'Patient';
    if (!pid) return '';
    return `<button class="chart-toggle-btn" onclick="openChartForPatient('${pid}', '${pname}')" title="View patient chart">📋 Chart</button>`;
}

// ============================================================
// INVENTORY VIEW
// ============================================================
function renderInventoryView(container) {
    // Load inventory data on first visit
    if (!inventorySummary && !isLoading) {
        container.innerHTML = `
            <h1 style="font-size:28px; margin-bottom:20px;">Inventory</h1>
            <div class="inventory-tabs">
                <button class="inv-tab ${activeInventoryTab === 'dea' ? 'active' : ''}" onclick="setInventoryTab('dea')">DEA Controlled</button>
                <button class="inv-tab ${activeInventoryTab === 'peptides' ? 'active' : ''}" onclick="setInventoryTab('peptides')">Peptides</button>
                <button class="inv-tab ${activeInventoryTab === 'supplies' ? 'active' : ''}" onclick="setInventoryTab('supplies')">Supplies</button>
            </div>
            ${renderLoadingState()}
        `;
        loadInventorySummary().then(() => {
            if (currentTab === 'inventory') renderCurrentTab();
        });
        return;
    }

    container.innerHTML = `
        <h1 style="font-size:28px; margin-bottom:20px;">Inventory</h1>
        <div class="inventory-tabs">
            <button class="inv-tab ${activeInventoryTab === 'dea' ? 'active' : ''}" onclick="setInventoryTab('dea')">DEA Controlled</button>
            <button class="inv-tab ${activeInventoryTab === 'peptides' ? 'active' : ''}" onclick="setInventoryTab('peptides')">Peptides</button>
            <button class="inv-tab ${activeInventoryTab === 'supplies' ? 'active' : ''}" onclick="setInventoryTab('supplies')">Supplies</button>
        </div>
        <div id="inventoryContent">
            ${renderInventoryContent()}
        </div>
    `;
}

function setInventoryTab(tab) {
    activeInventoryTab = tab;
    renderCurrentTab();
}

function renderInventoryContent() {
    switch (activeInventoryTab) {
        case 'dea': return renderDEASection();
        case 'peptides': return renderPeptidesSection();
        case 'supplies': return renderSuppliesSection();
        default: return '';
    }
}

// ─── DEA SECTION ────────────────────────────────────────────
function renderDEASection() {
    const vials = extractVials();

    return `
        <!-- Daily DEA Verification -->
        <div class="dea-check-section">
            <div class="dea-check-title">Daily DEA Verification</div>
            <div class="dea-check-row">
                <div class="dea-check-label">☀️ Morning Count</div>
                <button class="toggle-btn" onclick="openDEACheckModal('morning')">Complete</button>
            </div>
            <div class="dea-check-row">
                <div class="dea-check-label">🌙 End of Day Count</div>
                <button class="toggle-btn" onclick="openDEACheckModal('evening')">Complete</button>
            </div>
        </div>

        <!-- Vial Inventory -->
        <div class="section-header" style="margin-top:20px">
            <h2>Vial Inventory</h2>
            <span style="color:var(--text-tertiary); font-size:13px;">${vials.length} vials tracked</span>
        </div>
        ${vials.length > 0 ? `
            <div class="vial-scroll">
                ${vials.map(v => renderVialCard(v)).join('')}
            </div>
        ` : renderEmptyState('💉', 'No vial data', 'Inventory data not yet available')}

        <!-- Stage Dose Button -->
        <button class="btn-dispense" onclick="openStageDoseModal()">
            💉 Stage Dose (Controlled)
        </button>

        <!-- Dispense Now Button -->
        <button class="btn-dispense" style="background:linear-gradient(135deg, #059669 0%, #10b981 100%); margin-top:8px;" onclick="openQuickDispenseModalWrapper()">
            ✅ Quick Dispense
        </button>

        <!-- Stage Dose Modal -->
        <div class="modal-overlay" id="stageDoseModal">
            <div class="modal modal-large">
                <h3>Stage Controlled Dose</h3>
                <p style="font-size:12px; color:var(--text-tertiary); margin-bottom:16px;">
                    System auto-selects vial (FEFO) and creates DEA transaction
                </p>
                <div class="modal-field">
                    <label>Patient</label>
                    <div class="patient-search-wrapper">
                        <input type="text" id="stageDosePatientSearch" class="patient-search-input"
                               placeholder="Type 2+ letters to search patients…" autocomplete="off" />
                        <div id="stageDosePatientResults" class="patient-search-results"></div>
                        <div id="stageDosePatientBadge" class="patient-selected-badge" style="display:none;"></div>
                    </div>
                </div>
                <div class="modal-row">
                    <div class="modal-field half">
                        <label>Dose (mL)</label>
                        <input type="number" id="stageDoseMl" step="0.05" value="0.35" min="0.05" max="5">
                    </div>
                    <div class="modal-field half">
                        <label>Waste (mL)</label>
                        <input type="number" id="stageDoseWaste" step="0.05" value="0.10" min="0">
                    </div>
                </div>
                <div class="modal-row">
                    <div class="modal-field half">
                        <label>Syringe Count</label>
                        <input type="number" id="stageDoseSyringes" value="1" min="1" max="10">
                    </div>
                    <div class="modal-field half">
                        <label>Staged For Date</label>
                        <input type="date" id="stageDoseDate" value="${new Date().toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE })}">
                    </div>
                </div>
                <div class="modal-field">
                    <label>Notes (optional)</label>
                    <input type="text" id="stageDoseNotes" placeholder="e.g., Patient prefers glute injection" class="patient-search-input">
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeStageDoseModal()">Cancel</button>
                    <button class="btn-primary" id="stageDoseSubmitBtn" onclick="submitStageDose()">Stage Dose</button>
                </div>
            </div>
        </div>

        <!-- DEA Check Modal -->
        <div class="modal-overlay" id="deaCheckModal">
            <div class="modal modal-large">
                <h3 id="deaCheckTitle">Morning DEA Count</h3>
                <p style="font-size:12px; color:var(--text-tertiary); margin-bottom:16px;">
                    Enter physical counts. System will compare with expected inventory.
                </p>
                <div id="deaCheckSystemCounts" class="dea-system-counts">
                    <div class="loading-spinner"></div>
                    <span style="color:var(--text-tertiary)">Loading system counts…</span>
                </div>
                <div class="modal-row">
                    <div class="modal-field half">
                        <label>Carrie Boyd Full Vials (30mL)</label>
                        <input type="number" id="deaCheckCbVials" min="0" value="0">
                    </div>
                    <div class="modal-field half">
                        <label>CB Partial Vial (mL)</label>
                        <input type="number" id="deaCheckCbPartial" step="0.5" min="0" value="0">
                    </div>
                </div>
                <div class="modal-row">
                    <div class="modal-field half">
                        <label>TopRx Vials (10mL)</label>
                        <input type="number" id="deaCheckTopRxVials" min="0" value="0">
                    </div>
                    <div class="modal-field half">
                        <label>TopRx Partial (mL)</label>
                        <input type="number" id="deaCheckTopRxPartial" step="0.5" min="0" value="0">
                    </div>
                </div>
                <div class="modal-field">
                    <label>Notes</label>
                    <input type="text" id="deaCheckNotes" placeholder="Notes (required if discrepancy)" class="patient-search-input">
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeModal('deaCheckModal')">Cancel</button>
                    <button class="btn-primary" onclick="submitDEACheck()">Submit Count</button>
                </div>
            </div>
        </div>
    `;
}

let stageDosePatientId = null;
let stageDosePatientName = '';
let deaCheckType = 'morning';

function openStageDoseModal() {
    stageDosePatientId = null;
    stageDosePatientName = '';
    document.getElementById('stageDoseModal').classList.add('visible');
    let timeout = null;
    const input = document.getElementById('stageDosePatientSearch');
    const results = document.getElementById('stageDosePatientResults');
    if (input) {
        input.value = '';
        document.getElementById('stageDosePatientBadge').style.display = 'none';
        // FIX: Use oninput assignment instead of addEventListener to prevent listener accumulation
        input.oninput = () => {
            const q = input.value.trim();
            if (timeout) clearTimeout(timeout);
            if (q.length < 3) { results.innerHTML = ''; results.style.display = 'none'; return; }
            results.innerHTML = '<div class="patient-search-loading">Searching…</div>';
            results.style.display = 'block';
            timeout = setTimeout(async () => {
                try {
                    const data = await apiFetch(`/ops/api/patients/search/?q=${encodeURIComponent(q)}`);
                    if (!data?.patients?.length) { results.innerHTML = '<div class="patient-search-empty">No patients found</div>'; return; }
                    results.innerHTML = data.patients.map(p => {
                        const n = `${p.first_name || ''} ${p.last_name || ''}`.trim();
                        return `<div class="patient-search-item" onclick="selectStageDosePatient('${p.healthie_id || p.id}', '${n.replace(/'/g, "\\'")}')">
                            <span class="patient-search-name">${n}</span>
                            <span class="patient-search-detail">${p.dob ? 'DOB: ' + p.dob : ''}</span>
                        </div>`;
                    }).join('');
                } catch (e) { results.innerHTML = '<div class="patient-search-empty">Search error</div>'; }
            }, 300);
        };
    }
}

function selectStageDosePatient(id, name) {
    stageDosePatientId = id;
    stageDosePatientName = name;
    const badge = document.getElementById('stageDosePatientBadge');
    const results = document.getElementById('stageDosePatientResults');
    const input = document.getElementById('stageDosePatientSearch');
    if (input) input.value = '';
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    if (badge) { badge.style.display = 'flex'; badge.innerHTML = `<span>👤 ${name}</span><button onclick="clearStageDosePatient()" class="patient-clear-btn">✕</button>`; }
}

function clearStageDosePatient() {
    stageDosePatientId = null; stageDosePatientName = '';
    const badge = document.getElementById('stageDosePatientBadge');
    if (badge) { badge.style.display = 'none'; badge.innerHTML = ''; }
}

function closeStageDoseModal() { document.getElementById('stageDoseModal').classList.remove('visible'); }

async function submitStageDose() {
    if (!stageDosePatientId) { showToast('Select a patient first', 'error'); return; }
    const doseMl = parseFloat(document.getElementById('stageDoseMl').value);
    const wasteMl = parseFloat(document.getElementById('stageDoseWaste').value);
    const syringeCount = parseInt(document.getElementById('stageDoseSyringes').value);
    const stagedForDate = document.getElementById('stageDoseDate').value;
    const notes = document.getElementById('stageDoseNotes').value;
    if (!doseMl || doseMl <= 0) { showToast('Enter a valid dose', 'error'); return; }
    if (!stagedForDate) { showToast('Enter the staged-for date', 'error'); return; }

    const btn = document.getElementById('stageDoseSubmitBtn');
    btn.disabled = true; btn.textContent = 'Staging…';
    try {
        const result = await apiFetch('/ops/api/ipad/stage-dose/', {
            method: 'POST',
            body: JSON.stringify({ patientId: stageDosePatientId, patientName: stageDosePatientName, doseMl, wasteMl, syringeCount, stagedForDate, notes })
        });
        if (result?.success) {
            closeStageDoseModal();
            const totalMl = (doseMl + wasteMl) * syringeCount;
            showToast(`Staged ${totalMl.toFixed(2)}mL from vial ${result.data?.vial_used || '?'} — ${result.data?.remaining_in_vial}mL remaining`, 'success');
            loadVialList();
        } else {
            showToast(result?.error || 'Stage failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Stage failed — check connection', 'error');
    } finally { btn.disabled = false; btn.textContent = 'Stage Dose'; }
}

// ─── DEA CHECK ──────────────────────────────────────────────
async function openDEACheckModal(type) {
    deaCheckType = type;
    document.getElementById('deaCheckTitle').textContent = type === 'morning' ? '☀️ Morning DEA Count' : '🌙 Evening DEA Count';
    document.getElementById('deaCheckModal').classList.add('visible');
    try {
        const counts = await apiFetch('/ops/api/inventory/controlled-check/?action=counts');
        document.getElementById('deaCheckSystemCounts').innerHTML = `
            <div class="dea-expected-row"><span>Carrie Boyd (30mL):</span> <strong>${counts?.carrieboyd_full_vials || 0} full + ${(counts?.carrieboyd_partial_ml || 0).toFixed(1)}mL partial = ${(counts?.carrieboyd_total_ml || 0).toFixed(1)}mL</strong></div>
            <div class="dea-expected-row"><span>TopRx (10mL):</span> <strong>${counts?.toprx_full_vials || 0} full + ${(counts?.toprx_partial_ml || 0).toFixed(1)}mL partial = ${(counts?.toprx_total_ml || 0).toFixed(1)}mL</strong></div>
        `;
    } catch (e) {
        document.getElementById('deaCheckSystemCounts').innerHTML = '<div class="patient-search-empty">Could not load system counts</div>';
    }
}

async function submitDEACheck() {
    const data = {
        carrieboyd_full_vials: parseInt(document.getElementById('deaCheckCbVials').value) || 0,
        carrieboyd_partial_ml: parseFloat(document.getElementById('deaCheckCbPartial').value) || 0,
        toprx_vials: parseInt(document.getElementById('deaCheckTopRxVials').value) || 0,
        check_type: deaCheckType,
        notes: document.getElementById('deaCheckNotes').value || null,
        discrepancyNotes: document.getElementById('deaCheckNotes').value || null,
    };
    try {
        const result = await apiFetch('/ops/api/inventory/controlled-check/', { method: 'POST', body: JSON.stringify(data) });
        closeModal('deaCheckModal');
        if (result?.success) {
            if (result.newInventoryDetected) {
                showToast(`⚠️ New inventory detected — please add new vials via Inventory Management (need lot# & expiration).`, 'info');
            } else if (result.hasDiscrepancy) {
                showToast(`⚠️ Discrepancy: ${result.discrepancyDetails}. Inventory adjusted down.`, 'info');
            } else {
                showToast(`${deaCheckType === 'morning' ? 'Morning' : 'Evening'} count verified ✅`, 'success');
            }
        } else showToast(result?.error || 'Check failed', 'error');
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('DEA check failed', 'error');
    }
}

// FIX(2026-03-15): Enhanced closeModal + added backdrop click-to-dismiss for static modals
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.remove('visible');
        el.style.display = '';
    }
}

// Dismiss static modals (deaCheckModal, stageDoseModal) when clicking the overlay backdrop
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay') && e.target.classList.contains('visible')) {
        e.target.classList.remove('visible');
    }
});

// FIX(2026-03-15): Close visible modal overlays on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const visibleOverlay = document.querySelector('.modal-overlay.visible');
        if (visibleOverlay) {
            visibleOverlay.classList.remove('visible');
        }
    }
});

function extractVials() {
    if (vialList.length > 0) return vialList.map(v => ({
        ...v, id: v.vial_id || v.id, vial_id: v.external_id || v.vial_id || v.id,
        substance: v.dea_drug_name || v.substance || v.name || '',
        remaining_ml: parseFloat(v.remaining_volume_ml || v.remaining_ml || '0'),
        total_ml: parseFloat(v.initial_volume_ml || v.total_ml || '10'),
        expiration: v.expiration_date || v.expiry_date || '',
    }));
    if (!inventorySummary) return [];
    if (inventorySummary.vials && Array.isArray(inventorySummary.vials)) return inventorySummary.vials;
    if (inventorySummary.dea && Array.isArray(inventorySummary.dea)) return inventorySummary.dea;
    if (Array.isArray(inventorySummary)) return inventorySummary.filter(item => item.vial_id || item.substance || item.is_controlled);
    return [];
}

function renderVialCard(vial) {
    const remaining = vial.remaining_ml || vial.remaining || vial.current_amount || 0;
    const total = vial.total_ml || vial.total || vial.initial_amount || 10;
    const pct = total > 0 ? (remaining / total) * 100 : 0;
    const level = pct > 60 ? 'high' : pct > 25 ? 'mid' : 'low';
    const substance = vial.substance || vial.name || vial.medication || '';
    const shortSubstance = substance.split(' ').slice(0, 2).join(' ');
    const vialId = vial.vial_id || vial.id || '';
    const expiry = vial.expiration || vial.expiry_date || vial.expires_at || '';
    return `
        <div class="vial-card">
            <div class="vial-id">${vialId}</div>
            <div class="vial-substance">${shortSubstance}</div>
            <div class="vial-gauge"><div class="vial-gauge-fill ${level}" style="width:${pct}%"></div></div>
            <div class="vial-remaining">${typeof remaining === 'number' ? remaining.toFixed(1) : remaining}<span> / ${total} mL</span></div>
            ${expiry ? `<div class="vial-expiry">Exp: ${expiry}</div>` : ''}
        </div>
    `;
}

// ─── PEPTIDES SECTION ───────────────────────────────────────
function renderPeptidesSection() {
    const peptides = extractPeptides();

    if (peptides.length === 0) {
        return renderEmptyState('💊', 'No peptide data', 'Inventory data not yet available');
    }

    return `
    <div class="peptide-grid stagger-in">
        ${peptides.map(p => {
        const stock = p.current_stock ?? p.stock ?? p.quantity ?? 0;
        const par = p.reorder_point ?? p.par_level ?? p.par ?? 10;
        const name = p.name || p.medication || p.peptide_name || '';
        const ratio = par > 0 ? stock / par : 1;
        const level = ratio > 1.5 ? 'over' : ratio >= 0.8 ? 'at' : 'under';
        const barPct = Math.min((stock / Math.max(par * 3, 1)) * 100, 100);
        return `
                    <div class="peptide-card">
                        <div class="peptide-name">${name}</div>
                        <div class="peptide-stock">${stock}<span> vials</span></div>
                        <div class="peptide-par">Reorder at: ${par} vials</div>
                        <div class="stock-bar">
                            <div class="stock-bar-fill ${level}" style="width:${barPct}%"></div>
                        </div>
                        ${stock < 0 ? '<div style="color:var(--red);font-size:11px;margin-top:4px;">⚠ Negative stock — check data</div>' : ''}
                        ${p.status === 'low' ? '<div style="color:var(--red);font-size:11px;margin-top:4px;">⚠ Below reorder point</div>' : ''}
                    </div>
                `;
    }).join('')
        }
    </div>
    `;
}

function extractPeptides() {
    if (!inventorySummary) return [];
    // API returns { peptides: [{ product_id, name, current_stock, reorder_point, status }] }
    if (inventorySummary.peptides && Array.isArray(inventorySummary.peptides)) return inventorySummary.peptides;
    if (Array.isArray(inventorySummary)) {
        return inventorySummary.filter(item => item.peptide_name || item.is_peptide || (item.category && item.category.toLowerCase().includes('peptide')));
    }
    return [];
}

// ─── SUPPLIES SECTION ───────────────────────────────────────
function renderSuppliesSection() {
    const supplies = supplyItems || extractSupplies();

    if (supplies.length === 0 && !supplyItems) {
        // Try loading from the dedicated supplies API
        loadSuppliesData();
        return renderLoadingState();
    }

    if (supplies.length === 0) {
        return renderEmptyState('📦', 'No supply data', 'No supplies found for this location');
    }

    const categories = ['All', ...new Set(supplies.map(s => s.category || 'Other').filter(Boolean))];
    let filtered = activeSupplyFilter === 'All' ? supplies : supplies.filter(s => (s.category || 'Other') === activeSupplyFilter);

    // Low stock filter
    if (showLowStockOnly) {
        filtered = filtered.filter(s => {
            const count = s.qty_on_hand ?? s.current_count ?? 0;
            const par = s.par_level ?? null;
            return par && count <= par;
        });
    }

    const lowCount = supplies.filter(s => {
        const count = s.qty_on_hand ?? s.current_count ?? 0;
        const par = s.par_level ?? null;
        return par && count <= par;
    }).length;

    const locations = [
        { id: 'mens_health', label: "Men's Health" },
        { id: 'primary', label: 'Primary' },
        { id: 'optimal', label: 'Optimal' },
    ];

    return `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div class="supply-filters">
            ${locations.map(l => `
                <button class="filter-pill ${activeSupplyLocation === l.id ? 'active' : ''}" 
                        onclick="setSupplyLocation('${l.id}')">${l.label}</button>
            `).join('')}
        </div>
        <button class="btn-primary btn-sm" onclick="openSupplyCountModal()" style="font-size:12px; padding:6px 14px;">
            📝 Update Counts
        </button>
    </div>

    ${lowCount > 0 ? `
        <div onclick="toggleLowStock()" style="cursor:pointer; margin-bottom:12px; padding:12px 16px; background:${showLowStockOnly ? 'var(--red-dim)' : 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.05))'}; border:1px solid ${showLowStockOnly ? 'var(--red)' : 'rgba(239,68,68,0.3)'}; border-radius:var(--radius-sm); display:flex; align-items:center; gap:10px;">
            <span style="font-size:20px;">⚠️</span>
            <div>
                <div style="font-weight:600; color:var(--red); font-size:14px;">${lowCount} Item${lowCount > 1 ? 's' : ''} Below Par</div>
                <div style="font-size:11px; color:var(--text-tertiary);">${showLowStockOnly ? 'Showing low stock only — tap to show all' : 'Tap to filter low stock items'}</div>
            </div>
        </div>
    ` : ''}

    <div class="supply-filters" style="margin-bottom:8px;">
        ${categories.map(c => `
            <button class="filter-pill ${activeSupplyFilter === c ? 'active' : ''}" 
                    onclick="setSupplyFilter('${c}')">${c}</button>
        `).join('')}
    </div>

    <div class="stagger-in">
        ${filtered.map(s => {
        const count = s.qty_on_hand ?? s.current_count ?? s.quantity ?? s.stock ?? 0;
        const par = s.par_level ?? s.par ?? null;
        const name = s.name || s.supply_name || '';
        const cat = s.category || '';
        const ratio = par ? count / par : 1;
        const level = !par ? 'ok' : ratio > 1.2 ? 'ok' : ratio >= 0.8 ? 'warning' : 'low';
        const label = level === 'ok' ? 'In Stock' : level === 'warning' ? 'Re-order Soon' : 'LOW STOCK';
        const countedInfo = s.counted_at ? `Counted ${formatDateDisplay(s.counted_at)}${s.counted_by ? ' by ' + s.counted_by : ''}` : '';
        return `
                <div class="supply-item">
                    <div class="supply-info">
                        <div class="supply-name">${name}</div>
                        ${cat ? `<div class="supply-category">${cat}</div>` : ''}
                        ${countedInfo ? `<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${countedInfo}</div>` : ''}
                    </div>
                    <div class="supply-count">
                        <div style="text-align:right;">
                            <span class="supply-count-value">${count}</span>
                            ${par != null ? `<span class="supply-par-value">/ ${par} par</span>` : `<span class="supply-par-value" style="color:var(--yellow);">no par set</span>`}
                        </div>
                        <span class="supply-par-indicator ${level}">${label}</span>
                        <button onclick="event.stopPropagation(); editSupplyPar(${s.id}, '${name.replace(/'/g, "\\'")}', ${par || 0})" 
                                style="background:none; border:1px solid var(--border-light); border-radius:6px; padding:4px 8px; color:var(--text-tertiary); font-size:10px; cursor:pointer;">✏️</button>
                    </div>
                </div>
            `;
    }).join('')}
    </div>
`;
}

// supplyItems declared at top with other state variables
let activeSupplyLocation = 'mens_health';
let showLowStockOnly = false;

async function loadSuppliesData() {
    try {
        const data = await apiFetch(`/ops/api/supplies/?location=${activeSupplyLocation}`);
        if (data?.items && Array.isArray(data.items)) {
            supplyItems = data.items;
        }
        renderCurrentTab();
    } catch (e) {
        console.warn('Supplies load failed:', e);
    }
}

function setSupplyLocation(loc) {
    activeSupplyLocation = loc;
    supplyItems = null; // force reload
    renderCurrentTab();
    loadSuppliesData();
}

function toggleLowStock() {
    showLowStockOnly = !showLowStockOnly;
    renderCurrentTab();
}

function editSupplyPar(itemId, itemName, currentPar) {
    const newPar = prompt(`Set PAR level for "${itemName}":`, currentPar || '');
    if (newPar === null) return;
    const parVal = parseInt(newPar, 10);
    if (isNaN(parVal) || parVal < 0) { alert('Invalid PAR level'); return; }

    apiFetch(`/ops/api/supplies/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ par_level: parVal }),
    }).then(() => {
        showToast(`PAR updated to ${parVal}`);
        supplyItems = null;
        loadSuppliesData();
    }).catch(e => showToast('Failed to update PAR: ' + e.message));
}

function openSupplyCountModal() {
    const supplies = supplyItems || extractSupplies();
    if (supplies.length === 0) { showToast('No supplies loaded'); return; }

    const html = `
        <div class="modal-overlay" id="supplyCountModal" onclick="if(event.target===this)this.remove()">
            <div class="modal-content" style="max-height:85vh; overflow-y:auto;">
                <h2 style="margin-bottom:4px;">📝 Update Supply Counts</h2>
                <p style="color:var(--text-tertiary); font-size:12px; margin-bottom:16px;">Location: ${activeSupplyLocation.replace(/_/g, ' ')}</p>
                <div id="supplyCountEntries">
                    ${supplies.map(s => {
        const currentQty = s.qty_on_hand ?? s.current_count ?? 0;
        return `
                            <div style="display:flex; align-items:center; gap:10px; padding:10px 0; border-bottom:1px solid var(--border);">
                                <div style="flex:1;">
                                    <div style="font-weight:500; font-size:13px;">${s.name}</div>
                                    <div style="font-size:11px; color:var(--text-tertiary);">${s.category || ''} · Current: ${currentQty}</div>
                                </div>
                                <input type="number" min="0" value="${currentQty}" data-item-id="${s.id}" 
                                       style="width:80px; padding:8px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); text-align:center; font-size:16px; font-weight:600;">
                            </div>
                        `;
    }).join('')}
                </div>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button class="btn-secondary" onclick="document.getElementById('supplyCountModal').remove()" style="flex:1;">Cancel</button>
                    <button class="btn-primary" onclick="submitSupplyCounts()" style="flex:1;">💾 Save Counts</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
}

async function submitSupplyCounts() {
    const inputs = document.querySelectorAll('#supplyCountEntries input[data-item-id]');
    const entries = [];
    inputs.forEach(input => {
        const qty = parseInt(input.value, 10);
        const itemId = parseInt(input.dataset.itemId, 10);
        if (!isNaN(qty) && !isNaN(itemId)) {
            entries.push({ item_id: itemId, qty: qty, location: activeSupplyLocation });
        }
    });

    if (entries.length === 0) { showToast('No entries to save'); return; }

    try {
        // FIX(2026-03-15): Added trailing slash to prevent 404/redirect
        await apiFetch('/ops/api/supplies/count/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries, recorded_by: 'iPad User' }),
        });
        showToast(`✅ ${entries.length} counts saved`);
        document.getElementById('supplyCountModal')?.remove();
        supplyItems = null;
        loadSuppliesData();
    } catch (e) {
        showToast('Failed to save: ' + e.message);
    }
}

function extractSupplies() {
    if (!inventorySummary) return [];
    // API returns { supplies: [{ id, name, category, par_level, qty_on_hand, status }] }
    if (inventorySummary.supplies && Array.isArray(inventorySummary.supplies)) {
        return inventorySummary.supplies.map(s => ({
            ...s,
            current_count: s.qty_on_hand ?? s.current_count ?? s.stock ?? 0,
            par_level: s.par_level ?? s.par ?? 10,
        }));
    }
    if (Array.isArray(inventorySummary)) {
        return inventorySummary.filter(item => item.supply_name || item.is_supply || (item.category && !item.category.toLowerCase().includes('peptide') && !item.is_controlled));
    }
    return [];
}

function setSupplyFilter(category) {
    activeSupplyFilter = category;
    renderCurrentTab();
}

// ============================================================
// PATIENTS VIEW
// ============================================================
function renderPatientsView(container) {
    // Load patients if not yet loaded or if previous load failed with empty result
    if (allPatients.length === 0 && !isLoading) {
        container.innerHTML = renderLoadingState();
        loadAllPatients().then((ok) => {
            if (currentTab === 'patients') renderCurrentTab();
            if (!ok && allPatients.length === 0) {
                // Show retry state instead of infinite spinner
                const main = document.getElementById('mainContent');
                const view = main?.querySelector('#view-patients');
                if (view) view.innerHTML = `
                    <h1 style="font-size:28px; margin-bottom:20px;">Patients</h1>
                    ${renderEmptyState('⚠️', 'Failed to load patients', 'Tap below to retry')}
                    <div style="text-align:center; margin-top:16px;">
                        <button onclick="renderCurrentTab()" style="padding:10px 24px; background:var(--cyan); color:#0a0f1a; border:none; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer;">↻ Retry</button>
                    </div>
                `;
            }
        });
        return;
    }

    const patients = getPatients();
    const recent = patients.slice(0, 6);

    container.innerHTML = `
    <h1 style="font-size:28px; margin-bottom:20px;">Patients</h1>
        <div class="patient-search">
            <span class="patient-search-icon">🔍</span>
            <input type="text" placeholder="Search patients..." id="patientSearchInput"
                oninput="debouncedHandlePatientSearch(this.value)">
        </div>

        ${recent.length > 0 ? `
            <div class="section-header" style="margin-top:0">
                <h2>Recently Viewed</h2>
            </div>
            <div class="recent-patients" id="recentPatients">
                ${recent.map(p => {
        const name = p.name || p.patient_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        const color = p.avatar_color || getAvatarColor(name);
        const pType = formatClientType(p.client_type_key || p.client_type || '');
        return `
                        <div class="recent-patient-card" onclick="selectPatient('${p.id || p.patient_id}')">
                            ${p.avatar_url ? `<div class="patient-avatar" style="background:${color}; overflow:hidden; padding:0;"><img src="${p.avatar_url}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.textContent='${getInitials(name)}'"/></div>` : `<div class="patient-avatar" style="background:${color}">${getInitials(name)}</div>`}
                            <div class="recent-patient-name">${name}</div>
                            ${pType ? `<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">${pType}</div>` : ''}
                        </div>
                    `;
    }).join('')}
            </div>
        ` : ''
        }

        <div id="patientDetail"></div>

        <div class="section-header">
            <h2>All Patients</h2>
            <span style="color:var(--text-tertiary); font-size:13px;">${patients.length} total</span>
        </div>
        <div class="patient-list" id="patientList">
            ${patients.length > 0
            ? patients.map(p => renderPatientListItem(p)).join('')
            : renderEmptyState('👥', 'No patient data', 'Patient data will appear once the dashboard loads')}
        </div>
`;
}

function getAvatarColor(name) {
    const colors = ['#3B82F6', '#EC4899', '#F59E0B', '#10B981', '#8B5CF6', '#06B6D4', '#EF4444', '#14B8A6', '#6366F1', '#F97316'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function formatStatusLabel(raw) {
    if (!raw) return 'Active';
    const map = {
        'Active': 'Active', 'active': 'Active',
        'active_pending': 'Pending', 'Inactive': 'Inactive',
        'hold_service_change': 'Hold', 'hold_payment_research': 'Hold',
        'hold_patient_research': 'Hold', 'hold_other': 'Hold',
        'lead': 'Lead', 'cancelled': 'Cancelled',
        'churned': 'Churned', 'paused': 'Paused',
    };
    return map[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getStatusColor(raw) {
    if (!raw) return 'var(--green)';
    if (raw === 'Active' || raw === 'active') return 'var(--green)';
    if (raw.startsWith('hold_')) return 'var(--yellow)';
    if (raw === 'active_pending') return 'var(--cyan)';
    if (raw === 'Inactive' || raw === 'cancelled' || raw === 'churned') return 'var(--text-tertiary)';
    return 'var(--text-secondary)';
}

function formatClientType(raw) {
    if (!raw) return '';
    const map = {
        'NowMensHealth.Care': 'Men\'s Health',
        'nowmenshealth': 'Men\'s Health',
        'QBO TCMH $180/Month': 'TCMH $180',
        'QBO F&F/FR/Veteran $140/Month': 'F&F $140',
        'Ins. Supp. $60/Month': 'Ins. Supp.',
        'weight_loss': 'Weight Loss',
        'primary_care': 'Primary Care',
    };
    return map[raw] || raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderPatientListItem(p) {
    const name = p.name || p.patient_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    const color = p.avatar_color || getAvatarColor(name);
    const rawStatus = p.status_key || p.status || 'Active';
    const label = formatStatusLabel(rawStatus);
    const statusColor = getStatusColor(rawStatus);
    const clientType = formatClientType(p.client_type_key || p.client_type || '');
    const hasHealthie = !!(p.healthie_client_id || p.healthie_id);

    return `
        <div class="patient-list-item" onclick="selectPatient('${p.id || p.patient_id}')">
            ${p.avatar_url ? `<div class="patient-list-avatar" style="background:${color}; overflow:hidden; padding:0;"><img src="${p.avatar_url}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.textContent='${getInitials(name)}'"/></div>` : `<div class="patient-list-avatar" style="background:${color}">${getInitials(name)}</div>`}
            <div class="patient-list-info">
                <div class="patient-list-name">${sanitize(name)}
                    ${hasHealthie ? '<span style="font-size:9px; margin-left:4px; padding:1px 5px; border-radius:3px; background:rgba(34,197,94,0.15); color:#22c55e; font-weight:500;">✓ Healthie</span>' : '<span style="font-size:9px; margin-left:4px; padding:1px 5px; border-radius:3px; background:rgba(239,68,68,0.1); color:#ef4444; font-weight:500;">✗ Not linked</span>'}
                </div>
                ${clientType ? `<div style="font-size:11px; color:var(--text-tertiary); margin-top:1px;">${sanitize(clientType)}</div>` : ''}
            </div>
            <span class="patient-status-badge" style="color:${statusColor}; border-color:${statusColor}40; background:${statusColor}10;">${label}</span>
        </div>
    `;
}

// FIX(2026-03-15): Debounce patient search to avoid re-rendering on every keystroke
let _patientSearchTimeout = null;
function debouncedHandlePatientSearch(query) {
    if (_patientSearchTimeout) clearTimeout(_patientSearchTimeout);
    _patientSearchTimeout = setTimeout(() => handlePatientSearch(query), 250);
}

function handlePatientSearch(query) {
    const patients = getPatients();
    const q = query.toLowerCase().trim();
    // FIX(2026-03-15): Only filter after 2+ characters to avoid unnecessary re-renders
    const filtered = (q && q.length >= 2)
        ? patients.filter(p => {
            const name = (p.name || p.patient_name || ((p.first_name || '') + ' ' + (p.last_name || ''))).toLowerCase();
            return name.includes(q);
        })
        : patients;

    const list = document.getElementById('patientList');
    if (list) {
        list.innerHTML = filtered.length > 0
            ? filtered.map(p => renderPatientListItem(p)).join('')
            : renderEmptyState('🔍', 'No patients found', 'Try a different search term');
    }
}

async function selectPatient(id) {
    console.log('%c[selectPatient v3.0] Clicked patient: ' + id, 'background:#22d3ee;color:#000;padding:2px 6px;font-weight:bold;');
    const patients = getPatients();
    const patient = patients.find(p => String(p.id || p.patient_id) === String(id));
    if (!patient) { console.error('[selectPatient] Patient not found in list for id:', id); return; }
    selectedPatient = patient;

    const detail = document.getElementById('patientDetail');
    if (!detail) { console.error('[selectPatient] patientDetail container not found'); return; }

    const name = patient.name || patient.patient_name || patient.full_name || ((patient.first_name || '') + ' ' + (patient.last_name || '')).trim();
    const color = patient.avatar_color || getAvatarColor(name);
    const rawStatus = patient.status_key || patient.status || 'Active';
    const statusLabel = formatStatusLabel(rawStatus);
    const statusColor = getStatusColor(rawStatus);

    // Show basic info + loading spinner
    detail.innerHTML = `
        <div class="patient-detail">
            <div class="patient-detail-header">
                ${patient.avatar_url ? `<div class="patient-detail-avatar" style="background:${color}; overflow:hidden; padding:0;" id="patientAvatar-${id}"><img src="${patient.avatar_url}" style="width:100%; height:100%; object-fit:cover;" onerror="this.parentElement.textContent='${getInitials(name)}'"/></div>` : `<div class="patient-detail-avatar" style="background:${color}" id="patientAvatar-${id}">${getInitials(name)}</div>`}
                <div style="flex:1">
                    <div class="patient-detail-name">${sanitize(name)}</div>
                    ${patient.dob ? `<div class="patient-detail-dob">DOB: ${formatDateDisplay(patient.dob)}</div>` : ''}
                    <div style="display:flex; gap:4px; margin-top:4px;">
                        <span class="patient-status-badge" style="color:${statusColor}; border-color:${statusColor}40; background:${statusColor}10;">${statusLabel}</span>
                        ${patient.healthie_client_id ? '<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(34,197,94,0.12); color:#22c55e;">✅ Healthie</span>' : '<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(239,68,68,0.12); color:#ef4444;">❌ Not linked</span>'}
                    </div>
                </div>
                <button class="quick-action-btn-sm" onclick="openStatusChangeModal('${id}', '${rawStatus}')" title="Change Status">✏️</button>
            </div>
            <div id="patient360Data">
                <div class="patient-360-loading">
                    <div class="loading-spinner"></div>
                    <span>Loading patient details…</span>
                </div>
            </div>
        </div>
    `;

    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Load 360 data
    try {
        console.log('[selectPatient] Loading 360 data for:', id);
        const data360 = await loadPatient360(id);
        console.log('[selectPatient] 360 data loaded:', data360 ? 'got data' : 'NULL', data360 ? Object.keys(data360) : []);
        renderPatient360(data360, patient, id);
        console.log('[selectPatient] renderPatient360 completed successfully');
    } catch (e) {
        console.error('[selectPatient] render failed:', e, e?.stack);
        const container = document.getElementById('patient360Data');
        if (container) {
            container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--red); font-size:13px;">
                Failed to load patient details. <button onclick="selectPatient('${id}')" style="color:var(--cyan); background:none; border:none; cursor:pointer; text-decoration:underline;">Retry</button>
            </div>`;
        }
    }
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    try {
        // Parse date-only strings as noon UTC to avoid day-boundary shift in Arizona (UTC-7)
        const raw = String(dateStr);
        const d = raw.match(/^\d{4}-\d{2}-\d{2}$/) ? new Date(raw + 'T12:00:00Z') : new Date(raw);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', {
            month: '2-digit', day: '2-digit', year: 'numeric',
            timeZone: CLINIC_TIMEZONE
        }).replace(/\//g, '-');
    } catch { return dateStr; }
}

// ─── INLINE COLLAPSIBLE SECTIONS (Patient 360 view) ─────────────────

function renderInlineAllergiesSection(data) {
    const allergies = data.healthie_allergies || data.allergies || [];
    if (allergies.length === 0) {
        return `
            <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;">
                <span style="font-size:13px;color:var(--green);font-weight:600;">✓ NKDA</span>
                <span style="font-size:11px;color:var(--text-tertiary);margin-left:8px;">No Known Drug Allergies</span>
            </div>`;
    }
    return `
        <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;cursor:pointer;" onclick="this.querySelector('.inline-collapse-body').classList.toggle('hidden')">
            <div style="font-size:12px;font-weight:600;color:var(--red);margin-bottom:4px;display:flex;justify-content:space-between;align-items:center;">
                <span>⚠️ ALLERGIES (${allergies.length})</span>
                <span style="font-size:10px;color:var(--text-tertiary);">tap to toggle</span>
            </div>
            <div class="inline-collapse-body" style="display:flex;flex-wrap:wrap;gap:6px;">
                ${allergies.map(a => `
                    <span style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-xs);padding:3px 8px;font-size:12px;color:var(--text-primary);">
                        ${a.name || a.allergen || a}${a.severity ? ` (${a.severity})` : ''}
                    </span>
                `).join('')}
            </div>
        </div>`;
}

function renderInlineDiagnosesSection(data, demo) {
    const diagnoses = data.working_diagnoses || data.diagnoses || demo.diagnoses || [];
    if (diagnoses.length === 0) return '';

    return `
        <div style="margin-bottom:12px;cursor:pointer;" onclick="this.querySelector('.inline-collapse-body').classList.toggle('hidden')">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                <span>🏷️ Working Diagnoses (${diagnoses.length})</span>
                <span style="font-size:10px;color:var(--text-tertiary);">tap to toggle</span>
            </div>
            <div class="inline-collapse-body" style="display:flex;flex-wrap:wrap;gap:6px;">
                ${diagnoses.map(dx => {
                    const code = dx.icd10 || dx.code || '';
                    const desc = dx.description || dx.name || (typeof dx === 'string' ? dx : '');
                    return `
                        <span style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);padding:3px 8px;font-size:12px;color:var(--text-primary);">
                            ${code ? `<span style="color:var(--purple);font-weight:600;margin-right:4px;">${code}</span>` : ''}${desc}
                        </span>`;
                }).join('')}
            </div>
        </div>`;
}

function renderInlineMedicationsSection(data, peptides, trt) {
    const rxActive = data.prescriptions?.active || [];
    const rxControlled = rxActive.filter(p => p.schedule != null);
    const totalCount = rxActive.length + peptides.length + trt.length;

    if (totalCount === 0) return '';

    return `
        <div style="margin-bottom:12px;cursor:pointer;" onclick="this.querySelector('.inline-collapse-body').classList.toggle('hidden')">
            <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                <span>💊 Medications (${totalCount})${rxControlled.length > 0
                    ? ` <span style="color:var(--orange);font-size:10px;margin-left:4px;">⚠️ ${rxControlled.length} Controlled</span>` : ''}</span>
                <span style="font-size:10px;color:var(--text-tertiary);">tap to toggle</span>
            </div>
            <div class="inline-collapse-body">
                ${rxActive.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
                    ${rxActive.map(rx => {
                        const borderColor = rx.schedule === 'II' ? 'var(--red)'
                            : rx.schedule === 'III' ? 'var(--orange)'
                            : rx.schedule === 'IV' ? 'var(--yellow)'
                            : rx.schedule === 'V' ? 'var(--green)'
                            : 'transparent';
                        return `<span class="rx-med-chip" style="${rx.schedule ? `border-left:3px solid ${borderColor};` : ''}">
                            ${rx.product_name || rx.display_name || '?'}
                            ${rx.dosage ? `<span style="color:var(--text-tertiary);font-size:11px;">${rx.dosage}</span>` : ''}
                            ${rx.schedule ? `<span class="rx-schedule-badge rx-schedule-badge-${rx.schedule.toLowerCase()}">C-${rx.schedule}</span>` : ''}
                        </span>`;
                    }).join('')}
                </div>` : ''}
                ${peptides.length + trt.length > 0 ? `<div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;">
                    ${[
                        ...peptides.map(m => m.medication_name || m.product_name || '?'),
                        ...trt.map(m => m.medication_name || '?'),
                    ].filter(Boolean).join(' · ')}
                </div>` : ''}
            </div>
        </div>`;
}

function renderInlinePrescriptionsSummary(data) {
    const rxData = data.prescriptions || {};
    const active = rxData.active || [];
    const controlled = active.filter(p => p.schedule != null);

    if (active.length === 0) return '';

    return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px 16px;margin-bottom:12px;cursor:pointer;" onclick="this.querySelector('.inline-collapse-body').classList.toggle('hidden')">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:13px;font-weight:600;color:var(--text-primary);">
                    💊 Active Prescriptions
                </span>
                <span style="font-size:12px;color:var(--text-tertiary);">
                    ${active.length} active${controlled.length > 0 ? ` · ${controlled.length} controlled` : ''}
                </span>
            </div>
            ${controlled.length > 0
                ? `<div class="rx-alert-banner" style="margin-bottom:8px;padding:8px 12px;font-size:12px;">
                    ⚠️ ${controlled.length} Controlled: ${[...new Set(controlled.map(p => 'C-' + p.schedule))].join(', ')}
                  </div>`
                : ''}
            <div class="inline-collapse-body" style="display:flex;flex-direction:column;gap:4px;">
                ${active.slice(0, 5).map(rx => {
                    const borderColor = rx.schedule === 'II' ? 'var(--red)'
                        : rx.schedule === 'III' ? 'var(--orange)'
                        : rx.schedule === 'IV' ? 'var(--yellow)'
                        : rx.schedule === 'V' ? 'var(--green)'
                        : 'var(--border)';
                    return `
                        <div style="border-left:3px solid ${borderColor};padding:4px 10px;font-size:12px;">
                            <span style="color:var(--text-primary);font-weight:500;">${rx.product_name || rx.display_name || 'Unknown'}</span>
                            ${rx.dosage ? `<span style="color:var(--text-tertiary);margin-left:4px;">${rx.dosage}</span>` : ''}
                            ${rx.last_fill_date ? `<span style="color:var(--text-tertiary);font-size:10px;margin-left:6px;">filled ${formatRxDate(rx.last_fill_date)}</span>` : ''}
                            ${rx.refills != null ? `<span style="color:var(--text-tertiary);font-size:10px;margin-left:6px;">${rx.refills} refills</span>` : ''}
                        </div>`;
                }).join('')}
                ${active.length > 5
                    ? `<div style="font-size:11px;color:var(--text-tertiary);padding-left:13px;">
                        + ${active.length - 5} more...
                      </div>`
                    : ''}
            </div>
        </div>`;
}

function renderPatient360(data, patient, patientId) {
    const container = document.getElementById('patient360Data');
    if (!container) return;

    if (!data) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--text-tertiary); font-size:13px;">Extended patient data not available</div>`;
        return;
    }

    const demo = data.demographics || patient || {};
    // Map from API structure (medications.trt, payments.issues) to flat names
    const dispenses = data.controlled_substances || data.medications?.trt || data.recent_dispenses || [];
    const peptides = data.medications?.peptides || data.recent_peptides || [];
    const payIssues = data.payments?.issues || data.payment_issues || [];
    const staged = data.staged_doses || [];
    const labs = data.labs?.queue_items || [];
    const visits = data.visits || [];
    const alerts = data.alerts || [];
    const summary = data.summary || {};
    const labOrders = data.lab_orders || [];

    // Mapping badges
    const hasGHL = !!(demo.ghl_contact_id || patient?.ghl_contact_id);
    const hasHealthie = !!(demo.healthie_client_id || patient?.healthie_client_id);
    const healthiePhoto = demo.healthie_avatar_url || patient?.healthie_avatar_url || '';

    // If we have a Healthie avatar, update the patient detail header avatar
    if (healthiePhoto) {
        const avatarEl = document.getElementById(`patientAvatar-${patientId}`);
        if (avatarEl) {
            avatarEl.innerHTML = `<img src="${healthiePhoto}" style="width:100%; height:100%; border-radius:inherit; object-fit:cover;" onerror="this.parentElement.textContent='${getInitials(demo.full_name || '')}'"/>`;
        }
    }

    let html = '';

    // ─── Badges & Info Grid (no duplicate name — name is in the header above) ───
    html += `
        <div class="patient-360-section">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
                <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(34,197,94,0.12); color:#22c55e;">✅ GMH</span>
                <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${hasGHL ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color:${hasGHL ? '#22c55e' : '#ef4444'};">${hasGHL ? '✅' : '❌'} GHL</span>
                <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${hasHealthie ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)'}; color:${hasHealthie ? '#22c55e' : '#ef4444'};">${hasHealthie ? '✅' : '❌'} Healthie</span>
                <div style="flex:1;"></div>
                <button class="btn-secondary btn-sm" onclick="openEditDemographicsModal('${patientId}')" style="font-size:12px;">✏️ Edit</button>
            </div>
            <div class="patient-info-grid">
                <div class="patient-info-item">
                    <div class="patient-info-label">Status</div>
                    <div class="patient-info-value">${formatStatusLabel(demo.status_key)}</div>
                </div>
                ${demo.regimen ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Regimen</div>
                    <div class="patient-info-value">${demo.regimen}</div>
                </div>` : ''}
                ${demo.client_type_key ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Client Type</div>
                    <div class="patient-info-value">${demo.client_type_key.replace(/_/g, ' ')}</div>
                </div>` : ''}
                ${demo.phone_primary ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Phone</div>
                    <div class="patient-info-value">${demo.phone_primary}</div>
                </div>` : ''}
                ${demo.email ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Email</div>
                    <div class="patient-info-value" style="font-size:12px">${demo.email}</div>
                </div>` : ''}
                ${demo.dob ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">DOB</div>
                    <div class="patient-info-value">${formatDateDisplay(demo.dob)}</div>
                </div>` : ''}
                ${demo.gender ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Gender</div>
                    <div class="patient-info-value">${demo.gender}</div>
                </div>` : ''}
                ${demo.location || demo.clinic ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Location</div>
                    <div class="patient-info-value">${demo.location || demo.clinic || ''}</div>
                </div>` : ''}
                ${demo.provider_name ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Provider</div>
                    <div class="patient-info-value">${demo.provider_name}</div>
                </div>` : ''}
                ${demo.address_line_1 ? `
                <div class="patient-info-item" style="grid-column: span 2;">
                    <div class="patient-info-label">Address</div>
                    <div class="patient-info-value" style="font-size:12px;">${demo.address_line_1}${demo.address_line_2 ? ', ' + demo.address_line_2 : ''}${demo.city ? ', ' + demo.city : ''}${demo.state ? ' ' + demo.state : ''} ${demo.zip || ''}</div>
                </div>` : ''}
            </div>
        </div>
    `;

    // ─── Inline Clinical Sections (collapsible) ───
    html += renderInlineAllergiesSection(data);
    html += renderInlineDiagnosesSection(data, demo);
    html += renderInlineMedicationsSection(data, peptides, dispenses);
    html += renderInlinePrescriptionsSummary(data);

    // ─── Lab Dates ───
    const lastLab = patient?.last_lab || demo.last_lab;
    const nextLab = patient?.next_lab || demo.next_lab;
    const labStatus = patient?.lab_status || demo.lab_status;
    html += `
        <div class="patient-360-section">
            <h3>Lab Schedule</h3>
            <div class="patient-info-grid">
                <div class="patient-info-item">
                    <div class="patient-info-label">Last Lab</div>
                    <div class="patient-info-value">${lastLab ? formatDateDisplay(lastLab) : 'Not set'}</div>
                </div>
                <div class="patient-info-item">
                    <div class="patient-info-label">Next Lab</div>
                    <div class="patient-info-value">${nextLab ? formatDateDisplay(nextLab) : 'Not set'}</div>
                </div>
                ${labStatus ? `
                <div class="patient-info-item">
                    <div class="patient-info-label">Lab Status</div>
                    <div class="patient-info-value">${labStatus}</div>
                </div>` : ''}
            </div>
            <div style="display:flex; gap:8px; margin-top:10px;">
                <button class="btn-secondary btn-sm" onclick="openEditLabDatesModal('${patientId}', '${lastLab || ''}', '${nextLab || ''}')">📅 Edit Lab Dates</button>
                <button class="btn-primary btn-sm" onclick="openOrderLabModal('${patientId}', '${demo.full_name || patient?.name || ''}')">🧪 Order Lab</button>
            </div>
        </div>
    `;

    // ─── Last Controlled Dispense ───
    if (demo.last_controlled_dispense_at || demo.last_dea_drug) {
        html += `
            <div class="patient-360-section">
                <h3>Last Controlled Dispense</h3>
                <div class="patient-info-grid">
                    ${demo.last_dea_drug ? `<div class="patient-info-item"><div class="patient-info-label">Drug</div><div class="patient-info-value">${demo.last_dea_drug}</div></div>` : ''}
                    ${demo.last_controlled_dispense_at ? `<div class="patient-info-item"><div class="patient-info-label">Date</div><div class="patient-info-value">${formatDateDisplay(demo.last_controlled_dispense_at)}</div></div>` : ''}
                </div>
            </div>
        `;
    }

    // ─── Recent Dispenses ───
    if (dispenses.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Recent Controlled Dispenses</h3>
                ${dispenses.map(d => {
            const ml = parseFloat(d.total_dispensed_ml || 0);
            const mlDisplay = ml % 1 === 0 ? ml.toFixed(0) : parseFloat(ml.toFixed(3));
            const syringes = parseInt(d.syringe_count || 1);
            // 10mL = full vial from TopRX, typical syringe dose is 0.2-1mL
            const isFullVial = ml >= 10;
            const doseInfo = isFullVial
                ? `${mlDisplay}mL · 1 vial`
                : `${mlDisplay}mL · ${syringes} syringe${syringes > 1 ? 's' : ''}`;
            const vialRef = d.vial_label ? ` · ${d.vial_label}` : '';
            return `
                    <div class="med-card">
                        <div>
                            <div class="med-name">${d.dea_drug_name || d.vial_label || 'Testosterone'}</div>
                            <div class="med-dose">${formatDateDisplay(d.dispense_date)} · ${doseInfo}${vialRef}</div>
                        </div>
                        <span class="med-status ${d.signature_status || 'pending'}">${d.signature_status || 'pending'}</span>
                    </div>
                `;
        }).join('')}
            </div>
        `;
    }

    // ─── Recent Peptide Dispenses ───
    if (peptides.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Recent Peptide Dispenses</h3>
                ${peptides.map(p => `
                    <div class="med-card">
                        <div>
                            <div class="med-name">${p.product_name || 'Peptide'}</div>
                            <div class="med-dose">${formatDateDisplay(p.sale_date)} · Qty: ${p.quantity}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ─── Staged Doses ───
    if (staged.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>⏳ Pending Staged Doses</h3>
                ${staged.map(s => `
                    <div class="med-card" style="border-left:3px solid var(--yellow);">
                        <div>
                            <div class="med-name">${s.vial_external_id || 'Staged Dose'}</div>
                            <div class="med-dose">${formatDateDisplay(s.staged_for_date)} · ${s.dose_ml}mL + ${s.waste_ml}mL waste · ${s.syringe_count} syringe(s)</div>
                            ${s.staged_by_name ? `<div class="med-dose">Staged by ${s.staged_by_name}</div>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ─── Payment Issues ───
    if (payIssues.length > 0) {
        html += `
            <div class="patient-360-section" style="border-left:3px solid var(--red);">
                <h3 style="color:var(--red);">⚠️ Payment Issues</h3>
                ${payIssues.map(pi => `
                    <div class="med-card">
                        <div>
                            <div class="med-name">${(pi.issue_type || 'Payment Issue').replace(/_/g, ' ')}</div>
                            <div class="med-dose">${pi.days_overdue ? pi.days_overdue + ' days overdue' : (pi.created_at ? Math.floor((Date.now() - new Date(pi.created_at).getTime()) / 86400000) + ' days ago' : 'Date unknown')} · $${parseFloat(pi.amount_owed || 0).toFixed(2)}</div>
                        </div>
                        <span class="med-status" style="color:var(--red)">${pi.issue_severity || 'medium'}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ─── Lab Orders & Results (loaded async) ───
    html += `
        <div id="patientLabsSection-${patientId}" class="patient-360-section">
            <h3>🧪 Lab Orders & Results</h3>
            <div style="color:var(--text-tertiary); font-size:13px; padding:8px 0;">Loading lab data…</div>
        </div>
    `;

    // ─── Payment Data (loaded async) ───
    html += `
        <div id="patientPaymentSection-${patientId}" class="patient-360-section">
            <h3>💳 Payment History</h3>
            <div style="color:var(--text-tertiary); font-size:13px; padding:8px 0;">Loading payment data…</div>
        </div>
    `;

    // ─── Quick Actions ───
    html += `
        <div class="patient-quick-actions">
            <button class="quick-action-btn" onclick="openStatusChangeModal('${patientId}', '${demo.status_key || 'Active'}')">
                🔄 <span>Change Status</span>
            </button>
            <button class="quick-action-btn" onclick="window.open('https://app.gethealthie.com/users/${demo.healthie_client_id || patientId}', '_blank')">
                🔗 <span>View in Healthie</span>
            </button>
            <button class="quick-action-btn" onclick="openOrderLabModal('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                🧪 <span>Order Lab</span>
            </button>
            <button class="quick-action-btn" onclick="openControlledDispenseModal('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                💉 <span>Dispense Controlled</span>
            </button>
            <button class="quick-action-btn" onclick="openPeptideDispenseModal('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                💊 <span>Dispense Peptide</span>
            </button>
            <button class="quick-action-btn" onclick="openVitalsModal('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                📋 <span>Record Vitals</span>
            </button>
            <button class="quick-action-btn" onclick="startScribeFromProfile('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                🎙️ <span>Start Scribe</span>
            </button>
            <button class="quick-action-btn" onclick="printLabel('${patientId}', '${(demo.full_name || '').replace(/'/g, "\\'")}')">
                🏷️ <span>Print Label</span>
            </button>
        </div>
    `;

    console.log('[renderPatient360] Setting innerHTML, html length:', html.length);
    container.innerHTML = html;
    console.log('[renderPatient360] innerHTML set successfully');

    // Async: load lab orders & results for this patient
    loadPatientLabData(patientId);
    // Async: load payment data from Healthie
    loadPatientPaymentData(patientId);
}

// ─── STATUS CHANGE MODAL ────────────────────────────────────
function openStatusChangeModal(patientId, currentStatus) {
    const statuses = [
        { key: 'Active', label: 'Active' },
        { key: 'active_pending', label: 'Pending' },
        { key: 'hold_service_change', label: 'Hold - Service Change' },
        { key: 'hold_payment_research', label: 'Hold - Payment Research' },
        { key: 'hold_patient_research', label: 'Hold - Patient Research' },
        { key: 'Inactive', label: 'Inactive' },
        { key: 'paused', label: 'Paused' },
        { key: 'lead', label: 'Lead' },
        { key: 'cancelled', label: 'Cancelled' },
        { key: 'churned', label: 'Churned' },
    ];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'statusChangeModal';
    modal.innerHTML = `
        <div class="modal modal-large">
            <h3>Change Patient Status</h3>
            <div class="modal-field">
                <label>New Status</label>
                <select id="newStatusSelect">
                    ${statuses.map(s => `<option value="${s.key}" ${s.key === currentStatus ? 'selected' : ''}>${s.label}</option>`).join('')}
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="document.getElementById('statusChangeModal').remove()">Cancel</button>
                <button class="btn-primary" onclick="submitStatusChange('${patientId}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function submitStatusChange(patientId) {
    const newStatus = document.getElementById('newStatusSelect')?.value;
    if (!newStatus) return;

    try {
        showToast('Updating status…', 'info');
        const result = await apiFetch(`/ops/api/patients/${patientId}/`, {
            method: 'PATCH',
            body: JSON.stringify({ statusKey: newStatus })
        });
        if (result?.data || result?.success !== false) {
            showToast('Status updated!', 'success');
            // Update local patient data
            const p = allPatients.find(p => String(p.id || p.patient_id) === String(patientId));
            if (p) { p.status_key = newStatus; p.status = newStatus; }
            document.getElementById('statusChangeModal')?.remove();
            // Refresh patient detail
            selectPatient(patientId);
        } else {
            showToast(result?.error || 'Status update failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Status update failed', 'error');
    }
}

// ─── EDIT LAB DATES MODAL ───────────────────────────────────
function openEditLabDatesModal(patientId, lastLab, nextLab) {
    // Convert mm-dd-yyyy or any format to YYYY-MM-DD for date input
    const toInputDate = (d) => {
        if (!d) return '';
        try { const dt = new Date(d); return isNaN(dt.getTime()) ? '' : dt.toISOString().split('T')[0]; }
        catch { return ''; }
    };

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'labDatesModal';
    modal.innerHTML = `
        <div class="modal modal-large">
            <h3>Edit Lab Dates</h3>
            <div class="modal-row">
                <div class="modal-field half">
                    <label>Last Lab</label>
                    <input type="date" id="labLastDate" value="${toInputDate(lastLab)}">
                </div>
                <div class="modal-field half">
                    <label>Next Lab</label>
                    <input type="date" id="labNextDate" value="${toInputDate(nextLab)}">
                </div>
            </div>
            <div class="modal-field">
                <label>Lab Status</label>
                <select id="labStatusSelect">
                    <option value="">Not Set</option>
                    <option value="current">Current</option>
                    <option value="due_soon">Due Soon</option>
                    <option value="overdue">Overdue</option>
                    <option value="ordered">Ordered</option>
                    <option value="pending_review">Pending Review</option>
                </select>
            </div>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="document.getElementById('labDatesModal').remove()">Cancel</button>
                <button class="btn-primary" onclick="submitLabDates('${patientId}')">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function submitLabDates(patientId) {
    const lastLab = document.getElementById('labLastDate')?.value || null;
    const nextLab = document.getElementById('labNextDate')?.value || null;
    const labStatus = document.getElementById('labStatusSelect')?.value || null;

    try {
        showToast('Updating lab dates…', 'info');
        const result = await apiFetch(`/ops/api/patients/${patientId}/`, {
            method: 'PATCH',
            body: JSON.stringify({ lastLab, nextLab, labStatus })
        });
        if (result?.data || result?.success !== false) {
            showToast('Lab dates updated!', 'success');
            document.getElementById('labDatesModal')?.remove();
            selectPatient(patientId);
        } else {
            showToast(result?.error || 'Update failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Update failed', 'error');
    }
}

// ─── ORDER LAB MODAL ────────────────────────────────────────
function openOrderLabModal(patientId, patientName) {
    // ─── Access Medical Labs — Matching Dashboard Modal Exactly ───
    const CLINICS = [
        { id: '22937', name: "Tri-City Men's Health" },
        { id: '72152', name: 'NowPrimary.Care' },
    ];

    const STANDARD_PANELS = [
        { code: '9757', name: 'Male - Pre-Required' },
        { code: '9761', name: 'Male - Post' },
        { code: '9756', name: 'Female Pre-Required' },
        { code: '9760', name: 'Female - Post' },
    ];

    const ADD_ONS = [
        { code: '146', name: 'PSA (Total)' },
    ];

    const RESTRICTED_ADD_ONS = [
        { code: 'L509', name: 'Lipid Panel (Requires Approval)' },
        { code: '202', name: 'HBA1C (Requires Approval)' },
    ];

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'orderLabModal';
    modal.innerHTML = `
        <div class="modal modal-large" style="max-height:85vh; overflow-y:auto;">
            <h3>🧪 Create Lab Order</h3>
            <p style="color:var(--text-secondary); font-size:13px; margin-bottom:16px;">Patient: <strong>${patientName}</strong></p>

            <!-- Clinic Selection -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block;">Select Clinic</label>
                <div style="display:flex; gap:8px;">
                    ${CLINICS.map(c => `
                        <label style="flex:1; padding:10px 14px; border:2px solid var(--border-light); border-radius:8px; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:13px; transition:all 0.2s;" class="clinic-radio-label">
                            <input type="radio" name="labClinic" value="${c.id}" ${c.id === '22937' ? 'checked' : ''} onchange="document.querySelectorAll('.clinic-radio-label').forEach(l => l.style.borderColor='var(--border-light)'); this.parentElement.style.borderColor='var(--cyan)';">
                            ${c.name}
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Standard Panels (pick ONE) -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block;">Select Panel (Pick One)</label>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${STANDARD_PANELS.map(p => `
                        <label style="display:flex; align-items:center; gap:8px; padding:10px 14px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-size:13px;">
                            <input type="radio" name="labPanel" value="${p.code}">
                            <span>${p.name}</span>
                            <span style="margin-left:auto; color:var(--text-tertiary); font-size:11px;">${p.code}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Add-Ons (checkboxes) -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block;">Add-Ons</label>
                <div style="display:flex; flex-direction:column; gap:6px;">
                    ${ADD_ONS.map(a => `
                        <label style="display:flex; align-items:center; gap:8px; padding:8px 14px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:8px; cursor:pointer; font-size:13px;">
                            <input type="checkbox" class="lab-addon" value="${a.code}">
                            ${a.name}
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Restricted Add-Ons -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block; color:var(--red);">⚠️ Restricted Add-Ons (Requires Admin Approval)</label>
                <div style="display:flex; flex-direction:column; gap:6px; padding:10px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.2); border-radius:8px;">
                    ${RESTRICTED_ADD_ONS.map(a => `
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:var(--text-secondary);">
                            <input type="checkbox" class="lab-addon-restricted" value="${a.code}">
                            ${a.name}
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Custom Codes -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block;">Custom Codes (Requires Approval)</label>
                <input type="text" id="labCustomCodes" placeholder="Enter codes separated by commas (e.g. TSH, VITD)"
                    style="width:100%; padding:10px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-primary); font-family:inherit; font-size:14px;">
            </div>

            <!-- Notes -->
            <div class="modal-field">
                <label style="font-weight:600; margin-bottom:6px; display:block;">Notes / Instructions</label>
                <textarea id="labOrderNotes" rows="2" placeholder="Optional notes…" style="width:100%; padding:10px; background:var(--bg-secondary); border:1px solid var(--border); border-radius:var(--radius-sm); color:var(--text-primary); font-family:inherit; font-size:14px;"></textarea>
            </div>

            <div class="modal-actions">
                <button class="btn-cancel" onclick="document.getElementById('orderLabModal').remove()">Cancel</button>
                <button class="btn-primary" id="labSubmitBtn" onclick="submitLabOrder('${patientId}')">🧪 Submit Lab Order</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Set initial border highlight on the default checked clinic
    setTimeout(() => {
        const checked = modal.querySelector('input[name="labClinic"]:checked');
        if (checked) checked.parentElement.style.borderColor = 'var(--cyan)';
    }, 50);
}

async function submitLabOrder(patientId) {
    // Get selected panel (radio — pick one)
    const panelRadio = document.querySelector('#orderLabModal input[name="labPanel"]:checked');
    const selectedPanel = panelRadio ? panelRadio.value : '';

    // Get add-ons (checkboxes)
    const addOnChecks = document.querySelectorAll('#orderLabModal .lab-addon:checked');
    const addOns = Array.from(addOnChecks).map(cb => cb.value);

    // Get restricted add-ons
    const restrictedChecks = document.querySelectorAll('#orderLabModal .lab-addon-restricted:checked');
    const restrictedAddOns = Array.from(restrictedChecks).map(cb => cb.value);

    const notes = document.getElementById('labOrderNotes')?.value || '';
    const customCodes = document.getElementById('labCustomCodes')?.value?.trim() || '';

    // Build tests array
    const tests = [];
    if (selectedPanel) tests.push(selectedPanel);
    tests.push(...addOns);
    tests.push(...restrictedAddOns);

    if (tests.length === 0 && !customCodes) {
        showToast('Please select at least one panel or enter custom codes', 'error');
        return;
    }

    // Get selected clinic
    const clinicRadio = document.querySelector('#orderLabModal input[name="labClinic"]:checked');
    const clinicId = clinicRadio ? clinicRadio.value : '22937';

    // Provider based on clinic — matches dashboard exactly
    const provider = clinicId === '22937'
        ? { name: 'Dr. Whitten', npi: '1366037806' }       // Tri-City Men's Health
        : { name: 'Phil Schafer NP', npi: '1790276608' };  // NowPrimary.Care

    // Get patient demographics
    const p360 = patient360Cache[patientId];
    const demo = p360?.demographics || {};
    const patientData = allPatients.find(p => String(p.id || p.patient_id) === String(patientId)) || {};
    const fullName = demo.full_name || patientData.name || patientData.full_name || '';
    const nameParts = fullName.split(' ');
    const firstName = demo.first_name || nameParts[0] || '';
    const lastName = demo.last_name || nameParts.slice(1).join(' ') || '';

    try {
        showToast('Submitting lab order…', 'info');
        const result = await apiFetch('/ops/api/labs/orders/', {
            method: 'POST',
            body: JSON.stringify({
                clinic_id: clinicId,
                patient_id: patientId,
                patient: {
                    first_name: firstName,
                    last_name: lastName,
                    dob: demo.dob || demo.date_of_birth || patientData.dob || patientData.date_of_birth || '',
                    gender: demo.gender || '',
                    address: demo.address || '',
                    city: demo.city || '',
                    state: demo.state || '',
                    zip: demo.zip || '',
                    phone: demo.phone || demo.phone_primary || patientData.phone_primary || '',
                    email: demo.email || patientData.email || '',
                },
                tests: tests,
                custom_codes: customCodes,
                diagnosis_codes: [],
                notes: notes,
                provider_name: provider.name,
                provider_npi: provider.npi,
            })
        });

        if (result?.success) {
            const orderId = result.order_id || result?.data?.order_id;
            showToast('Lab order submitted!', 'success');
            document.getElementById('orderLabModal')?.remove();

            // Open requisition PDF if available
            if (orderId && result.requisition_pdf_available) {
                window.open(`/ops/api/labs/orders/${orderId}/requisition/`, '_blank');
            } else if (orderId && result.status === 'pending_approval') {
                showToast('Order pending admin approval — requisition will be available after approval', 'info');
            }
        } else {
            showToast(result?.error || 'Order failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Lab order failed — ' + (e.message || 'check connection'), 'error');
    }
}

// ─── PEPTIDE DISPENSE MODAL ─────────────────────────────────
async function openPeptideDispenseModal(patientId, patientName) {
    // Load peptide products
    let products = [];
    try {
        const data = await apiFetch('/ops/api/peptides/?action=options');
        products = data?.products || data?.data || data || [];
    } catch { products = []; }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.id = 'peptideDispenseModal';
    modal.innerHTML = `
        <div class="modal modal-large">
            <h3>Dispense Peptide — ${patientName}</h3>
            <div class="modal-field">
                <label>Product</label>
                <select id="peptideProduct">
                    <option value="">Select a product…</option>
                    ${(Array.isArray(products) ? products : []).map(p => `<option value="${p.product_id || p.id}" data-name="${p.name}" data-price="${p.unit_price || p.price || 0}">${p.name} — $${parseFloat(p.unit_price || p.price || 0).toFixed(2)}</option>`).join('')}
                </select>
            </div>
            <div class="modal-row">
                <div class="modal-field half">
                    <label>Quantity (vials)</label>
                    <input type="number" id="peptideQty" value="1" min="1" max="10">
                </div>
                <div class="modal-field half">
                    <label>Total Price</label>
                    <input type="text" id="peptideTotal" readonly value="$0.00" style="background:var(--bg-tertiary);">
                </div>
            </div>
            <div class="modal-field">
                <label>Notes</label>
                <input type="text" id="peptideNotes" placeholder="Optional notes…">
            </div>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="document.getElementById('peptideDispenseModal').remove()">Cancel</button>
                <button class="btn-primary" onclick="submitPeptideDispense('${patientId}', '${patientName.replace(/'/g, "\\'")}')">💊 Dispense & Print Label</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Wire up price calc
    const prodSelect = document.getElementById('peptideProduct');
    const qtyInput = document.getElementById('peptideQty');
    const totalInput = document.getElementById('peptideTotal');
    const updateTotal = () => {
        const opt = prodSelect?.selectedOptions[0];
        const price = parseFloat(opt?.dataset?.price || '0');
        const qty = parseInt(qtyInput?.value || '1');
        totalInput.value = `$${(price * qty).toFixed(2)}`;
    };
    prodSelect?.addEventListener('change', updateTotal);
    qtyInput?.addEventListener('input', updateTotal);
}

async function submitPeptideDispense(patientId, patientName) {
    const prodSelect = document.getElementById('peptideProduct');
    const productId = prodSelect?.value;
    const productName = prodSelect?.selectedOptions[0]?.dataset?.name || '';
    const qty = parseInt(document.getElementById('peptideQty')?.value || '1');
    const notes = document.getElementById('peptideNotes')?.value || '';
    const unitPrice = parseFloat(prodSelect?.selectedOptions[0]?.dataset?.price || '0');

    if (!productId) {
        showToast('Please select a product', 'error');
        return;
    }

    try {
        showToast('Recording dispense…', 'info');
        // FIX(2026-04-06): Include patient_dob so label has DOB
        const _p360 = patient360Cache[patientId];
        const _demo = _p360?.demographics || {};
        const _pat = allPatients.find(p => String(p.id || p.patient_id) === String(patientId)) || {};
        const _dob = _demo.dob || _demo.date_of_birth || _pat.dob || _pat.date_of_birth || '';
        const result = await apiFetch('/ops/api/peptides/dispenses/', {
            method: 'POST',
            body: JSON.stringify({
                patient_name: patientName,
                patient_id: patientId,
                patient_dob: _dob,
                product_id: productId,
                quantity: qty,
                unit_price: unitPrice,
                total_price: unitPrice * qty,
                notes
            })
        });
        if (result?.success || result?.data) {
            showToast('Peptide dispensed! Label generated.', 'success');
            document.getElementById('peptideDispenseModal')?.remove();
            // FIX(2026-04-06): Use printPeptideLabel with dispense_id for full DB-backed label
            const dispenseId = result?.dispense_id || result?.sale_id || result?.data?.dispense_id || result?.data?.sale_id;
            if (dispenseId) {
                printPeptideLabel(dispenseId);
            } else {
                // Fallback: generic label with type forced to peptide
                printLabel(patientId, patientName, productName, { type: 'peptide' });
            }
            // Refresh patient detail
            selectPatient(patientId);
        } else {
            showToast(result?.error || 'Dispense failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('Dispense failed', 'error');
    }
}

// ─── PRINT LABEL ────────────────────────────────────────────
// FIX(2026-03-26): Matches dashboard TransactionsTable.tsx and DispenseHistory.tsx exactly
function printLabel(patientId, patientName, medication, options = {}) {
    const med = medication || 'Testosterone Cypionate';
    const type = options.type || (med.toLowerCase().includes('testosterone') ? 'testosterone' : 'peptide');

    // Match dashboard: testosterone always shows "Testosterone Cypionate 200mg/ml"
    let labelMed = med;
    if (type === 'testosterone' && !med.includes('200mg') && !med.includes('200 mg')) {
        labelMed = 'Testosterone Cypionate 200mg/ml';
    }

    // Look up patient DOB from cached data
    const p360 = patient360Cache[patientId];
    const demo = p360?.demographics || {};
    const patientData = allPatients.find(p => String(p.id || p.patient_id) === String(patientId)) || {};
    const dob = options.dob || demo.dob || demo.date_of_birth || patientData.dob || patientData.date_of_birth || '';
    const formattedDob = dob ? formatDateDisplay(dob) : '';
    const expDate = options.expDate ? formatDateDisplay(options.expDate) : '';

    // Match dashboard: dosage for testosterone uses regimen, peptides use label_directions
    let dosage = options.dosage || '';
    if (!dosage && type === 'testosterone') {
        const regimen = demo.regimen || patientData.regimen || '';
        dosage = regimen || (options.amountDispensed ? options.amountDispensed + 'mL SUBQ Weekly' : 'Use as directed');
    }
    // For peptides, dosage is auto-generated by the PDF generator from medication name if empty

    const params = new URLSearchParams({
        type,
        patientName: patientName || '',
        patientDob: formattedDob,
        medication: labelMed,
        dosage: dosage,
        provider: 'Dr. Aaron Whitten NMD - DEA: MW6359574',
        dateDispensed: new Date().toLocaleDateString('en-US', { timeZone: CLINIC_TIMEZONE }),
        lotNumber: options.lotNumber || '',
        volume: options.volume || '',
        vialNumber: options.vialNumber || '',
        amountDispensed: options.amountDispensed || '',
        expDate: expDate,
    });
    window.open(`/ops/api/labels/generate/?${params.toString()}`, '_blank');
}

// ─── CEO DASHBOARD ──────────────────────────────────────────
function renderCEODashboard(container) {
    const dd = dashboardData || {};
    const stagedDoses = getStagedDoses();
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    // Pull revenue figures from dashboard data
    const revenue = dd.revenue || {};
    const todayRev = revenue.today || 0;
    const weekRev = revenue.week || 0;
    const monthRev = revenue.month || 0;

    // Patient type breakdown
    const patientsByType = dd.patientsByType || {};
    const totalActive = dd.totalActivePatients || allPatients.length || 0;

    // Payment issues
    const paymentIssues = dd.paymentIssues || [];

    container.innerHTML = `
        <div style="padding: 0 4px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
                <div>
                    <h1 style="font-size:24px; margin:0; color:var(--text-primary);">CEO Dashboard</h1>
                    <p style="font-size:13px; color:var(--text-tertiary); margin:4px 0 0;">${today}</p>
                </div>
                <button onclick="loadAllData()" style="padding:8px 16px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:13px; cursor:pointer;">↻ Refresh</button>
            </div>

            <!-- Revenue Cards — Phil only -->
            ${currentUser?.email === 'admin@nowoptimal.com' ? `
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:20px;">
                <div style="background:linear-gradient(135deg, rgba(34,211,238,0.15), rgba(6,182,212,0.05)); border:1px solid rgba(34,211,238,0.2); border-radius:12px; padding:20px;">
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">Today's Revenue</div>
                    <div style="font-size:28px; font-weight:700; color:#22d3ee;">$${Number(todayRev).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(168,85,247,0.15), rgba(139,92,246,0.05)); border:1px solid rgba(168,85,247,0.2); border-radius:12px; padding:20px;">
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">This Week</div>
                    <div style="font-size:28px; font-weight:700; color:#a855f7;">$${Number(weekRev).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style="background:linear-gradient(135deg, rgba(34,197,94,0.15), rgba(22,163,74,0.05)); border:1px solid rgba(34,197,94,0.2); border-radius:12px; padding:20px;">
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.08em; margin-bottom:8px;">This Month</div>
                    <div style="font-size:28px; font-weight:700; color:#22c55e;">$${Number(monthRev).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
            </div>
            ` : ''}

            <!-- Operational KPIs -->
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px; margin-bottom:20px;">
                <div class="metric-card" style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:32px; font-weight:700; color:var(--text-primary);">${totalActive}</div>
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em;">Active Patients</div>
                </div>
                <div class="metric-card" style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:32px; font-weight:700; color:var(--text-primary);">${healthieAppointments.length}</div>
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em;">Today's Appts</div>
                </div>
                <div class="metric-card" style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:32px; font-weight:700; color:${inventoryAlerts.length > 0 ? '#f59e0b' : 'var(--text-primary)'};">${inventoryAlerts.length}</div>
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em;">Inventory Alerts</div>
                </div>
                <div class="metric-card" style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:16px; text-align:center;">
                    <div style="font-size:32px; font-weight:700; color:${paymentIssues.length > 0 ? '#ef4444' : 'var(--text-primary)'};">${paymentIssues.length}</div>
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em;">Payment Issues</div>
                </div>
            </div>

            <!-- Today's Schedule Summary -->
            <div style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:20px; margin-bottom:20px;">
                <h3 style="font-size:16px; margin:0 0 16px; color:var(--text-primary);">📋 Today's Schedule</h3>
                ${healthieAppointments.length === 0 ? '<p style="color:var(--text-tertiary); font-size:14px;">No appointments scheduled today</p>' :
            healthieAppointments.slice(0, 8).map(appt => `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-light);">
                            <div style="display:flex; align-items:center; gap:10px;">
                                <div style="width:36px; height:36px; border-radius:8px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:13px; color:var(--text-primary);">
                                    ${getInitials(appt.full_name || appt.patient_name)}
                                </div>
                                <div>
                                    <div style="font-size:14px; font-weight:500; color:var(--text-primary);">${appt.full_name || appt.patient_name || 'Unknown'}</div>
                                    <div style="font-size:12px; color:var(--text-tertiary);">${appt.appointment_type || appt.type || 'Appointment'} · ${appt.time || ''}</div>
                                </div>
                            </div>
                            <span style="font-size:11px; padding:3px 8px; border-radius:6px; background:${(appt.appointment_status || appt.status) === 'Confirmed' ? 'rgba(34,197,94,0.15)' : 'rgba(251,191,36,0.15)'}; color:${(appt.appointment_status || appt.status) === 'Confirmed' ? '#22c55e' : '#fbbf24'};">${appt.appointment_status || appt.status || 'pending'}</span>
                        </div>
                    `).join('')}
            </div>

            <!-- Staged Doses Overview -->
            <div style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:20px; margin-bottom:20px;">
                <h3 style="font-size:16px; margin:0 0 12px; color:var(--text-primary);">💉 Staged Doses (${stagedDoses.length})</h3>
                ${stagedDoses.length === 0 ? '<p style="color:var(--text-tertiary); font-size:14px;">No doses staged</p>' :
            stagedDoses.slice(0, 6).map(s => `
                        <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                            <div style="font-size:14px; color:var(--text-primary);">${s.patient_name || 'Unknown'}</div>
                            <div style="font-size:12px; color:var(--text-tertiary);">${s.dose_ml || '?'}mL · ${s.medication || 'Testosterone'}</div>
                        </div>
                    `).join('')}
            </div>

            <!-- Inventory Alerts -->
            ${inventoryAlerts.length > 0 ? `
            <div style="background:var(--card); border:1px solid rgba(239,68,68,0.2); border-radius:12px; padding:20px; margin-bottom:20px;">
                <h3 style="font-size:16px; margin:0 0 12px; color:#ef4444;">⚠️ Inventory Alerts</h3>
                ${inventoryAlerts.slice(0, 5).map(a => `
                    <div style="padding:8px 0; border-bottom:1px solid var(--border-light); font-size:14px; color:var(--text-secondary);">
                        ${a.item_name || a.name || 'Unknown Item'} — <span style="color:#ef4444;">${a.message || 'Low stock'}</span>
                    </div>
                `).join('')}
            </div>` : ''}

            <!-- Payment Issues -->
            ${paymentIssues.length > 0 ? `
            <div style="background:var(--card); border:1px solid rgba(251,191,36,0.2); border-radius:12px; padding:20px; margin-bottom:20px;">
                <h3 style="font-size:16px; margin:0 0 12px; color:#fbbf24;">💳 Payment Issues (${paymentIssues.length})</h3>
                ${paymentIssues.slice(0, 5).map(pi => `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-light);">
                        <div style="font-size:14px; color:var(--text-primary);">${pi.patient_name || 'Unknown'}</div>
                        <div style="font-size:13px; color:#f87171;">$${parseFloat(pi.amount || 0).toFixed(2)} · ${pi.reason || 'declined'}</div>
                    </div>
                `).join('')}
            </div>` : ''}

            <!-- Recent Receipts Section -->
            <div style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:20px; margin-bottom:20px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                    <h3 style="font-size:16px; margin:0; color:var(--text-primary);">🧾 Recent Payment Receipts</h3>
                    <button onclick="loadRecentReceipts()" style="padding:6px 12px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px; color:var(--text-secondary); font-size:12px; cursor:pointer;">View All</button>
                </div>
                <div id="recentReceiptsContainer" style="min-height:60px;">
                    <p style="color:var(--text-tertiary); font-size:14px;">Loading receipts...</p>
                </div>
            </div>
        </div>
    `;

    // Load recent receipts on CEO dashboard load
    loadRecentReceipts();
}

// ─── LOAD RECENT RECEIPTS FOR CEO DASHBOARD ────────────────
async function loadRecentReceipts() {
    const container = document.getElementById('recentReceiptsContainer');
    if (!container) return;

    try {
        // FIX(2026-04-02): Was missing /ops base path and using wrong auth method
        const response = await fetch('/ops/api/receipts?limit=10', {
            method: 'GET',
            credentials: 'include',
        });

        if (!response.ok) {
            throw new Error(`Failed to load receipts: ${response.status}`);
        }

        const data = await response.json();
        const receipts = data.transactions || [];

        if (receipts.length === 0) {
            container.innerHTML = '<p style="color:var(--text-tertiary); font-size:14px;">No receipts available</p>';
            return;
        }

        // Render payment list
        container.innerHTML = receipts.map(receipt => {
            var dt = '';
            try { dt = new Date(receipt.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) {}
            var statusColor = receipt.status === 'succeeded' ? '#4ade80' : receipt.status === 'failed' ? '#ef4444' : '#94a3b8';
            return `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-light);">
                <div style="flex:1; min-width:0;">
                    <div style="font-size:14px; color:var(--text-primary); font-weight:500;">${receipt.patientName || 'Unknown Patient'}</div>
                    <div style="font-size:12px; color:var(--text-tertiary); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        ${receipt.description || 'Payment'} · ${dt}
                    </div>
                </div>
                <div style="text-align:right; flex-shrink:0; margin-left:8px;">
                    <div style="font-size:14px; font-weight:600; color:var(--text-primary);">
                        $${(receipt.amount || 0).toFixed(2)}
                    </div>
                    <div style="font-size:10px; color:${statusColor};">${receipt.status || 'pending'}</div>
                    ${receipt.receiptNumber ? `<div style="font-size:10px; color:var(--text-tertiary);">${receipt.receiptNumber}</div>` : ''}
                </div>
                ${receipt.healthieDocumentId && receipt.healthieClientId ? `
                    <button onclick="window.open('https://secure.gethealthie.com/client_portal/clients/${receipt.healthieClientId}/documents/${receipt.healthieDocumentId}', '_blank')"
                        style="margin-left:8px; padding:6px 10px; background:rgba(0,212,255,0.15); color:var(--cyan); border:1px solid rgba(0,212,255,0.3); border-radius:6px; font-size:11px; cursor:pointer; flex-shrink:0;">
                        View
                    </button>
                ` : ''}
            </div>`;
        }).join('');

    } catch (error) {
        console.error('Error loading receipts:', error);
        container.innerHTML = `<p style="color:#ef4444; font-size:14px;">Error loading receipts: ${error.message}</p>`;
    }
}

// ─── PROVIDER SCHEDULE TAB ──────────────────────────────────
var scheduleProviderFilter = 'all';
// scheduleAllData declared at top with other state variables
var scheduleViewMode = 'day';
var scheduleSelectedDate = new Date();
var scheduleAppointmentTypes = [];
var _moveAppt = null; // appointment being moved: { id, name, time, date, provider_id }

function startMoveAppt(apptId, name, time, date, providerId) {
    _moveAppt = { id: apptId, name: name, time: time, date: date, provider_id: providerId };
    var contentEl = document.getElementById('scheduleContent');
    if (contentEl) renderScheduleContent(contentEl);
}

function cancelMoveAppt() {
    _moveAppt = null;
    var contentEl = document.getElementById('scheduleContent');
    if (contentEl) renderScheduleContent(contentEl);
}

async function executeMoveAppt(newDate, newTime, newProviderId) {
    if (!_moveAppt) return;
    var datetime = newDate + 'T' + newTime + ':00-07:00';
    var newProvName = newProviderId === '12093125' ? 'Dr. Whitten' : 'Phil Schafer';
    var newLoc = newProviderId === '12093125'
        ? 'NowMensHealth.Care - 215 N. McCormick, Prescott, AZ 86301'
        : 'NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 1';
    var timeLabel = formatSlotTime(parseInt(newTime.split(':')[0]), parseInt(newTime.split(':')[1]));

    if (!confirm('Reschedule ' + _moveAppt.name + '\\n\\nFrom: ' + _moveAppt.time + ' on ' + _moveAppt.date + '\\nTo: ' + timeLabel + ' on ' + newDate + ' with ' + newProvName + '\\n\\nProceed?')) return;

    try {
        var data = await apiFetch('/ops/api/ipad/appointment-status/', {
            method: 'PUT',
            body: JSON.stringify({
                appointment_id: _moveAppt.id,
                datetime: datetime,
                provider_id: newProviderId,
                location: newLoc
            })
        });
        showToast(_moveAppt.name + ' rescheduled to ' + timeLabel, 'success');
        _moveAppt = null;
        await loadScheduleForRange(true);
    } catch (e) {
        showToast('Failed to reschedule: ' + (e.message || 'Error'), 'error');
    }
}

function getWeekRange(date) {
    var d = new Date(date);
    var day = d.getDay();
    var start = new Date(d);
    start.setDate(d.getDate() - day);
    var end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: start, end: end };
}

function getMonthRange(date) {
    var d = new Date(date);
    var start = new Date(d.getFullYear(), d.getMonth(), 1);
    var end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { start: start, end: end };
}

function getPhoenixDateStr(date) {
    return date.toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE });
}

async function renderScheduleView(container) {
    // Reset to today if the date is somehow invalid
    if (isNaN(scheduleSelectedDate.getTime())) scheduleSelectedDate = new Date();

    console.log('[Schedule] renderScheduleView - mode:', scheduleViewMode);
    container.innerHTML = '<div style="padding: 0 4px;">' +
        // Header row
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">' +
        '<div><h1 style="font-size:24px; margin:0; color:var(--text-primary);">Schedule</h1>' +
        '<p id="scheduleDateLabel" style="font-size:13px; color:var(--text-tertiary); margin:4px 0 0;"></p></div>' +
        '<div style="display:flex; gap:6px;">' +
        '<button onclick="showAddToScheduleModal()" style="padding:8px 14px; background:rgba(0,212,255,0.15); border:1px solid rgba(0,212,255,0.3); border-radius:8px; color:var(--cyan); font-size:13px; font-weight:600; cursor:pointer;">+ Add Patient</button>' +
        '<button onclick="loadScheduleForRange(true)" style="padding:8px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:13px; cursor:pointer;">↻</button>' +
        '</div></div>' +
        // View mode toggle + date nav
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">' +
        '<div style="display:flex; gap:4px;">' +
        '<button onclick="setScheduleViewMode(\'day\')" id="schedModeDay" style="padding:5px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid var(--border-light); background:var(--surface); color:var(--text-secondary);">Day</button>' +
        '<button onclick="setScheduleViewMode(\'week\')" id="schedModeWeek" style="padding:5px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid var(--border-light); background:var(--surface); color:var(--text-secondary);">Week</button>' +
        '<button onclick="setScheduleViewMode(\'month\')" id="schedModeMonth" style="padding:5px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid var(--border-light); background:var(--surface); color:var(--text-secondary);">Month</button>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:8px;">' +
        '<button onclick="scheduleNavPrev()" style="padding:4px 10px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px; color:var(--text-secondary); font-size:14px; cursor:pointer;">‹</button>' +
        '<button onclick="scheduleNavToday()" style="padding:4px 10px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px; color:var(--cyan); font-size:12px; font-weight:600; cursor:pointer;">Today</button>' +
        '<button onclick="scheduleNavNext()" style="padding:4px 10px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px; color:var(--text-secondary); font-size:14px; cursor:pointer;">›</button>' +
        '</div></div>' +
        // Provider tabs
        '<div id="scheduleProviderTabs" style="display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap;"></div>' +
        // Content
        '<div id="scheduleContent"><div class="loading-spinner" style="margin:40px auto;"></div></div>' +
        '</div>';

    await new Promise(resolve => setTimeout(resolve, 50));
    updateScheduleViewModeButtons();
    updateScheduleDateLabel();

    // Load previsit tasks from server
    await loadPrevisitTasks();

    // Auto-refresh previsit tasks every 15 seconds
    if (window._previsitPollTimer) clearInterval(window._previsitPollTimer);
    window._previsitPollTimer = setInterval(async function() {
        if (currentTab !== 'schedule') { clearInterval(window._previsitPollTimer); return; }
        await loadPrevisitTasks();
        var contentEl = document.getElementById('scheduleContent');
        if (contentEl && scheduleAllData.length > 0) {
            renderScheduleContent(contentEl);
        }
    }, 15000);

    var verifyEl = document.getElementById('scheduleContent');
    if (verifyEl) {
        await loadScheduleForRange();
    } else {
        await new Promise(resolve => setTimeout(resolve, 200));
        await loadScheduleForRange();
    }
}

function updateScheduleViewModeButtons() {
    ['Day', 'Week', 'Month'].forEach(function(m) {
        var btn = document.getElementById('schedMode' + m);
        if (!btn) return;
        var active = scheduleViewMode === m.toLowerCase();
        btn.style.background = active ? 'rgba(0,212,255,0.15)' : 'var(--surface)';
        btn.style.borderColor = active ? 'var(--cyan)' : 'var(--border-light)';
        btn.style.color = active ? 'var(--cyan)' : 'var(--text-secondary)';
    });
}

function updateScheduleDateLabel() {
    var el = document.getElementById('scheduleDateLabel');
    if (!el) return;
    var d = scheduleSelectedDate;
    if (scheduleViewMode === 'day') {
        el.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } else if (scheduleViewMode === 'week') {
        var r = getWeekRange(d);
        el.textContent = r.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' + r.end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
        el.textContent = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
}

function setScheduleViewMode(mode) {
    scheduleViewMode = mode;
    updateScheduleViewModeButtons();
    updateScheduleDateLabel();
    loadScheduleForRange(true);
}

function scheduleNavPrev() {
    if (scheduleViewMode === 'day') scheduleSelectedDate.setDate(scheduleSelectedDate.getDate() - 1);
    else if (scheduleViewMode === 'week') scheduleSelectedDate.setDate(scheduleSelectedDate.getDate() - 7);
    else scheduleSelectedDate.setMonth(scheduleSelectedDate.getMonth() - 1);
    updateScheduleDateLabel();
    loadScheduleForRange(true);
}

function scheduleNavNext() {
    if (scheduleViewMode === 'day') scheduleSelectedDate.setDate(scheduleSelectedDate.getDate() + 1);
    else if (scheduleViewMode === 'week') scheduleSelectedDate.setDate(scheduleSelectedDate.getDate() + 7);
    else scheduleSelectedDate.setMonth(scheduleSelectedDate.getMonth() + 1);
    updateScheduleDateLabel();
    loadScheduleForRange(true);
}

function scheduleNavToday() {
    scheduleSelectedDate = new Date();
    updateScheduleDateLabel();
    loadScheduleForRange(true);
}

async function loadScheduleForRange(forceRefresh) {
    var contentEl = document.getElementById('scheduleContent');
    if (!contentEl) return;
    contentEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';

    var startDate, endDate;
    if (scheduleViewMode === 'day') {
        startDate = getPhoenixDateStr(scheduleSelectedDate);
        endDate = startDate;
    } else if (scheduleViewMode === 'week') {
        var wr = getWeekRange(scheduleSelectedDate);
        startDate = getPhoenixDateStr(wr.start);
        endDate = getPhoenixDateStr(wr.end);
    } else {
        var mr = getMonthRange(scheduleSelectedDate);
        startDate = getPhoenixDateStr(mr.start);
        endDate = getPhoenixDateStr(mr.end);
    }

    try {
        var url = '/ops/api/ipad/schedule/?start_date=' + startDate + '&end_date=' + endDate;
        var resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        scheduleAllData = data.patients || [];
        // Also update global for Today tab if viewing today
        var todayStr = getPhoenixDateStr(new Date());
        if (startDate === todayStr && endDate === todayStr && scheduleAllData.length > 0) {
            healthieAppointments = scheduleAllData.map(function(p) {
                return { id: p.appointment_id || '', patient_id: p.patient_id || p.healthie_id || '', patient_name: p.full_name || '', appointment_type: p.appointment_type || '', status: p.appointment_status || 'scheduled', appointment_status: p.appointment_status || 'scheduled', time: p.time || '', provider: p.provider || '' };
            });
        }
        var provMap = new Map();
        scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
        renderProviderTabs([...provMap.values()]);
        renderScheduleContent(contentEl);
    } catch (e) {
        console.error('[Schedule] Load error:', e);
        contentEl.innerHTML = '<div class="empty-state-card"><h3>Could not load schedule</h3><p>' + (e.message || 'Error') + '</p><button onclick="loadScheduleForRange(true)" class="btn-primary" style="margin-top:8px;">Try Again</button></div>';
    }
}

function renderScheduleContent(contentEl) {
    // FIX(2026-03-31): When a single provider is selected, use the list view
    // which includes the pre-visit checklist. Grid view for "All" providers.
    if (scheduleViewMode === 'day' && scheduleProviderFilter !== 'all') {
        renderScheduleList(contentEl);
    } else if (scheduleViewMode === 'day') {
        renderScheduleDayGrid(contentEl);
    } else if (scheduleViewMode === 'week') {
        renderScheduleWeekView(contentEl);
    } else {
        renderScheduleMonthView(contentEl);
    }
}

function renderScheduleWeekView(contentEl) {
    var filtered = scheduleProviderFilter === 'all' ? scheduleAllData : scheduleAllData.filter(function(p) { return (p.provider || 'Unknown') === scheduleProviderFilter; });
    var wr = getWeekRange(scheduleSelectedDate);

    // Group by date
    var byDate = {};
    for (var i = 0; i < 7; i++) {
        var d = new Date(wr.start);
        d.setDate(wr.start.getDate() + i);
        byDate[getPhoenixDateStr(d)] = [];
    }
    filtered.forEach(function(p) {
        // Healthie dates: "2026-03-25 09:15:00 -0700" — extract YYYY-MM-DD
        var apptDate = '';
        if (p.date) {
            var match = p.date.match(/^(\d{4}-\d{2}-\d{2})/);
            apptDate = match ? match[1] : '';
            if (!apptDate) {
                try { apptDate = parseHealthieDate(p.date).toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE }); } catch(e) {}
            }
        }
        if (byDate[apptDate] !== undefined) {
            byDate[apptDate].push(p);
        }
    });

    var todayStr = getPhoenixDateStr(new Date());
    var html = '<div style="display:flex; flex-direction:column; gap:8px;">';
    Object.keys(byDate).sort().forEach(function(dateStr) {
        var dayAppts = byDate[dateStr];
        var d = new Date(dateStr + 'T12:00:00');
        var dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        var isToday = dateStr === todayStr;
        html += '<div style="background:var(--card); border:1px solid ' + (isToday ? 'rgba(0,212,255,0.3)' : 'var(--border-light)') + '; border-radius:10px; padding:12px;' + (isToday ? ' border-left:3px solid var(--cyan);' : '') + '">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">';
        html += '<div style="font-size:13px; font-weight:600; color:' + (isToday ? 'var(--cyan)' : 'var(--text-primary)') + ';">' + dayLabel + (isToday ? ' (Today)' : '') + '</div>';
        html += '<span style="font-size:11px; color:var(--text-tertiary);">' + dayAppts.length + ' appt' + (dayAppts.length !== 1 ? 's' : '') + '</span>';
        html += '</div>';
        if (dayAppts.length === 0) {
            html += '<div style="font-size:12px; color:var(--text-tertiary); padding:4px 0;">No appointments</div>';
        } else {
            dayAppts.sort(function(a, b) { return parseHealthieDate(a.date).getTime() - parseHealthieDate(b.date).getTime(); });
            dayAppts.forEach(function(p) {
                var st = getApptStatusStyle(p.appointment_status || 'Pending');
                var pid = p.patient_id || p.healthie_id || '';
                html += '<div style="display:flex; align-items:center; justify-content:space-between; padding:6px 0; border-top:1px solid rgba(255,255,255,0.04);">';
                html += '<div style="display:flex; align-items:center; gap:8px; min-width:0; flex:1;">';
                html += '<span style="font-size:12px; font-weight:500; color:var(--text-primary); min-width:52px;">' + (p.time || 'TBD') + '</span>';
                html += '<span style="font-size:13px; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (p.full_name || 'Unknown') + '</span>';
                html += '<span style="font-size:11px; color:var(--text-tertiary);">' + (p.appointment_type || '') + '</span>';
                html += '</div>';
                html += '<div style="display:flex; align-items:center; gap:4px; flex-shrink:0;">';
                if (pid) html += '<button onclick="event.stopPropagation(); openChartForPatient(\'' + pid + '\', \'' + (p.full_name || '').replace(/'/g, '') + '\')" style="padding:3px 8px; border-radius:5px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); font-size:10px; cursor:pointer;">📋</button>';
                html += '<span style="font-size:10px; padding:2px 6px; border-radius:4px; background:' + st.bg + '; color:' + st.color + ';">' + (p.appointment_status || 'Pending') + '</span>';
                html += '</div></div>';
            });
        }
        html += '</div>';
    });
    html += '</div>';
    contentEl.innerHTML = html;
}

function renderScheduleMonthView(contentEl) {
    var filtered = scheduleProviderFilter === 'all' ? scheduleAllData : scheduleAllData.filter(function(p) { return (p.provider || 'Unknown') === scheduleProviderFilter; });
    var mr = getMonthRange(scheduleSelectedDate);
    var todayStr = getPhoenixDateStr(new Date());

    // Group by date
    var byDate = {};
    filtered.forEach(function(p) {
        var apptDate = '';
        if (p.date) {
            var match = p.date.match(/^(\d{4}-\d{2}-\d{2})/);
            apptDate = match ? match[1] : '';
            if (!apptDate) {
                try { apptDate = parseHealthieDate(p.date).toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE }); } catch(e) {}
            }
        }
        if (!byDate[apptDate]) byDate[apptDate] = [];
        byDate[apptDate].push(p);
    });

    // Build calendar grid
    var firstDay = new Date(mr.start);
    var startDayOfWeek = firstDay.getDay();
    var daysInMonth = mr.end.getDate();

    var html = '<div style="margin-bottom:6px;">';
    // Day headers
    html += '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px; margin-bottom:4px;">';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function(d) {
        html += '<div style="text-align:center; font-size:10px; color:var(--text-tertiary); font-weight:600; padding:4px 0;">' + d + '</div>';
    });
    html += '</div>';

    // Calendar cells
    html += '<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:2px;">';
    // Empty cells for start
    for (var e = 0; e < startDayOfWeek; e++) {
        html += '<div style="min-height:60px;"></div>';
    }
    for (var day = 1; day <= daysInMonth; day++) {
        var cellDate = new Date(scheduleSelectedDate.getFullYear(), scheduleSelectedDate.getMonth(), day);
        var cellStr = getPhoenixDateStr(cellDate);
        var dayAppts = byDate[cellStr] || [];
        var isToday = cellStr === todayStr;
        var cellBg = isToday ? 'rgba(0,212,255,0.1)' : dayAppts.length > 0 ? 'var(--card)' : 'transparent';
        var cellBorder = isToday ? 'rgba(0,212,255,0.4)' : dayAppts.length > 0 ? 'var(--border-light)' : 'rgba(255,255,255,0.03)';

        html += '<div onclick="scheduleSelectedDate=new Date(' + cellDate.getFullYear() + ',' + cellDate.getMonth() + ',' + cellDate.getDate() + '); setScheduleViewMode(\'day\')" style="min-height:60px; background:' + cellBg + '; border:1px solid ' + cellBorder + '; border-radius:6px; padding:4px; cursor:pointer; overflow:hidden;" title="' + dayAppts.length + ' appointments">';
        html += '<div style="font-size:11px; font-weight:' + (isToday ? '700' : '500') + '; color:' + (isToday ? 'var(--cyan)' : 'var(--text-primary)') + '; margin-bottom:2px;">' + day + '</div>';
        if (dayAppts.length > 0) {
            html += '<div style="font-size:9px; color:var(--cyan); font-weight:600;">' + dayAppts.length + ' appt' + (dayAppts.length > 1 ? 's' : '') + '</div>';
            // Show first 2 names
            dayAppts.slice(0, 2).forEach(function(p) {
                html += '<div style="font-size:8px; color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (p.time || '') + ' ' + (p.full_name || '').split(' ')[0] + '</div>';
            });
            if (dayAppts.length > 2) html += '<div style="font-size:8px; color:var(--text-tertiary);">+' + (dayAppts.length - 2) + ' more</div>';
        }
        html += '</div>';
    }
    html += '</div></div>';

    // Summary below calendar
    html += '<div style="margin-top:10px; padding:12px; background:var(--card); border:1px solid var(--border-light); border-radius:10px;">';
    html += '<div style="font-size:13px; font-weight:600; color:var(--text-primary); margin-bottom:6px;">' + filtered.length + ' total appointments this month</div>';
    // Group by type
    var typeCount = {};
    filtered.forEach(function(p) { var t = p.appointment_type || 'Other'; typeCount[t] = (typeCount[t] || 0) + 1; });
    Object.keys(typeCount).sort().forEach(function(t) {
        html += '<div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;"><span style="color:var(--text-secondary);">' + t + '</span><span style="color:var(--text-tertiary);">' + typeCount[t] + '</span></div>';
    });
    html += '</div>';

    contentEl.innerHTML = html;
}

// ─── ADD PATIENT TO SCHEDULE MODAL ──────────────────────────

async function showAddToScheduleModal(prefillDate, prefillTime, prefillProviderId) {
    var existing = document.getElementById('addScheduleModal');
    if (existing) existing.remove();

    // Load appointment types if not cached
    if (scheduleAppointmentTypes.length === 0) {
        try {
            var data = await apiFetch('/ops/api/ipad/schedule/', {
                method: 'POST',
                body: JSON.stringify({ action: 'get_appointment_types' })
            });
            scheduleAppointmentTypes = data.appointment_types || [];
        } catch (e) {
            console.error('[Schedule] Failed to load appointment types:', e);
        }
    }

    // Brand-grouped appointment type dropdown with color coding
    var BRAND_TYPES = {
        'mens_health': {
            label: "Men's Health",
            color: '#DC2626',
            ids: ['504725','504732','504734','504735','504736','505645','511049']
        },
        'primary_care': {
            label: 'Primary Care',
            color: '#060F6A',
            ids: ['504726','504716','504718','504719','504741','504743','505646','505648','505649','504759','504760','511050']
        },
        'longevity': {
            label: 'Longevity',
            color: '#6B8F71',
            ids: ['504727','504728','504729','504730','504731','504717','505647']
        },
        'mental_health': {
            label: 'Mental Health',
            color: '#7C3AED',
            ids: []
        },
        'other': {
            label: 'Other',
            color: '#888888',
            ids: []
        }
    };

    // Build a lookup: type ID → brand key
    var typeBrandMap = {};
    Object.keys(BRAND_TYPES).forEach(function(bk) {
        BRAND_TYPES[bk].ids.forEach(function(tid) { typeBrandMap[tid] = bk; });
    });

    // Group appointment types by brand
    var grouped = {};
    Object.keys(BRAND_TYPES).forEach(function(bk) { grouped[bk] = []; });
    scheduleAppointmentTypes.forEach(function(t) {
        var bk = typeBrandMap[t.id] || 'other';
        if (!grouped[bk]) grouped[bk] = [];
        grouped[bk].push(t);
    });

    // Build optgroup HTML with brand colors
    var typeOptions = '';
    ['mens_health', 'primary_care', 'longevity', 'mental_health', 'other'].forEach(function(bk) {
        var brand = BRAND_TYPES[bk];
        var types = grouped[bk] || [];
        if (types.length === 0) return;
        typeOptions += '<optgroup label="━━ ' + brand.label + ' ━━" style="color:' + brand.color + '; font-weight:700; font-size:13px;">';
        types.forEach(function(t) {
            typeOptions += '<option value="' + t.id + '" data-length="' + (t.length || 30) + '" style="color:var(--text-primary); font-weight:400; padding-left:8px;">  ' + sanitize(t.name) + ' (' + (t.length || 30) + 'min)</option>';
        });
        typeOptions += '</optgroup>';
    });

    var providerOptions = '<option value="12088269"' + (prefillProviderId === '12088269' ? ' selected' : '') + '>Phil Schafer NP</option><option value="12093125"' + (prefillProviderId === '12093125' ? ' selected' : '') + '>Dr. Aaron Whitten</option>';
    // Default location based on provider
    var defaultLocation = prefillProviderId === '12093125'
        ? 'NowMensHealth.Care - 215 N. McCormick, Prescott, AZ 86301'
        : 'NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 1';

    document.body.insertAdjacentHTML('beforeend', `
        <div id="addScheduleModal" class="modal-overlay visible" style="display:flex; z-index:10001;">
            <div class="modal" style="max-width:440px; padding:24px; max-height:90vh; overflow-y:auto;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:18px; color:var(--text-primary);">Add to Schedule</h3>
                    <button onclick="document.getElementById('addScheduleModal').remove()" style="background:none; border:none; color:var(--text-tertiary); font-size:20px; cursor:pointer;">✕</button>
                </div>

                <!-- Patient Search -->
                <div style="margin-bottom:14px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Patient *</label>
                    <input id="addSchedPatientSearch" type="text" placeholder="Search by name..." oninput="searchPatientsForSchedule(this.value)" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                    <div id="addSchedPatientResults" style="max-height:120px; overflow-y:auto; margin-top:4px;"></div>
                </div>
                <input id="addSchedPatientId" type="hidden" value="">
                <div id="addSchedSelectedPatient" style="display:none; padding:8px 12px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); border-radius:8px; margin-bottom:14px; font-size:13px; color:var(--cyan);"></div>

                <!-- Provider -->
                <div style="margin-bottom:14px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Provider *</label>
                    <select id="addSchedProvider" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                        ${providerOptions}
                    </select>
                </div>

                <!-- Appointment Type -->
                <div style="margin-bottom:14px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Appointment Type *</label>
                    <select id="addSchedType" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                        <option value="">Select type...</option>
                        ${typeOptions}
                    </select>
                </div>

                <!-- Date & Time -->
                <div style="display:flex; gap:10px; margin-bottom:14px;">
                    <div style="flex:1;">
                        <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Date *</label>
                        <input id="addSchedDate" type="date" value="${prefillDate || getPhoenixDateStr(scheduleSelectedDate)}" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                    </div>
                    <div style="flex:1;">
                        <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Time *</label>
                        <input id="addSchedTime" type="time" value="${prefillTime || '09:00'}" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                    </div>
                </div>

                <!-- Contact Type -->
                <div style="margin-bottom:16px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Contact Type</label>
                    <div style="display:flex; gap:8px;">
                        <button onclick="document.getElementById('addSchedContactType').value='In Person'; this.style.background='rgba(0,212,255,0.15)'; this.style.borderColor='var(--cyan)'; this.style.color='var(--cyan)'; this.nextElementSibling.style.background='var(--surface)'; this.nextElementSibling.style.borderColor='var(--border-light)'; this.nextElementSibling.style.color='var(--text-secondary)';" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--cyan); background:rgba(0,212,255,0.15); color:var(--cyan); font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;">In-Person</button>
                        <button onclick="document.getElementById('addSchedContactType').value='Secure Videochat'; this.style.background='rgba(0,212,255,0.15)'; this.style.borderColor='var(--cyan)'; this.style.color='var(--cyan)'; this.previousElementSibling.style.background='var(--surface)'; this.previousElementSibling.style.borderColor='var(--border-light)'; this.previousElementSibling.style.color='var(--text-secondary)';" style="flex:1; padding:8px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-secondary); font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;">Telehealth</button>
                    </div>
                    <input id="addSchedContactType" type="hidden" value="In Person">
                </div>

                <!-- Location -->
                <div style="margin-bottom:16px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Location</label>
                    <select id="addSchedLocation" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                        <option value="NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 1" ${defaultLocation.includes('NowPrimary') ? 'selected' : ''}>NowPrimary - Room 1</option>
                        <option value="NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 2">NowPrimary - Room 2</option>
                        <option value="NowMensHealth.Care - 215 N. McCormick, Prescott, AZ 86301" ${defaultLocation.includes('NowMensHealth') ? 'selected' : ''}>NowMensHealth</option>
                        <option value="NowLongevity.Care - 404 S. Montezuma, Prescott, AZ 86303">NowLongevity</option>
                        <option value="In Person">In Person (other)</option>
                        <option value="Healthie Video Call">Video Call</option>
                        <option value="Phone Call">Phone Call</option>
                    </select>
                </div>

                <button onclick="submitAddToSchedule()" id="addSchedBtn" style="width:100%; padding:12px; background:linear-gradient(135deg, #0891b2, #22d3ee); border:none; border-radius:8px; color:#0a0f1a; font-weight:700; font-size:14px; cursor:pointer; font-family:inherit;">Add to Schedule</button>
            </div>
        </div>
    `);
    // Pre-select provider and location if passed from split view slot click
    var provSel = document.getElementById('addSchedProvider');
    var locSel = document.getElementById('addSchedLocation');
    if (provSel && prefillProviderId) {
        provSel.value = prefillProviderId;
        if (locSel) {
            if (prefillProviderId === '12093125') locSel.value = 'NowMensHealth.Care - 215 N. McCormick, Prescott, AZ 86301';
            else locSel.value = 'NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 1';
        }
    }
    // Auto-switch location when provider changes
    if (provSel && locSel) {
        provSel.addEventListener('change', function() {
            if (this.value === '12093125') locSel.value = 'NowMensHealth.Care - 215 N. McCormick, Prescott, AZ 86301';
            else locSel.value = 'NowPrimary.Care - 404 S. Montezuma, Prescott, AZ 86303 - Room 1';
        });
    }
}

var _schedSearchTimeout = null;
function searchPatientsForSchedule(searchQuery) {
    clearTimeout(_schedSearchTimeout);
    if (!searchQuery || searchQuery.length < 2) { document.getElementById('addSchedPatientResults').innerHTML = ''; return; }
    _schedSearchTimeout = setTimeout(async function() {
        try {
            // Search Healthie users directly so all patients are findable
            var data = await apiFetch('/ops/api/ipad/messages/', {
                method: 'POST',
                body: JSON.stringify({ action: 'search_patients', search: searchQuery })
            });
            var resultsEl = document.getElementById('addSchedPatientResults');
            if (!resultsEl) return;
            var pts = data.patients || [];
            if (pts.length === 0) {
                resultsEl.innerHTML = '<div style="padding:8px; font-size:12px; color:var(--text-tertiary);">No patients found</div>';
                return;
            }
            resultsEl.innerHTML = pts.map(function(p) {
                return '<div onclick="selectPatientForSchedule(\'' + (p.healthie_id || '') + '\', \'' + sanitize(p.full_name).replace(/\'/g, '') + '\')" style="padding:8px 10px; cursor:pointer; border-radius:6px; font-size:13px; color:var(--text-primary);" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'transparent\'">' + sanitize(p.full_name) + (p.email ? ' <span style="color:var(--text-tertiary); font-size:10px;">' + sanitize(p.email) + '</span>' : '') + '</div>';
            }).join('');
        } catch (e) { console.error('[Schedule] Patient search error:', e); }
    }, 300);
}

function selectPatientForSchedule(healthieId, name) {
    if (!healthieId) { showToast('Patient has no Healthie ID — cannot schedule', 'error'); return; }
    document.getElementById('addSchedPatientId').value = healthieId;
    document.getElementById('addSchedSelectedPatient').style.display = 'block';
    document.getElementById('addSchedSelectedPatient').textContent = '✓ ' + name;
    document.getElementById('addSchedPatientResults').innerHTML = '';
    document.getElementById('addSchedPatientSearch').value = name;
}

async function submitAddToSchedule() {
    var patientId = document.getElementById('addSchedPatientId').value;
    var providerId = document.getElementById('addSchedProvider').value;
    var typeId = document.getElementById('addSchedType').value;
    var dateVal = document.getElementById('addSchedDate').value;
    var timeVal = document.getElementById('addSchedTime').value;
    var contactType = document.getElementById('addSchedContactType').value;
    var location = document.getElementById('addSchedLocation')?.value || '';

    if (!patientId) { showToast('Please select a patient', 'error'); return; }
    if (!typeId) { showToast('Please select appointment type', 'error'); return; }
    if (!dateVal || !timeVal) { showToast('Please select date and time', 'error'); return; }

    // Construct datetime in Phoenix timezone (MST = UTC-7)
    var datetime = dateVal + 'T' + timeVal + ':00-07:00';

    var btn = document.getElementById('addSchedBtn');
    btn.textContent = 'Scheduling...'; btn.disabled = true;

    try {
        var data = await apiFetch('/ops/api/ipad/schedule/', {
            method: 'POST',
            body: JSON.stringify({
                action: 'create',
                patient_id: patientId,
                provider_id: providerId,
                appointment_type_id: typeId,
                datetime: datetime,
                contact_type: contactType,
                location: location
            })
        });
        document.getElementById('addScheduleModal')?.remove();
        showToast('Appointment created successfully!', 'success');
        // Refresh schedule
        await loadScheduleForRange(true);
    } catch (e) {
        console.error('[Schedule] Create error:', e);
        showToast('Failed: ' + (e.message || 'Error'), 'error');
        btn.textContent = 'Add to Schedule'; btn.disabled = false;
    }
}

async function loadScheduleData(forceRefresh) {
    console.log('[Schedule] loadScheduleData called, forceRefresh:', forceRefresh);
    var contentEl = document.getElementById('scheduleContent');
    if (!contentEl) {
        console.warn('[Schedule] scheduleContent element not found!');
        return;
    }

    // ✅ IMPORTANT: If user has a provider filter, ALWAYS fetch fresh data (don't use cache)
    // The Today tab doesn't filter by provider, so cached data would show all providers
    var hasProviderFilter = currentUser?.is_provider && currentUser?.healthie_provider_id;

    // Use already-loaded data from Today tab ONLY if no provider filter is active
    if (!forceRefresh && !hasProviderFilter && healthieAppointments.length > 0) {
        console.log('[Schedule] Using cached data from Today tab:', healthieAppointments.length, 'appointments (no provider filter)');
        scheduleAllData = healthieAppointments.map(function(a) {
            return {
                appointment_id: a.id || a.appointment_id || '',
                healthie_id: a.patient_id || a.healthie_id || '',
                patient_id: a.patient_id || null,
                full_name: a.patient_name || a.full_name || 'Unknown',
                appointment_type: a.appointment_type || 'Appointment',
                provider: a.provider || '',
                provider_id: a.provider_id || '',
                appointment_status: a.appointment_status || a.status || 'Scheduled',
                time: a.time || '',
                date: a.date || '',
                length: a.length || null,
                location: a.location || '',
            };
        });
        var provMap = new Map();
        scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
        renderProviderTabs([...provMap.values()]);
        renderScheduleContent(contentEl);
        return;
    }

    console.log('[Schedule] Fetching fresh data from API...');
    contentEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
    try {
        var controller = new AbortController();
        var tid = setTimeout(function() {
            console.warn('[Schedule] Aborting request after 25s timeout');
            controller.abort();
        }, 25000);

        var startTime = Date.now();

        // Fetch ALL provider schedules — provider tabs handle filtering on the client side
        var url = '/ops/api/ipad/schedule/';
        console.log('[Schedule] Fetching all providers (filter via tabs)');

        var resp = await fetch(url, { credentials: 'include', signal: controller.signal });
        var elapsed = Date.now() - startTime;
        console.log('[Schedule] API response received in', elapsed, 'ms, status:', resp.status);

        clearTimeout(tid);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);

        var data = await resp.json();
        console.log('[Schedule] API data parsed:', data);

        scheduleAllData = data.patients || [];
        console.log('[Schedule] scheduleAllData set to', scheduleAllData.length, 'appointments');

        // Also update the global so Today tab stays in sync
        if (scheduleAllData.length > 0) {
            healthieAppointments = scheduleAllData.map(function(p) {
                return {
                    id: p.appointment_id || '',
                    patient_id: p.patient_id || p.healthie_id || '',
                    patient_name: p.full_name || '',
                    appointment_type: p.appointment_type || '',
                    status: p.appointment_status || 'scheduled',
                    appointment_status: p.appointment_status || 'scheduled',
                    time: p.time || '',
                    provider: p.provider || '',
                };
            });
        }

        if (scheduleAllData.length === 0) {
            console.log('[Schedule] No appointments - rendering empty state');
            renderProviderTabs([]);
            contentEl.innerHTML = '<div class="empty-state-card"><div class="empty-state-icon">📅</div><h3>No Appointments Today</h3><p>No patients are scheduled for today.</p></div>';
            return;
        }
        console.log('[Schedule] Rendering', scheduleAllData.length, 'appointments');
        var provMap = new Map();
        scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
        renderProviderTabs([...provMap.values()]);
        // FIX(2026-03-31): Was calling renderScheduleList (legacy); use renderScheduleContent
        // to dispatch to the correct day/week/month view mode
        renderScheduleContent(contentEl);
        console.log('[Schedule] Render complete');
    } catch (e) {
        console.error('[Schedule] Error:', e);
        if (e.message === 'AUTH_EXPIRED') throw e;
        if (e.name === 'AbortError') {
            contentEl.innerHTML = '<div class="empty-state-card"><h3>Request Timeout</h3><p>The schedule took too long to load. <button onclick="loadScheduleData(true)" style="margin-top:8px; padding:6px 12px; border-radius:6px; background:var(--cyan); border:none; color:#000; cursor:pointer;">Try Again</button></p></div>';
        } else {
            contentEl.innerHTML = '<div class="empty-state-card"><h3>Could not load schedule</h3><p>' + (e.message || 'Network error') + ' <button onclick="loadScheduleData(true)" style="margin-top:8px; padding:6px 12px; border-radius:6px; background:var(--cyan); border:none; color:#000; cursor:pointer;">Try Again</button></p></div>';
        }
    }
}

function renderProviderTabs(providers) {
    var tabsEl = document.getElementById('scheduleProviderTabs');
    if (!tabsEl) return;
    var tabs = [{ name: 'All', id: 'all' }].concat(providers.map(function(p) { return { name: p.name, id: p.name }; }));
    var html = '';
    tabs.forEach(function(t) {
        var isActive = scheduleProviderFilter === t.id;
        var count = t.id === 'all' ? scheduleAllData.length : scheduleAllData.filter(function(p) { return (p.provider || 'Unknown') === t.id; }).length;
        html += '<button onclick="filterScheduleByProvider(this.dataset.prov)" data-prov="' + t.id + '" style="padding:6px 14px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; border:1px solid ' + (isActive ? 'var(--cyan)' : 'var(--border-light)') + '; background:' + (isActive ? 'rgba(0,212,255,0.15)' : 'var(--surface)') + '; color:' + (isActive ? 'var(--cyan)' : 'var(--text-secondary)') + ';">' + t.name + ' (' + count + ')</button>';
    });
    tabsEl.innerHTML = html;
}

function filterScheduleByProvider(providerName) {
    scheduleProviderFilter = providerName;
    var provMap = new Map();
    scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
    renderProviderTabs([...provMap.values()]);
    var contentEl = document.getElementById('scheduleContent');
    // FIX(2026-03-31): Was calling renderScheduleList (legacy flat list) instead of
    // renderScheduleContent which dispatches to the correct day/week/month view
    if (contentEl) renderScheduleContent(contentEl);
}

// ==================== PRE-VISIT CHECKLIST (Server-synced) ====================
const PREVISIT_TASKS = [
    { key: 'forms', label: '📝 Forms Signed' },
    { key: 'vitals', label: '🩺 Vitals Done' },
    { key: 'meds', label: '💊 Meds/Allergies Verified' },
    { key: 'demo', label: '👤 Demographics/Group Verified' },
    { key: 'app', label: '📱 App Installed/Mentioned' },
];

// Server-synced task state — shared across all iPads
let previsitServerData = {}; // { appointmentId: { taskKey: { completed_by, completed_at } } }

async function loadPrevisitTasks() {
    try {
        var resp = await apiFetch('/ops/api/ipad/previsit-tasks/');
        if (resp?.success) {
            previsitServerData = resp.tasks || {};
        }
    } catch (e) {
        console.warn('[Previsit] Load failed:', e);
    }
}

function getPrevisitState(apptId) {
    var serverTasks = previsitServerData[apptId] || [];
    var state = {};
    serverTasks.forEach(function(t) { state[t.key] = t; });
    return state;
}

async function togglePrevisitTask(apptId, taskKey) {
    var state = getPrevisitState(apptId);
    var isCompleted = !state[taskKey];
    var who = currentUser?.display_name || currentUser?.email?.split('@')[0] || 'Staff';

    // Optimistic update
    if (isCompleted) {
        if (!previsitServerData[apptId]) previsitServerData[apptId] = [];
        previsitServerData[apptId].push({ key: taskKey, completed_by: who, completed_at: new Date().toISOString() });
    } else {
        previsitServerData[apptId] = (previsitServerData[apptId] || []).filter(function(t) { return t.key !== taskKey; });
    }

    // Re-render — use renderScheduleContent to stay in current view mode
    var contentEl = document.getElementById('scheduleContent');
    if (contentEl) renderScheduleContent(contentEl);
    var provMap = new Map();
    scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
    renderProviderTabs([...provMap.values()]);

    // Persist to server
    try {
        await apiFetch('/ops/api/ipad/previsit-tasks/', {
            method: 'POST',
            body: JSON.stringify({ appointment_id: apptId, task_key: taskKey, completed: isCompleted, completed_by: who })
        });
    } catch (e) {
        console.error('[Previsit] Save failed:', e);
        showToast('Task save failed — try again', 'error');
    }
}

function isPrevisitComplete(apptId) {
    var state = getPrevisitState(apptId);
    return PREVISIT_TASKS.every(function(t) { return state[t.key]; });
}

function previsitCompletedCount(apptId) {
    var state = getPrevisitState(apptId);
    return PREVISIT_TASKS.filter(function(t) { return state[t.key]; }).length;
}

function getApptStatusStyle(st) {
    switch(st) {
        case 'Confirmed': return { color: '#22c55e', bg: 'rgba(34,197,94,0.15)' };
        case 'Scheduled': return { color: '#22c55e', bg: 'rgba(34,197,94,0.15)' };
        case 'Checked In': return { color: '#22d3ee', bg: 'rgba(34,211,238,0.15)' };
        case 'In Progress': return { color: '#a855f7', bg: 'rgba(168,85,247,0.15)' };
        case 'Completed': return { color: '#10b981', bg: 'rgba(16,185,129,0.15)' };
        case 'Cancelled': return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
        case 'No Show': return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)' };
        default: return { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' };
    }
}

function renderScheduleDayGrid(contentEl) {
    var allFiltered = scheduleProviderFilter === 'all' ? scheduleAllData : scheduleAllData.filter(function(p) { return (p.provider || 'Unknown') === scheduleProviderFilter; });
    var isSplit = scheduleProviderFilter === 'all';

    // Providers for split columns
    var PROVIDERS = [
        { id: '12088269', name: 'Phil Schafer NP', short: 'Phil', color: getProviderColor('schafer') },
        { id: '12093125', name: 'Aaron Whitten', short: 'Dr. Whitten', color: getProviderColor('whitten') }
    ];

    // Clinic hours: 7 AM to 6 PM in 30-min slots
    var START_HOUR = 7, END_HOUR = 18;
    var slots = [];
    for (var h = START_HOUR; h < END_HOUR; h++) {
        slots.push({ hour: h, min: 0, label: formatSlotTime(h, 0) });
        slots.push({ hour: h, min: 30, label: formatSlotTime(h, 30) });
    }

    // Build slot maps per provider
    function buildSlotMap(appts) {
        var map = {};
        appts.forEach(function(p) {
            if (!p.date) return;
            var d = parseHealthieDate(p.date);
            if (isNaN(d.getTime())) return;
            var key = padTwo(d.getHours()) + ':' + padTwo(d.getMinutes() < 30 ? 0 : 30);
            if (!map[key]) map[key] = [];
            map[key].push(p);
        });
        return map;
    }

    var now = new Date();
    var nowHr = now.getHours(), nowMn = now.getMinutes();
    var dateStr = getPhoenixDateStr(scheduleSelectedDate);
    var isToday = dateStr === getPhoenixDateStr(new Date());

    // Summary stats
    var checkedIn = allFiltered.filter(function(p) { return p.appointment_status === 'Checked In'; }).length;
    var html = '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; flex-wrap:wrap;">';
    html += '<span style="font-size:14px; color:var(--text-secondary);">' + allFiltered.length + ' appointments</span>';
    if (checkedIn > 0) html += '<span style="font-size:11px; padding:3px 10px; border-radius:6px; background:rgba(34,211,238,0.1); color:#22d3ee;">' + checkedIn + ' checked in</span>';
    // Legend — Brand colors + indicators
    html += '<div style="margin-left:auto; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="width:8px; height:8px; border-radius:2px; background:#DC2626;"></span><span style="color:#DC2626;">MensHealth</span></span>';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="width:8px; height:8px; border-radius:2px; background:#060F6A;"></span><span style="color:#6875d5;">Primary</span></span>';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="width:8px; height:8px; border-radius:2px; background:#6B8F71;"></span><span style="color:#6B8F71;">Longevity</span></span>';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="width:8px; height:8px; border-radius:2px; background:#7C3AED;"></span><span style="color:#7C3AED;">Mental</span></span>';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="width:8px; height:8px; border-radius:2px; background:#3b82f6;"></span><span style="color:#93c5fd;">Telehealth</span></span>';
    html += '<span style="display:flex; align-items:center; gap:3px; font-size:10px;"><span style="padding:1px 4px; border-radius:3px; background:rgba(251,191,36,0.2); color:#fbbf24; font-size:8px; font-weight:700;">NEW</span></span>';
    html += '</div></div>';

    // Move mode banner
    if (_moveAppt) {
        html += '<div style="padding:10px 16px; margin-bottom:10px; background:rgba(251,191,36,0.15); border:1px solid rgba(251,191,36,0.4); border-radius:10px; display:flex; align-items:center; justify-content:space-between;">';
        html += '<div style="font-size:13px; color:#fbbf24; font-weight:600;">Moving: ' + sanitize(_moveAppt.name) + ' <span style="font-weight:400; color:var(--text-tertiary);">(' + _moveAppt.time + ')</span> — tap a slot to place, or navigate days with arrows</div>';
        html += '<button onclick="cancelMoveAppt()" style="padding:6px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:6px; color:var(--text-secondary); font-size:12px; cursor:pointer;">Cancel</button>';
        html += '</div>';
    }

    if (isSplit) {
        // ─── SPLIT VIEW: two provider columns ───
        var provData = PROVIDERS.map(function(prov) {
            var appts = allFiltered.filter(function(p) { return (p.provider_id || '') === prov.id; });
            return { prov: prov, appts: appts, slotMap: buildSlotMap(appts) };
        });

        html += '<div style="display:flex; gap:0; border:1px solid var(--border-light); border-radius:10px; overflow:hidden;">';
        // Time column
        html += '<div style="flex-shrink:0; width:55px;">';
        html += '<div style="height:36px; border-bottom:1px solid var(--border-light); border-right:1px solid var(--border-light);"></div>';
        slots.forEach(function(slot) {
            var isHalf = slot.min === 30;
            var isCur = isToday && slot.hour === nowHr && ((slot.min === 0 && nowMn < 30) || (slot.min === 30 && nowMn >= 30));
            html += '<div style="height:56px; display:flex; align-items:center; padding:0 6px; font-size:11px; font-weight:' + (isHalf ? '400' : '600') + '; color:' + (isCur ? 'var(--cyan)' : 'var(--text-tertiary)') + '; border-bottom:1px solid ' + (isHalf ? 'rgba(255,255,255,0.03)' : 'var(--border-light)') + '; border-right:1px solid var(--border-light);' + (isCur ? ' background:rgba(0,212,255,0.06);' : '') + '">';
            html += isHalf ? '' : slot.label;
            html += '</div>';
        });
        html += '</div>';

        // Provider columns
        provData.forEach(function(pd, colIdx) {
            var isLast = colIdx === provData.length - 1;
            html += '<div style="flex:1; min-width:0;' + (!isLast ? ' border-right:2px solid var(--border-light);' : '') + '">';
            // Column header
            html += '<div style="height:36px; display:flex; align-items:center; justify-content:center; gap:6px; border-bottom:1px solid var(--border-light); background:' + pd.prov.color.bg + ';">';
            html += '<span style="width:8px; height:8px; border-radius:2px; background:' + pd.prov.color.border + ';"></span>';
            html += '<span style="font-size:13px; font-weight:700; color:' + pd.prov.color.text + ';">' + pd.prov.short + '</span>';
            html += '<span style="font-size:10px; color:var(--text-tertiary);">(' + pd.appts.length + ')</span>';
            html += '</div>';

            slots.forEach(function(slot) {
                var key = padTwo(slot.hour) + ':' + padTwo(slot.min);
                var appts = pd.slotMap[key] || [];
                var isHalf = slot.min === 30;
                var isCur = isToday && slot.hour === nowHr && ((slot.min === 0 && nowMn < 30) || (slot.min === 30 && nowMn >= 30));
                var isPast = isToday && (slot.hour < nowHr || (slot.hour === nowHr && slot.min + 30 <= nowMn));
                var timeKey = padTwo(slot.hour) + ':' + padTwo(slot.min);

                html += '<div style="min-height:56px; padding:3px 5px; border-bottom:1px solid ' + (isHalf ? 'rgba(255,255,255,0.03)' : 'var(--border-light)') + '; display:flex; flex-direction:column; justify-content:center; gap:2px;' + (isCur ? ' background:rgba(0,212,255,0.04);' : '') + (isPast ? ' opacity:0.45;' : '') + '">';

                if (appts.length > 0) {
                    appts.forEach(function(p) {
                        var st = p.appointment_status || 'Scheduled';
                        var sty = getApptStatusStyle(st);
                        var pid = p.patient_id || p.healthie_id || '';
                        var apptId = p.appointment_id || '';
                        var isFinal = st === 'Completed' || st === 'No Show' || st === 'Cancelled';
                        var lc = getLocationColor(p.location, p.appointment_type);
                        var isNew = isNewPatientAppt(p.appointment_type);
                        var isTele = isTelehealthAppt(p.location, p.contact_type);

                        html += '<div style="display:flex; align-items:center; gap:4px; padding:3px 6px; border-radius:6px; background:' + (isFinal ? 'var(--surface)' : (isTele ? 'rgba(59,130,246,0.08)' : lc.bg)) + '; border-left:3px solid ' + (isFinal ? 'rgba(255,255,255,0.1)' : (isTele ? '#3b82f6' : lc.border)) + '; min-width:0; cursor:default;' + (isFinal ? ' opacity:0.6;' : '') + '">';
                        // Name + badges
                        html += '<div style="flex:1; min-width:0; overflow:hidden;">';
                        html += '<div style="display:flex; align-items:center; gap:4px;">';
                        if (isNew) html += '<span style="font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; background:rgba(251,191,36,0.2); color:#fbbf24; flex-shrink:0;">NEW</span>';
                        if (isTele) html += '<span style="font-size:8px; flex-shrink:0;">📹</span>';
                        html += '<span style="font-size:12px; font-weight:600; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + sanitize(p.full_name || '?') + '</span>';
                        html += '</div>';
                        html += '<div style="font-size:9px; color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + (p.time || '') + ' · ' + abbreviateType(p.appointment_type) + '</div>';
                        html += '</div>';
                        // Action buttons
                        html += '<div style="display:flex; gap:3px; flex-shrink:0;">';
                        if (!isFinal && apptId && !_moveAppt) html += '<button onclick="event.stopPropagation(); startMoveAppt(\x27' + apptId + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27, \x27' + (p.time || '') + '\x27, \x27' + dateStr + '\x27, \x27' + (p.provider_id || '') + '\x27)" style="padding:2px 5px; border-radius:4px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25); color:#fbbf24; font-size:9px; cursor:pointer;" title="Move/reschedule">↔</button>';
                        if (pid) html += '<button onclick="event.stopPropagation(); openChartForPatient(\x27' + pid + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27)" style="padding:2px 5px; border-radius:4px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); font-size:9px; cursor:pointer;">📋</button>';
                        if (isTele && !isFinal && apptId) html += '<button onclick="event.stopPropagation(); startProviderVideoCall(\x27' + apptId + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27, \x27' + pid + '\x27)" style="padding:2px 6px; border-radius:4px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#60a5fa; font-size:9px; font-weight:600; cursor:pointer;" title="Start video call">📹 Video</button>';
                        if (!isFinal && apptId) {
                            html += '<div style="position:relative; display:inline-block;">';
                            html += '<span onclick="event.stopPropagation(); toggleStatusMenu(\x27sm_' + apptId + '\x27)" style="font-size:9px; padding:2px 6px; border-radius:4px; background:' + sty.bg + '; color:' + sty.color + '; font-weight:600; cursor:pointer;">' + abbreviateStatus(st) + ' ▾</span>';
                            html += '<div id="sm_' + apptId + '" style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:var(--card); border:1px solid var(--border-light); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.3); z-index:100; min-width:120px;">';
                            [{ l:'✅ Check In',v:'Checked In',s:st==='Scheduled'||st==='Confirmed'},
                             { l:'🟣 In Progress',v:'In Progress',s:st==='Checked In'},
                             { l:'✅ Done',v:'Completed',s:st==='In Progress'||st==='Checked In'},
                             { l:'🚫 No Show',v:'No Show',s:st!=='No Show'&&st!=='Completed'},
                             { l:'❌ Cancel',v:'Cancelled',s:st!=='Cancelled'&&st!=='Completed'&&st!=='No Show'}
                            ].forEach(function(o){if(!o.s)return;html+='<div onclick="event.stopPropagation(); updateApptStatus(\x27'+apptId+'\x27, \x27'+o.v+'\x27)" style="padding:8px 12px; font-size:11px; cursor:pointer; border-bottom:1px solid var(--border);">'+o.l+'</div>';});
                            html += '</div></div>';
                        } else {
                            html += '<span style="font-size:9px; padding:2px 6px; border-radius:4px; background:' + sty.bg + '; color:' + sty.color + ';">' + abbreviateStatus(st) + '</span>';
                        }
                        html += '</div></div>';
                    });
                } else {
                    // Empty — clickable
                    if (_moveAppt) {
                        html += '<div onclick="executeMoveAppt(\'' + dateStr + '\', \'' + timeKey + '\', \'' + pd.prov.id + '\')" style="display:flex; align-items:center; justify-content:center; height:100%; cursor:pointer; border-radius:6px; background:rgba(251,191,36,0.06);" onmouseover="this.style.background=\'rgba(251,191,36,0.15)\'" onmouseout="this.style.background=\'rgba(251,191,36,0.06)\'">';
                        html += '<span style="font-size:10px; color:#fbbf24; font-weight:600;">Place here</span>';
                        html += '</div>';
                    } else {
                        html += '<div onclick="showAddToScheduleModal(\'' + dateStr + '\', \'' + timeKey + '\', \'' + pd.prov.id + '\')" style="display:flex; align-items:center; justify-content:center; height:100%; cursor:pointer; border-radius:6px;" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'transparent\'">';
                        html += '<span style="font-size:10px; color:var(--text-tertiary); opacity:0.5;">+</span>';
                        html += '</div>';
                    }
                }
                html += '</div>';
            });
            html += '</div>';
        });
        html += '</div>';
    } else {
        // ─── SINGLE PROVIDER VIEW ───
        var slotMap = buildSlotMap(allFiltered);
        html += '<div style="border:1px solid var(--border-light); border-radius:10px; overflow:hidden;">';
        slots.forEach(function(slot) {
            var key = padTwo(slot.hour) + ':' + padTwo(slot.min);
            var appts = slotMap[key] || [];
            var isHalf = slot.min === 30;
            var isCur = isToday && slot.hour === nowHr && ((slot.min === 0 && nowMn < 30) || (slot.min === 30 && nowMn >= 30));
            var isPast = isToday && (slot.hour < nowHr || (slot.hour === nowHr && slot.min + 30 <= nowMn));
            var timeKey = padTwo(slot.hour) + ':' + padTwo(slot.min);

            html += '<div style="display:flex; border-bottom:1px solid ' + (isHalf ? 'rgba(255,255,255,0.03)' : 'var(--border-light)') + ';' + (isCur ? ' background:rgba(0,212,255,0.06);' : '') + (isPast ? ' opacity:0.5;' : '') + '">';
            html += '<div style="width:60px; padding:6px 8px; font-size:11px; font-weight:' + (isHalf ? '400' : '600') + '; color:' + (isCur ? 'var(--cyan)' : 'var(--text-tertiary)') + '; border-right:1px solid var(--border-light); display:flex; align-items:center;">' + (isHalf ? '' : slot.label) + '</div>';
            html += '<div style="flex:1; min-height:44px; padding:3px 6px; display:flex; flex-direction:column; gap:2px; justify-content:center;">';
            if (appts.length > 0) {
                appts.forEach(function(p) {
                    var st = p.appointment_status || 'Scheduled';
                    var sty = getApptStatusStyle(st);
                    var pid = p.patient_id || p.healthie_id || '';
                    var apptId = p.appointment_id || '';
                    var isFinal = st === 'Completed' || st === 'No Show' || st === 'Cancelled';
                    var pc = getProviderColor(p.provider);
                    var lc = getLocationColor(p.location, p.appointment_type);
                    var isNew = isNewPatientAppt(p.appointment_type);
                    var isTele = isTelehealthAppt(p.location, p.contact_type);

                    html += '<div style="display:flex; align-items:center; gap:6px; padding:5px 8px; border-radius:8px; background:' + (isFinal ? 'var(--surface)' : (isTele ? 'rgba(59,130,246,0.08)' : lc.bg)) + '; border:1px solid ' + (isFinal ? 'rgba(255,255,255,0.06)' : (isTele ? 'rgba(59,130,246,0.3)' : lc.border)) + '; border-left:3px solid ' + (isFinal ? 'rgba(255,255,255,0.1)' : (isTele ? '#3b82f6' : pc.border)) + ';">';
                    html += '<div style="flex:1; min-width:0;">';
                    html += '<div style="display:flex; align-items:center; gap:4px;">';
                    if (isNew) html += '<span style="font-size:8px; font-weight:700; padding:1px 4px; border-radius:3px; background:rgba(251,191,36,0.2); color:#fbbf24;">NEW</span>';
                    if (isTele) html += '<span style="font-size:9px;">📹</span>';
                    html += '<span style="font-size:13px; font-weight:600; color:var(--text-primary);">' + sanitize(p.full_name || '?') + '</span>';
                    html += '</div>';
                    html += '<div style="font-size:10px; color:var(--text-tertiary);">' + (p.time || '') + ' · ' + (p.appointment_type || '') + '</div>';
                    html += '</div>';
                    html += '<div style="display:flex; gap:4px; flex-shrink:0;">';
                    if (pid) html += '<button onclick="event.stopPropagation(); openChartForPatient(\x27' + pid + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27)" style="padding:3px 6px; border-radius:5px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); font-size:10px; cursor:pointer;">📋</button>';
                    html += '<span style="font-size:10px; padding:3px 8px; border-radius:5px; background:' + sty.bg + '; color:' + sty.color + '; font-weight:600;">' + st + '</span>';
                    html += '</div></div>';
                });
                html += '<div onclick="showAddToScheduleModal(\'' + dateStr + '\', \'' + timeKey + '\')" style="font-size:10px; color:var(--text-tertiary); cursor:pointer; padding:1px 8px; text-align:right;" onmouseover="this.style.color=\'var(--cyan)\'" onmouseout="this.style.color=\'var(--text-tertiary)\'">+ book</div>';
            } else {
                if (_moveAppt) {
                    html += '<div onclick="executeMoveAppt(\'' + dateStr + '\', \'' + timeKey + '\', \'' + (scheduleProviderFilter !== 'all' ? (scheduleAllData[0]?.provider_id || '') : '') + '\')" style="display:flex; align-items:center; justify-content:center; height:100%; cursor:pointer; border-radius:6px; min-height:30px; background:rgba(251,191,36,0.06);" onmouseover="this.style.background=\'rgba(251,191,36,0.15)\'" onmouseout="this.style.background=\'rgba(251,191,36,0.06)\'"><span style="font-size:11px; color:#fbbf24; font-weight:600;">Place here</span></div>';
                } else {
                    html += '<div onclick="showAddToScheduleModal(\'' + dateStr + '\', \'' + timeKey + '\')" style="display:flex; align-items:center; justify-content:center; height:100%; cursor:pointer; border-radius:6px; min-height:30px;" onmouseover="this.style.background=\'rgba(0,212,255,0.04)\'" onmouseout="this.style.background=\'transparent\'"><span style="font-size:11px; color:var(--text-tertiary);">+ Book</span></div>';
                }
            }
            html += '</div></div>';
        });
        html += '</div>';
    }

    contentEl.innerHTML = html;
}

// Location color coding for schedule
function getLocationColor(location, appointmentType) {
    var loc = (location || '').toLowerCase();
    var apptType = (appointmentType || '').toLowerCase();

    // Brand detection: location first, then appointment type name
    // Men's Health (Red) — McCormick location or MH-specific types
    if (loc.includes('nowmenshealth') || loc.includes('mccormick') ||
        apptType.includes('male hormone') || apptType.includes('nmh ') ||
        apptType.includes('trt') || apptType.includes('mens health'))
        return { bg: 'rgba(220,38,38,0.08)', border: 'rgba(220,38,38,0.35)', brandLabel: "Men's Health" };

    // Primary Care (Navy/Green) — Montezuma location or PC-specific types
    if (loc.includes('nowprimary') || loc.includes('montezuma') ||
        apptType.includes('primary care') || apptType.includes('sick visit') ||
        apptType.includes('sports physical') || apptType.includes('medical clearance') ||
        apptType.includes('tb test') || apptType.includes('allergy') ||
        apptType.includes('female hormone') || apptType.includes('injection') ||
        apptType.includes('membership'))
        return { bg: 'rgba(6,15,106,0.08)', border: 'rgba(6,15,106,0.35)', brandLabel: 'Primary Care' };

    // Longevity (Sage Green) — pelleting, weight loss, IV therapy, peptide
    if (apptType.includes('pellet') || apptType.includes('weight loss') ||
        apptType.includes('iv therapy') || apptType.includes('longevity') ||
        apptType.includes('peptide'))
        return { bg: 'rgba(107,143,113,0.10)', border: 'rgba(107,143,113,0.40)', brandLabel: 'Longevity' };

    // Mental Health (Purple)
    if (apptType.includes('mental health') || apptType.includes('therapy') ||
        apptType.includes('ketamine') || apptType.includes('psychiatric'))
        return { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.35)', brandLabel: 'Mental Health' };

    // Telehealth fallback
    if (loc.includes('video') || loc.includes('phone'))
        return { bg: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.2)', brandLabel: 'Telehealth' };

    return { bg: 'var(--surface)', border: 'rgba(255,255,255,0.06)', brandLabel: '' };
}

function isNewPatientAppt(type) {
    var t = (type || '').toLowerCase();
    return t.includes('initial') || t.includes('new patient') || t.includes('new consult');
}

function isTelehealthAppt(location, contactType) {
    var loc = (location || '').toLowerCase();
    var ct = (contactType || '').toLowerCase();
    return ct.includes('video') || ct.includes('telehealth') ||
           loc.includes('video') || loc.includes('phone') || loc.includes('telemedicine') || loc.includes('telehealth');
}

function abbreviateType(type) {
    if (!type) return '';
    // Shorten long appointment type names for compact view
    return type.replace('Repeat Pelleting Procedure', 'Pellet')
               .replace('Initial Female Hormone Replacement Therapy Consult', 'Initial HRT (F)')
               .replace('Initial Male Hormone Replacement Consult', 'Initial HRT (M)')
               .replace('Initial Primary Care Consult - Physical & Lab Review', 'Initial PCP')
               .replace('NMH General TRT Telemedicine Appt', 'TRT Tele')
               .replace('NMH TRT Supply Refill', 'TRT Refill')
               .replace('In-Person Sick Visit', 'Sick Visit')
               .replace('Allergy Injection Consult', 'Allergy Inj');
}

function abbreviateStatus(st) {
    var map = { 'Scheduled': 'Sched', 'Confirmed': 'Conf', 'Checked In': 'In', 'In Progress': 'Active', 'Completed': 'Done', 'No Show': 'NS', 'Cancelled': 'Cxl' };
    return map[st] || st;
}

// Provider color coding for schedule
function getProviderColor(providerName) {
    var name = (providerName || '').toLowerCase();
    if (name.includes('whitten')) return { bg: 'rgba(168,85,247,0.10)', border: '#a855f7', text: '#c084fc', dot: '#a855f7' };  // purple
    if (name.includes('schafer')) return { bg: 'rgba(34,211,238,0.10)', border: '#22d3ee', text: '#22d3ee', dot: '#22d3ee' };  // cyan
    return { bg: 'rgba(251,191,36,0.10)', border: '#fbbf24', text: '#fbbf24', dot: '#fbbf24' };  // amber fallback
}

function formatSlotTime(h, m) {
    var ampm = h >= 12 ? 'PM' : 'AM';
    var hr = h > 12 ? h - 12 : (h === 0 ? 12 : h);
    return hr + (m > 0 ? ':' + padTwo(m) : '') + ' ' + ampm;
}

function padTwo(n) { return n < 10 ? '0' + n : '' + n; }

// Legacy list view (kept for reference)
function renderScheduleList(contentEl) {
    var filtered = scheduleProviderFilter === 'all' ? scheduleAllData : scheduleAllData.filter(function(p) { return (p.provider || 'Unknown') === scheduleProviderFilter; });
    if (filtered.length === 0) { contentEl.innerHTML = '<div class="empty-state-card"><h3>No appointments</h3><p>No appointments for this provider today.</p></div>'; return; }
    filtered.sort(function(a, b) { return parseHealthieDate(a.date).getTime() - parseHealthieDate(b.date).getTime(); });

    var activeAppts = filtered.filter(function(p) { return p.appointment_status !== 'Completed' && p.appointment_status !== 'No Show' && p.appointment_status !== 'Cancelled'; });
    var readyCount = activeAppts.filter(function(p) { return p.appointment_id && isPrevisitComplete(p.appointment_id); }).length;
    var checkedIn = filtered.filter(function(p) { return p.appointment_status === 'Checked In'; }).length;
    var showProv = scheduleProviderFilter === 'all';
    var html = '<div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap;">';
    html += '<span style="font-size:14px; color:var(--text-secondary);">' + filtered.length + ' patients</span>';
    if (checkedIn > 0) html += '<span style="font-size:11px; padding:3px 10px; border-radius:6px; background:rgba(34,211,238,0.1); color:#22d3ee;">' + checkedIn + ' checked in</span>';
    if (readyCount > 0) html += '<span style="font-size:11px; padding:3px 10px; border-radius:6px; background:rgba(34,197,94,0.1); color:#22c55e;">✅ ' + readyCount + ' ready for provider</span>';
    html += '</div>';

    filtered.forEach(function(p) {
        var st = p.appointment_status || 'Pending';
        var s = getApptStatusStyle(st);
        var apptId = p.appointment_id || '';
        var canAdv = apptId && st !== 'Completed' && st !== 'No Show';
        var pid = p.patient_id || p.healthie_id || '';
        var isFinalStatus = st === 'Completed' || st === 'No Show' || st === 'Cancelled';
        var allTasksDone = apptId && isPrevisitComplete(apptId);
        var cardBg = isFinalStatus ? 'var(--card)' : allTasksDone ? 'rgba(34,197,94,0.08)' : 'var(--card)';
        var cardBorder = isFinalStatus ? 'var(--border-light)' : allTasksDone ? 'rgba(34,197,94,0.3)' : 'var(--border-light)';

        html += '<div style="background:' + cardBg + '; border:1px solid ' + cardBorder + '; border-radius:12px; padding:14px 16px; margin-bottom:8px;' + (allTasksDone && !isFinalStatus ? ' border-left:3px solid #22c55e;' : '') + '">';
        html += '<div style="display:flex; align-items:center; justify-content:space-between;">';
        html += '<div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">';
        html += '<div style="width:42px; height:42px; border-radius:10px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:14px; color:var(--text-primary); flex-shrink:0;">' + getInitials(p.full_name) + '</div>';
        html += '<div style="min-width:0; flex:1;">';
        html += '<div style="font-size:15px; font-weight:600; color:var(--text-primary);">' + (p.full_name || 'Unknown') + '</div>';
        html += '<div style="font-size:12px; color:var(--text-tertiary);"><span style="color:var(--text-primary); font-weight:500;">' + (p.time || 'TBD') + '</span>';
        if (p.length) html += ' &middot; ' + p.length + 'min';
        html += ' &middot; ' + (p.appointment_type || 'Appt');
        if (showProv && p.provider) html += ' &middot; <span style="color:var(--text-secondary);">' + p.provider + '</span>';
        html += '</div></div></div>';
        html += '<div style="display:flex; align-items:center; gap:6px; flex-shrink:0;">';
        if (!isFinalStatus && apptId && !_moveAppt) html += '<button onclick="event.stopPropagation(); startMoveAppt(\x27' + apptId + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27, \x27' + (p.time || '') + '\x27, \x27' + getPhoenixDateStr(scheduleSelectedDate) + '\x27, \x27' + (p.provider_id || '') + '\x27)" style="padding:5px 10px; border-radius:6px; background:rgba(251,191,36,0.1); border:1px solid rgba(251,191,36,0.25); color:#fbbf24; font-size:11px; font-weight:600; cursor:pointer;" title="Move/reschedule">↔ Move</button>';
        if (pid) html += '<button onclick="event.stopPropagation(); openChartForPatient(\x27' + pid + '\x27, \x27' + (p.full_name || '').replace(/'/g, '') + '\x27)" style="padding:5px 10px; border-radius:6px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); color:var(--cyan); font-size:11px; font-weight:600; cursor:pointer;" title="Open chart">📋 Chart</button>';
        // Status badge + dropdown for status changes
        var isFinal = st === 'Completed' || st === 'No Show' || st === 'Cancelled';
        html += '<div style="position:relative; display:inline-block;">';
        html += '<span style="font-size:11px; padding:4px 10px; border-radius:6px; background:' + s.bg + '; color:' + s.color + '; font-weight:600; cursor:' + (isFinal ? 'default' : 'pointer') + '; user-select:none;" ' + (isFinal ? '' : 'onclick="event.stopPropagation(); toggleStatusMenu(\x27sm_' + apptId + '\x27)"') + '>' + st + (isFinal ? '' : ' ▾') + '</span>';
        if (!isFinal && apptId) {
            html += '<div id="sm_' + apptId + '" style="display:none; position:absolute; right:0; top:100%; margin-top:4px; background:var(--card); border:1px solid var(--border-light); border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,0.3); z-index:100; min-width:140px; overflow:hidden;">';
            var statusOptions = [
                { label: '✅ Check In', value: 'Checked In', show: st === 'Scheduled' || st === 'Confirmed' },
                { label: '🟣 In Progress', value: 'In Progress', show: st === 'Checked In' },
                { label: '✅ Completed', value: 'Completed', show: st === 'In Progress' || st === 'Checked In' },
                { label: '🚫 No Show', value: 'No Show', show: st !== 'No Show' && st !== 'Completed' },
                { label: '❌ Cancel', value: 'Cancelled', show: st !== 'Cancelled' && st !== 'Completed' && st !== 'No Show' },
            ];
            statusOptions.forEach(function(opt) {
                if (!opt.show) return;
                var optStyle = opt.value === 'No Show' || opt.value === 'Cancelled' ? 'color:#ef4444;' : 'color:var(--text-primary);';
                html += '<div onclick="event.stopPropagation(); updateApptStatus(\x27' + apptId + '\x27, \x27' + opt.value + '\x27)" style="padding:10px 14px; font-size:12px; font-weight:500; cursor:pointer; border-bottom:1px solid var(--border); ' + optStyle + '" onmouseover="this.style.background=\'var(--surface-2)\'" onmouseout="this.style.background=\'transparent\'">' + opt.label + '</div>';
            });
            html += '</div>';
        }
        html += '</div>';
        html += '</div></div>';

        // Pre-visit checklist (only for active appointments)
        if (apptId && !isFinalStatus) {
            var pvState = getPrevisitState(apptId);
            var doneCount = previsitCompletedCount(apptId);
            var totalTasks = PREVISIT_TASKS.length;
            html += '<div style="margin-top:10px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.06);">';
            // Progress bar
            var pct = Math.round((doneCount / totalTasks) * 100);
            html += '<div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">';
            html += '<div style="flex:1; height:4px; background:var(--surface-2); border-radius:2px; overflow:hidden;"><div style="width:' + pct + '%; height:100%; background:' + (allTasksDone ? '#22c55e' : '#0891b2') + '; border-radius:2px; transition:width 0.3s;"></div></div>';
            html += '<span style="font-size:10px; color:' + (allTasksDone ? '#22c55e' : 'var(--text-tertiary)') + '; font-weight:600; white-space:nowrap;">' + (allTasksDone ? '✅ Ready' : doneCount + '/' + totalTasks) + '</span>';
            html += '</div>';
            // Task pills with timestamps
            html += '<div style="display:flex; flex-wrap:wrap; gap:4px;">';
            PREVISIT_TASKS.forEach(function(t) {
                var taskData = pvState[t.key];
                var done = !!taskData;
                var pillBg = done ? 'rgba(34,197,94,0.15)' : 'var(--surface-2)';
                var pillColor = done ? '#22c55e' : 'var(--text-tertiary)';
                var pillBorder = done ? 'rgba(34,197,94,0.3)' : 'var(--border)';
                var tooltip = done && taskData.completed_by ? taskData.completed_by + (taskData.completed_at ? ' · ' + new Date(taskData.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TIMEZONE }) : '') : '';
                html += '<button onclick="event.stopPropagation(); togglePrevisitTask(\x27' + apptId + '\x27, \x27' + t.key + '\x27)" title="' + (tooltip || 'Click to complete') + '" style="padding:3px 8px; font-size:10px; font-weight:500; border-radius:6px; border:1px solid ' + pillBorder + '; background:' + pillBg + '; color:' + pillColor + '; cursor:pointer; font-family:inherit; transition:all 0.15s;">' + (done ? '✓ ' : '') + t.label + '</button>';
            });
            html += '</div>';
            // Show who completed tasks (compact timestamp line)
            var completedTasks = PREVISIT_TASKS.filter(function(t) { return pvState[t.key]; });
            if (completedTasks.length > 0) {
                var lastTask = completedTasks.reduce(function(a, b) {
                    var aTime = pvState[a.key]?.completed_at ? new Date(pvState[a.key].completed_at).getTime() : 0;
                    var bTime = pvState[b.key]?.completed_at ? new Date(pvState[b.key].completed_at).getTime() : 0;
                    return bTime > aTime ? b : a;
                });
                var lastData = pvState[lastTask.key];
                if (lastData && lastData.completed_by) {
                    var timeStr = lastData.completed_at ? new Date(lastData.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TIMEZONE }) : '';
                    html += '<div style="font-size:9px; color:var(--text-tertiary); margin-top:3px;">Last: ' + lastData.completed_by + (timeStr ? ' at ' + timeStr : '') + '</div>';
                }
            }
            html += '</div>';
        }

        html += '</div>';
    });
    contentEl.innerHTML = html;
}

function toggleStatusMenu(menuId) {
    // Close any other open menus first
    document.querySelectorAll('[id^="sm_"]').forEach(function(el) {
        if (el.id !== menuId) el.style.display = 'none';
    });
    var menu = document.getElementById(menuId);
    if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    // Close on outside click
    if (menu && menu.style.display === 'block') {
        setTimeout(function() {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 50);
    }
}

async function updateApptStatus(appointmentId, newStatus) {
    // Close menu
    document.querySelectorAll('[id^="sm_"]').forEach(function(el) { el.style.display = 'none'; });

    // Optimistic update in local data
    var appt = scheduleAllData.find(function(a) { return String(a.appointment_id) === String(appointmentId); });
    var prev = appt ? appt.appointment_status : null;
    if (appt) appt.appointment_status = newStatus;
    // Also update Today tab data
    var todayAppt = healthieAppointments.find(function(a) { return String(a.id) === String(appointmentId); });
    if (todayAppt) { todayAppt.status = newStatus; todayAppt.appointment_status = newStatus; }

    var contentEl = document.getElementById('scheduleContent');
    if (contentEl) renderScheduleContent(contentEl);
    var provMap = new Map();
    scheduleAllData.forEach(function(p) { provMap.set(p.provider || 'Unknown', { name: p.provider || 'Unknown', id: p.provider_id || '' }); });
    renderProviderTabs([...provMap.values()]);
    showToast('Status → ' + newStatus, 'info');

    try {
        var resp = await apiFetch('/ops/api/ipad/appointment-status/', {
            method: 'PATCH',
            body: JSON.stringify({ appointment_id: appointmentId, status: newStatus }),
        });
        if (resp.success) {
            showToast('✓ ' + newStatus + ' saved to Healthie', 'success');
        } else {
            throw new Error(resp.error || 'Unknown error');
        }
    } catch (e) {
        // Rollback
        if (appt && prev) appt.appointment_status = prev;
        if (todayAppt && prev) { todayAppt.status = prev; todayAppt.appointment_status = prev; }
        if (contentEl) renderScheduleContent(contentEl);
        showToast('Status update failed: ' + e.message, 'error');
    }
}

function navigateToPatient(patientId, patientName) {
    if (!patientId) return;
    openChartForPatient(patientId, patientName);
}

// ─── VITALS / METRICS ENTRY ─────────────────────────────────
const METRIC_UNITS = {
    weight: 'lbs', height: 'in', blood_pressure: 'mmHg', heart_rate: 'bpm',
    temperature: '°F', oxygen_saturation: '%', respiration_rate: '/min',
    testosterone_level: 'ng/dL', hematocrit: '%', psa: 'ng/mL',
    bmi: '', waist_circumference: 'in', hemoglobin: 'g/dL',
};

function openVitalsModal(patientId, patientName) {
    var existingModal = document.getElementById('vitalsModal');
    if (existingModal) existingModal.remove();

    var formStyle = 'width:100%; padding:10px 12px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;';
    var labelStyle = 'display:block; font-size:11px; color:var(--text-secondary); margin-bottom:4px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;';
    var fieldWrap = 'flex:1; min-width:120px;';

    var html = '<div id="vitalsModal" class="modal-overlay" style="display:flex;">';
    html += '<div class="modal modal-large" style="max-width:620px;">';
    html += '<div class="modal-header"><h2 style="font-size:18px; margin:0;">📋 Record Vitals</h2>';
    html += '<button class="modal-close" onclick="document.getElementById(\'vitalsModal\').remove()">✕</button></div>';
    html += '<div class="modal-body" style="padding:20px;">';
    html += '<div style="font-size:13px; color:var(--text-tertiary); margin-bottom:14px;">Patient: <strong style="color:var(--text-primary);">' + patientName + '</strong></div>';

    var selectStyle = 'width:100%; padding:10px 8px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:13px; font-family:inherit;';

    // Row 1: Blood Pressure + Method
    html += '<div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Blood Pressure (mmHg)</label><input id="vBP" type="text" inputmode="numeric" placeholder="120/80" maxlength="7" style="' + formStyle + '" oninput="autoFormatBP(this)"></div>';
    html += '<div style="min-width:100px;"><label style="' + labelStyle + '">BP Method</label><select id="vBPMethod" style="' + selectStyle + '"><option value="Auto">Auto</option><option value="Manual">Manual</option><option value="Arterial Line">A-Line</option></select></div>';
    html += '</div>';

    // Row 2: Pulse + RR
    html += '<div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Heart Rate</label><input id="vPulse" type="number" placeholder="72" style="' + formStyle + '"></div>';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Resp Rate</label><input id="vRR" type="number" placeholder="18" style="' + formStyle + '"></div>';
    html += '</div>';

    // Row 3: Temp + Method + SpO2 + O2 Source
    html += '<div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap;">';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Temp (°F)</label><input id="vTemp" type="number" step="0.1" placeholder="98.6" style="' + formStyle + '"></div>';
    html += '<div style="min-width:100px;"><label style="' + labelStyle + '">Temp Method</label><select id="vTempMethod" style="' + selectStyle + '"><option value="Tympanic">Tympanic</option><option value="Oral">Oral</option><option value="Temporal">Temporal</option><option value="Axillary">Axillary</option><option value="Rectal">Rectal</option></select></div>';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">SpO2 (%)</label><input id="vSpO2" type="number" placeholder="98" style="' + formStyle + '"></div>';
    html += '<div style="min-width:100px;"><label style="' + labelStyle + '">O₂ Source</label><select id="vO2Source" style="' + selectStyle + '"><option value="RA">RA</option><option value="1L NC">1L NC</option><option value="2L NC">2L NC</option><option value="3L NC">3L NC</option><option value="4L NC">4L NC</option><option value="5L NC">5L NC</option><option value="6L NC">6L NC</option><option value="NRB">NRB</option><option value="Venti">Venti</option><option value="CPAP">CPAP/BiPAP</option><option value="Vent">Vent</option></select></div>';
    html += '</div>';

    // Row 3: Height + Weight + auto BMI
    html += '<div style="display:flex; gap:10px; margin-bottom:14px; flex-wrap:wrap; align-items:flex-end;">';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Height (in)</label><input id="vHeight" type="number" step="0.1" placeholder="70" oninput="calcBMI()" style="' + formStyle + '"></div>';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">Weight (lbs)</label><input id="vWeight" type="number" step="0.1" placeholder="185" oninput="calcBMI()" style="' + formStyle + '"></div>';
    html += '<div style="' + fieldWrap + '"><label style="' + labelStyle + '">BMI <span style="font-weight:400; color:var(--text-tertiary);">(auto)</span></label><input id="vBMI" type="text" readonly style="' + formStyle + ' background:var(--bg); color:var(--text-secondary);"></div>';
    html += '</div>';

    // Notes
    html += '<div style="margin-bottom:14px;"><label style="' + labelStyle + '">Notes (optional)</label>';
    html += '<input id="vNotes" type="text" placeholder="e.g. Before medication, fasting" style="' + formStyle + '"></div>';

    // Status messages
    html += '<div id="vitalsError" style="display:none; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:10px;"></div>';
    html += '<div id="vitalsSuccess" style="display:none; padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:13px; margin-bottom:10px;"></div>';

    html += '</div>';
    html += '<div class="modal-actions">';
    html += '<button class="btn-cancel" onclick="document.getElementById(\'vitalsModal\').remove()">Cancel</button>';
    html += '<button class="btn-primary" id="vitalsSubmitBtn" onclick="submitAllVitals(\'' + patientId + '\')">Save All Vitals</button>';
    html += '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
    // Must add .visible class after insertion for CSS transition to work
    requestAnimationFrame(function() {
        var modal = document.getElementById('vitalsModal');
        if (modal) modal.classList.add('visible');
    });
}

function calcBMI() {
    var h = parseFloat(document.getElementById('vHeight')?.value);
    var w = parseFloat(document.getElementById('vWeight')?.value);
    var bmiEl = document.getElementById('vBMI');
    if (bmiEl && h > 0 && w > 0) {
        var bmi = (w / (h * h)) * 703;
        bmiEl.value = bmi.toFixed(1);
    } else if (bmiEl) {
        bmiEl.value = '';
    }
}

function updateVitalsUnit() {} // kept for backwards compat

// Auto-format BP: "120" → "120/" after 3 digits
function autoFormatBP(input) {
    let v = input.value.replace(/[^\d\/]/g, '');
    // If user typed 3+ digits without a slash, insert one
    if (v.length >= 3 && !v.includes('/')) {
        v = v.slice(0, 3) + '/' + v.slice(3);
    }
    // Limit to 7 chars (e.g., 120/80)
    input.value = v.slice(0, 7);
}

async function submitAllVitals(patientId) {
    var btn = document.getElementById('vitalsSubmitBtn');
    var errorEl = document.getElementById('vitalsError');
    var successEl = document.getElementById('vitalsSuccess');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    // Gather all non-empty vitals
    var vitals = [];

    // Blood Pressure — single field "120/80"
    var bpRaw = document.getElementById('vBP')?.value || '';
    if (bpRaw) {
        var bpMatch = bpRaw.match(/^(\d{2,3})\/(\d{2,3})$/);
        if (!bpMatch) {
            errorEl.textContent = 'Blood pressure format: 120/80 (systolic/diastolic)';
            errorEl.style.display = 'block';
            return;
        }
        var systolic = parseInt(bpMatch[1]);
        var diastolic = parseInt(bpMatch[2]);
        if (systolic < 60 || systolic > 250 || diastolic < 30 || diastolic > 150) {
            errorEl.textContent = 'Blood pressure out of range (60-250 / 30-150)';
            errorEl.style.display = 'block';
            return;
        }
        // Store as two Healthie entries (metric_stat is numeric) but display as combined
        var bpMethod = document.getElementById('vBPMethod')?.value || 'Auto';
        vitals.push({ metric_type: 'blood_pressure_systolic', value: String(systolic), unit: 'mmHg', notes: bpMethod });
        vitals.push({ metric_type: 'blood_pressure_diastolic', value: String(diastolic), unit: 'mmHg', notes: bpMethod });
    }

    var pulse = document.getElementById('vPulse')?.value;
    if (pulse) vitals.push({ metric_type: 'heart_rate', value: pulse, unit: 'bpm' });
    var rr = document.getElementById('vRR')?.value;
    if (rr) vitals.push({ metric_type: 'respiration_rate', value: rr, unit: 'breaths/min' });
    var temp = document.getElementById('vTemp')?.value;
    var tempMethod = document.getElementById('vTempMethod')?.value || 'Tympanic';
    if (temp) vitals.push({ metric_type: 'temperature', value: temp, unit: '°F', notes: tempMethod });
    var spo2 = document.getElementById('vSpO2')?.value;
    var o2Source = document.getElementById('vO2Source')?.value || 'RA';
    if (spo2) vitals.push({ metric_type: 'oxygen_saturation', value: spo2, unit: '%', notes: 'on ' + o2Source });
    var height = document.getElementById('vHeight')?.value;
    if (height) vitals.push({ metric_type: 'height', value: height, unit: 'in' });
    var weight = document.getElementById('vWeight')?.value;
    if (weight) vitals.push({ metric_type: 'weight', value: weight, unit: 'lbs' });
    var bmiVal = document.getElementById('vBMI')?.value;
    if (bmiVal) vitals.push({ metric_type: 'bmi', value: bmiVal, unit: '' });
    var notes = document.getElementById('vNotes')?.value || '';

    if (vitals.length === 0) {
        errorEl.textContent = 'Enter at least one vital sign';
        errorEl.style.display = 'block';
        return;
    }

    btn.textContent = 'Saving ' + vitals.length + ' vitals…';
    btn.disabled = true;

    try {
        var saved = 0;
        var failed = 0;
        for (var i = 0; i < vitals.length; i++) {
            try {
                var v = vitals[i];
                // Preserve per-vital method notes, append general notes
                var vitalDescription = v.notes || '';
                if (notes) vitalDescription = vitalDescription ? vitalDescription + ' — ' + notes : notes;
                v.notes = vitalDescription;
                var resp = await apiFetch('/ops/api/ipad/patient/' + patientId + '/metrics/', {
                    method: 'POST',
                    body: JSON.stringify(v)
                });
                if (resp.error) { failed++; } else {
                    saved++;
                    // Fire-and-forget sync to Healthie
                    var hid = chartPanelData && chartPanelData.healthie_id;
                    if (hid) {
                        var categoryMap = {
                            blood_pressure_systolic: 'Blood Pressure Systolic',
                            blood_pressure_diastolic: 'Blood Pressure Diastolic',
                            heart_rate: 'Heart Rate',
                            respiration_rate: 'Respiration Rate',
                            temperature: 'Temperature',
                            oxygen_saturation: 'SpO2',
                            height: 'Height',
                            weight: 'Weight',
                            bmi: 'BMI'
                        };
                        var cat = categoryMap[v.metric_type];
                        if (cat) {
                            try {
                                apiFetch('/ops/api/ipad/patient-data/', {
                                    method: 'POST',
                                    body: JSON.stringify({
                                        action: 'add_vital',
                                        healthie_id: hid,
                                        category: cat,
                                        value: v.value,
                                        description: vitalDescription || ''
                                    })
                                }).catch(function(err) { console.error('[Vitals] Healthie sync error:', err); });
                            } catch (syncErr) {
                                console.error('[Vitals] Healthie sync error:', syncErr);
                            }
                        }
                    }
                }
            } catch (e) {
                failed++;
            }
        }
        var msg = saved + ' vital(s) saved';
        if (failed > 0) msg += ', ' + failed + ' failed';
        if (chartPanelData && chartPanelData.healthie_id) msg += ' (synced to Healthie)';
        successEl.textContent = msg + ' ✅';
        successEl.style.display = 'block';
        btn.textContent = 'Saved!';
        btn.disabled = false;

        // Refresh patient data
        invalidatePatientCache(patientId);
        if (typeof loadChartData === 'function' && chartPanelPatientId === patientId) {
            loadChartData(patientId);
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Failed to save vitals';
        errorEl.style.display = 'block';
        btn.textContent = 'Save All Vitals';
        btn.disabled = false;
    }
}

async function submitVitals(patientId) { submitAllVitals(patientId); } // backwards compat

// ─── LAB ORDERS & RESULTS IN PATIENT PROFILE ────────────────
async function loadPatientLabData(patientId) {
    const section = document.getElementById(`patientLabsSection-${patientId}`);
    if (!section) return;

    try {
        // Fetch lab orders for this patient
        let orders = [];
        try {
            const data = await apiFetch(`/ops/api/labs/orders?patient_id=${patientId}`);
            orders = data?.orders || data?.data || data || [];
            if (!Array.isArray(orders)) orders = [];
        } catch { orders = []; }

        // Also check review queue for lab results
        let reviewItems = [];
        try {
            const qData = await apiFetch('/ops/api/labs/review-queue/');
            const allItems = qData?.queue || qData?.data || qData || [];
            if (Array.isArray(allItems)) {
                reviewItems = allItems.filter(item => {
                    const itemId = String(item.patient_id || '');
                    return itemId === String(patientId);
                });
            }
        } catch { reviewItems = []; }

        let labHtml = '<h3>🧪 Lab Orders & Results</h3>';

        if (orders.length === 0 && reviewItems.length === 0) {
            labHtml += '<div style="color:var(--text-tertiary); font-size:13px; padding:8px 0;">No lab orders found for this patient</div>';
        } else {
            // Lab Orders
            if (orders.length > 0) {
                labHtml += orders.map(o => {
                    const status = o.status || 'pending';
                    const statusColor = status === 'submitted' ? '#22c55e' : status === 'failed' ? '#ef4444' : '#f59e0b';
                    const statusLabel = status === 'submitted' ? '✅ Submitted' : status === 'failed' ? '❌ Failed' : '⏳ Pending';
                    const orderDate = o.created_at ? formatDateDisplay(o.created_at) : 'Unknown date';
                    const testNames = o.test_names || o.tests?.map(t => t.name || t.test_name)?.join(', ') || 'Lab Panel';
                    const orderId = o.id || o.order_id;

                    return `
                        <div class="med-card" style="margin-bottom:8px;">
                            <div style="flex:1;">
                                <div class="med-name">${testNames}</div>
                                <div class="med-dose">${orderDate} · ${o.external_order_id || 'Local Order'}</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${statusColor}15; color:${statusColor};">${statusLabel}</span>
                                ${o.requisition_pdf ? `<button class="btn-sm btn-secondary" onclick="viewLabRequisition('${orderId}')" style="font-size:11px; padding:3px 8px;">📄 Requisition</button>` : ''}
                                ${status === 'pending' ? `<button class="btn-sm btn-primary" onclick="approveLabFromProfile('${orderId}', '${patientId}')" style="font-size:11px; padding:3px 8px;">✅ Approve</button>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // Lab Results from Review Queue
            if (reviewItems.length > 0) {
                labHtml += '<div style="margin-top:12px; font-size:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Results Pending Review</div>';
                labHtml += reviewItems.map(r => {
                    const resultDate = r.received_at || r.created_at ? formatDateDisplay(r.received_at || r.created_at) : '';
                    return `
                        <div class="med-card" style="margin-top:6px; border-left:3px solid #3b82f6;">
                            <div style="flex:1;">
                                <div class="med-name">${r.test_name || r.panel_name || 'Lab Result'}</div>
                                <div class="med-dose">${resultDate} · ${r.lab_provider || 'Access Medical'}</div>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${r.id ? `<button class="btn-sm btn-secondary" onclick="window.open('/ops/api/labs/review-queue/${r.id}/pdf/', '_blank')" style="font-size:11px; padding:3px 8px;">📄 View PDF</button>` : ''}
                                <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:rgba(59,130,246,0.12); color:#3b82f6;">🔬 Needs Review</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        section.innerHTML = labHtml;
    } catch (e) {
        console.warn('[loadPatientLabData]', e);
        section.innerHTML = '<h3>🧪 Lab Orders & Results</h3><div style="color:var(--text-tertiary); font-size:13px;">Failed to load lab data</div>';
    }
}

async function approveLabFromProfile(orderId, patientId) {
    if (!confirm('Approve this lab order and submit to Access Medical?')) return;
    try {
        const resp = await apiFetch(`/ops/api/labs/order/${orderId}/approve`, { method: 'POST' });
        if (resp.error) throw new Error(resp.error);
        alert('Lab approved and submitted!');
        loadPatientLabData(patientId);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        alert('Failed to approve: ' + (e.message || 'Unknown error'));
    }
}

function viewLabRequisition(orderId) {
    window.open(`/ops/api/labs/orders/${orderId}/requisition`, '_blank');
}

// ─── PAYMENT DATA IN PATIENT PROFILE ────────────────────────
async function loadPatientPaymentData(patientId) {
    const section = document.getElementById(`patientPaymentSection-${patientId}`);
    if (!section) return;

    try {
        const data = await apiFetch(`/ops/api/ipad/patient/${patientId}/payments/`);
        const billingItems = data?.billing_items || [];
        const requestedPayments = data?.requested_payments || [];
        const totalPaid = data?.total_paid || 0;

        let html = '<h3>💳 Payment History</h3>';

        if (data?.error === 'Patient not linked to Healthie') {
            html += '<div style="color:var(--text-tertiary); font-size:13px; padding:8px 0;">Patient not linked to Healthie — no payment data available</div>';
        } else if (billingItems.length === 0 && requestedPayments.length === 0) {
            html += '<div style="color:var(--text-tertiary); font-size:13px; padding:8px 0;">No payment records found</div>';
        } else {
            // Total paid summary
            html += `<div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; padding:10px 14px; background:rgba(34,197,94,0.06); border-radius:10px; border:1px solid rgba(34,197,94,0.15);">
                <span style="font-size:24px;">💰</span>
                <div>
                    <div style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.5px;">Total Paid</div>
                    <div style="font-size:20px; font-weight:700; color:#22c55e;">$${totalPaid.toFixed(2)}</div>
                </div>
                <div style="flex:1; text-align:right;">
                    <div style="font-size:11px; color:var(--text-tertiary);">${billingItems.length} billing items · ${requestedPayments.length} payments</div>
                </div>
            </div>`;

            // Recent billing items
            if (billingItems.length > 0) {
                html += '<div style="font-size:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Billing Items</div>';
                html += billingItems.slice(0, 10).map(b => {
                    const state = b.state || 'unknown';
                    const stateColor = state === 'paid' || state === 'succeeded' ? '#22c55e' : state === 'failed' ? '#ef4444' : '#f59e0b';
                    const stateLabel = state === 'paid' || state === 'succeeded' ? '✅ Paid' : state === 'failed' ? '❌ Failed' : '⏳ ' + state;
                    const date = b.created_at ? formatDateDisplay(b.created_at) : '';
                    const offeringName = b.offering?.name || 'Service';
                    const amount = parseFloat(b.amount_paid || 0).toFixed(2);

                    return `
                        <div class="med-card" style="margin-bottom:4px;">
                            <div style="flex:1;">
                                <div class="med-name">${offeringName}</div>
                                <div class="med-dose">${date} · $${amount}</div>
                            </div>
                            <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${stateColor}15; color:${stateColor};">${stateLabel}</span>
                        </div>
                    `;
                }).join('');
                if (billingItems.length > 10) {
                    html += `<div style="font-size:12px; color:var(--text-tertiary); text-align:center; padding:4px;">…and ${billingItems.length - 10} more</div>`;
                }
            }

            // Requested payments
            if (requestedPayments.length > 0) {
                html += '<div style="font-size:12px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin:12px 0 6px;">Requested Payments</div>';
                html += requestedPayments.slice(0, 10).map(rp => {
                    const status = rp.status || 'pending';
                    const statusColor = status === 'completed' || status === 'paid' ? '#22c55e' : status === 'cancelled' ? '#6b7280' : '#f59e0b';
                    const statusLabel = status === 'completed' || status === 'paid' ? '✅ Paid' : status === 'cancelled' ? '🚫 Cancelled' : '⏳ Pending';
                    const date = rp.created_at ? formatDateDisplay(rp.created_at) : '';
                    const price = parseFloat(rp.price || 0).toFixed(2);
                    const offeringName = rp.offering?.name || 'Payment Request';

                    return `
                        <div class="med-card" style="margin-bottom:4px;">
                            <div style="flex:1;">
                                <div class="med-name">${offeringName}</div>
                                <div class="med-dose">${date} · $${price}</div>
                            </div>
                            <span style="font-size:11px; padding:2px 8px; border-radius:4px; background:${statusColor}15; color:${statusColor};">${statusLabel}</span>
                        </div>
                    `;
                }).join('');
            }
        }

        section.innerHTML = html;
    } catch (e) {
        console.warn('[loadPatientPaymentData]', e);
        section.innerHTML = '<h3>💳 Payment History</h3><div style="color:var(--text-tertiary); font-size:13px;">Failed to load payment data</div>';
    }
}

// ─── CONTROLLED SUBSTANCE DISPENSE MODAL ────────────────────
async function openControlledDispenseModal(patientId, patientName) {
    const existing = document.getElementById('controlledDispenseModal');
    if (existing) existing.remove();

    // Load available vials from inventory
    let vials = [];
    try {
        // FIX(2026-03-15): Added trailing slash before query params to prevent 404/redirect
        const data = await apiFetch('/ops/api/inventory/vials/?status=active');
        vials = data?.data || data?.vials || data || [];
        if (!Array.isArray(vials)) vials = [];
    } catch { vials = []; }

    // Filter to only DEA-scheduled vials
    const deaVials = vials.filter(v => v.dea_schedule || v.dea_drug_name);

    document.body.insertAdjacentHTML('beforeend', `
        <div id="controlledDispenseModal" class="modal-overlay" style="display:flex;">
            <div class="modal modal-large" style="max-width:540px;">
                <div class="modal-header">
                    <h2 style="font-size:18px; margin:0;">💉 Dispense Controlled — ${patientName}</h2>
                    <button class="modal-close" onclick="document.getElementById('controlledDispenseModal').remove()">✕</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Select Vial</label>
                        <select id="cdVial" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                            <option value="">Choose a vial…</option>
                            ${deaVials.map(v => `<option value="${v.vial_id || v.id}" data-drug="${v.dea_drug_name || 'Testosterone Cypionate'}" data-schedule="${v.dea_schedule || 'CIII'}" data-remaining="${v.remaining_ml || v.volume_ml || 10}" data-lot="${v.lot_number || ''}" data-exp="${v.expiration_date || ''}" data-extid="${v.external_id || v.vial_id}">${v.external_id || v.vial_id} — ${v.dea_drug_name || 'Testosterone'} (${parseFloat(v.remaining_ml || v.volume_ml || 10).toFixed(1)}mL remain)</option>`).join('')}
                        </select>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Dose (mL)</label>
                            <input id="cdDoseMl" type="number" step="0.01" value="0.50" min="0.01" max="10" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Waste (mL)</label>
                            <input id="cdWasteMl" type="number" step="0.01" value="0.00" min="0" max="10" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Syringes</label>
                            <input id="cdSyringes" type="number" value="1" min="1" max="5" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Notes</label>
                        <input id="cdNotes" type="text" placeholder="Optional notes…" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                    </div>
                    <div id="cdError" style="display:none; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:12px;"></div>
                    <div id="cdSuccess" style="display:none; padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:13px; margin-bottom:12px;"></div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="document.getElementById('controlledDispenseModal').remove()">Cancel</button>
                    <button class="btn-primary" id="cdSubmitBtn" onclick="submitControlledDispense('${patientId}', '${patientName.replace(/'/g, "\\'")}')">💉 Stage & Dispense</button>
                </div>
            </div>
        </div>
    `);
}

async function submitControlledDispense(patientId, patientName) {
    const btn = document.getElementById('cdSubmitBtn');
    const errorEl = document.getElementById('cdError');
    const successEl = document.getElementById('cdSuccess');
    const vialSelect = document.getElementById('cdVial');
    const vialId = vialSelect?.value;
    const drugName = vialSelect?.selectedOptions[0]?.dataset?.drug || 'Testosterone Cypionate';
    const doseMl = parseFloat(document.getElementById('cdDoseMl')?.value || 0);
    const wasteMl = parseFloat(document.getElementById('cdWasteMl')?.value || 0);
    const syringes = parseInt(document.getElementById('cdSyringes')?.value || 1);
    const notes = document.getElementById('cdNotes')?.value || '';

    if (!vialId) { errorEl.textContent = 'Please select a vial'; errorEl.style.display = 'block'; return; }
    if (doseMl <= 0) { errorEl.textContent = 'Dose must be greater than 0'; errorEl.style.display = 'block'; return; }

    btn.textContent = 'Dispensing…';
    btn.disabled = true;
    errorEl.style.display = 'none';

    try {
        const resp = await apiFetch('/ops/api/ipad/stage-dose/', {
            method: 'POST',
            body: JSON.stringify({
                patient_id: patientId,
                vial_id: vialId,
                dose_ml: doseMl,
                waste_ml: wasteMl,
                syringe_count: syringes,
                notes,
                dispense_immediately: true,
            })
        });

        if (resp.error) throw new Error(resp.error);

        successEl.textContent = `${drugName} dispensed: ${doseMl}mL + ${wasteMl}mL waste from ${vialSelect.selectedOptions[0]?.text?.split(' —')[0] || 'vial'}`;
        successEl.style.display = 'block';

        // Print label — pass lot/exp from vial select data attributes
        const _selOpt = vialSelect?.selectedOptions[0];
        printLabel(patientId, patientName, drugName, {
            dosage: `${doseMl}mL`,
            volume: `${doseMl}mL`,
            vialNumber: _selOpt?.dataset?.extid || vialId,
            lotNumber: _selOpt?.dataset?.lot || '',
            expDate: _selOpt?.dataset?.exp || '',
            amountDispensed: `${doseMl}`,
        });

        btn.textContent = '✅ Done';
        setTimeout(() => {
            document.getElementById('controlledDispenseModal')?.remove();
            invalidatePatientCache(patientId);
            loadPatient360(patientId, true);
        }, 1500);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Dispense failed';
        errorEl.style.display = 'block';
        btn.textContent = '💉 Stage & Dispense';
        btn.disabled = false;
    }
}
// ─── QUICK DISPENSE MODAL (from Inventory tab) ─────────────
async function openQuickDispenseModalWrapper() {
    console.log('[QuickDispense] Wrapper called');
    try {
        await openQuickDispenseModal();
        console.log('[QuickDispense] Modal opened successfully');
    } catch(err) {
        alert('Error opening modal: ' + err.message);
        console.error('[QuickDispense] Error:', err);
    }
}

async function openQuickDispenseModal() {
    console.log('[QuickDispense] Opening modal...');
    const existing = document.getElementById('quickDispenseModal');
    if (existing) existing.remove();

    // Check morning audit status first
    let morningCheckDone = false;
    try {
        const checkResp = await apiFetch('/ops/api/inventory/controlled-check?action=status');
        morningCheckDone = checkResp?.completed === true;
    } catch(e) {
        console.warn('[QuickDispense] Morning check status failed:', e);
    }

    // Load available vials (sorted FIFO by expiration)
    let vials = [];
    try {
        const data = await apiFetch('/ops/api/inventory/vials/?status=Active');
        vials = data?.data || data?.vials || data || [];
        if (!Array.isArray(vials)) vials = [];
    } catch (err) {
        console.error('[QuickDispense] Failed to load vials:', err);
        vials = [];
    }

    // Filter to DEA vials only, sort FIFO (earliest expiration first, Carrie Boyd preferred)
    const deaVials = vials
        .filter(v => v.dea_schedule || v.dea_drug_name)
        .filter(v => parseFloat(v.remaining_ml || v.remaining_volume_ml || v.volume_ml || 0) > 0)
        .sort((a, b) => {
            const aCarrie = (a.dea_drug_name || '').toLowerCase().includes('carrie') || (a.dea_drug_name || '').toLowerCase().includes('miglyol');
            const bCarrie = (b.dea_drug_name || '').toLowerCase().includes('carrie') || (b.dea_drug_name || '').toLowerCase().includes('miglyol');
            if (aCarrie && !bCarrie) return -1;
            if (!aCarrie && bCarrie) return 1;
            const aExp = a.expiration_date ? new Date(a.expiration_date).getTime() : Infinity;
            const bExp = b.expiration_date ? new Date(b.expiration_date).getTime() : Infinity;
            return aExp - bExp;
        });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE });

    document.body.insertAdjacentHTML('beforeend', `
        <div id="quickDispenseModal" class="modal-overlay visible" style="display:flex;">
            <div class="modal modal-large" style="max-width:560px;">
                <div class="modal-header">
                    <h2 style="font-size:18px; margin:0;">✅ Record Controlled Dispense</h2>
                    <button class="modal-close" onclick="document.getElementById('quickDispenseModal').remove()">✕</button>
                </div>
                <div class="modal-body" style="padding:20px; max-height:70vh; overflow-y:auto; -webkit-overflow-scrolling:touch;">
                    ${!morningCheckDone ? `
                        <div style="padding:10px 14px; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.3); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:14px; font-weight:600;">
                            ⚠️ Morning inventory check NOT completed. Dispensing may be blocked.
                        </div>
                    ` : `
                        <div style="padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:12px; margin-bottom:14px;">
                            ✅ Morning check completed
                        </div>
                    `}
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Patient</label>
                        <div class="patient-search-wrapper">
                            <input type="text" id="qdPatientSearch" class="patient-search-input" placeholder="Type 2+ letters to search patients…" autocomplete="off" />
                            <div id="qdPatientResults" class="patient-search-results"></div>
                            <div id="qdPatientBadge" class="patient-selected-badge" style="display:none;"></div>
                        </div>
                        <div id="qdRegimenInfo" style="display:none; margin-top:6px; padding:6px 10px; background:rgba(0,212,255,0.08); border:1px solid rgba(0,212,255,0.15); border-radius:6px; font-size:12px; color:var(--cyan);"></div>
                    </div>
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Select Vial (Carrie Boyd first → then by expiration)</label>
                        <select id="qdVial" onchange="updateDispenseSummary()" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                            <option value="">Choose a vial…</option>
                            ${deaVials.map((v, i) => {
                                const remaining = parseFloat(v.remaining_ml || v.remaining_volume_ml || v.volume_ml || 0);
                                const isCarrie = (v.dea_drug_name || '').toLowerCase().includes('carrie') || (v.dea_drug_name || '').toLowerCase().includes('miglyol');
                                const label = isCarrie ? '💉 CB' : '🧪';
                                const expDate = v.expiration_date ? new Date(v.expiration_date).toLocaleDateString('en-US', {month:'short', year:'2-digit'}) : '';
                                return `<option value="${v.external_id || v.vial_id}" data-drug="${v.dea_drug_name || 'Testosterone Cypionate'}" data-remaining="${remaining}" data-lot="${v.lot_number || ''}" data-exp="${v.expiration_date || ''}" ${i === 0 ? 'selected' : ''}>${label} ${v.external_id || v.vial_id} — ${remaining.toFixed(1)}mL remain${expDate ? ' (exp ' + expDate + ')' : ''}</option>`;
                            }).join('')}
                        </select>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:14px;">
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Dose/Syringe (mL)</label>
                            <input id="qdDoseMl" type="number" step="0.01" value="0.50" min="0.01" max="10" oninput="updateDispenseSummary()" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Syringes</label>
                            <input id="qdSyringes" type="number" value="1" min="1" max="10" oninput="updateDispenseSummary()" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Waste (auto)</label>
                            <input id="qdWasteMl" type="text" readonly style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:rgba(255,255,255,0.03); color:var(--text-secondary); font-size:14px; cursor:not-allowed;">
                        </div>
                    </div>
                    <div id="qdSummary" style="padding:10px 14px; background:rgba(0,212,255,0.06); border:1px solid rgba(0,212,255,0.12); border-radius:8px; margin-bottom:14px; font-size:13px; color:var(--text-secondary);"></div>
                    <div style="margin-bottom:14px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Notes</label>
                        <input id="qdNotes" type="text" placeholder="Optional notes…" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                    </div>
                    <div id="qdError" style="display:none; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:12px;"></div>
                    <div id="qdSuccess" style="display:none; padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:13px; margin-bottom:12px;"></div>
                </div>
                <div class="modal-actions" style="padding-bottom:env(safe-area-inset-bottom, 16px);">
                    <button class="btn-cancel" onclick="document.getElementById('quickDispenseModal').remove()">Cancel</button>
                    <button class="btn-primary" id="qdSubmitBtn" onclick="submitQuickDispense()" style="background:linear-gradient(135deg, #059669 0%, #10b981 100%);">✅ Record Dispense</button>
                </div>
            </div>
        </div>
    `);

    updateDispenseSummary();

    // Setup patient search with regimen auto-fill
    let qdTimeout = null;
    window._qdPatientId = null;
    window._qdPatientName = '';
    window._qdPatientRegimen = '';
    const input = document.getElementById('qdPatientSearch');
    const results = document.getElementById('qdPatientResults');
    if (input) {
        // FIX: Use oninput assignment instead of addEventListener to prevent listener accumulation
        input.oninput = () => {
            const q = input.value.trim();
            if (q.length < 2) { results.innerHTML = ''; results.style.display = 'none'; return; }
            clearTimeout(qdTimeout);
            qdTimeout = setTimeout(() => {
                const matches = allPatients.filter(p => {
                    const name = (p.name || p.full_name || '').toLowerCase();
                    return name.includes(q.toLowerCase());
                }).slice(0, 10);
                if (matches.length > 0) {
                    results.style.display = 'block';
                    results.innerHTML = matches.map(p => {
                        const regimen = p.regimen || '';
                        return `
                            <div class="patient-search-item" onclick="selectQuickDispensePatient('${p.id || p.patient_id}', '${sanitize(p.name || p.full_name || '').replace(/'/g, "\\'")}', '${sanitize(regimen).replace(/'/g, "\\'")}')">
                                <span class="patient-search-name">${sanitize(p.name || p.full_name)}</span>
                                ${regimen ? `<span style="font-size:11px; color:var(--text-tertiary); margin-left:8px;">${sanitize(regimen)}</span>` : ''}
                            </div>
                        `;
                    }).join('');
                } else {
                    results.innerHTML = '<div class="patient-search-empty">No patients found</div>';
                    results.style.display = 'block';
                }
            }, 200);
        };
    }
}

function updateDispenseSummary() {
    // WASTE_PER_SYRINGE defined at top of file
    const doseMl = parseFloat(document.getElementById('qdDoseMl')?.value || 0);
    const syringes = parseInt(document.getElementById('qdSyringes')?.value || 1);
    const vialSelect = document.getElementById('qdVial');
    const remaining = parseFloat(vialSelect?.selectedOptions[0]?.dataset?.remaining || 0);

    const totalWaste = Number((syringes * WASTE_PER_SYRINGE).toFixed(2));
    const totalDose = Number((doseMl * syringes).toFixed(2));
    const totalRemoval = Number((totalDose + totalWaste).toFixed(2));
    const remainingAfter = Number(Math.max(remaining - totalRemoval, 0).toFixed(2));
    const exceedsVial = totalRemoval > remaining + 0.001;

    const wasteEl = document.getElementById('qdWasteMl');
    if (wasteEl) wasteEl.value = totalWaste.toFixed(2) + ' mL (' + syringes + ' × 0.1)';

    const summaryEl = document.getElementById('qdSummary');
    if (summaryEl) {
        if (exceedsVial && remaining > 0) {
            // Split-vial preview: show how it will be split across vials
            const shortfall = Number((totalRemoval - remaining).toFixed(2));
            const vialLabel = vialSelect?.selectedOptions[0]?.textContent?.split(' — ')[0]?.trim() || 'Current vial';
            // Find next available vial from the select options
            const allOptions = Array.from(vialSelect.options);
            const currentIdx = vialSelect.selectedIndex;
            let nextVialLabel = 'next vial';
            for (let i = 0; i < allOptions.length; i++) {
                if (i !== currentIdx && allOptions[i].value && parseFloat(allOptions[i].dataset?.remaining || 0) > 0) {
                    nextVialLabel = allOptions[i].textContent?.split(' — ')[0]?.trim() || 'next vial';
                    break;
                }
            }
            summaryEl.innerHTML = `
                <div style="color:#f59e0b; font-weight:600;">🔀 Split-vial dispense will be used</div>
                <div style="margin-top:4px;">💉 Dose: ${totalDose.toFixed(2)} mL (${doseMl} × ${syringes}) + 🗑️ Waste: ${totalWaste.toFixed(2)} mL = <strong>${totalRemoval.toFixed(2)} mL total</strong></div>
                <div style="margin-top:6px; padding:6px 10px; background:rgba(245,158,11,0.1); border-radius:6px; font-size:12px;">
                    <div><strong>${vialLabel}:</strong> ${remaining.toFixed(2)} mL (use all remaining)</div>
                    <div><strong>${nextVialLabel}:</strong> ${shortfall.toFixed(2)} mL (continue here)</div>
                </div>
            `;
            summaryEl.style.borderColor = 'rgba(245,158,11,0.3)';
            summaryEl.style.background = 'rgba(245,158,11,0.06)';
        } else if (!vialSelect?.value) {
            summaryEl.innerHTML = `<div>💉 Dose: ${totalDose.toFixed(2)} mL + 🗑️ Waste: ${totalWaste.toFixed(2)} mL = <strong>${totalRemoval.toFixed(2)} mL</strong></div><div style="color:var(--text-tertiary);">Select a vial to see remaining volume</div>`;
            summaryEl.style.borderColor = 'rgba(0,212,255,0.12)';
            summaryEl.style.background = 'rgba(0,212,255,0.06)';
        } else {
            summaryEl.innerHTML = `
                <div>💉 Dose: ${totalDose.toFixed(2)} mL (${doseMl} × ${syringes}) + 🗑️ Waste: ${totalWaste.toFixed(2)} mL = <strong>${totalRemoval.toFixed(2)} mL total</strong></div>
                <div style="margin-top:4px;">Vial: ${remaining.toFixed(2)} mL → <strong style="color:var(--green);">${remainingAfter.toFixed(2)} mL</strong> remaining after</div>
            `;
            summaryEl.style.borderColor = 'rgba(0,212,255,0.12)';
            summaryEl.style.background = 'rgba(0,212,255,0.06)';
        }
    }
}

function selectQuickDispensePatient(patientId, patientName, regimen) {
    window._qdPatientId = patientId;
    window._qdPatientName = patientName;
    window._qdPatientRegimen = regimen || '';
    const input = document.getElementById('qdPatientSearch');
    const results = document.getElementById('qdPatientResults');
    const badge = document.getElementById('qdPatientBadge');
    const regimenEl = document.getElementById('qdRegimenInfo');
    if (input) input.value = '';
    if (results) { results.innerHTML = ''; results.style.display = 'none'; }
    if (badge) {
        badge.style.display = 'flex';
        badge.innerHTML = `
            <span>👤 ${patientName}</span>
            <button onclick="window._qdPatientId=null; window._qdPatientName=''; window._qdPatientRegimen=''; this.parentElement.style.display='none'; document.getElementById('qdRegimenInfo').style.display='none';" class="patient-clear-btn">✕</button>
        `;
    }
    if (regimen) {
        const match = regimen.match(/(\d+(?:\.\d+)?)\s*(?:ml|mL)?/i);
        if (match) {
            const regimenDose = parseFloat(match[1]);
            document.getElementById('qdDoseMl').value = regimenDose.toFixed(2);
            if (regimenEl) {
                regimenEl.style.display = 'block';
                regimenEl.innerHTML = `📋 Regimen: <strong>${sanitize(regimen)}</strong> — dose auto-filled to ${regimenDose} mL`;
            }
            updateDispenseSummary();
        } else {
            if (regimenEl) {
                regimenEl.style.display = 'block';
                regimenEl.innerHTML = `📋 Regimen: <strong>${sanitize(regimen)}</strong>`;
            }
        }
    } else {
        if (regimenEl) regimenEl.style.display = 'none';
    }
}

async function submitQuickDispense() {
    // WASTE_PER_SYRINGE defined at top of file
    const btn = document.getElementById('qdSubmitBtn');
    const errorEl = document.getElementById('qdError');
    const successEl = document.getElementById('qdSuccess');
    const vialSelect = document.getElementById('qdVial');
    const vialExternalId = vialSelect?.value;
    const drugName = vialSelect?.selectedOptions[0]?.dataset?.drug || 'Testosterone Cypionate';
    const vialRemaining = parseFloat(vialSelect?.selectedOptions[0]?.dataset?.remaining || 0);
    const vialLotNumber = vialSelect?.selectedOptions[0]?.dataset?.lot || '';
    const vialExpDate = vialSelect?.selectedOptions[0]?.dataset?.exp || '';
    const dosePerSyringe = parseFloat(document.getElementById('qdDoseMl')?.value || 0);
    const syringes = parseInt(document.getElementById('qdSyringes')?.value || 1);
    const notes = document.getElementById('qdNotes')?.value || '';
    const patientId = window._qdPatientId;
    const patientName = window._qdPatientName;

    const totalDose = Number((dosePerSyringe * syringes).toFixed(3));
    const totalWaste = Number((syringes * WASTE_PER_SYRINGE).toFixed(3));
    const totalRemoval = Number((totalDose + totalWaste).toFixed(3));
    const perSyringeRemoval = Number((dosePerSyringe + WASTE_PER_SYRINGE).toFixed(3));

    errorEl.style.display = 'none';
    if (!patientId) { errorEl.textContent = 'Please select a patient'; errorEl.style.display = 'block'; return; }
    if (!vialExternalId) { errorEl.textContent = 'Please select a vial'; errorEl.style.display = 'block'; return; }
    if (dosePerSyringe <= 0) { errorEl.textContent = 'Dose per syringe must be greater than 0'; errorEl.style.display = 'block'; return; }

    const needsSplit = totalRemoval > vialRemaining + 0.001;

    btn.textContent = 'Dispensing…';
    btn.disabled = true;

    try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE });

        if (!needsSplit) {
            // ─── SINGLE VIAL DISPENSE (unchanged logic) ───
            const resp = await apiFetch('/ops/api/ipad/quick-dispense/', {
                method: 'POST',
                body: JSON.stringify({
                    vialExternalId,
                    patientId,
                    patientName,
                    dispenseDate: today,
                    syringeCount: syringes,
                    dosePerSyringeMl: dosePerSyringe,
                    totalDispensedMl: totalDose,
                    wasteMl: totalWaste,
                    totalAmount: totalRemoval,
                    transactionType: 'dispense',
                    notes: notes || `iPad dispense: ${syringes} syringe(s) @ ${dosePerSyringe}mL + ${totalWaste}mL waste`,
                    deaDrugName: drugName,
                })
            });

            if (resp.error) throw new Error(resp.error);

            successEl.textContent = `✅ ${drugName} dispensed to ${patientName}: ${totalDose}mL dose + ${totalWaste}mL waste (${syringes} syringe${syringes > 1 ? 's' : ''})`;
            successEl.style.display = 'block';

            btn.textContent = '✅ Done';

            // Check if vial should be retired
            const newRemaining = resp?.data?.updated_remaining_ml ?? resp?.updatedRemainingMl;
            if (newRemaining != null && newRemaining > 0 && newRemaining < 2.0) {
                const doRetire = confirm(
                    `Vial ${vialExternalId} now has ${parseFloat(newRemaining).toFixed(2)} mL remaining — ` +
                    `not enough for a standard dose.\n\nRetire this vial and document remaining as waste?`
                );
                if (doRetire) {
                    try {
                        const retireResp = await apiFetch('/ops/api/inventory/retire-vial', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ vialExternalId })
                        });
                        if (retireResp?.success) {
                            successEl.textContent += ` | Vial ${vialExternalId} retired (${parseFloat(newRemaining).toFixed(2)} mL waste documented).`;
                        }
                    } catch (retireErr) {
                        console.error('[iPad] Retire vial failed:', retireErr);
                    }
                }
            }

            // Prompt to print dispense label
            promptPrintLabel({
                patientName, drugName, dosePerSyringe, syringes,
                totalDose, totalWaste, totalRemoval, vialExternalId,
                lotNumber: vialLotNumber, expDate: vialExpDate,
                date: today
            });

            setTimeout(() => {
                document.getElementById('quickDispenseModal')?.remove();
                loadInventorySummary().then(() => { if (currentTab === 'inventory') renderCurrentTab(); });
            }, 1500);
        } else {
            // ─── SPLIT-VIAL DISPENSE ───
            // Find the next available vial from the select dropdown (FIFO order)
            const allOptions = Array.from(vialSelect.options);
            const currentIdx = vialSelect.selectedIndex;
            let nextVialOption = null;
            for (let i = 0; i < allOptions.length; i++) {
                if (i !== currentIdx && allOptions[i].value && parseFloat(allOptions[i].dataset?.remaining || 0) > 0) {
                    nextVialOption = allOptions[i];
                    break;
                }
            }

            if (!nextVialOption) {
                errorEl.textContent = `Total ${totalRemoval.toFixed(2)} mL exceeds vial remaining ${vialRemaining.toFixed(2)} mL and no other vials are available.`;
                errorEl.style.display = 'block';
                btn.textContent = '✅ Record Dispense';
                btn.disabled = false;
                return;
            }

            const nextVialExternalId = nextVialOption.value;
            const nextDrugName = nextVialOption.dataset?.drug || drugName;
            const nextVialRemaining = parseFloat(nextVialOption.dataset?.remaining || 0);
            const nextVialLabel = nextVialOption.textContent?.split(' — ')[0]?.trim() || nextVialExternalId;

            // Calculate split — mirror TransactionForm.tsx logic
            // How many full syringes fit in the current vial?
            const syringesFromCurrent = Math.min(syringes, Math.max(1, Math.floor(vialRemaining / perSyringeRemoval)));
            let doseCurrent = Number((syringesFromCurrent * dosePerSyringe).toFixed(3));
            let wasteCurrent = Number((syringesFromCurrent * WASTE_PER_SYRINGE).toFixed(3));

            // Adjust to fit exactly within current vial remaining
            const currentTotal = doseCurrent + wasteCurrent;
            if (currentTotal > vialRemaining) {
                // Scale down proportionally
                const ratio = vialRemaining / currentTotal;
                doseCurrent = Number((doseCurrent * ratio).toFixed(3));
                wasteCurrent = Number(Math.max(vialRemaining - doseCurrent, 0).toFixed(3));
            }
            // If vial has surplus beyond whole syringes, add to waste (finish the vial)
            const delta = Number((vialRemaining - (doseCurrent + wasteCurrent)).toFixed(3));
            if (delta > 0) {
                wasteCurrent = Number((wasteCurrent + delta).toFixed(3));
            }
            const removalCurrent = Number(Math.min(doseCurrent + wasteCurrent, vialRemaining).toFixed(3));

            // Remainder goes to next vial
            const remainingRemoval = Number((totalRemoval - removalCurrent).toFixed(3));
            const remainingSyringes = Math.max(syringes - syringesFromCurrent, 0);
            const wasteNext = Number((remainingSyringes > 0 ? remainingSyringes * WASTE_PER_SYRINGE : 0).toFixed(3));
            const doseNext = Number(Math.max(remainingRemoval - wasteNext, 0).toFixed(3));

            // Validate next vial has enough
            if (remainingRemoval > nextVialRemaining + 0.001) {
                errorEl.textContent = `Split needs ${remainingRemoval.toFixed(2)} mL from ${nextVialLabel} but it only has ${nextVialRemaining.toFixed(2)} mL. Reduce dose or syringes.`;
                errorEl.style.display = 'block';
                btn.textContent = '✅ Record Dispense';
                btn.disabled = false;
                return;
            }

            // Submit first vial dispense
            const resp1 = await apiFetch('/ops/api/ipad/quick-dispense/', {
                method: 'POST',
                body: JSON.stringify({
                    vialExternalId,
                    patientId,
                    patientName,
                    dispenseDate: today,
                    syringeCount: syringesFromCurrent,
                    dosePerSyringeMl: dosePerSyringe,
                    totalDispensedMl: doseCurrent,
                    wasteMl: wasteCurrent,
                    totalAmount: removalCurrent,
                    transactionType: 'dispense',
                    notes: (notes || `iPad split-vial dispense (vial 1 of 2): ${syringesFromCurrent} syringe(s) @ ${dosePerSyringe}mL`) + ` [split: vial 1/2]`,
                    deaDrugName: drugName,
                })
            });
            if (resp1.error) throw new Error(resp1.error);

            // Submit second vial dispense (only if there's remaining removal)
            // FIX(2026-04-06): Hoist resp2 so retirement check can access it
            let resp2 = null;
            if (remainingRemoval > 0.01) {
                resp2 = await apiFetch('/ops/api/ipad/quick-dispense/', {
                    method: 'POST',
                    body: JSON.stringify({
                        vialExternalId: nextVialExternalId,
                        patientId,
                        patientName,
                        dispenseDate: today,
                        syringeCount: remainingSyringes > 0 ? remainingSyringes : null,
                        dosePerSyringeMl: dosePerSyringe,
                        totalDispensedMl: doseNext,
                        wasteMl: wasteNext,
                        totalAmount: remainingRemoval,
                        transactionType: 'dispense',
                        notes: (notes || `iPad split-vial dispense (vial 2 of 2): continuation`) + ` [split: vial 2/2]`,
                        deaDrugName: nextDrugName,
                    })
                });
                if (resp2.error) throw new Error(resp2.error);
            }

            const vialLabel = vialSelect?.selectedOptions[0]?.textContent?.split(' — ')[0]?.trim() || vialExternalId;
            successEl.innerHTML = `✅ Split across 2 vials:<br><strong>${vialLabel}</strong>: ${removalCurrent.toFixed(2)} mL (${doseCurrent.toFixed(2)} dose + ${wasteCurrent.toFixed(2)} waste)<br><strong>${nextVialLabel}</strong>: ${remainingRemoval.toFixed(2)} mL (${doseNext.toFixed(2)} dose + ${wasteNext.toFixed(2)} waste)`;
            successEl.style.display = 'block';

            btn.textContent = '✅ Done';

            // Check if second vial should be retired after split
            const newRemaining2 = resp2?.data?.updated_remaining_ml ?? resp2?.updatedRemainingMl;
            if (newRemaining2 != null && newRemaining2 > 0 && newRemaining2 < 2.0) {
                const doRetire = confirm(
                    `Vial ${nextVialExternalId} now has ${parseFloat(newRemaining2).toFixed(2)} mL remaining — ` +
                    `not enough for a standard dose.\n\nRetire this vial and document remaining as waste?`
                );
                if (doRetire) {
                    try {
                        await apiFetch('/ops/api/inventory/retire-vial', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ vialExternalId: nextVialExternalId })
                        });
                        successEl.innerHTML += `<br>🗑️ Vial ${nextVialExternalId} retired (${parseFloat(newRemaining2).toFixed(2)} mL waste documented).`;
                    } catch (retireErr) {
                        console.error('[iPad] Retire vial failed:', retireErr);
                    }
                }
            }

            // FIX(2026-04-06): Print label uses first vial ID only (not combined string)
            promptPrintLabel({
                patientName, drugName, dosePerSyringe, syringes,
                totalDose, totalWaste, totalRemoval,
                vialExternalId,
                lotNumber: vialLotNumber, expDate: vialExpDate,
                date: today
            });

            setTimeout(() => {
                document.getElementById('quickDispenseModal')?.remove();
                loadInventorySummary().then(() => { if (currentTab === 'inventory') renderCurrentTab(); });
            }, 2500); // Slightly longer to read split summary
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Dispense failed';
        errorEl.style.display = 'block';
        btn.textContent = '✅ Record Dispense';
        btn.disabled = false;
    }
}


// ─── PRINT LABEL AFTER DISPENSE ─────────────────────────────
function promptPrintLabel(info) {
    // Show a small prompt after dispense success
    const existing = document.getElementById('printLabelPrompt');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', `
        <div id="printLabelPrompt" class="modal-overlay visible" style="display:flex; z-index:10001;">
            <div class="modal" style="max-width:400px; padding:20px;">
                <div style="text-align:center; margin-bottom:16px;">
                    <div style="font-size:24px; margin-bottom:8px;">🏷️</div>
                    <div style="font-size:16px; font-weight:600; color:var(--text-primary);">Print label for this dispense?</div>
                    <div style="font-size:13px; color:var(--text-secondary); margin-top:6px;">
                        ${sanitize(info.patientName)} — ${info.totalDose}mL ${sanitize(info.drugName)}
                    </div>
                </div>
                <div style="display:flex; gap:10px; justify-content:center;">
                    <button onclick="document.getElementById('printLabelPrompt').remove()" class="btn-cancel" style="flex:1;">No Thanks</button>
                    <button onclick="(function(i){ printLabel(window._qdPatientId, i.patientName, i.drugName, { volume: String(i.totalDose), vialNumber: i.vialExternalId, amountDispensed: String(i.totalDose), lotNumber: i.lotNumber || '', expDate: i.expDate || '' }); document.getElementById('printLabelPrompt').remove(); })(window._lastDispenseInfo)" class="btn-primary" style="flex:1; background:linear-gradient(135deg, #0891b2 0%, #22d3ee 100%);">🖨️ Print Label</button>
                </div>
            </div>
        </div>
    `);
    window._lastDispenseInfo = info;

    // Auto-dismiss after 15 seconds
    setTimeout(() => {
        document.getElementById('printLabelPrompt')?.remove();
    }, 15000);
}


// ─── DEMOGRAPHICS EDITING MODAL ─────────────────────────────
function openEditDemographicsModal(patientId) {
    const existing = document.getElementById('editDemoModal');
    if (existing) existing.remove();

    const p360 = patient360Cache[patientId];
    const demo = p360?.demographics || {};
    const pat = allPatients.find(p => String(p.id || p.patient_id) === String(patientId)) || {};

    const fullName = demo.full_name || pat.name || '';
    const firstName = demo.first_name || fullName.split(' ')[0] || '';
    const lastName = demo.last_name || fullName.split(' ').slice(1).join(' ') || '';

    document.body.insertAdjacentHTML('beforeend', `
        <div id="editDemoModal" class="modal-overlay" style="display:flex;">
            <div class="modal modal-large" style="max-width:540px;">
                <div class="modal-header">
                    <h2 style="font-size:18px; margin:0;">✏️ Edit Patient Profile</h2>
                    <button class="modal-close" onclick="document.getElementById('editDemoModal').remove()">✕</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="font-size:12px; color:var(--text-tertiary); margin-bottom:16px;">Changes sync to Healthie, GHL, and GMH Dashboard</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">First Name</label>
                            <input id="editFirstName" value="${firstName}" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Last Name</label>
                            <input id="editLastName" value="${lastName}" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">DOB</label>
                            <input id="editDOB" type="text" inputmode="numeric" value="${demo.dob ? formatDobForEdit(demo.dob) : ''}" placeholder="MM/DD/YYYY" maxlength="10" oninput="autoFormatDob(this)" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Gender</label>
                            <select id="editGender" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                                <option value="Male" ${(demo.gender || '').toLowerCase() === 'male' ? 'selected' : ''}>Male</option>
                                <option value="Female" ${(demo.gender || '').toLowerCase() === 'female' ? 'selected' : ''}>Female</option>
                                <option value="Other" ${(demo.gender || '').toLowerCase() === 'other' ? 'selected' : ''}>Other</option>
                            </select>
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px;">
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Phone</label>
                            <input id="editPhone" value="${demo.phone_primary || ''}" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                        </div>
                        <div>
                            <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Email</label>
                            <input id="editEmail" type="email" value="${demo.email || ''}" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                        </div>
                    </div>
                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:4px; font-weight:600;">Address</label>
                        <input id="editAddress" value="${demo.address_line_1 || ''}" placeholder="Street address" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit; margin-bottom:8px;">
                        <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:8px;">
                            <input id="editCity" value="${demo.city || ''}" placeholder="City" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                            <input id="editState" value="${demo.state || ''}" placeholder="State" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                            <input id="editZip" value="${demo.zip || ''}" placeholder="ZIP" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                        </div>
                    </div>
                    <div id="editDemoError" style="display:none; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:12px;"></div>
                    <div id="editDemoSuccess" style="display:none; padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:13px; margin-bottom:12px;"></div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="document.getElementById('editDemoModal').remove()">Cancel</button>
                    <button class="btn-primary" id="editDemoSubmitBtn" onclick="submitDemographicsEdit('${patientId}')">💾 Save & Sync</button>
                </div>
            </div>
        </div>
    `);
}

async function submitDemographicsEdit(patientId) {
    const btn = document.getElementById('editDemoSubmitBtn');
    const errorEl = document.getElementById('editDemoError');
    const successEl = document.getElementById('editDemoSuccess');

    const payload = {
        first_name: document.getElementById('editFirstName')?.value?.trim(),
        last_name: document.getElementById('editLastName')?.value?.trim(),
        dob: parseDobToISO(document.getElementById('editDOB')?.value) || '',
        gender: document.getElementById('editGender')?.value,
        phone_primary: document.getElementById('editPhone')?.value?.trim(),
        email: document.getElementById('editEmail')?.value?.trim(),
        address_line_1: document.getElementById('editAddress')?.value?.trim(),
        city: document.getElementById('editCity')?.value?.trim(),
        state: document.getElementById('editState')?.value?.trim(),
        zip: document.getElementById('editZip')?.value?.trim(),
    };

    if (!payload.first_name || !payload.last_name) {
        errorEl.textContent = 'First and last name are required';
        errorEl.style.display = 'block';
        return;
    }

    btn.textContent = 'Saving…';
    btn.disabled = true;
    errorEl.style.display = 'none';

    try {
        const resp = await apiFetch(`/ops/api/ipad/patient/${patientId}/demographics/`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (resp.error) throw new Error(resp.error);

        const syncDetails = [];
        if (resp.healthie_synced) syncDetails.push('Healthie ✅');
        if (resp.ghl_synced) syncDetails.push('GHL ✅');
        syncDetails.push('GMH DB ✅');

        successEl.textContent = `Profile updated (${syncDetails.join(', ')})`;
        successEl.style.display = 'block';

        btn.textContent = '✅ Saved';
        // Clear cache and reload
        delete patient360Cache[patientId];
        setTimeout(() => {
            document.getElementById('editDemoModal')?.remove();
            invalidatePatientCache(patientId);
            loadPatient360(patientId, true);
        }, 1500);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Failed to save';
        errorEl.style.display = 'block';
        btn.textContent = '💾 Save & Sync';
        btn.disabled = false;
    }
}

// ─── ICD-10 DIAGNOSIS SEARCH ──────────────────────
let icd10SearchTimeout;
async function searchICD10(query) {
    clearTimeout(icd10SearchTimeout);
    const resultsDiv = document.getElementById('icd10Results');

    if (!query || query.length < 2) {
        resultsDiv.style.display = 'none';
        return;
    }

    icd10SearchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch(`/ops/api/ipad/icd10-search/?q=${encodeURIComponent(query)}`);
            const data = await resp.json();

            if (!data.success || !data.results || data.results.length === 0) {
                resultsDiv.innerHTML = '<div style="padding:8px; color:var(--text-tertiary); font-size:11px;">No diagnoses found</div>';
                resultsDiv.style.display = 'block';
                return;
            }

            resultsDiv.innerHTML = data.results.map(item => `
                <div onclick="selectICD10('${item.code}', '${item.description.replace(/'/g, "\\'")}')"
                     style="padding:8px; cursor:pointer; border-bottom:1px solid var(--border); transition:background 0.15s;"
                     onmouseover="this.style.background='rgba(168,85,247,0.1)'"
                     onmouseout="this.style.background='transparent'">
                    <div style="font-size:12px; color:var(--text-primary); font-weight:500;">${item.code}</div>
                    <div style="font-size:10px; color:var(--text-secondary); margin-top:2px;">${item.description}</div>
                </div>
            `).join('');
            resultsDiv.style.display = 'block';
        } catch (error) {
            console.error('[ICD10 Search] Error:', error);
            resultsDiv.innerHTML = '<div style="padding:8px; color:#ef4444; font-size:11px;">Search failed</div>';
            resultsDiv.style.display = 'block';
        }
    }, 300);
}

function selectICD10(code, description) {
    document.getElementById('selectedICD10Code').value = code;
    document.getElementById('selectedICD10Desc').value = description;
    document.getElementById('diagnosisSearch').value = '';
    document.getElementById('icd10Results').style.display = 'none';

    const selectedDiv = document.getElementById('selectedDiagnosis');
    const selectedText = document.getElementById('selectedDiagnosisText');
    selectedText.innerHTML = `<span style="font-family:monospace; font-weight:600; color:#a855f7;">${code}</span> — ${description}`;
    selectedDiv.style.display = 'block';

    const submitBtn = document.getElementById('diagnosisSubmitBtn');
    const submitText = document.getElementById('diagnosisSubmitText');
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    submitText.textContent = 'Add Diagnosis';
}

async function removeDiagnosis(code, description) {
    // Use chart panel context — these are always set when a chart is open
    const healthieId = chartPanelData?.healthie_id || chartPanelPatientId;
    if (!healthieId) {
        showToast('No patient selected', 'error');
        return;
    }

    const diagnosisText = description ? `${code} — ${description}` : code;
    if (!confirm(`Are you sure you want to remove this working diagnosis?\n\n${diagnosisText}\n\nThis will also be documented in Healthie.`)) return;

    showToast('Removing diagnosis…', 'info');
    try {
        const resp = await fetch('/ops/api/ipad/patient-data/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                action: 'remove_diagnosis',
                healthie_id: healthieId,
                code: code,
                description: description
            })
        });

        const data = await resp.json();
        if (data.success) {
            showToast('Diagnosis removed ✅', 'success');
            // Reload chart to refresh diagnoses
            if (chartPanelPatientId) {
                await loadChartData(chartPanelPatientId);
            }
        } else {
            showToast('Failed to remove: ' + (data.error || 'Unknown error'), 'error');
        }
    } catch (error) {
        console.error('[Remove Diagnosis] Error:', error);
        showToast('Failed to remove diagnosis', 'error');
    }
}

// ─── START SCRIBE FROM PATIENT PROFILE ──────────────────────
function startScribeFromProfile(patientId, patientName) {
    // Pre-fill the scribe session with the patient info
    scribePatientId = patientId;
    scribePatientName = patientName;
    scribeView = 'new';

    // Switch to scribe tab
    window.location.hash = '#scribe';

    // After tab switches, auto-fill the patient in the scribe form
    setTimeout(() => {
        const patientInput = document.getElementById('scribePatientSearch');
        if (patientInput) patientInput.value = patientName;
        const patientIdInput = document.getElementById('scribePatientId');
        if (patientIdInput) patientIdInput.value = patientId;
    }, 300);
}

// ==================== FINANCIAL MANAGEMENT FUNCTIONS ====================
async function updateBillingInfo() {
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    const healthieId = chartPanelData?.healthie_id;
    const patientName = chartPanelData?.demographics?.full_name || 'Patient';
    const patientEmail = chartPanelData?.demographics?.email || '';
    const paymentMethods = chartPanelData?.payment_methods || [];

    if (!patientId || !healthieId) {
        showToast('No patient selected', 'error');
        return;
    }

    // Show card management modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        padding: 20px;
    `;
    modal.innerHTML = `
        <div style="background: var(--card); border-radius: 12px; padding: 24px; max-width: 500px; width: 100%;">
            <h3 style="margin: 0 0 16px; color: var(--text-primary); font-size: 18px;">💳 Manage Payment Methods</h3>
            <div style="color: var(--text-secondary); font-size: 13px; margin-bottom: 20px;">
                ${patientName}
            </div>

            ${paymentMethods.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 8px;">Cards on File</div>
                    ${paymentMethods.map(pm => {
                        const isDirectStripe = pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_');
                        const bgColor = isDirectStripe ? 'rgba(240,147,251,0.08)' : 'rgba(16,185,129,0.08)';
                        const borderColor = isDirectStripe ? 'rgba(240,147,251,0.3)' : 'rgba(16,185,129,0.3)';
                        return `
                        <div style="background: ${bgColor}; border: 1px solid ${borderColor}; padding: 12px; border-radius: 6px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
                            <div style="flex: 1;">
                                <div style="color: var(--text-primary); font-size: 14px;">${isDirectStripe ? '💳 Billing Card (Direct)' : '🏥 Healthie Card'} ****${pm.last_four || '****'}</div>
                                <div style="color: var(--text-tertiary); font-size: 12px;">${isDirectStripe ? 'For products, services, peptides' : 'Managed in Healthie — subscriptions only'}</div>
                                <div style="color: var(--text-tertiary); font-size: 11px;">Expires ${pm.expiration || 'N/A'} · ZIP ${pm.zip || 'N/A'}</div>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                ${pm.is_default ? '<div style="background: #10b981; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px;">Default</div>' : ''}
                                ${isDirectStripe ? `<button onclick="deletePaymentMethod('${pm.id.replace('direct_', '')}')" style="background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 11px; cursor: pointer; font-weight: 600;">🗑️ Delete</button>` : ''}
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            ` : ''}

            <div style="margin-bottom: 16px;">
                <div style="font-size: 12px; font-weight: 600; color: #f093fb; text-transform: uppercase; margin-bottom: 8px;">
                    💳 Bill Patient for Product/Service
                </div>
                <button onclick="manageDualStripeCards()" style="
                    width: 100%; padding: 14px;
                    background: linear-gradient(135deg, #f093fb, #f5576c);
                    color: white; border: none; border-radius: 8px;
                    font-size: 14px; font-weight: 600; cursor: pointer;
                ">
                    ➕ Add Card for Billing
                </button>
                <div style="font-size: 11px; color: var(--text-tertiary); margin-top: 6px; padding: 0 4px;">
                    For today's visit, supplements, peptides, or any product/service
                </div>
            </div>

            <button onclick="closeBillingModal()" style="
                width: 100%; padding: 12px;
                background: transparent; color: var(--text-tertiary); border: 1px solid var(--border-light);
                border-radius: 8px; font-size: 13px; cursor: pointer;
            ">Close</button>
        </div>
    `;
    document.body.appendChild(modal);
    window._billingModal = modal;
}

function closeBillingModal() {
    if (window._billingModal) {
        window._billingModal.remove();
        delete window._billingModal;
    }
}

async function deletePaymentMethod(paymentMethodId) {
    const patientName = chartPanelData?.demographics?.full_name || 'this patient';

    if (!confirm(`Are you sure you want to delete this payment method?\n\nThis cannot be undone.`)) {
        return;
    }

    try {
        const response = await apiFetch(`/ops/api/ipad/billing/delete-card?payment_method_id=${encodeURIComponent(paymentMethodId)}`, {
            method: 'DELETE'
        });

        if (response.success) {
            showToast('✅ Payment method deleted successfully', 'success');
            closeBillingModal();
            // Reload patient chart to reflect changes
            if (chartPanelData?.demographics?.patient_id) {
                await loadChartData(chartPanelData.demographics.patient_id);
            }
        } else {
            throw new Error(response.error || 'Failed to delete payment method');
        }
    } catch (error) {
        console.error('[deletePaymentMethod]', error);
        showToast(`❌ Error: ${error.message || 'Failed to delete card'}`, 'error');
    }
}

async function manageDualStripeCards() {
    closeBillingModal();

    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    const healthieId = chartPanelData?.healthie_id;
    const patientName = chartPanelData?.demographics?.full_name || 'Patient';
    const patientEmail = chartPanelData?.demographics?.email || '';

    if (!patientId || !healthieId) {
        showToast('Error: Missing patient information', 'error');
        return;
    }

    // Open Stripe Elements card collection page in popup
    const width = 550;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const popup = window.open(
        `/ops/ipad/add-card.html?patient_id=${encodeURIComponent(patientId)}&patient_name=${encodeURIComponent(patientName)}&patient_email=${encodeURIComponent(patientEmail)}&healthie_id=${encodeURIComponent(healthieId)}`,
        'addCard',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );

    if (!popup) {
        showToast('Please allow popups to add cards', 'error');
        return;
    }

    // Listen for success message from popup
    window.addEventListener('message', async function handler(event) {
        if (event.data.type === 'card_added' && event.data.success) {
            window.removeEventListener('message', handler);
            showToast('✅ Card added to Direct Stripe!', 'success');
            // Reload patient chart
            if (chartPanelData?.demographics?.patient_id) {
                await loadChartData(chartPanelData.demographics.patient_id);
            }
        }
    });
}

function closeCardModal() {
    if (window._cardModal) {
        window._cardModal.remove();
        delete window._cardModal;
    }
}

// ==================== ASSIGN PACKAGE MODAL ====================
async function showAssignPackageModal() {
    const healthieId = chartPanelData?.healthie_id;
    if (!healthieId) {
        showToast('Cannot assign package — patient not linked to Healthie', 'error');
        return;
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'assignPackageOverlay';
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:10000; display:flex; align-items:center; justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--card); border:1px solid var(--border); border-radius:12px; width:90%; max-width:480px; max-height:80vh; overflow-y:auto; padding:20px;';

    modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <h3 style="margin:0; color:var(--text-primary); font-size:16px;">📦 Assign Healthie Package</h3>
            <button onclick="document.getElementById('assignPackageOverlay').remove()" style="background:none; border:none; color:var(--text-secondary); font-size:20px; cursor:pointer;">&times;</button>
        </div>
        <div id="assignPackageList" style="color:var(--text-secondary); font-size:13px; text-align:center; padding:24px 0;">Loading packages...</div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Fetch packages
    try {
        const resp = await fetch('/ops/api/ipad/billing/assign-package/', { credentials: 'include' });
        const data = await resp.json();

        if (!data.success || !data.packages?.length) {
            document.getElementById('assignPackageList').innerHTML = '<div style="color:var(--text-tertiary);">No packages available in Healthie</div>';
            return;
        }

        const formatFreq = (f) => {
            const map = { one_time: 'One-time', weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
            return map[f] || f || '';
        };

        const listHtml = data.packages.map(pkg => `
            <div style="background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div style="flex:1;">
                        <div style="font-weight:600; color:var(--text-primary); font-size:13px;">${pkg.name}</div>
                        <div style="color:var(--text-secondary); font-size:11px; margin-top:2px;">
                            ${pkg.price ? '$' + parseFloat(pkg.price).toFixed(2) : ''} ${formatFreq(pkg.billing_frequency)}
                        </div>
                        ${pkg.description ? `<div style="color:var(--text-tertiary); font-size:10px; margin-top:4px;">${pkg.description}</div>` : ''}
                    </div>
                    <button onclick="assignPackageToPatient('${pkg.id}', '${pkg.name.replace(/'/g, "\\'")}')" style="padding:6px 14px; background:var(--purple); color:white; border:none; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap; margin-left:8px;">
                        Assign
                    </button>
                </div>
            </div>
        `).join('');

        document.getElementById('assignPackageList').innerHTML = listHtml;
    } catch (err) {
        console.error('[showAssignPackageModal] Failed to load packages:', err);
        document.getElementById('assignPackageList').innerHTML = '<div style="color:var(--red);">Failed to load packages</div>';
    }
}

async function assignPackageToPatient(packageId, packageName) {
    const healthieId = chartPanelData?.healthie_id;
    if (!healthieId) {
        showToast('Patient not linked to Healthie', 'error');
        return;
    }

    try {
        const resp = await fetch('/ops/api/ipad/billing/assign-package/', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ healthie_id: healthieId, package_id: packageId }),
        });
        const data = await resp.json();

        if (!data.success) {
            showToast(data.error || 'Failed to assign package', 'error');
            return;
        }

        showToast(`Assigned "${packageName}" successfully`, 'success');

        // Close modal
        const overlay = document.getElementById('assignPackageOverlay');
        if (overlay) overlay.remove();

        // Reload chart data to reflect the new package
        if (chartPanelPatientId) {
            loadChartPanelData(chartPanelPatientId);
        }
    } catch (err) {
        console.error('[assignPackageToPatient] Error:', err);
        showToast('Failed to assign package', 'error');
    }
}

async function chargePatient() {
    const patientId = chartPanelData?.demographics?.patient_id || chartPanelPatientId;
    const healthieId = chartPanelData?.healthie_id;
    const patientName = chartPanelData?.demographics?.full_name || 'Patient';
    const paymentMethods = chartPanelData?.payment_methods || [];

    // Check for a Direct Stripe card
    const directCards = paymentMethods.filter(pm =>
        pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_')
    );

    if (directCards.length === 0) {
        showToast('No billing card on file. Add a card first.', 'error');
        return;
    }

    showProductSearchModal({
        patientId,
        healthieId,
        patientName,
        paymentMethods
    });
}

// === Product Search Modal ===

function showProductSearchModal(patientData) {
    const { patientId, healthieId, patientName, paymentMethods } = patientData;

    const directCards = paymentMethods.filter(pm =>
        pm.source_type === 'direct_stripe' || pm.id?.startsWith('direct_pm_')
    );
    const defaultCard = directCards.find(c => c.is_default) || directCards[0];

    if (!defaultCard) {
        showToast('No billing card on file. Please add a card first.', 'error');
        return;
    }

    const modal = document.createElement('div');
    modal.id = 'product-search-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;

    modal.innerHTML = `
        <div style="
            background: var(--bg-primary, #1a1a2e); border-radius: 16px;
            width: 90%; max-width: 500px; max-height: 85vh;
            overflow: hidden; border: 1px solid var(--border-color, #2d2d4a);
            display: flex; flex-direction: column;
        ">
            <!-- Header -->
            <div style="padding: 20px 24px 16px; border-bottom: 1px solid var(--border-color, #2d2d4a);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-size: 18px; font-weight: 700; color: var(--text-primary, #fff);">
                            Bill Patient
                        </div>
                        <div style="font-size: 13px; color: var(--text-secondary, #aaa); margin-top: 4px;">
                            ${patientName} - Card ending ${defaultCard.last_four || '****'}
                        </div>
                    </div>
                    <button onclick="document.getElementById('product-search-modal')?.remove()" style="
                        background: none; border: none; color: var(--text-secondary, #aaa);
                        font-size: 24px; cursor: pointer; padding: 4px;
                    ">X</button>
                </div>

                <!-- Search Input -->
                <div style="margin-top: 16px; position: relative;">
                    <input
                        type="text"
                        id="product-search-input"
                        placeholder="Search peptides... (e.g. bpc157, tesamorelin)"
                        oninput="handleProductSearch(this.value)"
                        autocomplete="off"
                        style="
                            width: 100%; padding: 12px 16px; padding-left: 40px;
                            background: var(--bg-secondary, #16162a);
                            border: 1px solid var(--border-color, #2d2d4a);
                            border-radius: 10px; color: var(--text-primary, #fff);
                            font-size: 15px; outline: none; box-sizing: border-box;
                        "
                    />
                    <span style="position: absolute; left: 14px; top: 50%; transform: translateY(-50%); font-size: 16px;">&#128269;</span>
                </div>
            </div>

            <!-- Product Results -->
            <div id="product-search-results" style="
                flex: 1; overflow-y: auto; padding: 8px 16px;
                max-height: 45vh;
            ">
                <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                    Type to search products or choose Custom Charge below
                </div>
            </div>

            <!-- Cart -->
            <div id="billing-cart" style="display: none; padding: 8px 16px; border-top: 1px solid var(--border-color, #2d2d4a);"></div>

            <!-- Footer: Custom Charge Option -->
            <div style="padding: 16px 24px; border-top: 1px solid var(--border-color, #2d2d4a);">
                <button onclick="showCustomChargeForm('${patientId}', '${healthieId}', '${patientName.replace(/'/g, "\\'")}')" style="
                    width: 100%; padding: 12px;
                    background: transparent;
                    border: 1px dashed var(--border-color, #2d2d4a);
                    border-radius: 8px; color: var(--text-secondary, #aaa);
                    font-size: 13px; cursor: pointer;
                ">
                    Custom Charge (enter amount manually)
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('product-search-input')?.focus(), 100);
    window._currentChargePatient = patientData;
    window._cartDiscountPct = 0;
    // Load existing cart from server (may have items added by other providers)
    loadServerCart();
}

let _productSearchTimeout = null;

function handleProductSearch(query) {
    clearTimeout(_productSearchTimeout);

    if (!query || query.length < 2) {
        document.getElementById('product-search-results').innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                Type at least 2 characters to search
            </div>
        `;
        return;
    }

    document.getElementById('product-search-results').innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-secondary, #aaa);">
            Searching...
        </div>
    `;

    _productSearchTimeout = setTimeout(async () => {
        try {
            const resp = await fetch('/ops/api/ipad/billing/products/?q=' + encodeURIComponent(query), {
                credentials: 'include'
            });
            const data = await resp.json();

            if (!data.success || !data.products?.length) {
                document.getElementById('product-search-results').innerHTML = `
                    <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
                        No products found for "${query}"
                    </div>
                `;
                return;
            }

            const resultsHtml = data.products.map(p => `
                <div onclick='selectProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})' style="
                    padding: 14px 16px; margin: 6px 0;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a);
                    border-radius: 10px; cursor: pointer;
                    transition: all 0.15s ease;
                " onmouseover="this.style.borderColor='#f093fb'" onmouseout="this.style.borderColor='var(--border-color, #2d2d4a)'">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <div style="flex: 1;">
                            <div style="font-size: 14px; font-weight: 600; color: var(--text-primary, #fff);">
                                ${p.name}
                            </div>
                            <div style="font-size: 11px; color: var(--text-tertiary, #666); margin-top: 4px;">
                                ${p.supplier || 'No supplier'} ${p.category ? '- ' + p.category : ''}
                                <span style="margin-left: 8px; padding: 2px 6px; border-radius: 4px; font-weight: 600;
                                    ${parseInt(p.current_stock) > 0
                                        ? 'background: rgba(16,185,129,0.15); color: #10b981;'
                                        : 'background: rgba(239,68,68,0.15); color: #ef4444;'
                                    }">
                                    ${parseInt(p.current_stock) > 0 ? parseInt(p.current_stock) + ' in stock' : 'Out of stock'}
                                </span>
                            </div>
                        </div>
                        <div style="
                            font-size: 18px; font-weight: 700; color: #f093fb;
                            min-width: 70px; text-align: right;
                        ">
                            $${parseFloat(p.price || 0).toFixed(2)}
                        </div>
                    </div>
                </div>
            `).join('');

            document.getElementById('product-search-results').innerHTML = resultsHtml;
        } catch (err) {
            console.error('Product search error:', err);
            document.getElementById('product-search-results').innerHTML = `
                <div style="text-align: center; padding: 20px; color: #ef4444;">
                    Search failed. Please try again.
                </div>
            `;
        }
    }, 300);
}

// === Shopping Cart (server-persisted per patient) ===
window._billingCart = [];

async function selectProduct(product) {
    const patient = window._currentChargePatient;
    if (!patient) return;

    // Save to server
    try {
        await fetch('/ops/api/ipad/billing/cart/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                patient_id: patient.healthieId || patient.patientId,
                patient_name: patient.patientName,
                product_id: product.product_id,
                product_name: product.name,
                price: parseFloat(product.price || 0),
                quantity: 1
            })
        });
    } catch (err) {
        console.error('Failed to save cart item:', err);
    }

    // Reload cart from server
    await loadServerCart();
    showToast('Added ' + product.name + ' to cart', 'success');

    // Clear search and refocus
    const searchInput = document.getElementById('product-search-input');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    document.getElementById('product-search-results').innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: var(--text-tertiary, #666);">
            Type to search products or choose Custom Charge below
        </div>
    `;
}

async function loadServerCart() {
    const patient = window._currentChargePatient;
    if (!patient) return;

    try {
        const resp = await fetch('/ops/api/ipad/billing/cart/?patient_id=' + encodeURIComponent(patient.healthieId || patient.patientId), {
            credentials: 'include'
        });
        const data = await resp.json();
        if (data.success && data.items) {
            window._billingCart = data.items.map(item => ({
                id: item.id,
                product_id: item.product_id,
                name: item.product_name,
                price: parseFloat(item.price),
                amount: parseFloat(item.price) * item.quantity,
                quantity: item.quantity,
                current_stock: parseInt(item.current_stock) || 0,
                added_by: item.added_by
            }));
        } else {
            window._billingCart = [];
        }
    } catch (err) {
        console.error('Failed to load cart:', err);
    }
    renderCart();
}

function renderCart() {
    const cartArea = document.getElementById('billing-cart');
    if (!cartArea) return;

    const cart = window._billingCart || [];
    if (cart.length === 0) {
        cartArea.style.display = 'none';
        return;
    }

    cartArea.style.display = 'block';
    const subtotal = cart.reduce((sum, item) => sum + item.amount, 0);
    const isPhil = currentUser && currentUser.email === 'admin@nowoptimal.com';

    cartArea.innerHTML = `
        <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary, #aaa); text-transform: uppercase; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center;">
            <span>Cart (${cart.length} item${cart.length > 1 ? 's' : ''})</span>
            <button onclick="clearCart()" style="background: none; border: none; color: #ef4444; font-size: 11px; cursor: pointer; font-weight: 600;">Clear All</button>
        </div>
        ${cart.map((item, idx) => `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; margin-bottom: 4px;
                background: var(--bg-secondary, #16162a); border-radius: 8px; border: 1px solid var(--border-color, #2d2d4a);">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 13px; color: var(--text-primary, #fff); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${item.name}
                    </div>
                    <div style="font-size: 11px; color: var(--text-tertiary, #666); display: flex; align-items: center; gap: 6px;">
                        <span style="padding: 1px 4px; border-radius: 3px; font-weight: 600;
                            ${item.current_stock > 0 ? 'background: rgba(16,185,129,0.15); color: #10b981;' : 'background: rgba(239,68,68,0.15); color: #ef4444;'}">
                            ${item.current_stock > 0 ? item.current_stock + ' in stock' : 'Out of stock'}
                        </span>
                        ${item.added_by ? '<span style="color: var(--text-tertiary, #555);">by ' + item.added_by.split('@')[0] + '</span>' : ''}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 4px; background: var(--bg-primary, #1a1a2e); border-radius: 6px; padding: 2px;">
                        <button onclick="updateCartQty(${idx}, -1)" style="width: 26px; height: 26px; background: none; border: none; color: var(--text-secondary, #aaa); font-size: 16px; cursor: pointer; border-radius: 4px;">-</button>
                        <span style="font-size: 13px; color: var(--text-primary, #fff); font-weight: 600; min-width: 20px; text-align: center;">${item.quantity}</span>
                        <button onclick="updateCartQty(${idx}, 1)" style="width: 26px; height: 26px; background: none; border: none; color: var(--text-secondary, #aaa); font-size: 16px; cursor: pointer; border-radius: 4px;">+</button>
                    </div>
                    <div style="font-size: 14px; font-weight: 700; color: #f093fb; min-width: 55px; text-align: right;">$${item.amount.toFixed(2)}</div>
                    <button onclick="removeFromCart(${idx})" style="background: none; border: none; color: #ef4444; font-size: 14px; cursor: pointer; padding: 2px;">&#10005;</button>
                </div>
            </div>
        `).join('')}

        ${isPhil ? `
            <div style="margin-top: 8px; padding: 8px 10px; background: rgba(240,147,251,0.06); border: 1px solid rgba(240,147,251,0.2); border-radius: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="font-size: 12px; color: #f093fb; font-weight: 600; white-space: nowrap;">Discount %</label>
                    <input type="number" id="cart-discount-pct" min="0" max="100" step="1" value="${window._cartDiscountPct || 0}"
                        oninput="window._cartDiscountPct = parseInt(this.value) || 0; renderCart();"
                        style="width: 60px; padding: 4px 8px; background: var(--bg-primary, #1a1a2e); border: 1px solid var(--border-color, #2d2d4a); border-radius: 6px; color: #f093fb; font-size: 14px; font-weight: 700; text-align: center;" />
                    <div style="flex: 1; display: flex; gap: 4px;">
                        ${[10, 15, 20, 25].map(pct => `
                            <button onclick="window._cartDiscountPct = ${pct}; document.getElementById('cart-discount-pct').value = ${pct}; renderCart();"
                                style="padding: 4px 8px; background: ${(window._cartDiscountPct || 0) === pct ? '#f093fb' : 'var(--bg-primary, #1a1a2e)'};
                                border: 1px solid rgba(240,147,251,0.3); border-radius: 4px;
                                color: ${(window._cartDiscountPct || 0) === pct ? '#fff' : '#f093fb'}; font-size: 11px; cursor: pointer; font-weight: 600;">${pct}%</button>
                        `).join('')}
                    </div>
                </div>
            </div>
        ` : ''}

        <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border-color, #2d2d4a);">
            ${(window._cartDiscountPct || 0) > 0 ? `
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--text-tertiary, #666); margin-bottom: 4px;">
                    <span>Subtotal</span><span>$${subtotal.toFixed(2)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 13px; color: #f093fb; margin-bottom: 8px;">
                    <span>Discount (${window._cartDiscountPct}%)</span><span>-$${(subtotal * (window._cartDiscountPct || 0) / 100).toFixed(2)}</span>
                </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 16px; font-weight: 700; color: var(--text-primary, #fff);">
                    Total: $${(subtotal * (1 - (window._cartDiscountPct || 0) / 100)).toFixed(2)}
                </div>
                <button onclick="checkoutCart()" style="
                    padding: 10px 24px;
                    background: linear-gradient(135deg, #f093fb, #f5576c);
                    border: none; border-radius: 8px;
                    color: white; font-size: 14px; font-weight: 700; cursor: pointer;
                ">Charge $${(subtotal * (1 - (window._cartDiscountPct || 0) / 100)).toFixed(2)}</button>
            </div>
        </div>
    `;
}

async function updateCartQty(index, delta) {
    const cart = window._billingCart;
    if (!cart[index]) return;
    const newQty = Math.max(1, cart[index].quantity + delta);

    try {
        await fetch('/ops/api/ipad/billing/cart/', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: cart[index].id, quantity: newQty })
        });
    } catch (err) {
        console.error('Failed to update qty:', err);
    }
    await loadServerCart();
}

async function removeFromCart(index) {
    const cart = window._billingCart;
    if (!cart[index]) return;

    try {
        await fetch('/ops/api/ipad/billing/cart/?id=' + cart[index].id, {
            method: 'DELETE',
            credentials: 'include'
        });
    } catch (err) {
        console.error('Failed to remove item:', err);
    }
    await loadServerCart();
}

async function clearCart() {
    const patient = window._currentChargePatient;
    if (!patient) return;

    try {
        await fetch('/ops/api/ipad/billing/cart/?patient_id=' + encodeURIComponent(patient.healthieId || patient.patientId), {
            method: 'DELETE',
            credentials: 'include'
        });
    } catch (err) {
        console.error('Failed to clear cart:', err);
    }
    window._cartDiscountPct = 0;
    await loadServerCart();
}

async function checkoutCart() {
    const patient = window._currentChargePatient;
    const cart = window._billingCart;
    if (!patient || cart.length === 0) return;

    const subtotal = cart.reduce((sum, item) => sum + item.amount, 0);
    const discountPct = window._cartDiscountPct || 0;
    const total = subtotal * (1 - discountPct / 100);
    const itemNames = cart.map(item => item.quantity > 1 ? item.name + ' x' + item.quantity : item.name).join(', ');
    const desc = discountPct > 0 ? itemNames + ' (' + discountPct + '% discount)' : itemNames;

    const modal = document.getElementById('product-search-modal');
    if (modal) {
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
    }

    try {
        showToast('Processing charge...', 'info');
        const response = await fetch('/ops/api/ipad/billing/charge/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                patient_id: patient.healthieId || patient.patientId,
                amount: Math.round(total * 100) / 100,
                description: desc,
                stripe_account: 'direct',
                items: cart.map(item => ({
                    product_id: item.product_id,
                    name: item.name,
                    amount: Math.round(item.amount * (1 - discountPct / 100) * 100) / 100,
                    quantity: item.quantity
                }))
            })
        });

        const result = await response.json();

        if (result.success) {
            // Clear server cart for this patient
            try {
                await fetch('/ops/api/ipad/billing/cart/?patient_id=' + encodeURIComponent(patient.healthieId || patient.patientId), {
                    method: 'DELETE', credentials: 'include'
                });
            } catch (e) { /* ignore */ }

            modal?.remove();
            window._billingCart = [];
            window._cartDiscountPct = 0;

            showChargeSuccess({
                patientName: patient.patientName,
                amount: total,
                description: desc,
                chargeId: result.charge_id,
                productId: cart[0]?.product_id,
                dispenseId: result.dispense_id,
                dispenseIds: result.dispense_ids,
                paymentMethod: result.payment_method,
                itemCount: cart.length
            });

            showToast('Charged ' + patient.patientName + ' $' + total.toFixed(2), 'success');

            if (typeof loadPatientPaymentData === 'function') {
                loadPatientPaymentData(patient.healthieId || patient.patientId);
            }
        } else {
            showToast('Charge failed: ' + (result.error || 'Unknown error'), 'error');
            if (modal) {
                const buttons = modal.querySelectorAll('button');
                buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
            }
        }
    } catch (err) {
        console.error('Cart charge error:', err);
        showToast('Network error - check before retrying.', 'error');
        if (modal) {
            const buttons = modal.querySelectorAll('button');
            buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
        }
    }
}

function showCustomChargeForm(patientId, healthieId, patientName) {
    const modal = document.getElementById('product-search-modal');
    if (!modal) return;

    modal.querySelector('div').innerHTML = `
        <div style="padding: 24px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
                <button onclick="document.getElementById('product-search-modal')?.remove(); showProductSearchModal(window._currentChargePatient);" style="
                    background: none; border: none; color: var(--text-secondary, #aaa);
                    font-size: 18px; cursor: pointer;
                ">&#8592;</button>
                <div style="font-size: 18px; font-weight: 700; color: var(--text-primary, #fff);">
                    Custom Charge
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <label style="font-size: 12px; color: var(--text-secondary, #aaa); text-transform: uppercase;">Amount ($)</label>
                <input type="number" id="custom-charge-amount" step="0.01" min="0.01" placeholder="0.00" style="
                    width: 100%; padding: 12px; margin-top: 6px;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 8px;
                    color: var(--text-primary, #fff); font-size: 18px; font-weight: 700;
                    box-sizing: border-box;
                " />
            </div>

            <div style="margin-bottom: 24px;">
                <label style="font-size: 12px; color: var(--text-secondary, #aaa); text-transform: uppercase;">Description</label>
                <input type="text" id="custom-charge-description" placeholder="Reason for charge..." style="
                    width: 100%; padding: 12px; margin-top: 6px;
                    background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 8px;
                    color: var(--text-primary, #fff); font-size: 14px;
                    box-sizing: border-box;
                " />
            </div>

            <div style="display: flex; gap: 12px;">
                <button onclick="document.getElementById('product-search-modal')?.remove()" style="
                    flex: 1; padding: 14px; background: var(--bg-secondary, #16162a);
                    border: 1px solid var(--border-color, #2d2d4a); border-radius: 10px;
                    color: var(--text-secondary, #aaa); font-size: 14px; font-weight: 600; cursor: pointer;
                ">Cancel</button>
                <button onclick="executeCustomCharge('${patientId}', '${healthieId}', '${(patientName || '').replace(/'/g, "\\'")}')" style="
                    flex: 2; padding: 14px;
                    background: linear-gradient(135deg, #f093fb, #f5576c);
                    border: none; border-radius: 10px;
                    color: white; font-size: 14px; font-weight: 700; cursor: pointer;
                ">Charge</button>
            </div>
        </div>
    `;

    setTimeout(() => document.getElementById('custom-charge-amount')?.focus(), 100);
}

async function executeCustomCharge(patientId, healthieId, patientName) {
    const amount = parseFloat(document.getElementById('custom-charge-amount')?.value);
    const description = document.getElementById('custom-charge-description')?.value?.trim();

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }
    if (!description) {
        showToast('Please enter a description', 'error');
        return;
    }

    await processCharge({
        patientId,
        healthieId,
        patientName,
        amount,
        description,
        productId: null,
        stripeAccount: 'direct'
    });
}

async function executeProductCharge(productId, productName, amount) {
    const patient = window._currentChargePatient;
    if (!patient) return;

    const chargeAmount = parseFloat(amount);
    if (!chargeAmount || chargeAmount <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    await processCharge({
        patientId: patient.patientId,
        healthieId: patient.healthieId,
        patientName: patient.patientName,
        amount: chargeAmount,
        description: productName,
        productId: productId,
        stripeAccount: 'direct'
    });
}

async function processCharge({ patientId, healthieId, patientName, amount, description, productId, stripeAccount }) {
    const modal = document.getElementById('product-search-modal');
    if (modal) {
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
    }

    try {
        showToast('Processing charge...', 'info');
        const response = await fetch('/ops/api/ipad/billing/charge/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                patient_id: healthieId || patientId,
                amount: amount,
                description: description,
                stripe_account: stripeAccount,
                product_id: productId
            })
        });

        const result = await response.json();

        if (result.success) {
            modal?.remove();

            showChargeSuccess({
                patientName,
                amount,
                description,
                chargeId: result.charge_id,
                productId: productId,
                dispenseId: result.dispense_id,
                paymentMethod: result.payment_method
            });

            showToast('Charged ' + patientName + ' $' + amount.toFixed(2) + ' for ' + description, 'success');

            if (typeof loadPatientPaymentData === 'function') {
                loadPatientPaymentData(healthieId || patientId);
            }
        } else {
            showToast('Charge failed: ' + (result.error || 'Unknown error'), 'error');
            if (modal) {
                const buttons = modal.querySelectorAll('button');
                buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
            }
        }
    } catch (err) {
        console.error('Charge error:', err);
        showToast('Network error - charge may not have processed. Check before retrying.', 'error');
        if (modal) {
            const buttons = modal.querySelectorAll('button');
            buttons.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
        }
    }
}

function showChargeSuccess({ patientName, amount, description, chargeId, productId, dispenseId, dispenseIds, paymentMethod, itemCount }) {
    const isPeptide = productId != null;
    const allDispenseIds = dispenseIds || (dispenseId ? [dispenseId] : []);

    const successModal = document.createElement('div');
    successModal.id = 'charge-success-modal';
    successModal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.7); z-index: 10001;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(4px);
    `;

    successModal.innerHTML = `
        <div style="
            background: var(--bg-primary, #1a1a2e); border-radius: 16px;
            width: 90%; max-width: 420px; padding: 32px 24px;
            border: 1px solid rgba(16, 185, 129, 0.3);
            text-align: center;
        ">
            <div style="font-size: 48px; margin-bottom: 16px;">&#9989;</div>
            <div style="font-size: 20px; font-weight: 700; color: #10b981; margin-bottom: 8px;">
                Payment Successful
            </div>
            <div style="font-size: 14px; color: var(--text-secondary, #aaa); margin-bottom: 24px;">
                ${patientName} - $${parseFloat(amount).toFixed(2)}
                ${itemCount > 1 ? '<br/>' + itemCount + ' items' : ''}
                <br/>${description}
                ${paymentMethod ? '<br/>Card ending ' + paymentMethod.last4 : ''}
            </div>

            ${isPeptide && allDispenseIds.length > 0 ? `
                <div style="margin-bottom: 16px;">
                    <div style="
                        background: rgba(240, 147, 251, 0.08); border: 1px solid rgba(240, 147, 251, 0.2);
                        border-radius: 10px; padding: 12px; margin-bottom: 12px;
                        font-size: 12px; color: var(--text-secondary, #aaa);
                    ">
                        Peptide inventory updated automatically<br/>
                        ${allDispenseIds.length} dispense${allDispenseIds.length > 1 ? 's' : ''} logged for ${patientName}
                    </div>
                    ${allDispenseIds.map(did => `
                        <button onclick="printPeptideLabel(${did})" style="
                            width: 100%; padding: 12px; margin-bottom: 6px;
                            background: linear-gradient(135deg, #3b82f6, #2563eb);
                            border: none; border-radius: 10px;
                            color: white; font-size: 13px; font-weight: 600; cursor: pointer;
                        ">
                            Print Label #${did}
                        </button>
                    `).join('')}
                </div>
            ` : ''}

            <button onclick="document.getElementById('charge-success-modal')?.remove()" style="
                width: 100%; padding: 14px;
                background: var(--bg-secondary, #16162a);
                border: 1px solid var(--border-color, #2d2d4a);
                border-radius: 10px; color: var(--text-primary, #fff);
                font-size: 14px; font-weight: 600; cursor: pointer;
            ">
                Done
            </button>
        </div>
    `;

    document.body.appendChild(successModal);
}

async function printPeptideLabel(dispenseId) {
    if (!dispenseId) {
        showToast('No dispense ID - cannot generate label', 'error');
        return;
    }
    const labelUrl = '/ops/api/ipad/billing/label/?dispense_id=' + dispenseId;
    window.open(labelUrl, '_blank');
    showToast('Label opened - print from new tab', 'success');
}

// sendInvoice() removed per admin request

// ─── HEALTHIE MESSAGES TAB ──────────────────────────────────
var messagesConversations = [];
var messagesCurrentConvo = null;
var messagesCurrentConvoName = null;
var messagesCurrentMessages = [];
var messagesLoading = false;

async function renderMessagesView(container) {
    container.innerHTML = '<div style="padding: 0 4px;">' +
        '<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">' +
        '<div><h1 style="font-size:24px; margin:0; color:var(--text-primary);">Messages</h1>' +
        '<p style="font-size:13px; color:var(--text-tertiary); margin:4px 0 0;">Healthie Messaging</p></div>' +
        '<div style="display:flex; gap:6px;">' +
        '<button onclick="loadMessagesConversations(true)" style="padding:8px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:13px; cursor:pointer;">↻ Refresh</button>' +
        '<button onclick="showNewConversationModal()" style="padding:8px 14px; background:rgba(0,212,255,0.15); border:1px solid rgba(0,212,255,0.3); border-radius:8px; color:var(--cyan); font-size:13px; font-weight:600; cursor:pointer;">+ New</button>' +
        '</div></div>' +
        '<div id="messagesContainer"><div class="loading-spinner" style="margin:40px auto;"></div></div>' +
        '</div>';

    await new Promise(resolve => setTimeout(resolve, 50));
    await loadMessagesConversations();

    // Auto-refresh every 30 seconds
    if (window._messagesPollTimer) clearInterval(window._messagesPollTimer);
    window._messagesPollTimer = setInterval(async function() {
        if (currentTab !== 'messages') { clearInterval(window._messagesPollTimer); return; }
        if (!messagesCurrentConvo) {
            await loadMessagesConversations();
        } else {
            await loadConversationMessages(messagesCurrentConvo, true);
        }
    }, 30000);
}

async function loadMessagesConversations(force) {
    var containerEl = document.getElementById('messagesContainer');
    if (!containerEl) return;
    if (!force && messagesConversations.length > 0) {
        renderConversationList(containerEl);
        return;
    }
    containerEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
    try {
        // Phil (admin) sees all conversations; everyone else sees only their own
        var isPhilAdmin = currentUser && (currentUser.email === 'admin@granitemountainhealth.com' || currentUser.email === 'admin@nowoptimal.com');
        var msgUrl = '/ops/api/ipad/messages/';
        if (!isPhilAdmin && currentUser?.healthie_provider_id) {
            msgUrl += '?provider_id=' + currentUser.healthie_provider_id;
        }
        var data = await apiFetch(msgUrl);
        messagesConversations = data.conversations || [];
        // Update badge
        var unreadCount = messagesConversations.filter(function(c) { return c.unread; }).length;
        var badge = document.getElementById('messagesBadge');
        if (badge) {
            if (unreadCount > 0) { badge.textContent = unreadCount; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }
        renderConversationList(containerEl);
    } catch (e) {
        console.error('[Messages] Load error:', e);
        containerEl.innerHTML = '<div class="empty-state-card"><h3>Could not load messages</h3><p>' + (e.message || 'Network error') + '</p><button onclick="loadMessagesConversations(true)" class="btn-primary" style="margin-top:8px;">Try Again</button></div>';
    }
}

function renderConversationList(containerEl) {
    if (messagesConversations.length === 0) {
        containerEl.innerHTML = '<div class="empty-state-card"><div class="empty-state-icon">💬</div><h3>No Conversations</h3><p>No active conversations found.</p></div>';
        return;
    }
    var html = '';
    messagesConversations.forEach(function(c) {
        var timeStr = c.updated_at ? formatRelativeTime(c.updated_at) : '';
        var unreadDot = c.unread ? '<div style="width:8px; height:8px; border-radius:50%; background:#22d3ee; flex-shrink:0;"></div>' : '';
        var plainMsg = healthieToPlainText(c.last_message || '');
        var preview = plainMsg.substring(0, 80);
        if (plainMsg.length > 80) preview += '...';
        html += '<div onclick="openConversation(\'' + c.id + '\')" style="background:var(--card); border:1px solid ' + (c.unread ? 'rgba(34,211,238,0.3)' : 'var(--border-light)') + '; border-radius:12px; padding:14px 16px; margin-bottom:8px; cursor:pointer; transition:background 0.15s;" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'var(--card)\'">';
        html += '<div style="display:flex; align-items:center; justify-content:space-between;">';
        html += '<div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">';
        html += unreadDot;
        html += '<div style="width:40px; height:40px; border-radius:10px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:14px; color:var(--cyan); flex-shrink:0;">💬</div>';
        html += '<div style="min-width:0; flex:1;">';
        html += '<div style="font-size:14px; font-weight:' + (c.unread ? '700' : '500') + '; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + sanitize(c.name) + '</div>';
        if (preview) html += '<div style="font-size:12px; color:var(--text-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px;">' + sanitize(preview) + '</div>';
        html += '</div></div>';
        html += '<div style="text-align:right; flex-shrink:0; margin-left:8px;">';
        html += '<div style="font-size:11px; color:var(--text-tertiary);">' + timeStr + '</div>';
        if (c.members && c.members.length > 1) {
            html += '<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;" title="' + c.members.map(sanitize).join(', ') + '">' + c.members.length + ': ' + c.members.map(function(n) { return n.split(' ')[0]; }).join(', ') + '</div>';
        } else if (c.member_count > 2) {
            html += '<div style="font-size:10px; color:var(--text-tertiary); margin-top:2px;">' + c.member_count + ' members</div>';
        }
        html += '</div></div></div>';
    });
    containerEl.innerHTML = html;
}

// FIX(2026-03-25): Healthie dates like "2026-03-25 11:11:36 -0700" don't parse in Safari.
// Normalize to ISO 8601 so all browsers handle it.
function parseHealthieDate(dateStr) {
    if (!dateStr) return new Date(NaN);
    // "2026-03-25 11:11:36 -0700" → "2026-03-25T11:11:36-07:00"
    var s = String(dateStr).trim();
    // Replace first space (between date and time) with T
    s = s.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
    // Fix timezone: " -0700" → "-07:00"
    s = s.replace(/\s+([+-])(\d{2})(\d{2})$/, '$1$2:$3');
    var d = new Date(s);
    return isNaN(d.getTime()) ? new Date(dateStr) : d;
}

function formatRelativeTime(dateStr) {
    var d = parseHealthieDate(dateStr);
    var now = new Date();
    var diffMs = now.getTime() - d.getTime();
    var diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'now';
    if (diffMin < 60) return diffMin + 'm ago';
    var diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';
    var diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function openConversation(convoId) {
    messagesCurrentConvo = convoId;
    // Cache the conversation name from the list so we have it when messages load
    var cached = (messagesConversations || []).find(function(c) { return c.id === convoId; });
    messagesCurrentConvoName = cached ? cached.name : null;
    var containerEl = document.getElementById('messagesContainer');
    if (!containerEl) return;
    containerEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
    await loadConversationMessages(convoId);
}

async function loadConversationMessages(convoId, silent) {
    var containerEl = document.getElementById('messagesContainer');
    if (!containerEl) return;
    if (!silent) containerEl.innerHTML = '<div class="loading-spinner" style="margin:40px auto;"></div>';
    try {
        var data = await apiFetch('/ops/api/ipad/messages/?conversation_id=' + convoId);
        messagesCurrentMessages = data.messages || [];
        renderConversationThread(containerEl, data.conversation, messagesCurrentMessages);
    } catch (e) {
        console.error('[Messages] Thread load error:', e);
        containerEl.innerHTML = '<div class="empty-state-card"><h3>Could not load conversation</h3><p>' + (e.message || 'Error') + '</p></div>';
    }
}

function renderConversationThread(containerEl, convo, messages) {
    // Use cached name from conversation list if server returned generic name
    var convoName = (messagesCurrentConvoName ? sanitize(messagesCurrentConvoName) : null) || (convo ? sanitize(convo.name) : 'Conversation');
    var html = '';
    // Header with back button
    html += '<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border-light);">';
    html += '<button onclick="messagesCurrentConvo=null; loadMessagesConversations(true);" style="padding:6px 12px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:13px; cursor:pointer;">← Back</button>';
    html += '<div style="font-size:16px; font-weight:600; color:var(--text-primary); flex:1;">' + convoName + '</div>';
    html += '<button onclick="showAddStaffToConvo(\'' + (convo?.id || messagesCurrentConvo || '') + '\')" style="padding:6px 10px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--cyan); font-size:12px; font-weight:600; cursor:pointer;">+ Staff</button>';
    html += '<button onclick="loadConversationMessages(\'' + (convo?.id || '') + '\')" style="padding:6px 10px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:12px; cursor:pointer;">↻</button>';
    html += '</div>';

    // Messages list
    html += '<div id="messagesThread" style="flex:1; overflow-y:auto; max-height:calc(100vh - 280px); padding:4px 0;">';
    if (messages.length === 0) {
        html += '<div style="text-align:center; color:var(--text-tertiary); padding:40px 0; font-size:14px;">No messages yet</div>';
    } else {
        messages.forEach(function(msg) {
            var timeStr = msg.created_at ? parseHealthieDate(msg.created_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: CLINIC_TIMEZONE
            }) : '';
            var isProvider = (msg.sender_name || '').toLowerCase().includes('whitten') || (msg.sender_name || '').toLowerCase().includes('schafer');
            var align = isProvider ? 'flex-end' : 'flex-start';
            var bubbleBg = isProvider ? 'rgba(0,212,255,0.15)' : 'var(--surface)';
            var bubbleBorder = isProvider ? 'rgba(0,212,255,0.2)' : 'var(--border-light)';

            html += '<div style="display:flex; flex-direction:column; align-items:' + align + '; margin-bottom:10px;">';
            html += '<div style="display:flex; align-items:center; gap:6px;' + (isProvider ? ' flex-direction:row-reverse;' : '') + '">';
            html += '<div style="font-size:10px; color:var(--text-tertiary);">' + sanitize(msg.sender_name) + ' · ' + timeStr + '</div>';
            html += '<button onclick="deleteMessage(\'' + msg.id + '\')" style="background:none; border:none; color:var(--text-tertiary); font-size:10px; cursor:pointer; padding:0 2px; opacity:0.5;" title="Delete message">✕</button>';
            html += '</div>';
            html += '<div style="max-width:80%; padding:10px 14px; border-radius:12px; background:' + bubbleBg + '; border:1px solid ' + bubbleBorder + '; font-size:14px; color:var(--text-primary); line-height:1.5; word-wrap:break-word;">';
            html += renderHealthieMessage(msg.content);
            if (msg.has_attachment) html += '<div style="margin-top:6px; font-size:11px; color:var(--cyan);">📎 Attachment</div>';
            html += '</div></div>';
        });
    }
    html += '</div>';

    // Compose bar
    html += '<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-light); display:flex; gap:8px; align-items:flex-end;">';
    html += '<button id="msgMicBtn" onclick="toggleSpeechToText()" style="padding:10px 12px; background:var(--surface); border:1px solid var(--border-light); border-radius:10px; color:var(--text-secondary); font-size:18px; cursor:pointer; flex-shrink:0;" title="Speech to text">🎙️</button>';
    html += '<textarea id="msgComposeInput" rows="2" placeholder="Type or tap 🎙️ to dictate..." style="flex:1; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:10px; color:var(--text-primary); font-size:14px; font-family:inherit; resize:none; outline:none;" onkeydown="if(event.key===\'Enter\' && !event.shiftKey){event.preventDefault(); sendMessageInConvo();}"></textarea>';
    html += '<button onclick="sendMessageInConvo()" style="padding:10px 18px; background:linear-gradient(135deg, #0891b2, #22d3ee); border:none; border-radius:10px; color:#0a0f1a; font-weight:700; font-size:14px; cursor:pointer; white-space:nowrap;">Send</button>';
    html += '</div>';

    containerEl.innerHTML = html;

    // Scroll to bottom
    var thread = document.getElementById('messagesThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
}

async function sendMessageInConvo() {
    var input = document.getElementById('msgComposeInput');
    if (!input) return;
    var content = input.value.trim();
    if (!content || !messagesCurrentConvo) return;

    input.disabled = true;
    input.value = 'Sending...';

    try {
        await apiFetch('/ops/api/ipad/messages/', {
            method: 'POST',
            body: JSON.stringify({ action: 'send', conversation_id: messagesCurrentConvo, content: content })
        });
        input.value = '';
        input.disabled = false;
        await loadConversationMessages(messagesCurrentConvo);
        showToast('Message sent', 'success');
    } catch (e) {
        console.error('[Messages] Send error:', e);
        input.value = content;
        input.disabled = false;
        showToast('Failed to send: ' + (e.message || 'Error'), 'error');
    }
}

var _cachedStaff = null;
async function showAddStaffToConvo(convoId) {
    if (!convoId) return;
    if (!_cachedStaff) {
        try {
            var data = await apiFetch('/ops/api/ipad/messages/', {
                method: 'POST',
                body: JSON.stringify({ action: 'get_staff' })
            });
            _cachedStaff = data.staff || [];
        } catch (e) {
            showToast('Failed to load staff: ' + (e.message || 'Error'), 'error');
            return;
        }
    }

    var existing = document.getElementById('addStaffModal');
    if (existing) existing.remove();

    var staffHtml = _cachedStaff.map(function(s) {
        return '<label style="display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:pointer; border-bottom:1px solid var(--border-light);" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<input type="checkbox" class="staffCheckbox" value="' + s.id + '" data-name="' + sanitize(s.name).replace(/"/g, '') + '" style="width:18px; height:18px; accent-color:var(--cyan);">' +
            '<span style="font-size:14px; color:var(--text-primary);">' + sanitize(s.name) + '</span></label>';
    }).join('');

    document.body.insertAdjacentHTML('beforeend',
        '<div id="addStaffModal" class="modal-overlay visible" style="display:flex; z-index:10001;">' +
        '<div class="modal" style="max-width:380px; padding:24px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">' +
        '<h3 style="margin:0; font-size:18px; color:var(--text-primary);">Add Staff to Conversation</h3>' +
        '<button onclick="document.getElementById(\'addStaffModal\').remove()" style="background:none; border:none; color:var(--text-tertiary); font-size:20px; cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="max-height:300px; overflow-y:auto;">' + staffHtml + '</div>' +
        '<button onclick="addSelectedStaffToConvo(\'' + convoId + '\')" style="width:100%; margin-top:14px; padding:12px; background:linear-gradient(135deg, #0891b2, #22d3ee); border:none; border-radius:8px; color:#0a0f1a; font-weight:700; font-size:14px; cursor:pointer;">Add Selected</button>' +
        '</div></div>'
    );
}

async function addSelectedStaffToConvo(convoId) {
    var checkboxes = document.querySelectorAll('#addStaffModal .staffCheckbox:checked');
    if (checkboxes.length === 0) { showToast('Select at least one staff member', 'error'); return; }
    var names = [];
    var failed = [];
    for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        try {
            await apiFetch('/ops/api/ipad/messages/', {
                method: 'POST',
                body: JSON.stringify({ action: 'add_member', conversation_id: convoId, user_id: cb.value })
            });
            names.push(cb.getAttribute('data-name'));
        } catch (e) {
            failed.push(cb.getAttribute('data-name'));
        }
    }
    document.getElementById('addStaffModal')?.remove();
    if (names.length > 0) showToast(names.join(', ') + ' added', 'success');
    if (failed.length > 0) showToast('Failed to add: ' + failed.join(', '), 'error');
}

async function deleteMessage(noteId) {
    if (!noteId) return;
    if (!confirm('Delete this message?')) return;
    try {
        await apiFetch('/ops/api/ipad/messages/', {
            method: 'POST',
            body: JSON.stringify({ action: 'delete', note_id: noteId })
        });
        showToast('Message deleted', 'success');
        if (messagesCurrentConvo) await loadConversationMessages(messagesCurrentConvo);
    } catch (e) {
        console.error('[Messages] Delete error:', e);
        showToast('Failed to delete: ' + (e.message || 'Error'), 'error');
    }
}

// Speech-to-text — shared helper. No cached state. Only appends final results
// to the input. You can freely delete/edit the textarea without interference.
function _startDictation(inputId, btnId, onStop) {
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { showToast('Speech recognition not supported', 'error'); return null; }
    var input = document.getElementById(inputId);
    var btn = document.getElementById(btnId);
    if (!input || !btn) return null;

    var rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false; // only fire when words are final — no overwrites
    rec.lang = 'en-US';
    rec._active = true;

    rec.onresult = function(event) {
        for (var i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
                var text = event.results[i][0].transcript.trim();
                if (text) {
                    // Just append to whatever is currently in the box
                    var cur = input.value;
                    input.value = cur + (cur && !cur.endsWith(' ') ? ' ' : '') + text;
                }
            }
        }
    };
    rec.onerror = function(e) {
        if (e.error === 'not-allowed') showToast('Microphone access denied', 'error');
        else if (e.error !== 'no-speech' && e.error !== 'aborted') showToast('Mic error: ' + e.error, 'error');
        rec._active = false;
        if (onStop) onStop();
    };
    rec.onend = function() {
        // Safari kills recognition after silence — restart if still active
        if (rec._active) {
            try { rec.start(); } catch(e) { rec._active = false; if (onStop) onStop(); }
        }
    };
    try {
        rec.start();
        btn.style.background = 'rgba(239,68,68,0.2)';
        btn.style.borderColor = '#ef4444';
        btn.style.color = '#ef4444';
        input.placeholder = 'Listening — speak now...';
    } catch(e) { showToast('Could not start microphone', 'error'); return null; }
    return rec;
}

function _stopDictation(rec, inputId, btnId, defaults) {
    if (rec) { rec._active = false; try { rec.stop(); } catch(e) {} }
    var btn = document.getElementById(btnId);
    var input = document.getElementById(inputId);
    if (btn) { btn.style.background = defaults.bg || 'var(--surface)'; btn.style.borderColor = defaults.border || 'var(--border-light)'; btn.style.color = defaults.color || 'var(--text-secondary)'; if (defaults.text) btn.textContent = defaults.text; }
    if (input) input.placeholder = defaults.placeholder || 'Type a message...';
}

// Message compose mic
var _msgRec = null;
function toggleSpeechToText() {
    if (_msgRec && _msgRec._active) { _stopDictation(_msgRec, 'msgComposeInput', 'msgMicBtn', { placeholder: 'Type or tap 🎙️ to dictate...' }); _msgRec = null; return; }
    _msgRec = _startDictation('msgComposeInput', 'msgMicBtn', function() {
        _stopDictation(_msgRec, 'msgComposeInput', 'msgMicBtn', { placeholder: 'Type or tap 🎙️ to dictate...' }); _msgRec = null;
    });
}
function stopSpeechToText() {
    _stopDictation(_msgRec, 'msgComposeInput', 'msgMicBtn', { placeholder: 'Type or tap 🎙️ to dictate...' }); _msgRec = null;
}

// New conversation modal mic
var _newConvoRec = null;
function toggleNewConvoSpeech() {
    if (_newConvoRec && _newConvoRec._active) { _stopDictation(_newConvoRec, 'newConvoMessage', 'newConvoMicBtn', { bg: 'none', text: '🎙️', placeholder: 'Type or tap 🎙️ to dictate...' }); _newConvoRec = null; return; }
    _newConvoRec = _startDictation('newConvoMessage', 'newConvoMicBtn', function() {
        _stopDictation(_newConvoRec, 'newConvoMessage', 'newConvoMicBtn', { bg: 'none', text: '🎙️', placeholder: 'Type or tap 🎙️ to dictate...' }); _newConvoRec = null;
    });
    if (_newConvoRec) { var b = document.getElementById('newConvoMicBtn'); if (b) b.textContent = '⏹️'; }
}
function stopNewConvoSpeech() {
    _stopDictation(_newConvoRec, 'newConvoMessage', 'newConvoMicBtn', { bg: 'none', text: '🎙️', placeholder: 'Type or tap 🎙️ to dictate...' }); _newConvoRec = null;
}

function showNewConversationModal() {
    var existing = document.getElementById('newConvoModal');
    if (existing) existing.remove();

    document.body.insertAdjacentHTML('beforeend', `
        <div id="newConvoModal" class="modal-overlay visible" style="display:flex; z-index:10001;">
            <div class="modal" style="max-width:420px; padding:24px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                    <h3 style="margin:0; font-size:18px; color:var(--text-primary);">New Conversation</h3>
                    <button onclick="document.getElementById('newConvoModal').remove()" style="background:none; border:none; color:var(--text-tertiary); font-size:20px; cursor:pointer;">✕</button>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block; font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Search Patient</label>
                    <input id="newConvoPatientSearch" type="text" placeholder="Patient name..." oninput="searchPatientsForConvo(this.value)" style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; outline:none; box-sizing:border-box;">
                    <div id="newConvoPatientResults" style="max-height:150px; overflow-y:auto; margin-top:6px;"></div>
                </div>
                <input id="newConvoRecipientId" type="hidden" value="">
                <div id="newConvoSelectedPatient" style="display:none; padding:8px 12px; background:rgba(0,212,255,0.1); border:1px solid rgba(0,212,255,0.2); border-radius:8px; margin-bottom:12px; font-size:13px; color:var(--cyan);"></div>
                <div style="margin-bottom:12px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <label style="font-size:11px; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.06em;">Message</label>
                        <button id="newConvoMicBtn" onclick="toggleNewConvoSpeech()" style="padding:2px 8px; background:none; border:1px solid var(--border-light); border-radius:6px; font-size:14px; cursor:pointer;" title="Dictate message">🎙️</button>
                    </div>
                    <textarea id="newConvoMessage" rows="3" placeholder="Type or tap 🎙️ to dictate..." style="width:100%; padding:10px 14px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-primary); font-size:14px; font-family:inherit; resize:none; outline:none; box-sizing:border-box;"></textarea>
                </div>
                <button onclick="createNewConversation()" id="newConvoBtn" style="width:100%; padding:12px; background:linear-gradient(135deg, #0891b2, #22d3ee); border:none; border-radius:8px; color:#0a0f1a; font-weight:700; font-size:14px; cursor:pointer;">Create & Send</button>
            </div>
        </div>
    `);
}

var _convoSearchTimeout = null;
function searchPatientsForConvo(query) {
    clearTimeout(_convoSearchTimeout);
    if (!query || query.length < 2) { document.getElementById('newConvoPatientResults').innerHTML = ''; return; }
    _convoSearchTimeout = setTimeout(async function() {
        try {
            // FIX(2026-03-25): Search Healthie users directly so all patients are findable
            var data = await apiFetch('/ops/api/ipad/messages/', {
                method: 'POST',
                body: JSON.stringify({ action: 'search_patients', search: query })
            });
            var resultsEl = document.getElementById('newConvoPatientResults');
            if (!resultsEl) return;
            var pts = data.patients || [];
            if (pts.length === 0) {
                resultsEl.innerHTML = '<div style="padding:8px; font-size:12px; color:var(--text-tertiary);">No patients found</div>';
                return;
            }
            resultsEl.innerHTML = pts.map(function(p) {
                return '<div onclick="selectPatientForConvo(\'' + (p.healthie_id || '') + '\', \'' + sanitize(p.full_name) + '\')" style="padding:8px 10px; cursor:pointer; border-radius:6px; font-size:13px; color:var(--text-primary);" onmouseover="this.style.background=\'var(--surface)\'" onmouseout="this.style.background=\'transparent\'">' + sanitize(p.full_name) + (p.email ? ' <span style="color:var(--text-tertiary); font-size:10px;">' + sanitize(p.email) + '</span>' : '') + '</div>';
            }).join('');
        } catch (e) { console.error('[Messages] Patient search error:', e); }
    }, 300);
}

function selectPatientForConvo(healthieId, name) {
    if (!healthieId) { showToast('Patient has no Healthie ID', 'error'); return; }
    document.getElementById('newConvoRecipientId').value = healthieId;
    document.getElementById('newConvoSelectedPatient').style.display = 'block';
    document.getElementById('newConvoSelectedPatient').textContent = '✓ ' + name;
    document.getElementById('newConvoPatientResults').innerHTML = '';
    document.getElementById('newConvoPatientSearch').value = name;
}

async function createNewConversation() {
    var recipientId = document.getElementById('newConvoRecipientId').value;
    var content = document.getElementById('newConvoMessage').value.trim();
    if (!recipientId) { showToast('Please select a patient', 'error'); return; }
    var btn = document.getElementById('newConvoBtn');
    btn.textContent = 'Creating...'; btn.disabled = true;
    try {
        var data = await apiFetch('/ops/api/ipad/messages/', {
            method: 'POST',
            body: JSON.stringify({ action: 'create', recipient_id: recipientId, content: content })
        });
        document.getElementById('newConvoModal')?.remove();
        showToast('Conversation created', 'success');
        if (data.conversation?.id) {
            await openConversation(data.conversation.id);
        } else {
            await loadMessagesConversations(true);
        }
    } catch (e) {
        console.error('[Messages] Create error:', e);
        showToast('Failed: ' + (e.message || 'Error'), 'error');
        btn.textContent = 'Create & Send'; btn.disabled = false;
    }
}

// Start scribe/recording directly from patient chart panel
function startScribeFromChart(patientId, patientName) {
    if (!patientId) {
        showToast('No patient selected', 'error');
        return;
    }
    window.location.hash = '#scribe';
    setTimeout(() => {
        const scribeSearch = document.getElementById('scribePatientSearch') || document.querySelector('#view-scribe input[type="text"]');
        if (scribeSearch) {
            scribeSearch.value = patientName;
            scribeSearch.dispatchEvent(new Event('input', { bubbles: true }));
        }
        showToast(`Switched to Scribe for ${patientName}`, 'info');
    }, 300);
}

// ============================================================
//  RESET PATIENT PASSWORD
// ============================================================

function showResetPasswordDialog() {
    const d = chartPanelData;
    if (!d) return;
    const email = d.demographics?.email || d.healthie_profile?.email || '';
    const healthieId = d.healthie_id || '';
    const patientName = d.demographics?.full_name || 'Patient';

    document.getElementById('resetPwOverlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'resetPwOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:var(--surface-1,#1a1d23);border-radius:12px;padding:20px;width:90vw;max-width:400px;border:1px solid var(--border,#333);">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                <div style="font-size:16px;font-weight:700;color:var(--text-primary,#fff);">🔑 Reset Password</div>
                <button onclick="document.getElementById('resetPwOverlay').remove()" style="background:none;border:none;color:var(--text-tertiary);font-size:20px;cursor:pointer;">✕</button>
            </div>
            <div style="font-size:13px;color:var(--cyan);font-weight:600;margin-bottom:4px;">${sanitize(patientName)}</div>
            <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:16px;">${sanitize(email) || 'No email on file'}</div>

            <div style="margin-bottom:12px;">
                <label style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.05em;display:block;margin-bottom:4px;">New Password</label>
                <input id="resetPwInput" type="text" placeholder="Min 8 characters" autocomplete="off"
                    style="width:100%;padding:10px 12px;border-radius:8px;background:var(--surface-2,#252830);border:1px solid var(--border,#333);color:var(--text-primary,#fff);font-size:15px;outline:none;box-sizing:border-box;" />
            </div>

            <div id="resetPwError" style="color:#ef4444;font-size:12px;min-height:18px;margin-bottom:8px;"></div>

            <div style="display:flex;gap:8px;">
                <button id="resetPwSetBtn" onclick="submitResetPassword('set')" style="flex:2;padding:12px;border-radius:8px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;color:#0a0f1a;font-weight:700;font-size:14px;cursor:pointer;">Set Password</button>
                <button id="resetPwEmailBtn" onclick="submitResetPassword('email')" style="flex:1;padding:12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--border);color:var(--text-secondary);font-weight:600;font-size:12px;cursor:pointer;">Send Reset Email</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('resetPwInput')?.focus(), 100);
}

async function submitResetPassword(mode) {
    const d = chartPanelData;
    if (!d) return;
    const email = d.demographics?.email || d.healthie_profile?.email || '';
    const healthieId = d.healthie_id || '';
    const patientName = d.demographics?.full_name || 'Patient';
    const password = document.getElementById('resetPwInput')?.value || '';
    const errEl = document.getElementById('resetPwError');
    const setBtn = document.getElementById('resetPwSetBtn');
    const emailBtn = document.getElementById('resetPwEmailBtn');

    if (errEl) errEl.textContent = '';

    if (mode === 'set') {
        if (password.length < 8) {
            if (errEl) errEl.textContent = 'Password must be at least 8 characters';
            return;
        }
        if (!healthieId) {
            if (errEl) errEl.textContent = 'No Healthie ID found for this patient';
            return;
        }
        if (setBtn) { setBtn.textContent = 'Setting...'; setBtn.disabled = true; }
    } else {
        if (!email) {
            if (errEl) errEl.textContent = 'No email on file for this patient';
            return;
        }
        if (emailBtn) { emailBtn.textContent = 'Sending...'; emailBtn.disabled = true; }
    }

    try {
        const body = mode === 'set'
            ? { healthie_id: healthieId, password, patient_name: patientName }
            : { email, action: 'send_reset', patient_name: patientName };

        const resp = await apiFetch('/ops/api/ipad/patient-chart/reset-password/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (resp.success) {
            document.getElementById('resetPwOverlay')?.remove();
            if (mode === 'set') {
                showToast(`✅ Password set for ${patientName}`, 'success');
            } else {
                showToast(`✅ Reset email sent to ${email}`, 'success');
            }
        } else {
            if (errEl) errEl.textContent = resp.error || 'Failed';
        }
    } catch (err) {
        if (errEl) errEl.textContent = 'Error: ' + (err.message || 'Request failed');
    } finally {
        if (setBtn) { setBtn.textContent = 'Set Password'; setBtn.disabled = false; }
        if (emailBtn) { emailBtn.textContent = 'Send Reset Email'; emailBtn.disabled = false; }
    }
}

// ============================================================
//  KIOSK MODE — Patient-facing form overlay
//  Locks iPad for patient to fill out their pending forms
//  Staff enters 4-digit PIN to unlock and return to dashboard
// ============================================================

let kioskActive = false;
let kioskSessionIds = [];
let kioskPopstateHandler = null;
let kioskOriginalOverscroll = '';

/**
 * Launch kiosk mode — fullscreen patient form overlay
 * @param {string} patientId - Local patient UUID
 * @param {string} healthieId - Healthie client ID
 * @param {Array} pendingForms - [{id, name, status}]
 * @param {string} patientName - Display name
 */
function launchKioskMode(patientId, healthieId, pendingForms, patientName) {
    // Parse forms if passed as string (from inline HTML attribute)
    if (typeof pendingForms === 'string') {
        try { pendingForms = JSON.parse(pendingForms); } catch(e) { pendingForms = []; }
    }

    if (!pendingForms || pendingForms.length === 0) {
        showToast('No pending forms for this patient', 'info');
        return;
    }

    // Confirmation dialog
    if (!confirm(`Lock iPad for patient use?\n\n${patientName} has ${pendingForms.length} form${pendingForms.length > 1 ? 's' : ''} to complete.\n\nA 4-digit PIN will be required to exit.`)) {
        return;
    }

    kioskActive = true;
    kioskSessionIds = [];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'kioskOverlay';
    overlay.className = 'kiosk-overlay';
    document.body.appendChild(overlay);

    // Lock navigation
    kioskOriginalOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = 'contain';
    history.pushState({ kiosk: true }, '');
    kioskPopstateHandler = function(e) {
        if (kioskActive) {
            history.pushState({ kiosk: true }, '');
        }
    };
    window.addEventListener('popstate', kioskPopstateHandler);

    // Start with form select (or jump to first form if only one)
    const formQueue = pendingForms.filter(f => f.status !== 'completed');
    if (formQueue.length === 1) {
        renderKioskForm(overlay, formQueue[0], { patientId, healthieId, patientName, formQueue, currentIndex: 0 });
    } else {
        renderKioskFormIntro(overlay, { patientId, healthieId, patientName, formQueue, currentIndex: 0 });
    }
}

function renderKioskHeader(overlay, showLock) {
    return `
        <div class="kiosk-header">
            <div class="kiosk-header-brand">
                <img src="/ops/nowoptimal_logo.png" alt="NOW Optimal" style="height:36px; object-fit:contain;">
            </div>
            ${showLock !== false ? '<button class="kiosk-lock-btn" onclick="showKioskUnlockDialog()" title="Staff unlock">🔒</button>' : ''}
        </div>
    `;
}

function renderKioskProgress(formQueue, currentIndex) {
    if (formQueue.length <= 1) return '';
    return `
        <div class="kiosk-progress-bar">
            ${formQueue.map((f, i) => `<div class="kiosk-progress-dot ${i < currentIndex ? 'completed' : ''} ${i === currentIndex ? 'active' : ''}"></div>`).join('')}
            <span class="kiosk-progress-label">Form ${currentIndex + 1} of ${formQueue.length}</span>
        </div>
    `;
}

/**
 * Intro screen — shows patient name and all forms they need to complete
 */
function renderKioskFormIntro(overlay, ctx) {
    overlay.innerHTML = `
        ${renderKioskHeader(overlay)}
        <div class="kiosk-body">
            <div class="kiosk-patient-banner">
                <div class="kiosk-patient-name">Welcome, ${sanitize(ctx.patientName)}</div>
                <div class="kiosk-patient-subtitle">Please complete the following ${ctx.formQueue.length} form${ctx.formQueue.length > 1 ? 's' : ''}</div>
            </div>
            <div class="kiosk-form-list">
                ${ctx.formQueue.map((f, i) => `
                    <div class="kiosk-form-card">
                        <div class="kiosk-form-card-title">${i + 1}. ${sanitize(f.name)}</div>
                        <div class="kiosk-form-card-status">Tap "Begin" to start</div>
                    </div>
                `).join('')}
            </div>
            <div style="max-width:600px; margin:24px auto 0;">
                <button class="kiosk-submit-btn" onclick="kioskStartFirstForm()">Begin</button>
            </div>
        </div>
    `;

    // Store context globally for callbacks
    window._kioskCtx = ctx;
}

function kioskStartFirstForm() {
    const overlay = document.getElementById('kioskOverlay');
    const ctx = window._kioskCtx;
    if (!overlay || !ctx) return;
    renderKioskForm(overlay, ctx.formQueue[0], ctx);
}

/**
 * Render a single form for patient to fill out
 */
async function renderKioskForm(overlay, form, ctx) {
    window._kioskCtx = ctx;

    overlay.innerHTML = `
        ${renderKioskHeader(overlay)}
        <div class="kiosk-body">
            ${renderKioskProgress(ctx.formQueue, ctx.currentIndex)}
            <div class="kiosk-form-container">
                <div class="kiosk-form-title">${sanitize(form.name)}</div>
                <div class="kiosk-form-desc">Please fill out all required fields below</div>
                <div id="kioskFormFields" style="text-align:center; padding:40px;">
                    <div class="spinner"></div>
                    <div style="color:#64748b; margin-top:8px;">Loading form...</div>
                </div>
            </div>
        </div>
    `;

    // Fetch form structure from Healthie
    try {
        const resp = await fetch(`/ops/api/ipad/kiosk/form-structure/?form_id=${form.id}`, { credentials: 'include' });
        if (resp.status === 401 || resp.status === 403) {
            document.getElementById('kioskFormFields').innerHTML = `
                <div style="color:#ef4444; text-align:center; padding:40px;">
                    <div style="font-size:48px; margin-bottom:12px;">⚠️</div>
                    <div style="font-size:18px; font-weight:600;">Session Expired</div>
                    <div style="font-size:14px; color:#64748b; margin-top:8px;">Please return this iPad to the front desk.</div>
                </div>
            `;
            return;
        }
        const data = await resp.json();
        if (!data.success || !data.form) {
            throw new Error(data.error || 'Failed to load form');
        }

        // Create audit record
        const auditResp = await fetch('/ops/api/ipad/kiosk/submit/', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                patient_id: ctx.patientId || null,
                healthie_patient_id: ctx.healthieId,
                form_id: form.id,
                form_name: form.name,
                answers: [],
                device_info: { screen_width: screen.width, screen_height: screen.height, platform: navigator.platform },
            }),
        }).catch(() => null);
        // We don't create a session here; we'll create on actual submit

        renderKioskFormFields(data.form, form, ctx);
    } catch (err) {
        console.error('[Kiosk] Failed to load form:', err);
        document.getElementById('kioskFormFields').innerHTML = `
            <div style="color:#ef4444; text-align:center; padding:40px;">
                <div style="font-size:48px; margin-bottom:12px;">❌</div>
                <div style="font-size:18px; font-weight:600;">Could not load form</div>
                <div style="font-size:14px; color:#64748b; margin-top:8px;">${sanitize(err.message)}</div>
                <button class="kiosk-submit-btn" style="margin-top:20px; max-width:300px;" onclick="renderKioskForm(document.getElementById('kioskOverlay'), window._kioskCtx.formQueue[window._kioskCtx.currentIndex], window._kioskCtx)">Retry</button>
            </div>
        `;
    }
}

function renderKioskFormFields(formData, form, ctx) {
    const container = document.getElementById('kioskFormFields');
    if (!container) return;

    const fields = formData.fields || [];
    window._kioskFormData = formData;
    window._kioskSignaturePads = {};

    let html = '';
    for (const field of fields) {
        html += renderKioskField(field);
    }

    html += `
        <button class="kiosk-submit-btn" id="kioskSubmitBtn" onclick="submitKioskForm()">
            Submit Form
        </button>
    `;

    container.innerHTML = html;
    container.style.textAlign = 'left';
    container.style.padding = '0';

    // Initialize signature pads
    for (const field of fields) {
        if (field.type === 'signature') {
            initKioskSignaturePad('kioskSig_' + field.id);
        }
    }
}

function renderKioskField(field) {
    const req = field.required ? 'required' : '';
    const reqClass = field.required ? ' required' : '';
    const desc = field.description ? `<div class="kiosk-field-description">${sanitize(field.description)}</div>` : '';
    const id = 'kioskField_' + field.id;

    let inputHtml = '';

    switch (field.type) {
        case 'text':
        case 'string':
            inputHtml = `<input type="text" id="${id}" class="kiosk-input" placeholder="Enter your answer" data-field-id="${field.id}" ${req}>`;
            break;

        case 'textarea':
        case 'long_text':
            inputHtml = `<textarea id="${id}" class="kiosk-input" rows="4" placeholder="Enter your answer" data-field-id="${field.id}" ${req}></textarea>`;
            break;

        case 'number':
            inputHtml = `<input type="number" id="${id}" class="kiosk-input" placeholder="Enter a number" data-field-id="${field.id}" ${req}>`;
            break;

        case 'phone':
            inputHtml = `<input type="tel" id="${id}" class="kiosk-input" placeholder="(___) ___-____" data-field-id="${field.id}" ${req} oninput="formatKioskPhone(this)">`;
            break;

        case 'date':
            inputHtml = `<input type="date" id="${id}" class="kiosk-input" data-field-id="${field.id}" ${req}>`;
            break;

        case 'radio':
        case 'dropdown': {
            const options = field.options || [];
            inputHtml = `<div class="kiosk-radio-group" id="${id}" data-field-id="${field.id}">
                ${options.map(opt => `
                    <div class="kiosk-radio-option" onclick="selectKioskRadio(this)" data-value="${sanitize(opt)}">${sanitize(opt)}</div>
                `).join('')}
            </div>`;
            break;
        }

        case 'checkbox': {
            const options = field.options || [];
            if (options.length > 0) {
                inputHtml = `<div class="kiosk-checkbox-group" id="${id}" data-field-id="${field.id}">
                    ${options.map(opt => `
                        <div class="kiosk-checkbox-option" onclick="toggleKioskCheckbox(this)" data-value="${sanitize(opt)}">${sanitize(opt)}</div>
                    `).join('')}
                </div>`;
            } else {
                // Single checkbox (consent-style)
                inputHtml = `<div class="kiosk-checkbox-group" id="${id}" data-field-id="${field.id}">
                    <div class="kiosk-checkbox-option" onclick="toggleKioskCheckbox(this)" data-value="Yes" style="width:100%;">
                        ☐ I agree
                    </div>
                </div>`;
            }
            break;
        }

        case 'signature':
            inputHtml = `
                <div class="kiosk-signature-wrapper">
                    <canvas id="kioskSig_${field.id}" class="kiosk-signature-canvas" data-field-id="${field.id}"></canvas>
                    <div class="kiosk-signature-actions">
                        <button class="kiosk-signature-clear" onclick="clearKioskSignature('kioskSig_${field.id}')">Clear Signature</button>
                        <span class="kiosk-signature-disclaimer">By signing, I acknowledge that I have read and agree to the above.</span>
                    </div>
                </div>
            `;
            break;

        case 'file':
        case 'image':
            inputHtml = `<input type="file" id="${id}" class="kiosk-input" accept="image/*,application/pdf" data-field-id="${field.id}" ${req} style="padding:10px;">`;
            break;

        case 'read_only':
        case 'label':
        case 'header':
            // Display-only field — just show label text, no input
            return `<div class="kiosk-field"><div style="font-size:14px; color:#334155; line-height:1.5; padding:8px 0; border-bottom:1px solid #e2e8f0;">${sanitize(field.label)}</div>${desc}</div>`;

        default:
            inputHtml = `<input type="text" id="${id}" class="kiosk-input" placeholder="Enter your answer" data-field-id="${field.id}" ${req}>`;
    }

    return `
        <div class="kiosk-field" data-field-id="${field.id}">
            <label class="kiosk-field-label${reqClass}">${sanitize(field.label)}</label>
            ${desc}
            ${inputHtml}
            <div class="kiosk-field-error" id="kioskErr_${field.id}"></div>
        </div>
    `;
}

// ─── KIOSK FORM INTERACTIONS ──────────────────────────

function selectKioskRadio(el) {
    const group = el.parentElement;
    group.querySelectorAll('.kiosk-radio-option').forEach(o => o.classList.remove('selected'));
    el.classList.add('selected');
}

function toggleKioskCheckbox(el) {
    el.classList.toggle('selected');
    // Update visual checkbox indicator
    if (el.classList.contains('selected')) {
        el.innerHTML = el.innerHTML.replace('☐', '☑');
    } else {
        el.innerHTML = el.innerHTML.replace('☑', '☐');
    }
}

function formatKioskPhone(input) {
    let v = input.value.replace(/\D/g, '');
    if (v.length > 10) v = v.slice(0, 10);
    if (v.length >= 6) {
        input.value = `(${v.slice(0,3)}) ${v.slice(3,6)}-${v.slice(6)}`;
    } else if (v.length >= 3) {
        input.value = `(${v.slice(0,3)}) ${v.slice(3)}`;
    }
}

// ─── SIGNATURE PAD ────────────────────────────────────

function initKioskSignaturePad(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Set canvas resolution
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000000';

    let drawing = false;
    let lastX = 0, lastY = 0;
    let hasDrawn = false;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        drawing = true;
        const touch = e.touches[0];
        const r = canvas.getBoundingClientRect();
        lastX = touch.clientX - r.left;
        lastY = touch.clientY - r.top;
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!drawing) return;
        hasDrawn = true;
        const touch = e.touches[0];
        const r = canvas.getBoundingClientRect();
        const x = touch.clientX - r.left;
        const y = touch.clientY - r.top;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        lastX = x;
        lastY = y;
    }, { passive: false });

    canvas.addEventListener('touchend', () => { drawing = false; });

    // Mouse support (for testing on desktop)
    canvas.addEventListener('mousedown', (e) => {
        drawing = true;
        const r = canvas.getBoundingClientRect();
        lastX = e.clientX - r.left;
        lastY = e.clientY - r.top;
    });
    canvas.addEventListener('mousemove', (e) => {
        if (!drawing) return;
        hasDrawn = true;
        const r = canvas.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        lastX = x;
        lastY = y;
    });
    canvas.addEventListener('mouseup', () => { drawing = false; });
    canvas.addEventListener('mouseleave', () => { drawing = false; });

    window._kioskSignaturePads[canvasId] = {
        isEmpty: () => !hasDrawn,
        toDataURL: () => canvas.toDataURL('image/png'),
        clear: () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            hasDrawn = false;
        }
    };
}

function clearKioskSignature(canvasId) {
    const pad = window._kioskSignaturePads[canvasId];
    if (pad) pad.clear();
}

// ─── FORM SUBMISSION ──────────────────────────────────

async function submitKioskForm() {
    const formData = window._kioskFormData;
    const ctx = window._kioskCtx;
    if (!formData || !ctx) return;

    const fields = formData.fields || [];
    const answers = [];
    let hasErrors = false;
    let signatureDataUrl = null;

    // Collect and validate answers
    for (const field of fields) {
        // Skip display-only fields
        if (['read_only', 'label', 'header'].includes(field.type)) continue;

        const errEl = document.getElementById('kioskErr_' + field.id);
        if (errEl) errEl.textContent = '';

        let value = '';

        if (field.type === 'signature') {
            const pad = window._kioskSignaturePads['kioskSig_' + field.id];
            if (pad && !pad.isEmpty()) {
                value = 'Signed';
                signatureDataUrl = pad.toDataURL();
            }
        } else if (field.type === 'radio' || field.type === 'dropdown') {
            const group = document.getElementById('kioskField_' + field.id);
            const selected = group?.querySelector('.selected');
            value = selected?.dataset?.value || '';
        } else if (field.type === 'checkbox') {
            const group = document.getElementById('kioskField_' + field.id);
            const selectedOpts = group?.querySelectorAll('.selected') || [];
            value = Array.from(selectedOpts).map(o => o.dataset.value).join(', ');
        } else if (field.type === 'file' || field.type === 'image') {
            const input = document.getElementById('kioskField_' + field.id);
            value = input?.files?.length > 0 ? input.files[0].name : '';
        } else {
            const input = document.getElementById('kioskField_' + field.id);
            value = input?.value?.trim() || '';
        }

        // Validation
        if (field.required && !value) {
            hasErrors = true;
            if (errEl) errEl.textContent = 'This field is required';
            const fieldEl = document.querySelector(`.kiosk-field[data-field-id="${field.id}"]`);
            if (fieldEl && hasErrors) {
                fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                hasErrors = true; // keep going to show all errors
            }
        }

        if (value) {
            answers.push({ custom_module_id: field.id, answer: value });
        }
    }

    if (hasErrors) {
        // Scroll to first error
        const firstErr = document.querySelector('.kiosk-field-error:not(:empty)');
        if (firstErr) firstErr.closest('.kiosk-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    // Disable button
    const btn = document.getElementById('kioskSubmitBtn');
    if (btn) { btn.textContent = 'Submitting...'; btn.disabled = true; }

    try {
        const currentForm = ctx.formQueue[ctx.currentIndex];
        const resp = await fetch('/ops/api/ipad/kiosk/submit/', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                patient_id: ctx.patientId || null,
                healthie_patient_id: ctx.healthieId,
                form_id: currentForm.id,
                form_name: currentForm.name,
                answers: answers,
                signature_data_url: signatureDataUrl,
                device_info: { screen_width: screen.width, screen_height: screen.height, platform: navigator.platform },
            }),
        });

        const data = await resp.json();

        if (data.session_id) {
            kioskSessionIds.push(data.session_id);
        }

        if (!resp.ok || !data.success) {
            throw new Error(data.error || 'Submission failed');
        }

        // Show confirmation, then advance to next form
        renderKioskConfirmation(data.completed_at, ctx);

    } catch (err) {
        console.error('[Kiosk] Submit error:', err);
        if (btn) { btn.textContent = 'Submit Form'; btn.disabled = false; }
        // Show error inline
        const overlay = document.getElementById('kioskOverlay');
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:12px; margin:12px 0; border-radius:8px; background:#fef2f2; border:1px solid #fecaca; color:#991b1b; font-size:14px; text-align:center;';
        errDiv.textContent = 'Error: ' + (err.message || 'Could not submit form. Please try again.');
        btn?.parentElement?.insertBefore(errDiv, btn);
        setTimeout(() => errDiv.remove(), 5000);
    }
}

function renderKioskConfirmation(completedAt, ctx) {
    const overlay = document.getElementById('kioskOverlay');
    if (!overlay) return;

    const timestamp = completedAt ? new Date(completedAt).toLocaleString('en-US', {
        timeZone: CLINIC_TIMEZONE,
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    }) + ' MST' : new Date().toLocaleString();

    const isLastForm = ctx.currentIndex >= ctx.formQueue.length - 1;

    overlay.innerHTML = `
        ${renderKioskHeader(overlay)}
        <div class="kiosk-body" style="display:flex; align-items:center; justify-content:center;">
            <div class="kiosk-confirmation">
                <div class="kiosk-confirmation-icon">✅</div>
                <div class="kiosk-confirmation-title">Form Submitted Successfully</div>
                <div class="kiosk-confirmation-timestamp">${timestamp}</div>
                ${isLastForm ? `
                    <div style="margin-top:16px;">
                        <button class="kiosk-next-btn" onclick="renderKioskReturnScreen()">Done</button>
                    </div>
                ` : `
                    <div style="margin-top:16px;">
                        <button class="kiosk-next-btn" onclick="kioskAdvanceToNextForm()">Continue to Next Form</button>
                        <div style="font-size:13px; color:#64748b; margin-top:8px;">Form ${ctx.currentIndex + 1} of ${ctx.formQueue.length} complete</div>
                    </div>
                `}
            </div>
        </div>
    `;

    window._kioskCtx = ctx;
}

function kioskAdvanceToNextForm() {
    const ctx = window._kioskCtx;
    if (!ctx) return;
    ctx.currentIndex++;
    if (ctx.currentIndex >= ctx.formQueue.length) {
        renderKioskReturnScreen();
        return;
    }
    const overlay = document.getElementById('kioskOverlay');
    if (!overlay) return;
    renderKioskForm(overlay, ctx.formQueue[ctx.currentIndex], ctx);
}

function renderKioskReturnScreen() {
    const overlay = document.getElementById('kioskOverlay');
    if (!overlay) return;

    overlay.innerHTML = `
        ${renderKioskHeader(overlay)}
        <div class="kiosk-return-screen">
            <div class="kiosk-return-icon">🏥</div>
            <div class="kiosk-return-title">All Done!</div>
            <div class="kiosk-return-subtitle">Thank you. Please return this iPad to the front desk.</div>
        </div>
    `;
}

// ─── PIN UNLOCK DIALOG ────────────────────────────────

function showKioskUnlockDialog() {
    // Remove existing dialog if any
    document.getElementById('kioskUnlockOverlay')?.remove();

    const dialog = document.createElement('div');
    dialog.id = 'kioskUnlockOverlay';
    dialog.className = 'kiosk-unlock-overlay';
    dialog.onclick = (e) => { if (e.target === dialog) dialog.remove(); };

    dialog.innerHTML = `
        <div class="kiosk-unlock-dialog">
            <div class="kiosk-unlock-title">🔒 Staff Unlock</div>
            <div class="kiosk-unlock-subtitle">Enter 4-digit PIN to exit patient mode</div>
            <input type="tel" id="kioskPinInput" class="kiosk-pin-input" maxlength="4" pattern="\\d{4}" inputmode="numeric" autocomplete="off" autofocus>
            <div class="kiosk-pin-error" id="kioskPinError"></div>
            <div class="kiosk-unlock-actions">
                <button class="kiosk-unlock-cancel" onclick="document.getElementById('kioskUnlockOverlay').remove()">Cancel</button>
                <button class="kiosk-unlock-submit" id="kioskUnlockBtn" onclick="validateKioskPin()">Unlock</button>
            </div>
        </div>
    `;

    document.body.appendChild(dialog);

    // Focus and auto-submit on 4 digits
    setTimeout(() => {
        const input = document.getElementById('kioskPinInput');
        if (input) {
            input.focus();
            input.addEventListener('input', () => {
                if (input.value.length === 4) validateKioskPin();
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') validateKioskPin();
            });
        }
    }, 100);
}

async function validateKioskPin() {
    const input = document.getElementById('kioskPinInput');
    const errEl = document.getElementById('kioskPinError');
    const btn = document.getElementById('kioskUnlockBtn');
    const pin = input?.value || '';

    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        if (errEl) errEl.textContent = 'Enter a 4-digit PIN';
        return;
    }

    if (btn) { btn.textContent = 'Checking...'; btn.disabled = true; }

    try {
        const resp = await fetch('/ops/api/ipad/kiosk/unlock/', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, kiosk_session_ids: kioskSessionIds }),
        });

        const data = await resp.json();

        if (resp.status === 429) {
            if (errEl) errEl.textContent = 'Too many attempts. Wait 1 minute.';
            if (btn) { btn.textContent = 'Unlock'; btn.disabled = false; }
            return;
        }

        if (data.valid) {
            exitKioskMode();
        } else {
            if (errEl) errEl.textContent = 'Incorrect PIN';
            if (input) { input.value = ''; input.focus(); }
            if (btn) { btn.textContent = 'Unlock'; btn.disabled = false; }
        }
    } catch (err) {
        console.error('[Kiosk] Unlock error:', err);
        if (errEl) errEl.textContent = 'Connection error. Try again.';
        if (btn) { btn.textContent = 'Unlock'; btn.disabled = false; }
    }
}

function exitKioskMode() {
    kioskActive = false;

    // Remove overlay
    document.getElementById('kioskOverlay')?.remove();
    document.getElementById('kioskUnlockOverlay')?.remove();

    // Restore navigation
    document.body.style.overscrollBehavior = kioskOriginalOverscroll;
    if (kioskPopstateHandler) {
        window.removeEventListener('popstate', kioskPopstateHandler);
        kioskPopstateHandler = null;
    }

    // Clean up state
    kioskSessionIds = [];
    window._kioskCtx = null;
    window._kioskFormData = null;
    window._kioskSignaturePads = {};

    showToast('Kiosk mode exited', 'success');

    // Refresh chart data to show updated form status
    if (chartPanelPatientId) {
        loadChartData(chartPanelPatientId);
    }
}