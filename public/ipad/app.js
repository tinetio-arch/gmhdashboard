/* ============================================================
   GMH Ops v2.0 — iPad Companion App (LIVE DATA)
   Connects to /ops/api/* endpoints via same-origin cookies
   ============================================================ */

// ─── STATE ──────────────────────────────────────────────────
let dashboardData = null;       // from /ops/api/ipad/dashboard
let healthieAppointments = [];  // from /ops/api/cron/morning-prep
let inventorySummary = null;    // from /ops/api/inventory/intelligence/summary
let inventoryAlerts = [];       // from /ops/api/inventory/intelligence/alerts
let labsQueue = [];             // from /ops/api/labs/review-queue or dashboard
let patient360Cache = {};       // patient_id -> 360 data

let currentTab = 'today';
let selectedPatient = null;
let activeLabFilter = 'pending';
let activeInventoryTab = 'dea';
let activeSupplyFilter = 'All';
let isConnected = false;
let isLoading = false;

// Cron secret for Healthie appointments
const CRON_SECRET = '59c7ba5958b3c753f607a1bdeeb53ae36aabac6ebcf8729f6d411f43fc704122';

// ─── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    updateClock();
    setInterval(updateClock, 30000);
    setupTabBar();
    setupHashRouting();
    setupPullToRefresh();
    loadAllData();
});

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
    if (!['today', 'labs', 'faxes', 'inventory', 'patients'].includes(tab)) tab = 'today';
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
        case 'faxes': renderFaxesView(view); break;
        case 'inventory': renderInventoryView(view); break;
        case 'patients': renderPatientsView(view); break;
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
    renderCurrentTab(); // Show loading states

    let anySuccess = false;

    // Parallel fetch: dashboard + inventory alerts + Healthie appointments
    const results = await Promise.allSettled([
        loadDashboard(),
        loadInventoryAlerts(),
        loadHealthieAppointments()
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
        const data = await apiFetch('/ops/api/ipad/dashboard');
        if (data.success && data.data) {
            dashboardData = data.data;
            return true;
        }
        // If endpoint returns but no data structure
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
        const data = await apiFetch('/ops/api/cron/morning-prep', {
            headers: { 'x-cron-secret': CRON_SECRET }
        });
        if (data && data.appointments) {
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
        const data = await apiFetch('/ops/api/inventory/intelligence/summary');
        inventorySummary = data;
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Inventory summary load failed:', e);
        return false;
    }
}

async function loadInventoryAlerts() {
    try {
        const data = await apiFetch('/ops/api/inventory/intelligence/alerts');
        if (Array.isArray(data)) {
            inventoryAlerts = data;
        } else if (data.alerts) {
            inventoryAlerts = data.alerts;
        } else if (data.data) {
            inventoryAlerts = Array.isArray(data.data) ? data.data : [];
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
        const data = await apiFetch('/ops/api/labs/review-queue');
        if (Array.isArray(data)) {
            labsQueue = data;
        } else if (data.data) {
            labsQueue = Array.isArray(data.data) ? data.data : [];
        } else if (data.labs) {
            labsQueue = data.labs;
        }
        return true;
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Labs queue load failed (endpoint may not exist yet):', e);
        return false;
    }
}

async function loadPatient360(patientId) {
    if (patient360Cache[patientId]) return patient360Cache[patientId];
    try {
        const data = await apiFetch(`/ops/api/patients/${patientId}/360`);
        patient360Cache[patientId] = data;
        return data;
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

    // Faxes badge — hidden since no endpoint yet
    const faxBadge = document.getElementById('faxesBadge');
    if (faxBadge) faxBadge.classList.add('hidden');
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
    return (dashboardData && dashboardData.patients) ? dashboardData.patients : [];
}

function getLabsPending() {
    // Prefer dedicated labs queue, fall back to dashboard labs
    if (labsQueue.length > 0) return labsQueue.filter(l => l.status === 'pending' || l.status === 'needs_review');
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

    // Compute stats
    const activePatientCount = patients.length || 0;
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
    `;

    // Setup swipe gestures on action cards
    setTimeout(() => setupSwipeGestures(), 100);
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
    // Try loading labs if not loaded
    if (labsQueue.length === 0 && !isLoading) {
        container.innerHTML = renderLoadingState();
        loadLabsQueue().then(success => {
            if (currentTab === 'labs') {
                renderCurrentTab();
                updateBadges();
            }
        });
        return;
    }

    const allLabs = labsQueue;
    const pending = allLabs.filter(l => l.status === 'pending' || l.status === 'needs_review');
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
        try { results = typeof lab.results_json === 'string' ? JSON.parse(lab.results_json) : lab.results_json; } catch(e) {}
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
                    <button class="btn-approve" onclick="event.stopPropagation(); approveLab('${labId}')">✓ APPROVE</button>
                    <button class="btn-reject" onclick="event.stopPropagation(); rejectLab('${labId}')">Reject</button>
                </div>
            ` : `
                <div class="lab-actions">
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
    // Try to call approve endpoint
    try {
        await apiFetch(`/ops/api/labs/review-queue/${id}/approve`, { method: 'POST' });
    } catch (e) {
        // If endpoint doesn't exist, just update locally
        console.warn('Lab approve endpoint not available, updating locally');
    }
    const lab = labsQueue.find(l => (l.id || l.lab_id) == id);
    if (lab) lab.status = 'approved';
    updateBadges();
    showToast('Lab result approved', 'success');
    renderCurrentTab();
}

async function rejectLab(id) {
    try {
        await apiFetch(`/ops/api/labs/review-queue/${id}/reject`, { method: 'POST' });
    } catch (e) {
        console.warn('Lab reject endpoint not available, updating locally');
    }
    const lab = labsQueue.find(l => (l.id || l.lab_id) == id);
    if (lab) lab.status = 'rejected';
    updateBadges();
    showToast('Lab result rejected', 'info');
    renderCurrentTab();
}

async function batchApproveNormal() {
    try {
        await apiFetch('/ops/api/labs/review-queue/batch-approve', { method: 'POST' });
    } catch (e) {
        console.warn('Batch approve endpoint not available, updating locally');
    }
    labsQueue.forEach(l => {
        if (!l.critical && !l.is_critical && (l.status === 'pending' || l.status === 'needs_review')) {
            l.status = 'approved';
        }
    });
    updateBadges();
    showToast('All normal labs approved', 'success');
    renderCurrentTab();
}

// ============================================================
// FAXES VIEW — Coming Soon
// ============================================================
function renderFaxesView(container) {
    container.innerHTML = `
        <h1 style="font-size:28px; margin-bottom:20px;">Fax Triage</h1>
        <div class="coming-soon">
            <div class="coming-soon-icon">📠</div>
            <h2>Coming Soon</h2>
            <p>AI-powered fax triage is being built. Incoming faxes will be automatically analyzed, 
               matched to patients, and queued for your review.</p>
            
            <div class="example-fax-cards">
                <div class="example-label">Preview — What this will look like</div>
                
                <div class="fax-card" style="opacity:0.6; pointer-events:none;">
                    <div class="fax-header">
                        <div>
                            <div class="fax-sender">Sonora Quest Laboratories</div>
                            <div class="fax-meta">
                                <span>Feb 26, 2026</span>
                                <span>3 pages</span>
                            </div>
                        </div>
                        <span class="fax-type-badge">Lab Results</span>
                    </div>
                    <div class="fax-ai-summary">
                        <div class="fax-ai-header">
                            ✨ AI Summary 
                            <span class="confidence-badge green">high confidence</span>
                        </div>
                        <p>Lab results for patient — CMP panel with flagged glucose (248 mg/dL). Urgent review recommended.</p>
                    </div>
                    <div class="fax-match">
                        <span>🔗</span>
                        <span>Suggested Patient: <strong>David Kowalski</strong></span>
                        <span class="fax-match-pct">95% match</span>
                    </div>
                    <div class="fax-actions">
                        <button class="btn-fax-approve" disabled>✓ APPROVE & UPLOAD</button>
                        <button class="btn-fax-reject" disabled>Reject</button>
                    </div>
                </div>

                <div class="fax-card" style="opacity:0.4; pointer-events:none;">
                    <div class="fax-header">
                        <div>
                            <div class="fax-sender">Desert Ridge Orthopedics</div>
                            <div class="fax-meta">
                                <span>Feb 25, 2026</span>
                                <span>5 pages</span>
                            </div>
                        </div>
                        <span class="fax-type-badge">Referral Letter</span>
                    </div>
                    <div class="fax-ai-summary">
                        <div class="fax-ai-header">
                            ✨ AI Summary
                            <span class="confidence-badge yellow">medium confidence</span>
                        </div>
                        <p>Referral letter for new patient. Includes MRI report, PT notes, medication list.</p>
                    </div>
                    <div class="fax-match">
                        <span>🔗</span>
                        <span>Suggested Patient: <strong>New Patient</strong></span>
                        <span class="fax-match-pct">72% match</span>
                    </div>
                    <div class="fax-actions">
                        <button class="btn-fax-approve" disabled>✓ APPROVE & UPLOAD</button>
                        <button class="btn-fax-reject" disabled>Reject</button>
                    </div>
                </div>
            </div>
        </div>
    `;
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
    // Extract vials from inventory summary
    const vials = extractVials();
    const patients = getPatients();

    return `
        <div class="dea-check-section">
            <div class="dea-check-title">Daily DEA Verification</div>
            <div class="dea-check-row">
                <div class="dea-check-label">
                    ☀️ Morning Count
                </div>
                <button class="toggle-btn" onclick="completeDEACheck('morning', this)"></button>
            </div>
            <div class="dea-check-row">
                <div class="dea-check-label">
                    🌙 End of Day Count
                </div>
                <button class="toggle-btn" onclick="completeDEACheck('eod', this)"></button>
            </div>
        </div>

        ${inventoryAlerts.length > 0 ? `
            <div class="section-header" style="margin-top:20px">
                <h2>⚠️ Alerts</h2>
            </div>
            <div class="stagger-in">
                ${inventoryAlerts.map(a => `
                    <div class="alert-card">
                        <div class="alert-emoji">⚠️</div>
                        <div class="alert-text">${a.message || a.alert || a.description || JSON.stringify(a)}</div>
                    </div>
                `).join('')}
            </div>
        ` : ''}

        <div class="section-header" style="margin-top:20px">
            <h2>Vial Inventory</h2>
            <span style="color:var(--text-tertiary); font-size:13px;">${vials.length} vials tracked</span>
        </div>
        ${vials.length > 0 ? `
            <div class="vial-scroll">
                ${vials.map(v => renderVialCard(v)).join('')}
            </div>
        ` : renderEmptyState('💉', 'No vial data', 'Inventory data not yet available')}

        <button class="btn-dispense" onclick="openDispenseModal()">
            💉 Quick Dispense
        </button>

        <!-- Dispense Modal -->
        <div class="modal-overlay" id="dispenseModal">
            <div class="modal">
                <h3>Quick Dispense</h3>
                <div class="modal-field">
                    <label>Vial</label>
                    <select id="dispenseVial">
                        ${vials.map(v => `<option value="${v.id || v.vial_id}">${v.vial_id || v.id} — ${v.substance || v.name} (${v.remaining_ml || v.remaining || '?'}mL)</option>`).join('')}
                    </select>
                </div>
                <div class="modal-field">
                    <label>Patient</label>
                    <select id="dispensePatient">
                        ${patients.map(p => `<option value="${p.id}">${p.name || p.patient_name || p.first_name + ' ' + p.last_name}</option>`).join('')}
                    </select>
                </div>
                <div class="modal-field">
                    <label>Amount (mL)</label>
                    <input type="number" id="dispenseAmount" step="0.1" value="0.5" min="0.1" max="10">
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="closeDispenseModal()">Cancel</button>
                    <button class="btn-primary" onclick="submitDispense()">Dispense</button>
                </div>
            </div>
        </div>
    `;
}

function extractVials() {
    if (!inventorySummary) return [];
    // Try common response shapes
    if (inventorySummary.vials && Array.isArray(inventorySummary.vials)) return inventorySummary.vials;
    if (inventorySummary.data && inventorySummary.data.vials) return inventorySummary.data.vials;
    if (inventorySummary.dea && Array.isArray(inventorySummary.dea)) return inventorySummary.dea;
    if (inventorySummary.controlled && Array.isArray(inventorySummary.controlled)) return inventorySummary.controlled;
    // If top-level is an array
    if (Array.isArray(inventorySummary)) {
        return inventorySummary.filter(item => item.vial_id || item.substance || item.is_controlled);
    }
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
            <div class="vial-gauge">
                <div class="vial-gauge-fill ${level}" style="width:${pct}%"></div>
            </div>
            <div class="vial-remaining">${remaining}<span> / ${total} mL</span></div>
            ${expiry ? `<div class="vial-expiry">Exp: ${expiry}</div>` : ''}
        </div>
    `;
}

function completeDEACheck(type, btn) {
    btn.classList.toggle('on');
    if (btn.classList.contains('on')) {
        showToast(`${type === 'morning' ? 'Morning' : 'End of Day'} DEA check completed`, 'success');
    }
}

function openDispenseModal() {
    document.getElementById('dispenseModal').classList.add('visible');
}

function closeDispenseModal() {
    document.getElementById('dispenseModal').classList.remove('visible');
}

async function submitDispense() {
    const vialId = document.getElementById('dispenseVial')?.value;
    const patientId = document.getElementById('dispensePatient')?.value;
    const amount = document.getElementById('dispenseAmount')?.value;

    if (vialId && patientId && amount) {
        try {
            await apiFetch('/ops/api/inventory/dispense', {
                method: 'POST',
                body: JSON.stringify({ vial_id: vialId, patient_id: patientId, amount: parseFloat(amount) })
            });
        } catch (e) {
            console.warn('Dispense endpoint not available');
        }
    }

    closeDispenseModal();
    showToast('Dispense recorded successfully', 'success');
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
                const stock = p.stock || p.current_stock || p.quantity || 0;
                const par = p.par_level || p.par || p.reorder_point || 10;
                const unit = p.unit || p.units || 'vials';
                const name = p.name || p.medication || p.peptide_name || '';
                const ratio = par > 0 ? stock / par : 1;
                const level = ratio > 1.5 ? 'over' : ratio >= 0.8 ? 'at' : 'under';
                const barPct = Math.min((stock / (par * 3)) * 100, 100);
                return `
                    <div class="peptide-card">
                        <div class="peptide-name">${name}</div>
                        <div class="peptide-stock">${stock}<span> ${unit}</span></div>
                        <div class="peptide-par">PAR Level: ${par} ${unit}</div>
                        <div class="stock-bar">
                            <div class="stock-bar-fill ${level}" style="width:${barPct}%"></div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function extractPeptides() {
    if (!inventorySummary) return [];
    if (inventorySummary.peptides && Array.isArray(inventorySummary.peptides)) return inventorySummary.peptides;
    if (inventorySummary.data && inventorySummary.data.peptides) return inventorySummary.data.peptides;
    if (Array.isArray(inventorySummary)) {
        return inventorySummary.filter(item => item.peptide_name || item.is_peptide || (item.category && item.category.toLowerCase().includes('peptide')));
    }
    return [];
}

// ─── SUPPLIES SECTION ───────────────────────────────────────
function renderSuppliesSection() {
    const supplies = extractSupplies();

    if (supplies.length === 0) {
        return renderEmptyState('📦', 'No supply data', 'Inventory data not yet available');
    }

    const categories = ['All', ...new Set(supplies.map(s => s.category || 'Other').filter(Boolean))];
    const filtered = activeSupplyFilter === 'All' ? supplies : supplies.filter(s => (s.category || 'Other') === activeSupplyFilter);

    return `
        <div class="supply-filters">
            ${categories.map(c => `
                <button class="filter-pill ${activeSupplyFilter === c ? 'active' : ''}" 
                        onclick="setSupplyFilter('${c}')">${c}</button>
            `).join('')}
        </div>
        <div class="stagger-in">
            ${filtered.map(s => {
                const count = s.current_count || s.quantity || s.stock || 0;
                const par = s.par_level || s.par || s.reorder_point || 10;
                const name = s.name || s.supply_name || '';
                const ratio = par > 0 ? count / par : 1;
                const level = ratio > 1.2 ? 'ok' : ratio >= 0.8 ? 'warning' : 'low';
                const label = level === 'ok' ? 'In Stock' : level === 'warning' ? 'Re-order Soon' : 'LOW STOCK';
                return `
                    <div class="supply-item">
                        <div class="supply-name">${name}</div>
                        <div class="supply-count">
                            <span class="supply-count-value">${count}</span>
                            <span class="supply-par-indicator ${level}">${label}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function extractSupplies() {
    if (!inventorySummary) return [];
    if (inventorySummary.supplies && Array.isArray(inventorySummary.supplies)) return inventorySummary.supplies;
    if (inventorySummary.data && inventorySummary.data.supplies) return inventorySummary.data.supplies;
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
                    return `
                        <div class="recent-patient-card" onclick="selectPatient('${p.id}')">
                            <div class="patient-avatar" style="background:${color}">${getInitials(name)}</div>
                            <div class="recent-patient-name">${name}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : ''}

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

function renderPatientListItem(p) {
    const name = p.name || p.patient_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
    const color = p.avatar_color || getAvatarColor(name);
    const status = p.status || 'Active';
    const statusClass = status.toLowerCase().replace(/\s+/g, '_');
    const clinic = p.clinic || p.location || '';

    return `
        <div class="patient-list-item" onclick="selectPatient('${p.id}')">
            <div class="patient-list-avatar" style="background:${color}">${getInitials(name)}</div>
            <div class="patient-list-name">${name}</div>
            <div class="patient-list-clinic">${clinic}</div>
            <span class="patient-list-status patient-status-badge ${statusClass}">${status}</span>
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
    const patient = patients.find(p => String(p.id) === String(id));
    if (!patient) return;
    selectedPatient = patient;

    const detail = document.getElementById('patientDetail');
    if (!detail) return;

    const name = patient.name || patient.patient_name || ((patient.first_name || '') + ' ' + (patient.last_name || '')).trim();
    const color = patient.avatar_color || getAvatarColor(name);
    const status = patient.status || 'Active';
    const statusClass = status.toLowerCase().replace(/\s+/g, '_');

    // Show basic info immediately, then load 360
    detail.innerHTML = `
        <div class="patient-detail">
            <div class="patient-detail-header">
                <div class="patient-detail-avatar" style="background:${color}">${getInitials(name)}</div>
                <div>
                    <div class="patient-detail-name">${name}</div>
                    ${patient.dob ? `<div class="patient-detail-dob">DOB: ${patient.dob}</div>` : ''}
                    <span class="patient-status-badge ${statusClass}">${status}</span>
                </div>
            </div>
            <div class="patient-info-grid">
                ${patient.clinic ? `
                    <div class="patient-info-item">
                        <div class="patient-info-label">Clinic</div>
                        <div class="patient-info-value">${patient.clinic || patient.location || ''}</div>
                    </div>
                ` : ''}
                ${patient.last_visit ? `
                    <div class="patient-info-item">
                        <div class="patient-info-label">Last Visit</div>
                        <div class="patient-info-value">${patient.last_visit}</div>
                    </div>
                ` : ''}
                ${patient.next_lab ? `
                    <div class="patient-info-item">
                        <div class="patient-info-label">Next Lab Due</div>
                        <div class="patient-info-value">${patient.next_lab}</div>
                    </div>
                ` : ''}
                ${patient.payment_status ? `
                    <div class="patient-info-item">
                        <div class="patient-info-label">Payment Status</div>
                        <div class="patient-info-value ${patient.payment_status === 'Past Due' ? 'overdue' : ''}">${patient.payment_status}</div>
                    </div>
                ` : ''}
            </div>
            <div id="patient360Data">
                <div class="patient-360-loading">
                    <div class="loading-spinner"></div>
                    <span>Loading patient details…</span>
                </div>
            </div>
            <div class="patient-quick-actions">
                <button class="quick-action-btn" onclick="window.open('https://app.gethealthie.com/users/${id}', '_blank')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    <span>View in Healthie</span>
                </button>
                <button class="quick-action-btn" onclick="showToast('Opening dispense log…', 'info')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3h6v7l4 9H5l4-9V3z"/></svg>
                    <span>Log Dispense</span>
                </button>
                <button class="quick-action-btn" onclick="showToast('Opening lab orders…', 'info')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                    <span>Order Labs</span>
                </button>
                <button class="quick-action-btn" onclick="showToast('Opening messaging…', 'info')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>Send Message</span>
                </button>
            </div>
        </div>
    `;

    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Load 360 data
    const data360 = await loadPatient360(id);
    renderPatient360(data360);
}

function renderPatient360(data) {
    const container = document.getElementById('patient360Data');
    if (!container) return;

    if (!data) {
        container.innerHTML = `
            <div style="padding:20px; text-align:center; color:var(--text-tertiary); font-size:13px;">
                Extended patient data not available
            </div>
        `;
        return;
    }

    // Normalize the 360 data — it could come in different shapes
    const medications = data.medications || data.meds || data.prescriptions || [];
    const labHistory = data.lab_history || data.labs || data.recent_labs || [];
    const visits = data.visits || data.appointments || data.recent_visits || [];
    const alerts = data.alerts || data.flags || [];
    const demographics = data.demographics || data.patient || data;

    let html = '';

    // Medications
    if (medications.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Medications</h3>
                ${medications.map(m => {
                    const medName = m.name || m.medication || m.drug_name || '';
                    const dose = m.dose || m.dosage || m.instructions || '';
                    const medStatus = m.status || 'active';
                    return `
                        <div class="med-card">
                            <div>
                                <div class="med-name">${medName}</div>
                                ${dose ? `<div class="med-dose">${dose}</div>` : ''}
                            </div>
                            <span class="med-status ${medStatus.toLowerCase()}">${medStatus}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Recent Labs
    if (labHistory.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Recent Labs</h3>
                ${labHistory.slice(0, 5).map(l => {
                    const labName = l.test_type || l.panel_name || l.name || 'Lab';
                    const labDate = l.date || l.received_date || l.created_at || '';
                    const labStatus = l.status || '';
                    return `
                        <div class="med-card">
                            <div>
                                <div class="med-name">${labName}</div>
                                ${labDate ? `<div class="med-dose">${labDate}</div>` : ''}
                            </div>
                            ${labStatus ? `<span class="med-status ${labStatus.toLowerCase()}">${labStatus}</span>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Alerts
    if (alerts.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Alerts</h3>
                ${alerts.map(a => {
                    const alertText = typeof a === 'string' ? a : (a.message || a.text || a.description || JSON.stringify(a));
                    return `
                        <div class="alert-card">
                            <div class="alert-emoji">⚠️</div>
                            <div class="alert-text">${alertText}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    // Recent Visits
    if (visits.length > 0) {
        html += `
            <div class="patient-360-section">
                <h3>Recent Visits</h3>
                ${visits.slice(0, 5).map(v => {
                    const visitDate = v.date || v.visit_date || v.created_at || '';
                    const visitType = v.type || v.visit_type || v.reason || '';
                    const provider = v.provider || v.provider_name || '';
                    return `
                        <div class="med-card">
                            <div>
                                <div class="med-name">${visitType || 'Visit'}</div>
                                <div class="med-dose">${visitDate}${provider ? ' · ' + provider : ''}</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    if (!html) {
        html = `
            <div style="padding:20px; text-align:center; color:var(--text-tertiary); font-size:13px;">
                No extended data available for this patient
            </div>
        `;
    }

    container.innerHTML = html;
}
