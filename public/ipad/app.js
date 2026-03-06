/* ============================================================
   GMH Ops v2.0 — iPad Companion App (LIVE DATA)
   Connects to /ops/api/* endpoints via same-origin cookies
   ============================================================ */

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
let mediaRecorder = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimer = null;
let scribeView = 'list';        // 'list' | 'new' | 'recording' | 'transcript' | 'note' | 'review'
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

// Cron secret for Healthie appointments
const CRON_SECRET = '59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122';

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
});

// ─── AUTH & RBAC ────────────────────────────────────────────
async function loadCurrentUser() {
    try {
        const resp = await fetch('/ops/api/ipad/me/', { credentials: 'include' });
        if (!resp.ok) return false;
        const data = await resp.json();
        if (data.error) return false;
        currentUser = data;
        return true;
    } catch (e) {
        console.warn('Auth check failed:', e);
        return false;
    }
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

    // Add Schedule tab for providers/admins
    if ((perms.can_use_scribe || perms.can_view_ceo_dashboard) && nav) {
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

    // Add CEO tab for admins
    if (perms.can_view_ceo_dashboard && nav) {
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
    const validTabs = ['today', 'labs', 'scribe', 'inventory', 'patients', 'ceo', 'schedule'];
    if (!validTabs.includes(tab)) tab = 'today';
    // RBAC: prevent access to tabs user doesn't have permission for
    if (currentUser?.permissions) {
        if (tab === 'ceo' && !currentUser.permissions.can_view_ceo_dashboard) tab = 'today';
        if (tab === 'scribe' && !currentUser.permissions.can_use_scribe) tab = 'today';
        if (tab === 'schedule' && !currentUser.permissions.can_use_scribe) tab = 'today';
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
    }

    main.appendChild(view);
    main.scrollTop = 0;
}

// ─── API LAYER ──────────────────────────────────────────────
async function apiFetch(url, options = {}) {
    const defaults = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    };
    const merged = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };

    try {
        const resp = await fetch(url, merged);

        if (resp.status === 401 || resp.status === 403) {
            showAuthExpired();
            throw new Error('AUTH_EXPIRED');
        }

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        return await resp.json();
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn(`API call failed: ${url}`, e);
        throw e;
    }
}

