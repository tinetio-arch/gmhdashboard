// ─── BACKGROUND TRANSCRIPTION POLLING SERVICE ───────────────
// Survives tab navigation, page visibility changes, and user actions
// FIX(2026-04-22): Added exponential backoff, document.hidden skip, and circuit breaker
let activePolls = new Map(); // sessionId → { sessionId, attempts, maxAttempts, interval, consecutiveErrors, currentDelay }

const POLL_INITIAL_DELAY = 5000;   // 5s — first 6 polls
const POLL_MID_DELAY = 15000;      // 15s — after 30s
const POLL_MAX_DELAY = 30000;      // 30s — after 2 min
const POLL_MAX_ATTEMPTS = 40;      // ~5 min total with backoff
const POLL_MAX_CONSECUTIVE_ERRORS = 3; // stop after 3 network failures in a row

function _getPollDelay(attempts) {
    if (attempts < 6) return POLL_INITIAL_DELAY;      // first 30s: every 5s
    if (attempts < 14) return POLL_MID_DELAY;          // next 2 min: every 15s
    return POLL_MAX_DELAY;                              // rest: every 30s
}

function startBackgroundTranscriptionPoll(sessionId) {
    if (activePolls.has(sessionId)) {
        return; // already polling
    }

    const pollInfo = {
        sessionId,
        attempts: 0,
        maxAttempts: POLL_MAX_ATTEMPTS,
        interval: null,
        consecutiveErrors: 0,
        currentDelay: POLL_INITIAL_DELAY,
    };

    activePolls.set(sessionId, pollInfo);

    function scheduleNext() {
        const delay = _getPollDelay(pollInfo.attempts);
        pollInfo.currentDelay = delay;
        pollInfo.interval = setTimeout(pollOnce, delay);
    }

    async function pollOnce() {
        pollInfo.attempts++;

        // Skip poll when app is backgrounded — saves battery on mobile
        if (document.hidden) {
            scheduleNext();
            return;
        }

        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);
            pollInfo.consecutiveErrors = 0; // reset on success

            if (data?.success && data.data?.status === 'transcribed') {
                stopBackgroundPoll(sessionId);

                // Reload sessions in background
                scribeLoaded = false; // force reload
                await loadScribeSessions();

                // Show notification
                const patientName = data.data.patient_name || scribeSessions.find(s => s.session_id === sessionId)?.patient_name || 'patient';
                showToast(`✅ Transcription complete for ${patientName}`, 'success');

                // Update badge
                updateBadges();

                // If user is on Scribe tab, refresh view
                if (currentTab === 'scribe') {
                    renderCurrentTab();
                }
                return; // done
            } else if (data?.data?.status === 'error') {
                stopBackgroundPoll(sessionId);
                showToast(`❌ Transcription failed`, 'error');
                // Reload sessions to show error state
                scribeLoaded = false;
                await loadScribeSessions();
                if (currentTab === 'scribe') renderCurrentTab();
                return; // done
            } else if (pollInfo.attempts >= pollInfo.maxAttempts) {
                stopBackgroundPoll(sessionId);
                showToast(`⏱ Transcription timed out - check back later`, 'warning');
                return; // done
            }

            // Still transcribing — schedule next poll
            scheduleNext();
        } catch (err) {
            if (err.message === 'AUTH_EXPIRED') {
                stopBackgroundPoll(sessionId);
                throw err;
            }

            pollInfo.consecutiveErrors++;
            if (pollInfo.consecutiveErrors >= POLL_MAX_CONSECUTIVE_ERRORS) {
                stopBackgroundPoll(sessionId);
                showToast('Transcription polling stopped — network issues. Tap retry later.', 'warning');
                return;
            }

            // Schedule next despite error (with backoff)
            scheduleNext();
        }
    }

    // Start first poll
    scheduleNext();
}

function stopBackgroundPoll(sessionId) {
    const pollInfo = activePolls.get(sessionId);
    if (pollInfo?.interval) {
        clearTimeout(pollInfo.interval);
        activePolls.delete(sessionId);
    }
}

// Stop all polls when user logs out
function stopAllBackgroundPolls() {
    for (const [sessionId] of activePolls) {
        stopBackgroundPoll(sessionId);
    }
}

// Auto-recovery: Check for pending transcriptions on load
async function checkForPendingTranscriptions() {
    try {
        const sessions = scribeSessions.filter(s => s.status === 'transcribing');

        if (sessions.length === 0) return;

        for (const session of sessions) {
            // Check if AWS job completed but DB not updated
            const check = await apiFetch(`/ops/api/scribe/transcribe?session_id=${session.session_id}`);

            if (check?.success && check.data?.status === 'transcribed') {
                // Fixed! Reload sessions
                scribeLoaded = false;
                await loadScribeSessions();
                showToast(`✅ Recovered completed transcription for ${session.patient_name}`, 'success');
            } else if (check?.data?.status === 'transcribing') {
                // Still processing - start background poll
                startBackgroundTranscriptionPoll(session.session_id);
            }
        }
    } catch (err) {
        console.error('[Scribe Recovery] Check failed:', err);
    }
}

// Manual retry function for stuck sessions
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
