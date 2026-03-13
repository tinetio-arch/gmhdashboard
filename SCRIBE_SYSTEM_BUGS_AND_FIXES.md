# iPad Scribe System — Critical Bugs & Fixes

**Date**: March 12, 2026
**Status**: System is fundamentally broken - recordings work but transcriptions never complete in UI
**Investigated By**: Claude Code (comprehensive deep dive)

---

## 🔴 CRITICAL BUGS IDENTIFIED

### Bug #1: Transcriptions Complete But Never Update UI
**Severity**: CRITICAL
**Impact**: All recordings appear "stuck" forever

**Evidence**:
```sql
-- Session from today stuck in "transcribing"
session_id: 4958b526-906d-4b3b-82c9-6693095511d1
status: transcribing
created_at: 2026-03-12 23:56:01
updated_at: 2026-03-12 23:56:01  ← NEVER UPDATED

-- AWS Transcribe job COMPLETED successfully
Job Status: COMPLETED
Created: 2026-03-12T23:56:01.684Z
Completed: 2026-03-12T23:56:20.326Z  ← 19 seconds!
```

**Root Cause**: The polling mechanism breaks when:
1. User navigates to different tab
2. User locks iPad
3. Page re-renders during polling
4. User closes browser

---

### Bug #2: Polling Loses Context on Tab Navigation
**Severity**: CRITICAL
**Location**: `app.js` lines 2428-2475 (`pollTranscription()`)

**The Problem**:
```javascript
async function pollTranscription(sessionId) {
    const container = document.getElementById('mainContent');
    // ❌ This container gets DESTROYED when user switches tabs!
    container.innerHTML = `<div id="pollStatus">Polling…</div>`;

    while (attempts < 60) {
        await sleep(5000);
        const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

        // ❌ This element might not exist anymore!
        document.getElementById('pollStatus').textContent = `Checking... ${attempts}`;

        if (data.status === 'transcribed') {
            // ❌ This renders CURRENT tab, not necessarily Scribe!
            renderCurrentTab();
        }
    }
}
```

**Why It Breaks**:
1. Polling starts → UI shows "Transcribing..."
2. User switches to "Today" tab → `renderCurrentTab()` destroys Scribe UI
3. Polling continues but `#pollStatus` no longer exists
4. Transcription completes
5. Polling calls `renderCurrentTab()` which renders "Today" tab (not Scribe)
6. Session remains "transcribing" in database forever

---

### Bug #3: No Background Polling Service
**Severity**: CRITICAL
**Impact**: Transcriptions only work if user keeps iPad on Scribe tab for 30-90 seconds

**Missing Features**:
- ❌ No global polling service
- ❌ No session resumption on app reload
- ❌ No notification when transcription completes
- ❌ No automatic recovery for stuck sessions

---

### Bug #4: No Recovery Mechanism
**Severity**: HIGH
**Impact**: Users have no way to recover stuck recordings

**Problems**:
- Sessions stuck in "transcribing" cannot be retried
- No "Check Status" button
- No automatic recovery on page load
- Database requires manual SQL to fix

---

## 🔧 REQUIRED FIXES

### Fix #1: Persistent Background Polling Service

Create a global polling manager that survives tab navigation:

```javascript
// ─── GLOBAL TRANSCRIPTION POLLING SERVICE ───────────────────
let activePolls = new Map(); // sessionId → poll info

function startBackgroundTranscriptionPoll(sessionId) {
    if (activePolls.has(sessionId)) return; // already polling

    const pollInfo = {
        sessionId,
        attempts: 0,
        maxAttempts: 60,
        interval: null,
    };

    activePolls.set(sessionId, pollInfo);

    // Use setInterval for persistent polling
    pollInfo.interval = setInterval(async () => {
        pollInfo.attempts++;

        try {
            const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

            if (data?.success && data.data?.status === 'transcribed') {
                stopBackgroundPoll(sessionId);

                // Reload sessions in background
                await loadScribeSessions();

                // Show notification if still on iPad
                showToast(`✅ Transcription complete for ${data.data.patient_name || 'patient'}`, 'success');

                // Update badge
                updateBadges();

                // If user is on Scribe tab, refresh view
                if (currentTab === 'scribe') {
                    renderCurrentTab();
                }
            } else if (data?.data?.status === 'error') {
                stopBackgroundPoll(sessionId);
                showToast(`❌ Transcription failed`, 'error');
            } else if (pollInfo.attempts >= pollInfo.maxAttempts) {
                stopBackgroundPoll(sessionId);
                showToast(`⏱ Transcription timed out - check back later`, 'warning');
            }
        } catch (err) {
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
```

### Fix #2: Auto-Recovery on Page Load

Check for stuck transcriptions when Scribe tab loads:

```javascript
async function checkForPendingTranscriptions() {
    try {
        const sessions = scribeSessions.filter(s => s.status === 'transcribing');

        for (const session of sessions) {
            // Check if AWS job completed but DB not updated
            const check = await apiFetch(`/ops/api/scribe/transcribe?session_id=${session.session_id}`);

            if (check?.data?.status === 'transcribed') {
                // Fixed! Reload sessions
                await loadScribeSessions();
                showToast(`✅ Recovered completed transcription for ${session.patient_name}`, 'success');
            } else if (check?.data?.status === 'transcribing') {
                // Still processing - start background poll
                startBackgroundTranscriptionPoll(session.session_id);
            }
        }
    } catch (err) {
        console.warn('[Scribe Recovery] Check failed:', err);
    }
}

// Call this in renderScribeView after loadScribeSessions
async function loadScribeSessions() {
    try {
        const data = await apiFetch('/ops/api/scribe/sessions/?limit=30');
        if (data?.success && Array.isArray(data.data)) {
            scribeSessions = data.data;
        }
        scribeLoaded = true;

        // ✅ NEW: Auto-check for stuck transcriptions
        await checkForPendingTranscriptions();
    } catch (e) {
        scribeLoaded = true;
        if (e.message === 'AUTH_EXPIRED') throw e;
        console.warn('Scribe sessions load failed:', e);
    }
}
```

### Fix #3: Update Upload Handler

Replace synchronous polling with background service:

```javascript
async function attemptScribeUpload(blob, filename) {
    const formData = new FormData();
    formData.append('audio', blob, filename);
    formData.append('patient_id', scribePatientId);
    formData.append('visit_type', scribeVisitType);
    formData.append('patient_name', scribePatientName || '');

    try {
        const resp = await fetch('/ops/api/scribe/transcribe/', {
            method: 'POST',
            body: formData,
            credentials: 'include',
        });

        if (!resp.ok) {
            const errorText = await resp.text().catch(() => 'Unknown error');
            console.error('[Scribe] Upload failed:', resp.status, errorText.substring(0, 200));
            showUploadFailedRetryScreen(resp.status, errorText.substring(0, 100));
            return;
        }

        const data = await resp.json();

        if (data.success) {
            // Clear backup on success
            window._pendingRecordingBlob = null;
            window._pendingRecordingMeta = null;
            try { indexedDB.deleteDatabase('scribe_backup'); } catch (e) {}

            activeScribeSession = data.data;

            if (data.data.status === 'transcribing') {
                // ✅ NEW: Start background polling instead of blocking UI
                startBackgroundTranscriptionPoll(data.data.session_id);

                showToast('✅ Audio uploaded! Transcribing in background...', 'success');

                // Return to list view immediately
                scribeView = 'list';
                await loadScribeSessions();
                renderCurrentTab();
                updateBadges();
            } else {
                // Already transcribed (sync transcription)
                showToast(`✅ Transcribed! ${data.data.transcript_length || 0} characters`, 'success');
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
```

### Fix #4: Add Manual Recovery Button

Add "Check Status" button for stuck sessions:

```javascript
// In renderScribeList, add retry button for transcribing sessions
const inProgress = sessions.filter(s => s.status === 'transcribing' || s.status === 'transcribed' || s.status === 'note_generated');

// For each transcribing session:
<div class="session-card">
    <div class="session-status transcribing">⏳ Transcribing...</div>
    <button onclick="retryTranscription('${s.session_id}')"
            class="session-action-btn">
        🔄 Check Status
    </button>
</div>

// Handler:
async function retryTranscription(sessionId) {
    showToast('Checking transcription status...', 'info');
    try {
        const data = await apiFetch(`/ops/api/scribe/transcribe?session_id=${sessionId}`);

        if (data?.data?.status === 'transcribed') {
            showToast('✅ Transcription complete!', 'success');
            await loadScribeSessions();
            renderCurrentTab();
        } else if (data?.data?.status === 'transcribing') {
            showToast('Still processing... started background check', 'info');
            startBackgroundTranscriptionPoll(sessionId);
        } else {
            showToast('Status: ' + data?.data?.status, 'info');
        }
    } catch (err) {
        showToast('Status check failed', 'error');
    }
}
```

---

## 📊 TESTING PLAN

1. **Test Background Polling**:
   - Start recording
   - Upload audio
   - Switch to "Today" tab
   - Wait 30 seconds
   - Switch back to Scribe
   - Verify transcription completed

2. **Test Recovery**:
   - Manually mark session as 'transcribing' in DB
   - Load Scribe tab
   - Verify auto-recovery runs

3. **Test Manual Retry**:
   - Find stuck session
   - Click "Check Status"
   - Verify recovery

---

## 🚀 DEPLOYMENT STEPS

1. Update `app.js` with all fixes above
2. Increment cache buster in `index.html`: `v=20260312H`
3. Hard refresh on iPad
4. Test end-to-end recording flow
5. Fix stuck session in database:

```sql
-- Fix the current stuck session
UPDATE scribe_sessions
SET status = 'transcribed',
    transcript = (SELECT results->'transcripts'->0->>'transcript'
                  FROM (SELECT content::json as results
                        FROM aws_s3_get_object('gmh-clinical-data-lake',
                                               'scribe/transcripts/scribe-12744975-1773359761484.json')) t),
    updated_at = NOW()
WHERE session_id = '4958b526-906d-4b3b-82c9-6693095511d1';
```

---

## 📝 SUMMARY

**The Scribe system is fundamentally broken** because:
1. Polling requires user to stay on tab
2. No background service
3. No recovery mechanism
4. No error handling for context loss

**After fixes**:
- ✅ Transcriptions work in background
- ✅ Auto-recovery on page load
- ✅ Manual retry button
- ✅ Users can navigate freely
- ✅ No more stuck sessions

**Estimated Fix Time**: 30 minutes
**Testing Time**: 15 minutes
**Total Deployment**: < 1 hour