function showAuthExpired() {
    document.getElementById('authOverlay').classList.add('visible');
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
    renderCurrentTab(); // Show loading states

    let anySuccess = false;

    // Parallel fetch: dashboard + inventory alerts + Healthie appointments + patients + labs
    const results = await Promise.allSettled([
        loadDashboard(),
        loadInventoryAlerts(),
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
    try {
        const data = await apiFetch('/ops/api/cron/morning-prep/', {
            headers: { 'x-cron-secret': CRON_SECRET }
        });
        // Morning-prep returns { success, data: { summary: { patients: [...] } } }
        if (data?.success && data?.data?.summary?.patients) {
            healthieAppointments = data.data.summary.patients.map(p => ({
                id: p.healthie_id || p.patient_id || '',
                patient_name: p.full_name || p.name || '',
                appointment_type: p.appointment_type || '',
                status: p.appointment_status || 'scheduled',
                time: '',
                has_staged_dose: p.has_staged_dose || false,
                has_payment_issue: p.has_payment_issue || false,
                has_pending_lab: p.has_pending_lab || false,
            }));
        } else if (data && data.appointments) {
            healthieAppointments = data.appointments;
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

async function loadPatient360(patientId) {
    if (patient360Cache[patientId]) return patient360Cache[patientId];
    try {
        const data = await apiFetch(`/ops/api/ipad/patient/${patientId}/`);
        // API returns { success, data: { demographics, recent_dispenses, recent_peptides, payment_issues, staged_doses, summary } }
        const result = (data?.success && data?.data) ? data.data : data;
        patient360Cache[patientId] = result;
        return result;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn(`Patient 360 load failed for ${patientId}:`, e);
        return null;
    }
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
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
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
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
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
    if (isLoading && !dashboardData) {
        container.innerHTML = renderLoadingState();
        return;
    }

    const stagedDoses = getStagedDoses();
    const paymentIssues = getPaymentIssues();
    const patients = getPatients();

    // Compute stats — use allPatients count for active count, not today's dashboard patients
    const activePatientCount = allPatients.length || patients.length || 0;
    const labsPendingCount = getLabsPending().length || 0;
    const stagedCount = stagedDoses.length || 0;
    const paymentIssueCount = paymentIssues.length || 0;

    // Build action items from live data
    const actions = buildActionItems(labsPendingCount, paymentIssueCount, stagedCount);

    // Merge Healthie appointments with staged doses for the schedule
    const scheduleItems = buildSchedule(stagedDoses);

    container.innerHTML = `
        <div class="greeting">
            <h1>${getGreeting()}, Team</h1>
            <div class="date">${formatDate()}</div>
        </div>

        <div class="stats-row stagger-in">
            <div class="stat-card" onclick="window.location.hash='#patients'">
                <div class="stat-icon cyan">👥</div>
                <div class="stat-value">${activePatientCount}</div>
                <div class="stat-label">Active Patients</div>
            </div>
            <div class="stat-card" onclick="window.location.hash='#labs'">
                <div class="stat-icon purple">🧪</div>
                <div class="stat-value">${labsPendingCount}</div>
                <div class="stat-label">Labs Pending</div>
            </div>
            <div class="stat-card" onclick="scrollToSection('stagedDosesSection')">
                <div class="stat-icon green">💉</div>
                <div class="stat-value">${stagedCount}</div>
                <div class="stat-label">Staged Doses</div>
            </div>
            <div class="stat-card ${paymentIssueCount > 0 ? 'alert' : ''}" onclick="scrollToSection('paymentSection')">
                <div class="stat-icon red">💳</div>
                <div class="stat-value">${paymentIssueCount}</div>
                <div class="stat-label">Payment Issues</div>
            </div>
        </div>

        ${actions.length > 0 ? `
            <div class="section-header">
                <h2>Action Queue</h2>
                <button class="section-action" onclick="clearAllActions()">Clear All</button>
            </div>
            <div class="action-queue stagger-in" id="actionQueue">
                ${actions.map((a, i) => renderActionCard(a, i)).join('')}
            </div>
        ` : ''}

        ${healthieAppointments.length > 0 ? `
            <div class="section-header">
                <h2>Healthie Appointments</h2>
                <span class="section-action">${healthieAppointments.length} today</span>
            </div>
            <div class="stagger-in">
                ${healthieAppointments.map(a => renderHealthieAppointment(a)).join('')}
            </div>
        ` : ''}

        <div class="section-header" id="stagedDosesSection">
            <h2>Staged Doses</h2>
            <span class="section-action">${stagedCount} staged</span>
        </div>
        ${stagedDoses.length > 0 ? `
            <div class="schedule-timeline stagger-in">
                ${scheduleItems.map(s => renderScheduleItem(s)).join('')}
            </div>
        ` : renderEmptyState('💉', 'No staged doses', 'No doses staged for today')}

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
    // Normalize different possible field names from the morning-prep endpoint
    const name = appt.patient_name || appt.patientName || appt.name || 'Unknown';
    const time = appt.time || appt.scheduled_time || appt.start_time || '';
    const type = appt.type || appt.appointment_type || appt.reason || '';
    const status = appt.status || 'scheduled';

    let statusClass = 'scheduled';
    if (status === 'checked_in' || status === 'Checked In') statusClass = 'checked_in';
    else if (status === 'in_progress' || status === 'In Progress') statusClass = 'in_progress';
    else if (status === 'completed' || status === 'Completed') statusClass = 'completed';

    const displayTime = typeof time === 'string' && time.includes('T')
        ? new Date(time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : time;

    return `
        <div class="healthie-appt-card" onclick="handleHealthieClick('${appt.id || ''}', '${status}')">
            <div class="healthie-appt-time">${displayTime}</div>
            <div class="healthie-appt-info">
                <div class="healthie-appt-name">${name}</div>
                <div class="healthie-appt-type">${type}</div>
            </div>
            <div class="healthie-appt-status sched-status ${statusClass}">${statusClass.replace('_', ' ')}</div>
        </div>
    `;
}

function handleHealthieClick(id, currentStatus) {
    const nextStatus = {
        'scheduled': 'checked_in',
        'checked_in': 'in_progress',
        'in_progress': 'completed'
    };
    const next = nextStatus[currentStatus];
    if (!next || !id) return;

    // Update locally
    const appt = healthieAppointments.find(a => String(a.id) === String(id));
    if (appt) appt.status = next;
    renderCurrentTab();
    showToast(`Status → ${next.replace('_', ' ')}`, 'success');
}

function renderScheduleItem(dose) {
    const displayTime = dose.time || '—';
    return `
        <div class="schedule-item">
            <div class="sched-time">${displayTime}</div>
            <div class="sched-dot"></div>
            <div class="sched-info">
                <div class="sched-name">${dose.patient_name}</div>
                <div class="sched-type">${dose.type}${dose.dosage ? ' · ' + dose.dosage : ''}</div>
                ${dose.vial_id ? `<div class="dose-detail"><span>Vial: ${dose.vial_id}</span></div>` : ''}
            </div>
            <div class="sched-status ${dose.status}">${dose.status.replace('_', ' ')}</div>
        </div>
    `;
}

function renderPaymentIssueCard(issue) {
    const name = issue.patient_name || issue.patientName || issue.name || 'Unknown';
    const detail = issue.issue || issue.reason || issue.description || 'Payment issue';
    const amount = issue.amount || issue.balance || '';

    return `
        <div class="payment-issue-card" onclick="showToast('Opening payment details…', 'info')">
            <div class="payment-issue-icon">💳</div>
            <div class="payment-issue-text">
                <div class="payment-issue-name">${name}</div>
                <div class="payment-issue-detail">${detail}</div>
            </div>
            ${amount ? `<div class="payment-issue-amount">$${typeof amount === 'number' ? amount.toFixed(2) : amount}</div>` : ''}
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

    const filteredLabs = activeLabFilter === 'pending' ? pending
        : activeLabFilter === 'approved' ? approved
            : allLabs;

    container.innerHTML = `
        <h1 style="font-size:28px; margin-bottom:20px;">Lab Results</h1>
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
        activeLabFilter === 'pending' ? 'No labs pending review' : 'No lab results',
        activeLabFilter === 'pending' ? 'All caught up!' : '') : ''}
        </div>
    `;
}

function setLabFilter(filter) {
    activeLabFilter = filter;
    renderCurrentTab();
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
                    <div class="lab-patient-name">${patientName}</div>
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
            await apiFetch('/ops/api/labs/review-queue', {
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

    switch (scribeView) {
        case 'list': renderScribeList(container); break;
        case 'new': renderScribeNewSession(container); break;
        case 'recording': renderScribeRecording(container); break;
        case 'transcript': renderScribeTranscript(container); break;
        case 'note': renderScribeNote(container); break;
        case 'review': renderScribeReview(container); break;
        default: renderScribeList(container);
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
    const time = session.created_at ? new Date(session.created_at).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    }) : '';
    const status = session.status || 'recording';
    const statusColors = {
        recording: 'var(--red)', transcribed: 'var(--yellow)',
        note_generated: 'var(--cyan)', submitted: 'var(--green)', signed: 'var(--green)',
    };
    const statusLabels = {
        recording: 'Recording', transcribed: 'Needs Note',
        note_generated: 'Review Note', submitted: 'Submitted', signed: 'Signed',
    };
    const nextAction = {
        transcribed: () => `onclick="openScribeSession('${session.session_id}', 'note')"`,
        note_generated: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
        submitted: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
        signed: () => `onclick="openScribeSession('${session.session_id}', 'review')"`,
    };
    const clickAttr = nextAction[status] ? nextAction[status]() : '';

    return `
        <div class="scribe-session-card" ${clickAttr}>
            <div class="scribe-session-header">
                <div class="scribe-session-info">
                    <div class="scribe-session-patient">${name}</div>
                    <div class="scribe-session-meta">${visitType} · ${time}</div>
                </div>
                <div class="scribe-status-badge" style="background:${statusColors[status] || 'var(--text-tertiary)'}20; color:${statusColors[status] || 'var(--text-tertiary)'}">
                    ${statusLabels[status] || status}
                </div>
            </div>
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

    // Auto-load chart data so it's available before recording
    loadChartData(healthieId);

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

async function beginScribeCapture() {
    if (!scribePatientId) {
        showToast('Please select a patient first', 'error');
        return;
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = handleRecordingComplete;
        mediaRecorder.start(1000); // collect in 1-sec chunks
        isRecording = true;
        recordingStartTime = Date.now();
        scribeView = 'recording';
        // Auto-open chart panel BEFORE rendering so it renders as open
        chartPanelOpen = true;
        renderCurrentTab();
        // After render creates new DOM, populate chart panel
        const pid = scribePatientId || activeScribeSession?.patient_id;
        if (pid) {
            if (chartPanelData && chartPanelPatientId === pid) {
                // Data already loaded for this patient — render it to the new DOM
                const content = document.getElementById('chartPanelContent');
                if (content) renderChartPanel(content);
            } else {
                // No data yet — load from API
                loadChartData(pid);
            }
        }
        // Start timer
        recordingTimer = setInterval(updateRecordingTimer, 1000);
    } catch (err) {
        showToast('Microphone access denied', 'error');
        console.error('Mic error:', err);
    }
}

function renderScribeRecording(container) {
    container.innerHTML = `
        <div class="scribe-recording-view">
            <div class="scribe-header-row">
                <h1 style="font-size:24px;">Recording Visit</h1>
                ${getChartToggleBtn()}
            </div>
            ${getChartPanelHTML()}
            <div class="scribe-recording-center">
                <div class="recording-pulse-ring">
                    <div class="recording-pulse-dot"></div>
                </div>
                <div class="recording-timer" id="recordingTimer">00:00</div>
                <div class="recording-patient">${getPatientNameById(scribePatientId)}</div>
                <div class="recording-visit-type">${scribeVisitType.replace(/_/g, ' ')}</div>
            </div>
            <div class="recording-waveform" id="waveform">
                ${Array.from({ length: 40 }, () => '<div class="wave-bar"></div>').join('')}
            </div>
            <div class="recording-controls">
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
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${m}:${s}`;
}

function animateWaveform() {
    const bars = document.querySelectorAll('.wave-bar');
    if (bars.length === 0 || !isRecording) return;
    bars.forEach(bar => {
        const h = Math.random() * 60 + 10;
        bar.style.height = h + '%';
    });
    if (isRecording) requestAnimationFrame(() => setTimeout(animateWaveform, 100));
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
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    isRecording = false;
    if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
}

async function handleRecordingComplete() {
    showToast('Uploading audio for transcription…', 'info');
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', blob, 'visit-recording.webm');
    formData.append('patient_id', scribePatientId);
    formData.append('visit_type', scribeVisitType);
    formData.append('patient_name', scribePatientName || '');

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
            showToast(`Upload failed (${resp.status}): ${errorText.substring(0, 100)}`, 'error');
            scribeView = 'list';
            renderCurrentTab();
            return;
        }

        // Safe JSON parse
        let data;
        try {
            data = await resp.json();
        } catch (parseErr) {
            console.error('[Scribe] Response parse error:', parseErr);
            showToast('Server returned invalid response. Please try again.', 'error');
            scribeView = 'list';
            renderCurrentTab();
            return;
        }

        if (data.success) {
            activeScribeSession = data.data;
            // Check if transcription is async (AWS Transcribe) or already done
            if (data.data.status === 'transcribing' || data.data.transcription_job_name) {
                showToast('Audio uploaded! Transcription in progress…', 'info');
                // Poll for completion
                await pollTranscription(data.data.session_id);
            } else {
                showToast(`Transcribed! ${data.data.transcript_length || 0} characters`, 'success');
                await loadScribeSessions();
                scribeView = 'note';
                renderCurrentTab();
                updateBadges();
            }
        } else {
            showToast(data.error || 'Transcription failed', 'error');
            scribeView = 'list';
            renderCurrentTab();
        }
    } catch (e) {
        console.error('[Scribe] Transcription error:', e);
        showToast('Transcription failed: ' + (e.message || 'network error'), 'error');
        scribeView = 'list';
        renderCurrentTab();
    }
}

async function pollTranscription(sessionId) {
    // Show a polling view
    const container = document.getElementById('mainContent');
    if (container) {
        container.innerHTML = `
            <div style="text-align:center; padding:60px 20px;">
                <div class="loading-spinner" style="margin:0 auto 20px;"></div>
                <h2 style="margin-bottom:8px;">Transcribing Visit Audio</h2>
                <p style="color:var(--text-tertiary);">AWS Transcribe Medical is processing your recording.<br>This usually takes 30-90 seconds.</p>
                <div id="pollStatus" style="margin-top:20px; color:var(--cyan); font-weight:600;">Polling…</div>
            </div>
        `;
    }

    let attempts = 0;
    const maxAttempts = 60; // 5 min max
    const pollInterval = 5000; // 5 sec

    while (attempts < maxAttempts) {
        attempts++;
        await new Promise(r => setTimeout(r, pollInterval));
        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);
            const statusEl = document.getElementById('pollStatus');
            if (statusEl) statusEl.textContent = `Checking… (attempt ${attempts})`;

            if (data?.success && data.data?.status === 'transcribed') {
                showToast(`Transcription complete! ${data.data.transcript_length || 0} chars`, 'success');
                await loadScribeSessions();
                activeScribeSession = scribeSessions.find(s => s.session_id === sessionId) || activeScribeSession;
                scribeView = 'note';
                renderCurrentTab();
                updateBadges();
                return;
            } else if (data?.data?.status === 'error') {
                showToast('Transcription failed: ' + (data.data.error || 'Unknown'), 'error');
                scribeView = 'list';
                renderCurrentTab();
                return;
            }
        } catch (e) {
            console.warn('Poll error:', e);
        }
    }
    showToast('Transcription timed out — check back later', 'error');
    scribeView = 'list';
    renderCurrentTab();
}

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
        renderCurrentTab();
    }
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
    showToast(regen ? 'Regenerating SOAP note with AI…' : 'Generating SOAP note with AI… this may take 30-60 seconds', 'info');

    try {
        // Use raw fetch to get full error details
        const resp = await fetch('/ops/api/scribe/generate-note/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: activeScribeSession.session_id,
                patient_id: scribePatientId || activeScribeSession.patient_id,
                visit_type: scribeVisitType || activeScribeSession.visit_type,
                patient_name: scribePatientName || activeScribeSession.patient_name || '',
                regenerate: regen,
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
            showToast('SOAP note generated!', 'success');
            await loadScribeSessions();
            activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession.session_id) || activeScribeSession;
            scribeView = 'review';
            renderCurrentTab();
            updateBadges();
        } else {
            const errMsg = result?.error || 'Note generation failed';
            console.error('[Scribe] Generate note error:', resp.status, errMsg);
            // If note already exists (409), offer to view it
            if (resp.status === 409) {
                showToast('Note already exists for this session — opening review', 'info');
                await loadScribeSessions();
                activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession.session_id) || activeScribeSession;
                scribeView = 'review';
                renderCurrentTab();
            } else {
                showToast(errMsg, 'error');
            }
        }
    } catch (e) {
        console.error('[Scribe] Generate note exception:', e);
        showToast('Note generation failed: ' + (e.message || 'network error'), 'error');
    }
}

function renderScribeReview(container) {
    if (!activeScribeSession) { scribeView = 'list'; renderCurrentTab(); return; }

    const note = currentNote || activeScribeSession;
    const noteData = note?.note || note;
    const isSubmitted = noteData?.healthie_status === 'submitted' || noteData?.healthie_status === 'locked';

    container.innerHTML = `
        <div class="scribe-header-row">
            <button class="scribe-back-btn" onclick="scribeView='list'; renderCurrentTab();">← Back</button>
            <h1 style="font-size:24px;">SOAP Note Review</h1>
            ${getChartToggleBtn()}
        </div>
        ${getChartPanelHTML()}

        <div class="scribe-session-summary">
            <div class="scribe-session-patient">${activeScribeSession.patient_name || getPatientNameById(scribePatientId)}</div>
            <div class="scribe-session-meta">${(activeScribeSession.visit_type || '').replace(/_/g, ' ')} · ${isSubmitted ? '✅ Submitted to Healthie' : '📝 Draft'}</div>
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

        ${noteData?.cpt_codes?.length > 0 ? `
            <div class="soap-codes-section">
                <h3>CPT Codes</h3>
                <div class="code-chips">
                    ${noteData.cpt_codes.map(c => `<span class="code-chip cpt">${c.code}: ${c.description || ''}</span>`).join('')}
                </div>
            </div>
        ` : ''}

        <!-- AI Edit Bar -->
        <div class="scribe-ai-edit" style="margin-top:16px; padding:12px; background:var(--surface-2); border-radius:12px; border:1px solid var(--border);">
            <div style="display:flex; gap:8px;">
                <input type="text" id="aiEditInput" placeholder="Tell AI what to change (e.g. 'add allergy to penicillin')…"
                       style="flex:1; padding:10px 12px; border-radius:8px; border:1px solid var(--border); background:var(--surface-1); color:var(--text-primary); font-size:14px;" />
                <button class="btn-primary" onclick="aiEditNote()" style="white-space:nowrap;">✨ AI Edit</button>
            </div>
        </div>

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
            <div class="scribe-review-actions" style="margin-top:16px;">
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
        `}
    `;
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

    showToast('Applying AI edit…', 'info');
    try {
        const result = await apiFetch(`/ops/api/scribe/notes/${noteId}/edit-ai/`, {
            method: 'POST',
            body: JSON.stringify({ edit_instruction: instruction })
        });
        if (result?.success) {
            const n = result.data.updated_note;
            if (currentNote) {
                currentNote.soap_subjective = n.soap_subjective;
                currentNote.soap_objective = n.soap_objective;
                currentNote.soap_assessment = n.soap_assessment;
                currentNote.soap_plan = n.soap_plan;
            }
            input.value = '';
            showToast('AI edit applied!', 'success');
            await loadScribeSessions();
            activeScribeSession = scribeSessions.find(s => s.session_id === activeScribeSession?.session_id) || activeScribeSession;
            renderCurrentTab();
        } else {
            showToast(result?.error || 'AI edit failed', 'error');
        }
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('AI edit failed', 'error');
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

    showToast(`Generating ${labels[docType] || docType}…`, 'info');

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
                output.innerHTML += `
                    <div style="background:var(--surface-1); border:1px solid var(--border); border-radius:10px; padding:12px; margin-top:8px;">
                        <h4 style="margin:0 0 8px; font-size:13px; color:var(--cyan);">${labels[docType] || docType}</h4>
                        <div style="font-size:13px; color:var(--text-secondary); white-space:pre-wrap; line-height:1.5;">${formatSOAPContent(result.data?.content || '')}</div>
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

// ============================================================
// PATIENT CHART REVIEW PANEL (Slide-out during Scribe)
// ============================================================
let chartPanelData = null;
let chartPanelOpen = false;
let chartPanelPatientId = null;

function toggleChartPanel() {
    const panel = document.getElementById('chartPanel');
    if (!panel) return;
    chartPanelOpen = !chartPanelOpen;
    panel.classList.toggle('open', chartPanelOpen);

    // Load data if opening and we have a patient
    const pid = scribePatientId || activeScribeSession?.patient_id;
    if (chartPanelOpen && pid && pid !== chartPanelPatientId) {
        loadChartData(pid);
    }
}

async function loadChartData(patientId) {
    chartPanelPatientId = patientId;
    const content = document.getElementById('chartPanelContent');
    if (!content) return;
    content.innerHTML = '<div class="chart-loading"><div class="spinner"></div> Loading chart…</div>';

    // Hard timeout: if nothing loaded after 12s, render with whatever we got
    const failsafe = setTimeout(() => {
        if (content.querySelector('.chart-loading')) {
            console.warn('Chart load timed out, rendering with empty data');
            chartPanelData = chartPanelData || {
                demographics: {}, medications: {}, labs: {}, visits: [], alerts: [],
                controlled_substances: [], healthie_meds: [], healthie_allergies: [],
                healthie_chart_notes: [], healthie_documents: [], healthie_vitals: [],
                healthie_appointments: [], scribe_history: [], avatar_url: null,
            };
            renderChartPanel(content);
        }
    }, 12000);

    try {
        // Fetch both local 360 and Healthie chart data in parallel
        const [localResult, healthieResult] = await Promise.allSettled([
            apiFetch(`/ops/api/patients/${patientId}/360/`),
            apiFetch(`/ops/api/ipad/patient-chart/?patient_id=${patientId}`),
        ]);

        clearTimeout(failsafe);

        const local360 = localResult.status === 'fulfilled' && localResult.value?.success ? localResult.value.data : null;
        const healthieChart = healthieResult.status === 'fulfilled' && healthieResult.value?.success ? healthieResult.value.data : null;

        // Merge data
        chartPanelData = {
            demographics: local360?.demographics || healthieChart?.demographics || {},
            medications: local360?.medications || {},
            labs: local360?.labs || {},
            visits: local360?.visits || [],
            alerts: local360?.alerts || [],
            controlled_substances: local360?.controlled_substances || [],
            healthie_meds: healthieChart?.medications || [],
            healthie_allergies: healthieChart?.allergies || [],
            healthie_chart_notes: healthieChart?.chart_notes || [],
            healthie_documents: healthieChart?.documents || [],
            healthie_vitals: healthieChart?.vitals || [],
            healthie_appointments: healthieChart?.appointments || [],
            scribe_history: healthieChart?.scribe_history || [],
            avatar_url: healthieChart?.avatar_url || null,
        };
        renderChartPanel(content);
    } catch (e) {
        clearTimeout(failsafe);
        if (e.message === 'AUTH_EXPIRED') throw e;
        // Still render the panel with empty data rather than showing an error
        chartPanelData = chartPanelData || {
            demographics: {}, medications: {}, labs: {}, visits: [], alerts: [],
            controlled_substances: [], healthie_meds: [], healthie_allergies: [],
            healthie_chart_notes: [], healthie_documents: [], healthie_vitals: [],
            healthie_appointments: [], scribe_history: [], avatar_url: null,
        };
        renderChartPanel(content);
    }
}

function renderChartPanel(content) {
    const d = chartPanelData;
    if (!d) return;

    // Default to charting tab
    if (!window._chartTab) window._chartTab = 'charting';

    const demo = d.demographics || {};

    content.innerHTML = `
        <!-- Patient Photo + Demographics (always visible above tabs) -->
        <div style="padding:0 4px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:4px;">
            <div style="display:flex; align-items:center; gap:12px; padding:10px 0 6px;">
                ${d.avatar_url ? `<img src="${d.avatar_url}" style="width:48px; height:48px; border-radius:50%; object-fit:cover; border:2px solid var(--cyan);" />` : `<div style="width:48px; height:48px; border-radius:50%; background:var(--surface-2); display:flex; align-items:center; justify-content:center; font-size:20px; border:2px solid var(--border);">\ud83d\udc64</div>`}
                <div style="flex:1;">
                    <div style="font-size:15px; font-weight:600; color:var(--text-primary);">${demo.full_name || 'Unknown'}</div>
                    <div style="font-size:11px; color:var(--text-tertiary);">${demo.dob ? `DOB: ${new Date(demo.dob).toLocaleDateString()}` : ''} ${demo.status_key ? '\u00b7 ' + demo.status_key : ''}</div>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:2px 12px; padding:4px 0 8px; font-size:11px;">
                ${demo.phone_primary ? `<div><span style="color:var(--text-tertiary);">Phone:</span> <span style="color:var(--text-secondary);">${demo.phone_primary}</span></div>` : ''}
                ${demo.email ? `<div><span style="color:var(--text-tertiary);">Email:</span> <span style="color:var(--text-secondary);">${demo.email}</span></div>` : ''}
                ${demo.regimen ? `<div><span style="color:var(--text-tertiary);">Regimen:</span> <span style="color:var(--text-secondary);">${demo.regimen}</span></div>` : ''}
                ${demo.client_type_key ? `<div><span style="color:var(--text-tertiary);">Type:</span> <span style="color:var(--text-secondary);">${demo.client_type_key}</span></div>` : ''}
            </div>
        </div>

        <!-- Tabs -->
        <div class="chart-tab-nav">
            <button class="chart-tab-btn ${window._chartTab === 'charting' ? 'active' : ''}" onclick="switchChartTab('charting')">📋 Charting</button>
            <button class="chart-tab-btn ${window._chartTab === 'forms' ? 'active' : ''}" onclick="switchChartTab('forms')">📝 Forms</button>
            <button class="chart-tab-btn ${window._chartTab === 'documents' ? 'active' : ''}" onclick="switchChartTab('documents')">📁 Documents</button>
        </div>
        <div id="chartTabContent"></div>
    `;

    renderChartTabContent();
}

function switchChartTab(tab) {
    window._chartTab = tab;
    // Update button active states
    document.querySelectorAll('.chart-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.includes(
            tab === 'charting' ? 'Charting' : tab === 'forms' ? 'Forms' : 'Documents'
        ));
    });
    renderChartTabContent();
}

function renderChartTabContent() {
    const container = document.getElementById('chartTabContent');
    if (!container || !chartPanelData) return;
    const d = chartPanelData;

    if (window._chartTab === 'charting') {
        renderChartingTab(container, d);
    } else if (window._chartTab === 'forms') {
        renderFormsTab(container, d);
    } else {
        renderDocumentsTab(container, d);
    }
}

// ==================== CHARTING TAB ====================
function renderChartingTab(container, d) {
    const demo = d.demographics || {};
    const meds = d.medications || {};
    const peptides = meds.peptides || d.peptides || [];
    const trt = meds.trt || d.trt || [];
    const hMeds = d.healthie_meds || [];
    const hAllergies = d.healthie_allergies || [];
    const hVitals = d.healthie_vitals || [];
    const hAppts = d.healthie_appointments || [];
    const controlled = d.controlled_substances || [];
    const alerts = d.alerts || [];

    container.innerHTML = `
        <!-- Allergies & Sensitivities -->
        <div class="chart-section${hAllergies.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>🚨 Allergies & Sensitivities (${hAllergies.length})</span>
                <span style="display:flex;align-items:center;gap:6px;"><button class="chart-add-btn" onclick="event.stopPropagation();showPatientDataForm('allergy')" title="Add Allergy">＋</button><span class="chart-chevron">›</span></span>
            </div>
            <div class="chart-section-body">
                ${hAllergies.length > 0 ? hAllergies.map(a => `
                    <div class="chart-alert-card">
                        <div class="chart-alert-type">${a.name || 'Unknown'}</div>
                        <div class="chart-alert-detail">${a.reaction ? `Reaction: ${a.reaction}` : ''} ${a.severity ? `· ${a.severity}` : ''}</div>
                    </div>
                `).join('') : '<div class="chart-empty">No known allergies</div>'}
            </div>
        </div>

        <!-- Active Medications -->
        <div class="chart-section">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>💊 Medications (${peptides.length + trt.length + hMeds.length})</span>
                <span style="display:flex;align-items:center;gap:6px;"><button class="chart-add-btn" onclick="event.stopPropagation();showPatientDataForm('medication')" title="Add Medication">＋</button><span class="chart-chevron">›</span></span>
            </div>
            <div class="chart-section-body">
                ${hMeds.length > 0 ? `
                    <div class="chart-sub-label">Active (Healthie)</div>
                    ${hMeds.map(m => `
                        <div class="chart-med-card">
                            <div class="chart-med-name">${m.name || 'Unknown'}</div>
                            <div class="chart-med-detail">${m.dosage ? `${m.dosage}` : ''} ${m.frequency || ''} ${m.route ? `(${m.route})` : ''}</div>
                            ${m.directions ? `<div class="chart-med-detail">${m.directions}</div>` : ''}
                        </div>
                    `).join('')}
                ` : ''}
                ${peptides.length > 0 ? `
                    <div class="chart-sub-label">Peptides (Local)</div>
                    ${peptides.map(m => `
                        <div class="chart-med-card">
                            <div class="chart-med-name">${m.medication_name || m.product_name || 'Unknown'}</div>
                            <div class="chart-med-detail">${m.dose || m.dose_ml ? `Dose: ${m.dose || m.dose_ml}` : ''} ${m.frequency || ''}</div>
                        </div>
                    `).join('')}
                ` : ''}
                ${trt.length > 0 ? `
                    <div class="chart-sub-label">TRT (Local)</div>
                    ${trt.map(m => `
                        <div class="chart-med-card">
                            <div class="chart-med-name">${m.medication_name || m.product_name || 'Unknown'}</div>
                            <div class="chart-med-detail">${m.dose || m.dose_ml ? `Dose: ${m.dose || m.dose_ml}` : ''}</div>
                        </div>
                    `).join('')}
                ` : ''}
                ${peptides.length === 0 && trt.length === 0 && hMeds.length === 0 ? '<div class="chart-empty">No medications on file</div>' : ''}
            </div>
        </div>

        <!-- Vitals -->
        <div class="chart-section${hVitals.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📊 Vitals (${hVitals.length})</span>
                <span style="display:flex;align-items:center;gap:6px;"><button class="chart-add-btn" onclick="event.stopPropagation();showPatientDataForm('vital')" title="Add Vital">＋</button><span class="chart-chevron">›</span></span>
            </div>
            <div class="chart-section-body">
                ${hVitals.length > 0 ? hVitals.slice(0, 20).map(v => `
                    <div class="chart-visit-card">
                        <div class="chart-visit-date">${v.created_at ? new Date(v.created_at).toLocaleDateString() : '—'}</div>
                        <div class="chart-visit-detail">${v.category || v.type || ''}: ${v.metric_stat || v.description || ''}</div>
                    </div>
                `).join('') : '<div class="chart-empty">No vitals recorded</div>'}
            </div>
        </div>

        <!-- Appointments -->
        ${hAppts.length > 0 ? `
        <div class="chart-section collapsed">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📅 Appointments (${hAppts.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${hAppts.slice(0, 10).map(a => `
                    <div class="chart-visit-card">
                        <div class="chart-visit-date">${a.date ? new Date(a.date).toLocaleDateString() : '—'}</div>
                        <div style="flex:1">
                            <div class="chart-med-name">${a.appointment_type?.name || 'Appointment'}</div>
                            <div class="chart-med-detail">${a.provider?.full_name || ''} · ${a.pm_status || a.status || ''}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Controlled Substances -->
        ${controlled.length > 0 ? `
        <div class="chart-section collapsed">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>🔐 Controlled Substances (${controlled.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${controlled.map(c => `
                    <div class="chart-med-card">
                        <div class="chart-med-name">${c.medication_name || 'Unknown'}</div>
                        <div class="chart-med-detail">${c.dose_ml ? `${c.dose_ml}mL` : ''} · Dispensed: ${c.dispensed_date ? new Date(c.dispensed_date).toLocaleDateString() : '—'}</div>
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
function renderFormsTab(container, d) {
    const hChartNotes = d.healthie_chart_notes || [];
    const scribeHist = d.scribe_history || [];

    container.innerHTML = `
        <!-- Prior Scribe Notes -->
        ${scribeHist.length > 0 ? `
        <div class="chart-section">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>🎙️ Scribe Notes (${scribeHist.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${scribeHist.map(s => `
                    <div class="chart-visit-card">
                        <div class="chart-visit-date">${s.created_at ? new Date(s.created_at).toLocaleDateString() : '—'}</div>
                        <div style="flex:1">
                            <div class="chart-med-name">${(s.visit_type || '').replace(/_/g, ' ')} · ${s.status}</div>
                            ${s.soap_assessment ? `<div class="chart-med-detail" style="margin-top:2px">${s.soap_assessment.substring(0, 120)}…</div>` : ''}
                            ${s.icd10_codes ? `<div class="chart-med-detail" style="color:var(--cyan); margin-top:2px">${Array.isArray(s.icd10_codes) ? s.icd10_codes.slice(0, 3).join(', ') : String(s.icd10_codes).substring(0, 80)}</div>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Chart Notes (from Healthie) -->
        <div class="chart-section${hChartNotes.length === 0 ? ' collapsed' : ''}">
            <div class="chart-section-header" onclick="this.parentElement.classList.toggle('collapsed')">
                <span>📝 Chart Notes (${hChartNotes.length})</span>
                <span class="chart-chevron">›</span>
            </div>
            <div class="chart-section-body">
                ${hChartNotes.length > 0 ? hChartNotes.slice(0, 15).map(n => `
                    <div class="chart-lab-card">
                        <div class="chart-lab-name">${n.name || 'Note'}</div>
                        <div class="chart-lab-detail">${n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</div>
                        ${n.form_answers?.length > 0 ? `<div class="chart-med-detail" style="margin-top:4px">${n.form_answers.slice(0, 2).map(a => `${a.label}: ${(a.displayed_answer || a.answer || '').substring(0, 80)}`).join('; ')}${n.form_answers.length > 2 ? '…' : ''}</div>` : ''}
                    </div>
                `).join('') : '<div class="chart-empty">No chart notes</div>'}
            </div>
        </div>

        ${scribeHist.length === 0 && hChartNotes.length === 0 ? '<div class="chart-empty" style="padding:24px; text-align:center;">No forms or notes on file</div>' : ''}
    `;
}

// ==================== PATIENT DATA ENTRY ====================

function showPatientDataForm(type) {
    const healthieId = chartPanelData?.healthie_id;
    if (!healthieId) {
        showToast('No Healthie ID — cannot add data for unmapped patients', 'error');
        return;
    }

    const container = document.getElementById('chartTabContent');
    if (!container) return;

    let formHTML = '';

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
                    <input type="text" id="allergyName" class="chart-data-input" placeholder="Allergy name (e.g. Penicillin)" />
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
    }

    // Prepend form to the tab content
    const formDiv = document.createElement('div');
    formDiv.id = 'patientDataFormWrapper';
    formDiv.innerHTML = formHTML;
    container.prepend(formDiv);

    // Focus first input
    setTimeout(() => {
        const firstInput = formDiv.querySelector('input[type="text"]');
        if (firstInput) firstInput.focus();
    }, 100);
}

function closePatientDataForm() {
    const wrapper = document.getElementById('patientDataFormWrapper');
    if (wrapper) wrapper.remove();
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
        const severity = document.getElementById('allergySeverity')?.value;
        const reaction = document.getElementById('allergyReaction')?.value?.trim();
        const categoryType = document.getElementById('allergyType')?.value;
        if (!name) { showToast('Enter an allergy name', 'error'); return; }
        payload.action = 'add_allergy';
        payload.name = name;
        payload.severity = severity || '';
        payload.reaction = reaction || '';
        payload.category_type = categoryType || 'Allergy';
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
            showToast(`${type === 'vital' ? 'Vital' : type === 'allergy' ? 'Allergy' : 'Medication'} added to Healthie! ✅`, 'success');
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

// ==================== DOCUMENTS TAB ====================
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
                ${hDocs.length > 0 ? hDocs.slice(0, 30).map(doc => `
                    <div class="chart-lab-card" style="cursor:pointer;" onclick="window.open('https://securestaging.healthie.com/documents/' + '${doc.id}', '_blank')">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:18px;">${(doc.file_content_type || '').includes('pdf') ? '📄' : (doc.file_content_type || '').includes('image') ? '🖼️' : '📎'}</span>
                            <div>
                                <div class="chart-lab-name">${doc.display_name || 'Document'}</div>
                                <div class="chart-lab-detail">${doc.friendly_type || ''} · ${doc.created_at ? new Date(doc.created_at).toLocaleDateString() : ''}</div>
                            </div>
                        </div>
                    </div>
                `).join('') : '<div class="chart-empty">No documents</div>'}
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

// HTML for the chart panel (injected into scribe views)
function getChartPanelHTML() {
    const patientName = scribePatientName || activeScribeSession?.patient_name || 'Patient';
    return `
        <div id="chartPanel" class="chart-panel ${chartPanelOpen ? 'open' : ''}">
            <div class="chart-panel-header">
                <div class="chart-panel-title">📋 ${patientName}</div>
                <button class="chart-panel-close" onclick="toggleChartPanel()">✕</button>
            </div>
            <div id="chartPanelContent" class="chart-panel-content">
                <div class="chart-loading"><div class="spinner"></div> Loading chart…</div>
            </div>
        </div>
    `;
}

// Chart toggle button HTML (used in scribe header rows)
function getChartToggleBtn() {
    const pid = scribePatientId || activeScribeSession?.patient_id;
    if (!pid) return '';
    return `<button class="chart-toggle-btn" onclick="toggleChartPanel()" title="View patient chart">📋 Chart</button>`;
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
                        <input type="date" id="stageDoseDate" value="${new Date().toISOString().split('T')[0]}">
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
        input.addEventListener('input', () => {
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
        });
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
            if (result.hasDiscrepancy) showToast(`⚠️ Discrepancy: ${result.discrepancyDetails}. Inventory adjusted.`, 'info');
            else showToast(`${deaCheckType === 'morning' ? 'Morning' : 'Evening'} count verified ✅`, 'success');
        } else showToast(result?.error || 'Check failed', 'error');
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        showToast('DEA check failed', 'error');
    }
}

function closeModal(id) { document.getElementById(id)?.classList?.remove('visible'); }

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

let supplyItems = null;
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
        await apiFetch('/ops/api/supplies/count', {
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
    // Load all patients if not loaded (with guard to prevent infinite loop)
    if (!patientsLoaded && allPatients.length === 0 && !isLoading) {
        container.innerHTML = renderLoadingState();
        patientsLoaded = true; // prevent re-entry
        loadAllPatients().then(() => {
            if (currentTab === 'patients') renderCurrentTab();
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
                oninput="handlePatientSearch(this.value)">
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
                            <div class="patient-avatar" style="background:${color}">${getInitials(name)}</div>
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

    return `
        <div class="patient-list-item" onclick="selectPatient('${p.id || p.patient_id}')">
            <div class="patient-list-avatar" style="background:${color}">${getInitials(name)}</div>
            <div class="patient-list-info">
                <div class="patient-list-name">${name}</div>
                ${clientType ? `<div style="font-size:11px; color:var(--text-tertiary); margin-top:1px;">${clientType}</div>` : ''}
            </div>
            <span class="patient-status-badge" style="color:${statusColor}; border-color:${statusColor}40; background:${statusColor}10;">${label}</span>
        </div>
    `;
}

function handlePatientSearch(query) {
    const patients = getPatients();
    const q = query.toLowerCase().trim();
    const filtered = q
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
    const patients = getPatients();
    const patient = patients.find(p => String(p.id || p.patient_id) === String(id));
    if (!patient) return;
    selectedPatient = patient;

    const detail = document.getElementById('patientDetail');
    if (!detail) return;

    const name = patient.name || patient.patient_name || patient.full_name || ((patient.first_name || '') + ' ' + (patient.last_name || '')).trim();
    const color = patient.avatar_color || getAvatarColor(name);
    const rawStatus = patient.status_key || patient.status || 'Active';
    const statusLabel = formatStatusLabel(rawStatus);
    const statusColor = getStatusColor(rawStatus);

    // Show basic info + loading spinner
    detail.innerHTML = `
        <div class="patient-detail">
            <div class="patient-detail-header">
                <div class="patient-detail-avatar" style="background:${color}">${getInitials(name)}</div>
                <div style="flex:1">
                    <div class="patient-detail-name">${name}</div>
                    ${patient.dob ? `<div class="patient-detail-dob">DOB: ${formatDateDisplay(patient.dob)}</div>` : ''}
                    <span class="patient-status-badge" style="color:${statusColor}; border-color:${statusColor}40; background:${statusColor}10;">${statusLabel}</span>
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
    const data360 = await loadPatient360(id);
    renderPatient360(data360, patient, id);
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${mm}-${dd}-${yyyy}`;
    } catch { return dateStr; }
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

    let html = '';

    // ─── Badges & Info Grid (no duplicate name — name is in the header above) ───
    html += `
        <div class="patient-360-section">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; flex-wrap:wrap;">
                ${healthiePhoto ? `<img src="${healthiePhoto}" style="width:40px; height:40px; border-radius:10px; object-fit:cover; border:2px solid var(--border-light);">` : ''}
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

    container.innerHTML = html;

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
        const result = await apiFetch('/ops/api/peptides/dispenses/', {
            method: 'POST',
            body: JSON.stringify({
                patient_name: patientName,
                patient_id: patientId,
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
            // Print label
            printLabel(patientId, patientName, productName);
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
function printLabel(patientId, patientName, medication, options = {}) {
    const med = medication || 'Testosterone Cypionate';
    const type = options.type || (med.toLowerCase().includes('testosterone') ? 'testosterone' : 'peptide');

    // Look up patient DOB from cached data
    const p360 = patient360Cache[patientId];
    const demo = p360?.demographics || {};
    const patientData = allPatients.find(p => String(p.id || p.patient_id) === String(patientId)) || {};
    const dob = options.dob || demo.dob || demo.date_of_birth || patientData.dob || patientData.date_of_birth || '';
    const formattedDob = dob ? formatDateDisplay(dob) : '';

    const params = new URLSearchParams({
        type,
        patientName: patientName || '',
        patientDob: formattedDob,
        medication: med,
        dosage: options.dosage || '',
        provider: 'Phil Schafer, NP',
        dateDispensed: new Date().toLocaleDateString('en-US'),
        lotNumber: options.lotNumber || '',
        volume: options.volume || '',
        vialNumber: options.vialNumber || '',
        amountDispensed: options.amountDispensed || '',
        expDate: options.expDate || '',
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

            <!-- Revenue Cards -->
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
        </div>
    `;
}

// ─── PROVIDER SCHEDULE TAB ──────────────────────────────────
async function renderScheduleView(container) {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    container.innerHTML = `
        <div style="padding: 0 4px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
                <div>
                    <h1 style="font-size:24px; margin:0; color:var(--text-primary);">Schedule</h1>
                    <p style="font-size:13px; color:var(--text-tertiary); margin:4px 0 0;">${today}</p>
                </div>
                <button onclick="loadScheduleData()" style="padding:8px 16px; background:var(--surface); border:1px solid var(--border-light); border-radius:8px; color:var(--text-secondary); font-size:13px; cursor:pointer;">↻ Refresh</button>
            </div>
            <div id="scheduleContent"><div class="loading-spinner" style="margin:40px auto;"></div></div>
        </div>
    `;

    await loadScheduleData();
}

async function loadScheduleData() {
    const contentEl = document.getElementById('scheduleContent');
    if (!contentEl) return;

    try {
        // Use lightweight schedule endpoint (not heavy morning-prep cron)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        let data;
        try {
            data = await apiFetch('/ops/api/ipad/schedule/');
        } catch (fetchErr) {
            clearTimeout(timeout);
            throw fetchErr;
        }
        clearTimeout(timeout);
        const patients = data?.patients || [];

        if (patients.length === 0) {
            contentEl.innerHTML = `
                <div class="empty-state-card">
                    <div class="empty-state-icon">📅</div>
                    <h3>No Appointments Today</h3>
                    <p>No patients are scheduled for today.</p>
                </div>
            `;
            return;
        }

        // Sort by time
        patients.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

        contentEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
                <span style="font-size:14px; color:var(--text-secondary);">${patients.length} patients today</span>
                <span style="font-size:12px; padding:3px 10px; border-radius:6px; background:rgba(34,211,238,0.1); color:#22d3ee;">
                    ${patients.filter(p => p.appointment_status === 'Confirmed').length} confirmed
                </span>
            </div>
            ${patients.map(p => {
            const statusColor = p.appointment_status === 'Confirmed' ? '#22c55e' :
                p.appointment_status === 'Checked In' ? '#22d3ee' :
                    p.appointment_status === 'No Show' ? '#ef4444' : '#fbbf24';
            const statusBg = p.appointment_status === 'Confirmed' ? 'rgba(34,197,94,0.15)' :
                p.appointment_status === 'Checked In' ? 'rgba(34,211,238,0.15)' :
                    p.appointment_status === 'No Show' ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)';
            return `
                <div style="background:var(--card); border:1px solid var(--border-light); border-radius:12px; padding:16px; margin-bottom:10px; cursor:pointer;" onclick="navigateToPatient('${p.patient_id || ''}', '${(p.full_name || '').replace(/'/g, "\\'")}')">
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <div style="display:flex; align-items:center; gap:12px;">
                            <div style="width:42px; height:42px; border-radius:10px; background:var(--surface); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:14px; color:var(--text-primary);">
                                ${getInitials(p.full_name)}
                            </div>
                            <div>
                                <div style="font-size:15px; font-weight:600; color:var(--text-primary);">${p.full_name || 'Unknown'}</div>
                                <div style="font-size:12px; color:var(--text-tertiary);">${p.appointment_type || 'Appointment'} · ${p.time || 'TBD'}</div>
                                ${p.needs_labs ? '<span style="font-size:11px; color:#f59e0b;">🔬 Labs needed</span>' : ''}
                                ${p.needs_payment ? '<span style="font-size:11px; color:#ef4444; margin-left:6px;">💳 Payment issue</span>' : ''}
                            </div>
                        </div>
                        <span style="font-size:11px; padding:4px 10px; border-radius:6px; background:${statusBg}; color:${statusColor}; font-weight:500;">
                            ${p.appointment_status || 'Pending'}
                        </span>
                    </div>
                </div>
                `;
        }).join('')}
        `;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        contentEl.innerHTML = `<div class="empty-state-card"><h3>Could not load schedule</h3><p>${e.message}</p></div>`;
    }
}

function navigateToPatient(patientId, patientName) {
    if (!patientId) return;
    selectedPatient = patientId;
    window.location.hash = '#patients';
    setTimeout(() => {
        loadPatient360(patientId);
    }, 200);
}

// ─── VITALS / METRICS ENTRY ─────────────────────────────────
const METRIC_UNITS = {
    weight: 'lbs', blood_pressure: 'mmHg', heart_rate: 'bpm',
    temperature: '°F', oxygen_saturation: '%', respiration_rate: '/min',
    testosterone_level: 'ng/dL', hematocrit: '%', psa: 'ng/mL',
    bmi: '', waist_circumference: 'in', hemoglobin: 'g/dL',
};

function openVitalsModal(patientId, patientName) {
    const existingModal = document.getElementById('vitalsModal');
    if (existingModal) existingModal.remove();

    document.body.insertAdjacentHTML('beforeend', `
        <div id="vitalsModal" class="modal-overlay" style="display:flex;">
            <div class="modal modal-large" style="max-width:520px;">
                <div class="modal-header">
                    <h2 style="font-size:18px; margin:0;">📋 Record Vitals</h2>
                    <button class="modal-close" onclick="document.getElementById('vitalsModal').remove()">✕</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="font-size:13px; color:var(--text-tertiary); margin-bottom:16px;">Patient: <strong style="color:var(--text-primary);">${patientName}</strong></div>

                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Metric Type</label>
                        <select id="vitalsType" onchange="updateVitalsUnit()" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                            <option value="weight">Weight (lbs)</option>
                            <option value="blood_pressure">Blood Pressure (mmHg)</option>
                            <option value="heart_rate">Heart Rate (bpm)</option>
                            <option value="temperature">Temperature (°F)</option>
                            <option value="oxygen_saturation">Oxygen Saturation (%)</option>
                            <option value="respiration_rate">Respiration Rate (/min)</option>
                            <option value="testosterone_level">Testosterone Level (ng/dL)</option>
                            <option value="hematocrit">Hematocrit (%)</option>
                            <option value="psa">PSA (ng/mL)</option>
                            <option value="bmi">BMI</option>
                            <option value="waist_circumference">Waist Circumference (in)</option>
                            <option value="hemoglobin">Hemoglobin (g/dL)</option>
                        </select>
                    </div>

                    <!-- Standard value input -->
                    <div id="vitalsStandardInput" style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Value <span id="vitalsUnitLabel" style="color:var(--text-tertiary);">(lbs)</span></label>
                        <input id="vitalsValue" type="number" step="any" placeholder="Enter value" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                    </div>

                    <!-- Blood pressure dual input (hidden by default) -->
                    <div id="vitalsBPInput" style="display:none; margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Blood Pressure</label>
                        <div style="display:flex; gap:10px; align-items:center;">
                            <input id="vitalsSystolic" type="number" placeholder="Systolic" style="flex:1; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                            <span style="color:var(--text-tertiary); font-size:18px;">/</span>
                            <input id="vitalsDiastolic" type="number" placeholder="Diastolic" style="flex:1; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px;">
                            <span style="color:var(--text-tertiary); font-size:13px;">mmHg</span>
                        </div>
                    </div>

                    <div style="margin-bottom:16px;">
                        <label style="display:block; font-size:12px; color:var(--text-secondary); margin-bottom:6px; font-weight:600;">Notes (optional)</label>
                        <input id="vitalsNotes" type="text" placeholder="e.g. Before medication, fasting" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
                    </div>

                    <div id="vitalsError" style="display:none; padding:8px 12px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); border-radius:8px; color:#f87171; font-size:13px; margin-bottom:12px;"></div>
                    <div id="vitalsSuccess" style="display:none; padding:8px 12px; background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.2); border-radius:8px; color:#22c55e; font-size:13px; margin-bottom:12px;"></div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="document.getElementById('vitalsModal').remove()">Cancel</button>
                    <button class="btn-primary" id="vitalsSubmitBtn" onclick="submitVitals('${patientId}')">Save Vitals</button>
                </div>
            </div>
        </div>
    `);
}

function updateVitalsUnit() {
    const type = document.getElementById('vitalsType').value;
    const unit = METRIC_UNITS[type] || '';
    const unitLabel = document.getElementById('vitalsUnitLabel');
    if (unitLabel) unitLabel.textContent = unit ? `(${unit})` : '';

    // Toggle BP dual-input vs standard input
    const stdInput = document.getElementById('vitalsStandardInput');
    const bpInput = document.getElementById('vitalsBPInput');
    if (type === 'blood_pressure') {
        stdInput.style.display = 'none';
        bpInput.style.display = 'block';
    } else {
        stdInput.style.display = 'block';
        bpInput.style.display = 'none';
    }
}

async function submitVitals(patientId) {
    const btn = document.getElementById('vitalsSubmitBtn');
    const errorEl = document.getElementById('vitalsError');
    const successEl = document.getElementById('vitalsSuccess');
    const type = document.getElementById('vitalsType').value;
    const notes = document.getElementById('vitalsNotes')?.value || '';

    let value, systolic, diastolic;
    if (type === 'blood_pressure') {
        systolic = document.getElementById('vitalsSystolic')?.value;
        diastolic = document.getElementById('vitalsDiastolic')?.value;
        if (!systolic || !diastolic) {
            errorEl.textContent = 'Enter both systolic and diastolic values';
            errorEl.style.display = 'block';
            return;
        }
        value = `${systolic}/${diastolic}`;
    } else {
        value = document.getElementById('vitalsValue')?.value;
        if (!value) {
            errorEl.textContent = 'Please enter a value';
            errorEl.style.display = 'block';
            return;
        }
    }

    btn.textContent = 'Saving…';
    btn.disabled = true;
    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    try {
        const resp = await apiFetch(`/ops/api/ipad/patient/${patientId}/metrics/`, {
            method: 'POST',
            body: JSON.stringify({
                metric_type: type,
                value,
                unit: METRIC_UNITS[type] || '',
                notes,
                blood_pressure_systolic: systolic,
                blood_pressure_diastolic: diastolic,
            })
        });

        if (resp.error) throw new Error(resp.error);

        const syncMsg = resp.healthie_synced ? ' (synced to Healthie ✅)' : ' (saved locally)';
        successEl.textContent = `${type.replace(/_/g, ' ')} recorded: ${value} ${METRIC_UNITS[type] || ''}${syncMsg}`;
        successEl.style.display = 'block';

        // Reset form for next entry
        btn.textContent = 'Save Another';
        btn.disabled = false;
        document.getElementById('vitalsValue').value = '';
        document.getElementById('vitalsSystolic').value = '';
        document.getElementById('vitalsDiastolic').value = '';
        document.getElementById('vitalsNotes').value = '';

        // Refresh patient data to show new vitals
        loadPatient360(patientId);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Failed to save vitals';
        errorEl.style.display = 'block';
        btn.textContent = 'Save Vitals';
        btn.disabled = false;
    }
}

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
            const qData = await apiFetch('/ops/api/labs/review-queue');
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
                                ${r.id ? `<button class="btn-sm btn-secondary" onclick="window.open('/ops/api/labs/review-queue/${r.id}/pdf', '_blank')" style="font-size:11px; padding:3px 8px;">📄 View PDF</button>` : ''}
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
        const data = await apiFetch('/ops/api/inventory/vials?status=active');
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
                            ${deaVials.map(v => `<option value="${v.vial_id || v.id}" data-drug="${v.dea_drug_name || 'Testosterone Cypionate'}" data-schedule="${v.dea_schedule || 'CIII'}" data-remaining="${v.remaining_ml || v.volume_ml || 10}">${v.external_id || v.vial_id} — ${v.dea_drug_name || 'Testosterone'} (${parseFloat(v.remaining_ml || v.volume_ml || 10).toFixed(1)}mL remain)</option>`).join('')}
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

        // Print label
        printLabel(patientId, patientName, drugName, {
            dosage: `${doseMl}mL`,
            volume: `${doseMl}mL`,
            vialNumber: vialId,
        });

        btn.textContent = '✅ Done';
        setTimeout(() => {
            document.getElementById('controlledDispenseModal')?.remove();
            loadPatient360(patientId);
        }, 1500);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Dispense failed';
        errorEl.style.display = 'block';
        btn.textContent = '💉 Stage & Dispense';
        btn.disabled = false;
    }
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
                            <input id="editDOB" type="date" value="${demo.dob || ''}" style="width:100%; padding:10px 14px; border-radius:8px; border:1px solid var(--border-light); background:var(--surface); color:var(--text-primary); font-size:14px; font-family:inherit;">
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
        dob: document.getElementById('editDOB')?.value,
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
            loadPatient360(patientId);
        }, 1500);
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        errorEl.textContent = e.message || 'Failed to save';
        errorEl.style.display = 'block';
        btn.textContent = '💾 Save & Sync';
        btn.disabled = false;
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
