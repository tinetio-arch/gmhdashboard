# iPad System - Remaining Bugs Fix Plan

**Date**: March 13, 2026
**Status**: High-priority bugs FIXED ✅ | Medium/Low priority bugs - Plan below

---

## ✅ COMPLETED (High Priority)

| # | Bug | Status | Time |
|---|-----|--------|------|
| 5 | BP validation missing | ✅ FIXED | 10 min |
| 14 | XSS protection gaps | ✅ FIXED | 10 min |
| 3 | Can't search by MRN/DOB | ✅ FIXED | 5 min |

**Total completed**: 3 bugs, ~25 minutes

---

## 🟡 MEDIUM PRIORITY (Do Next)

### Bug #9: Schedule Doesn't Auto-Refresh
**Impact**: Staff miss new appointments added in Healthie
**Estimated Time**: 15 minutes

**Implementation**:
```javascript
// Add to DOMContentLoaded init section (around line 100)
// Auto-refresh schedule every 5 minutes
setInterval(async () => {
    if (currentTab === 'schedule' && isConnected && !isLoading) {
        console.log('[Auto-Refresh] Reloading schedule...');
        await loadHealthieAppointments();
        if (currentTab === 'schedule') { // Double-check still on schedule
            renderCurrentTab();
        }
    }
}, 300000); // 5 minutes
```

**Testing**:
1. Open Schedule tab
2. Add appointment in Healthie
3. Wait 5 minutes
4. Verify appointment appears

---

### Bug #18: Silent API Errors
**Impact**: User doesn't know why things fail
**Estimated Time**: 10 minutes

**Implementation**:
```javascript
// Update apiFetch() function (around line 398)
async function apiFetch(url, options = {}) {
    const defaults = {
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
    };
    const merged = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };

    try {
        const resp = await fetch(url, merged);

        if (resp.status === 401 || resp.status === 403) {
            showAuthExpired();
            throw new Error('AUTH_EXPIRED');
        }

        if (!resp.ok) {
            // ✅ NEW: Show user-friendly error
            const errorText = await resp.text().catch(() => '');
            console.error(`[API Error] ${resp.status} ${url}:`, errorText.substring(0, 200));

            if (resp.status >= 500) {
                showToast('Server error - please try again', 'error');
            } else if (resp.status === 404) {
                showToast('Resource not found', 'error');
            } else {
                showToast(`Request failed (${resp.status})`, 'error');
            }

            throw new Error(`HTTP ${resp.status}`);
        }

        return await resp.json();
    } catch (e) {
        if (e.message === 'AUTH_EXPIRED') throw e;

        // ✅ NEW: Show network errors to user
        if (e.message.includes('fetch')) {
            showToast('Network error - check your connection', 'error');
        }

        console.warn(`API call failed: ${url}`, e);
        throw e;
    }
}
```

---

### Bug #1: Revenue Hidden from Staff
**Impact**: Front desk can't see daily revenue
**Estimated Time**: 5 minutes

**Options**:
A. **Make visible to all** (simplest):
```javascript
// Remove the permission check (line ~947)
// OLD:
${currentUser?.permissions?.can_view_ceo_dashboard ? `
    <div class="revenue-grid">...</div>
` : ''}

// NEW:
<div class="revenue-grid">...</div>
```

B. **Add granular permission**:
```javascript
// In /api/ipad/me route.ts
permissions: {
    can_view_ceo_dashboard: user.role === 'admin',
    can_view_revenue: user.role !== 'read', // All except read-only
    // ...
}

// Then use it:
${currentUser?.permissions?.can_view_revenue ? `
    <div class="revenue-grid">...</div>
` : ''}
```

**Recommendation**: Option A (simpler, revenue is useful for all staff)

---

### Bug #12: No Maximum Recording Length
**Impact**: Could create huge files, waste AWS costs
**Estimated Time**: 10 minutes

