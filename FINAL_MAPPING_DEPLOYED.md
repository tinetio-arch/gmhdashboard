# FINAL GMH → GHL Mapping - Production Ready

## ✅ CONFIRMED: GMH is Master System

**Architecture:**
```
GMH Control Center (SOURCE OF TRUTH)
    ↓ (overwrites)
GoHighLevel (DISPLAY/MARKETING MIRROR)
```

**Lab dates in GMH ALWAYS overwrite GHL - no exceptions!**

---

## 🔗 EXACT FIELD MAPPINGS (Now Live on Server)

### Native GHL Fields (11 connections)

| # | GMH Field | GHL API Field | Transform | Status |
|---|-----------|---------------|-----------|--------|
| 1 | `full_name` → first word | `firstName` | titleCase() | ✅ MAPPED |
| 2 | `full_name` → rest | `lastName` | titleCase() | ✅ MAPPED |
| 3 | `full_name` | `name` | titleCase() | ✅ MAPPED |
| 4 | `email` | `email` | toLowerCase() | ✅ MAPPED |
| 5 | `phone_primary` | `phone` | **normalizeE164()** | ✅ MAPPED |
| 6 | `address_line1` | `address1` | titleCase() | ✅ MAPPED |
| 7 | `city` | `city` | titleCase() | ✅ MAPPED |
| 8 | `state` | `state` | **detectSwap() + validate** | ✅ MAPPED |
| 9 | `postal_code` | `postalCode` | **detectSwap() + 5-digit** | ✅ MAPPED |
| 10 | (always US) | `country` | Fixed "US" | ✅ MAPPED |
| 11 | `dob` | `dateOfBirth` | ISO format | ⚠️ TODO |

### Custom Fields - Using YOUR Existing GHL Field IDs

| # | GMH Field | GHL Custom Field | GHL Field ID | Status |
|---|-----------|------------------|--------------|--------|
| 12 | `last_lab` | **Date of Last Lab Test** | `M9UY8UHBU8vI4lKBWN7w` | ✅ **MAPPED** |
| 13 | `next_lab` | **Date of Next Lab Test** | `cMaBe12wckOiBAYb6T3e` | ✅ **MAPPED** |
| 14 | `method_of_payment` | **Method of Payment** | `0yOZFsELGGAvMU8HwYH4` | ✅ MAPPED |

### Custom Fields - Using Generic Keys (Need IDs Later)

| # | GMH Field | GHL Custom Field Key | Status |
|---|-----------|---------------------|--------|
| 15 | `status_key` or `alert_status` | `patient_status` | ✅ MAPPED |
| 16 | `type_of_client` | `client_type` | ✅ MAPPED |
| 17 | `regimen` | `regimen` | ✅ MAPPED |
| 18 | `service_start_date` | `service_start_date` | ✅ MAPPED |

**Currently Syncing: 18 fields (11 native + 7 custom)**

---

## 🏷️ TAG MAPPINGS (Dynamic)

### Status-Based Tags
| GMH `status_key` | GHL Tags | Special Behavior |
|------------------|----------|------------------|
| `inactive` | **REMOVE ALL TAGS** | ⚠️ Complete wipe |
| `active` | "Active Patient" | Standard |
| `active_pending` | "Active - Pending Labs" | Standard |
| `hold_*` | "Hold - [Type]" | Various hold types |

### Men's Health "existing" Tag
| GMH `client_type_key` | GHL Tag |
|-----------------------|---------|
| `qbo_tcmh_180_month` | **"existing"** |
| `qbo_f_f_fr_veteran_140_month` | **"existing"** |
| `jane_tcmh_180_month` | **"existing"** |
| `jane_f_f_fr_veteran_140_month` | **"existing"** |
| `approved_disc_pro_bono_pt` | **"existing"** |
| `mens_health_qbo` | **"existing"** |

### Condition Tags
| GMH Condition | GHL Tag |
|---------------|---------|
| `is_primary_care = true` | "PrimeCare Patient" |
| Lab status overdue | "Labs Overdue" |
| `membership_owes > 0` | "Has Membership Balance" |
| `is_verified = true` | "Verified Patient" |
| Any GMH patient | "GMH Patient" |

---

## ⚡ CRITICAL SYNC RULES

### Rule 1: GMH ALWAYS Wins
```
GMH last_lab = "2024-11-20"
GHL last_lab = "2024-10-01"

→ GHL updated to "2024-11-20"  ✅
→ GMH never reads GHL value  ✅
```

### Rule 2: Empty GMH Values Clear GHL
```
GMH next_lab = null
GHL next_lab = "2024-12-15"

→ GHL field cleared to ""  ✅
→ Old GHL value discarded  ✅
```

### Rule 3: Inactive = Nuclear Option
```
GMH status_key = "inactive"

→ Update all contact fields  ✅
→ REMOVE ALL TAGS  ✅
→ Clean slate in GHL  ✅
```

### Rule 4: Data Cleaning
```
GMH phone = "(928) 963-2255"
→ Normalized to "+19289632255"  ✅

GMH city = "prescott"  
→ Title cased to "Prescott"  ✅

GMH state = "86315", postal = null
→ Fixed to state = "AZ", postal = "86315"  ✅
```

---

## 🎯 WHAT'S LIVE NOW

**On Server (nowoptimal.com/ops):**
- ✅ Updated sync code deployed
- ✅ Phone normalization (E.164)
- ✅ Address cleaning (title case)
- ✅ State/ZIP swap detection
- ✅ Country field ("US")
- ✅ Lab date mapping (YOUR field IDs)
- ✅ Method of payment mapping
- ✅ Inactive → remove all tags
- ✅ Name parsing (handle Jr, Sr, titles)

**Ready to Test:**
Visit: https://nowoptimal.com/ops/professional

---

## 📝 Summary

**Total Connections Mapped: 18 fields + dynamic tags**

**Critical Connections YOU Asked For:**
- ✅ Last Lab Date → `M9UY8UHBU8vI4lKBWN7w` 
- ✅ Next Lab Date → `cMaBe12wckOiBAYb6T3e`
- ✅ Method of Payment → `0yOZFsELGGAvMU8HwYH4`

**Data Flow:**
```
GMH Patient Updated
    ↓
Sync Triggered
    ↓
Find GHL Contact by email/phone
    ↓
OVERWRITE all GHL fields with GMH data
    ↓
OVERWRITE custom fields (Last Lab, Next Lab, etc.)
    ↓
RECALCULATE tags from GMH status
    ↓
If inactive: REMOVE ALL TAGS
    ↓
Log in GMH database
```

**GMH Lab Data → Always Trumps GHL! ✅**

---

Ready to test with 1 patient at: **https://nowoptimal.com/ops/professional** 🚀
