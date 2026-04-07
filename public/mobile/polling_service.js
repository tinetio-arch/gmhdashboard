// ─── BACKGROUND TRANSCRIPTION POLLING SERVICE ───────────────
// Survives tab navigation, page visibility changes, and user actions
let activePolls = new Map(); // sessionId → { sessionId, attempts, maxAttempts, interval }

function startBackgroundTranscriptionPoll(sessionId) {
    if (activePolls.has(sessionId)) {
        console.log(`[Background Poll] Already polling session ${sessionId}`);
        return; // already polling
    }

    const pollInfo = {
        sessionId,
        attempts: 0,
        maxAttempts: 60, // 5 minutes (60 × 5 seconds)
        interval: null,
    };

    activePolls.set(sessionId, pollInfo);

    // Use setInterval for persistent polling that survives tab changes
    pollInfo.interval = setInterval(async () => {
        pollInfo.attempts++;

        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

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
            } else if (data?.data?.status === 'error') {
                stopBackgroundPoll(sessionId);
                showToast(`❌ Transcription failed`, 'error');
                // Reload sessions to show error state
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
    }, 5000); // Poll every 5 seconds

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

        console.log(`[Scribe Recovery] Found ${sessions.length} sessions in 'transcribing' status`);

        for (const session of sessions) {
            // Check if AWS job completed but DB not updated
            const check = await apiFetch(`/ops/api/scribe/transcribe?session_id=${session.session_id}`);

            if (check?.success && check.data?.status === 'transcribed') {
                // Fixed! Reload sessions
                console.log(`[Scribe Recovery] ✅ Recovered completed transcription for ${session.patient_name}`);
                scribeLoaded = false;
                await loadScribeSessions();
                showToast(`✅ Recovered completed transcription for ${session.patient_name}`, 'success');
            } else if (check?.data?.status === 'transcribing') {
                // Still processing - start background poll
                console.log(`[Scribe Recovery] Session ${session.session_id} still processing - starting background poll`);
                startBackgroundTranscriptionPoll(session.session_id);
            }
        }
    } catch (err) {
        console.warn('[Scribe Recovery] Check failed:', err);
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
