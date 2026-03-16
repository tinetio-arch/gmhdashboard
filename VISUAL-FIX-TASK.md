# iPad App Visual & Aesthetic Fix Task

**Target files:** `public/ipad/app.js` and `public/ipad/style.css`
**Branch:** `master`
**Commit message:** `fix(ipad): comprehensive visual/aesthetic polish — tab bar, undefined CSS vars, color consistency, tab switching bug`

---

## CRITICAL BUG FIX

### B1 — Tab Switching Double-Active Bug
**File:** `app.js`, `switchChartTab()` function (~line 3734)

The function uses `btn.textContent.includes('Rx')` to detect the active tab. But `'💊 E-Rx'.includes('Rx')` is `true`, so clicking the "Rx" tab makes BOTH "Rx" and "E-Rx" buttons appear active simultaneously.

**Fix:** Replace the `textContent.includes()` approach with `data-tab` attributes:

1. In the tab buttons (around line 3719-3727), add `data-tab` to each button:
```js
<button class="chart-tab-btn" data-tab="charting" ...>📋 Charting</button>
<button class="chart-tab-btn" data-tab="forms" ...>📝 Forms</button>
<button class="chart-tab-btn" data-tab="documents" ...>📁 Documents</button>
<button class="chart-tab-btn" data-tab="financial" ...>💰 Financial</button>
<button class="chart-tab-btn" data-tab="prescriptions" ...>💊 Rx</button>
<button class="chart-tab-btn" data-tab="erx" ...>📋 E-Rx</button>
<button class="chart-tab-btn" data-tab="dispense" ...>💉 Dispense</button>
```

2. In `switchChartTab()`, replace the entire forEach with:
```js
document.querySelectorAll('.chart-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
});
```

### B2 — Duplicate Emoji on Rx vs E-Rx
Both "Rx" and "E-Rx" tabs use 💊. Change "E-Rx" to use 📋 (clipboard) to differentiate:
- Line ~3725: Change `💊 E-Rx` to `📋 E-Rx`

---

## UNDEFINED CSS VARIABLES (14 occurrences of `--surface-2`, 2 of `--surface-1`)

Neither `--surface-2` nor `--surface-1` exists in `style.css`. These elements render with transparent/no background.

### Fix Strategy — Add Variables to `:root` in style.css

In `:root` (after `--card-hover: #263347;`), add:
```css
--surface-1: #1a2332;
--surface-2: #162030;
```

These values fit between `--surface: #111827` and `--card: #1F2937` in the existing scale, providing subtle depth layering while staying on-theme.

**Affected areas (all in app.js):**
- Line 3036: AI edit bar background (`--surface-2`)
- Line 3039: AI edit input background (`--surface-1`)
- Line 3266: Document preview container (`--surface-1`)
- Line 3628: Default patient avatar background (`--surface-2`)
- Line 3705: Vitals cards background (`--surface-2`) ← this is what the user specifically called ugly
- Line 4379: Cancel button in demographics edit (`--surface-2`)
- Lines 4390-4416: All form inputs in demographics edit (`--surface-2`)
- Lines 4420, 4434, 4447: Demographics edit section backgrounds (`--surface-2`)
- Line 4465: Cancel button in demographics edit (save action) (`--surface-2`)

---

## TAB BAR OVERCROWDING

7 tabs crammed in one flex row with `flex: 1` and `padding: 8px 4px` → each tab is tiny and unreadable on smaller iPads.

### Fix in style.css — `.chart-tab-nav` (~line 3624):

Replace the existing `.chart-tab-nav` block with:
```css
.chart-tab-nav {
    display: flex;
    gap: 2px;
    padding: 2px 8px;
    margin: 0 8px 8px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 8px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
}
.chart-tab-nav::-webkit-scrollbar {
    display: none;
}
```

### Fix in style.css — `.chart-tab-btn` (~line 3634):

Replace the existing `.chart-tab-btn` block with:
```css
.chart-tab-btn {
    flex: 0 0 auto;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: #8899aa;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.2s;
    white-space: nowrap;
}
```

Key changes:
- `flex: 1` → `flex: 0 0 auto` (natural width, no squishing)
- `padding: 8px 4px` → `padding: 8px 10px` (more horizontal breathing room)
- `font-size: 12px` → `font-size: 11px` (slightly smaller to fit more comfortably)
- Added `overflow-x: auto` + hidden scrollbar for smooth horizontal scroll if needed