**Implementation**:
```javascript
// Update updateRecordingTimer() function (around line 2154)
function updateRecordingTimer() {
    if (!isRecording || !recordingStartTime) return;

    const now = Date.now();
    const elapsed = Math.floor((now - recordingStartTime - pausedDuration) / 1000);

    // ✅ NEW: Auto-stop at 60 minutes
    if (elapsed >= 3600) {
        showToast('⚠️ Maximum recording length (1 hour) reached - stopping', 'warning');
        stopScribeRecording();
        return;
    }

    // ✅ NEW: Warn at 55 minutes
    if (elapsed === 3300 && !window._recordingWarningShown) {
        showToast('⚠️ Recording will auto-stop at 60 minutes', 'warning', 10000);
        window._recordingWarningShown = true;
    }

    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const timerEl = document.getElementById('recordingTimer');
    if (timerEl) timerEl.textContent = display;
}
```

---

## 🟢 LOW PRIORITY (Nice to Have)

### Bug #2: Visit Type Shows "In-Office" Always
**Time**: 2 minutes
**Fix**: Line 901, change `p.visit_type` to `p.vendor`

### Bug #4: Missing Temperature Field in Vitals
**Time**: 15 minutes
**Fix**: Add temperature input to `showVitalsModal()`:
```javascript
<div class="vitals-field">
    <label>Temperature (°F)</label>
    <input type="number" id="vTemp" step="0.1" placeholder="98.6">
</div>
```

### Bug #8: Supply Filter Shows Duplicates
**Time**: 5 minutes
**Fix**: Dedupe by supply_id in `renderInventorySupplies()`

### Bug #10: Recording Timer Wrong When Paused
**Time**: 5 minutes
**Fix**: Already calculated `pausedDuration` but not used - just subtract it (see Bug #12 fix above)

### Bug #11: Auto-Pause Doesn't Update Timer
**Time**: 5 minutes
**Fix**: Call `renderCurrentTab()` in visibilitychange handler

### Bug #15: No Loading States
**Time**: 20 minutes
**Fix**: Add `container.innerHTML = renderLoadingState()` before async calls

### Bug #16: Toast Messages Overlap
**Time**: 5 minutes
**Fix**: Add CSS or auto-dismiss old toasts

### Bug #17: Pull-to-Refresh on Input Focus
**Time**: 10 minutes
**Fix**: Check `document.activeElement.tagName === 'INPUT'` in touchstart

---

## 📊 SUMMARY TABLE

| Priority | Bug Count | Est. Time | When |
|----------|-----------|-----------|------|
| 🔴 High | 3 | 25 min | ✅ DONE |
| 🟡 Medium | 4 | 40 min | Do next |
| 🟢 Low | 8 | 67 min | Optional |
| **Total** | **15** | **132 min** | **~2 hours** |

---

## 🎯 RECOMMENDED IMPLEMENTATION ORDER

### Phase 1: Today (30 min)
1. ✅ Bug #5: BP validation - DONE
2. ✅ Bug #14: XSS protection - DONE
3. ✅ Bug #3: Search by MRN - DONE

### Phase 2: Tomorrow (40 min)
4. Bug #9: Schedule auto-refresh (15 min)
5. Bug #18: API error handling (10 min)
6. Bug #1: Revenue visibility (5 min)
7. Bug #12: Max recording length (10 min)

### Phase 3: This Week (60 min)
8-15. All low-priority bugs

---

## 📝 TESTING CHECKLIST

After each fix:
- [ ] Hard refresh iPad Safari (pull down or close/reopen)
- [ ] Test the specific workflow
- [ ] Check console for errors
- [ ] Verify no regressions

**Critical Workflows to Test**:
1. **Vitals Entry**: Enter BP as "120/80", verify saves correctly
2. **Patient Search**: Search by name, then by patient ID, then by DOB
3. **Schedule**: Wait 5 minutes, verify auto-refresh works
4. **Scribe Recording**: Record 30 seconds, switch tabs, verify completes in background
5. **Error Handling**: Disconnect network, try action, verify friendly error

---

## 🚀 DEPLOYMENT STEPS

1. **Backup current app.js**:
   ```bash
   cp public/ipad/app.js public/ipad/app.js.backup_$(date +%Y%m%d)
   ```

2. **Apply fixes** (scripts provided above)

3. **Test locally** (if possible)

4. **Deploy** - Files are served statically, no build needed

5. **Hard refresh on iPad** - Cache buster uses Date.now()

6. **Verify in production**

---

## 📋 CODE SNIPPETS READY

All code snippets above are copy-paste ready. Each includes:
- ✅ Comment marker showing what changed
- Line number references
- Full context
- Error handling

**Next Step**: Implement Phase 2 (medium-priority bugs)