---

## HARDCODED COLORS IN PAYMENT/BILLING MODALS

The payment management modal (~line 8212), stripe account selector modal (~line 8403), and surrounding billing code use fully hardcoded hex colors that don't match the CSS variable system. This makes these modals look like they're from a different app.

### Fixes in app.js:

**Payment methods modal (~line 8212):**
- `background: #1a1a1a` → `background: var(--card)`
- `color: #fff` → `color: var(--text-primary)`
- `color: #999` → `color: var(--text-secondary)`
- `color: #666` → `color: var(--text-tertiary)`
- `border: 1px solid #333` → `border: 1px solid var(--border-light)`
- `background: #2a1a2a` → `background: rgba(240,147,251,0.08)` (keep the semantic tint but use transparency)
- `background: #1a2a2a` → `background: rgba(16,185,129,0.08)` (keep the semantic tint)

**Stripe account selector modal (~line 8403):**
- `background: #1a1a1a` → `background: var(--card)`
- `color: #fff` → `color: var(--text-primary)`
- `color: #999` → `color: var(--text-secondary)`
- `color: #666` → `color: var(--text-tertiary)`
- `border: 1px solid #333` → `border: 1px solid var(--border-light)`

---

## HARDCODED COLORS IN PATIENT PICKER MODAL

The "Connect Patient" modal (~line 1935-2020) uses hardcoded colors:

- `background:#1a2332` → `background: var(--card)`
- `color:#f0f4f8` → `color: var(--text-primary)`
- `color:#8899aa` → `color: var(--text-secondary)`
- `background:rgba(255,255,255,0.05)` is acceptable (transparent overlays are fine)

---

## MINOR AESTHETIC ITEMS

### M1 — Vitals Grid Too Dense
The vitals grid (~line 3703) uses `minmax(120px, 1fr)` with `gap:4px`. With 5 vitals this produces tiny, cramped cards.

Change to:
```js
display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:6px;
```

### M2 — 8px and 9px Font Sizes Too Small
Multiple places use `font-size:8px` and `font-size:9px` which are nearly illegible on iPad. Find and change:
- `font-size:8px` → `font-size:9px` (minimum 9px)
- Only in the vitals cards area (lines 3705-3709). Do NOT change elsewhere (tags at 9px are fine).

Specifically:
- Line 3708: `font-size:8px` for the vitals date → change to `font-size:9px`
- Line 3709: `font-size:8px` for "by recordedBy" → change to `font-size:9px`

### M3 — Native `prompt()` and `confirm()` for Billing
Lines 8470 and 8476 use native `prompt()` for amount input and description. This is jarring on iPad (ugly native dialog boxes). However, **do NOT fix this now** — it would require building custom modal components which is a separate task.

### M4 — Login Screen Colors
The login screen (~lines 341-365) uses hardcoded colors like `#94a3b8`, `#22d3ee`, `#fff`. These are acceptable since the login screen pre-dates the CSS variables and is a one-off static view. **Do NOT change these** — they're intentional branding.

---

## SUMMARY CHECKLIST

1. [ ] Add `--surface-1: #1a2332` and `--surface-2: #162030` to `:root` in style.css
2. [ ] Fix `.chart-tab-nav` overflow with horizontal scroll
3. [ ] Fix `.chart-tab-btn` sizing (flex: 0 0 auto, more padding)
4. [ ] Add `data-tab` attributes to all 7 chart tab buttons in app.js
5. [ ] Replace `switchChartTab()` textContent matching with `dataset.tab`
6. [ ] Change E-Rx emoji from 💊 to 📋
7. [ ] Replace hardcoded colors in payment modals with CSS vars
8. [ ] Replace hardcoded colors in patient picker modal with CSS vars
9. [ ] Widen vitals grid minmax from 120px to 140px, gap from 4px to 6px
10. [ ] Change 8px font sizes to 9px in vitals card area only

**Do NOT modify:**
- Login screen colors (intentional branding)
- Native `prompt()`/`confirm()` dialogs (separate task)
- DoseSpot iframe `background:#fff` (required for white DoseSpot UI)
- Any API logic, data fetching, or business logic
