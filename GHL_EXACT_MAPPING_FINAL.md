# GMH → GHL Lab Date Sync (GMH is Source of Truth)

## 🎯 CRITICAL RULE: GMH ALWAYS TRUMPS GHL

```
GMH Control Center = PARENT (Source of Truth)
         ↓
    ONE-WAY SYNC
         ↓
GoHighLevel = MIRROR (Display Only)
```

**This means:**
- ✅ Lab dates in GMH → ALWAYS overwrite GHL
- ✅ Any update in GMH → Automatically updates GHL
- ❌ Changes in GHL → NEVER flow back to GMH
- ❌ GHL cannot modify GMH data

---

## ✅ EXACT LAB DATE MAPPING

### Your Existing GHL Fields (Found & Verified)

| GMH Field (PARENT) | Direction | GHL Custom Field | Field ID | Type |
|--------------------|-----------|------------------|----------|------|
| `last_lab` | **→ OVERWRITES →** | **Date of Last Lab Test** | `M9UY8UHBU8vI4lKBWN7w` | DATE |
| `next_lab` | **→ OVERWRITES →** | **Date of Next Lab Test** | `cMaBe12wckOiBAYb6T3e` | DATE |

### Sync Behavior

```javascript
EVERY TIME WE SYNC:
1. Read last_lab from GMH database
2. Read next_lab from GMH database
3. Update GHL field M9UY8UHBU8vI4lKBWN7w = GMH last_lab
4. Update GHL field cMaBe12wckOiBAYb6T3e = GMH next_lab
5. ALWAYS overwrite, no merge, no conflict resolution
```

**Result:** GHL will ALWAYS show exactly what GMH has, no exceptions.

---

## 🔄 Complete Sync Logic with GMH Trumping

```javascript
function syncPatientToGHL(gmhPatient) {
  
  // 1. Find existing GHL contact
  ghlContact = findByEmail(gmhPatient.email) || findByPhone(gmhPatient.phone);
  
  if (!ghlContact) {
    return ERROR: "Contact not found - must exist in GHL first";
  }
  
  // 2. Prepare GMH data (THE TRUTH)
  const gmhData = {
    // Native fields
    firstName: parseFirstName(gmhPatient.full_name),
    lastName: parseLastName(gmhPatient.full_name),
    email: gmhPatient.email,
    phone: normalizePhone(gmhPatient.phone_primary),
    address1: titleCase(gmhPatient.address_line1),
    city: titleCase(gmhPatient.city),
    state: fixState(gmhPatient.state, gmhPatient.postal_code),
    postalCode: fixZip(gmhPatient.postal_code, gmhPatient.state),
    country: "US",
    dateOfBirth: gmhPatient.dob,
    source: "GMH Dashboard",
    
    // Custom fields (using GHL IDs)
    customField: [
      {
        id: "M9UY8UHBU8vI4lKBWN7w",  // Date of Last Lab Test
        field_value: gmhPatient.last_lab  // ← GMH TRUTH
      },
      {
        id: "cMaBe12wckOiBAYb6T3e",  // Date of Next Lab Test
        field_value: gmhPatient.next_lab  // ← GMH TRUTH
      },
      {
        id: "0yOZFsELGGAvMU8HwYH4",  // Method of Payment
        field_value: gmhPatient.method_of_payment  // ← GMH TRUTH
      }
    ]
  };
  
  // 3. OVERWRITE GHL contact with GMH data (no merge!)
  await ghl.updateContact(ghlContact.id, gmhData);
  
  // 4. Calculate tags from GMH status
  const tags = calculateTags(gmhPatient);
  
  // 5. Handle inactive patients (special rule)
  if (gmhPatient.status_key === 'inactive') {
    // Remove ALL tags
    await ghl.removeAllTags(ghlContact.id);
  } else {
    // Apply calculated tags
    await ghl.setTags(ghlContact.id, tags);
  }
  
  // 6. Store link in GMH
  await gmh.updatePatient(gmhPatient.patient_id, {
    ghl_contact_id: ghlContact.id,
    ghl_sync_status: 'synced',
    ghl_last_synced_at: NOW()
  });
}
```

---

## ⚠️ WHAT THIS MEANS

### Scenario 1: Lab Date Changed in GMH
```
1. Staff updates last_lab in GMH: "2024-11-15" → "2024-11-20"
2. Sync runs (manual or hourly)
3. GHL "Date of Last Lab Test" updated to "2024-11-20"
4. GMH remains the source of truth
```

### Scenario 2: Someone Changes Lab Date in GHL (Manually)
```
1. Someone in GHL changes "Date of Next Lab Test" to "2025-01-01"
2. Next sync runs
3. GMH overwrites it back to GMH value: "2024-12-15"
4. GHL change is lost
5. GMH always wins
```

### Scenario 3: Patient Made Inactive
```
1. Staff sets status_key = 'inactive' in GMH
2. Sync runs
3. ALL tags removed from GHL contact
4. Contact info still updated
5. Patient shows as inactive in GHL
```

---

## 📋 CURRENT EXACT MAPPING (Ready to Deploy)

### Phase 1: What We Can Sync RIGHT NOW

**Native Fields (11):**
- firstName, lastName, email, phone
- address1, city, state, postalCode, country
- dateOfBirth, source

**Existing Custom Fields (3):**
- `M9UY8UHBU8vI4lKBWN7w` ← `last_lab` (Date of Last Lab Test) ✅
- `cMaBe12wckOiBAYb6T3e` ← `next_lab` (Date of Next Lab Test) ✅
- `0yOZFsELGGAvMU8HwYH4` ← `method_of_payment` (Method of Payment) ✅

**Tags (Dynamic):**
- "existing" for Men's Health patients
- Status tags (Active, Inactive, Hold)
- Condition tags (Labs Overdue, etc.)
- **Special: Inactive = remove ALL**

**Total: 14 field connections + dynamic tags**

---

## 🚀 READY TO CODE AND DEPLOY

**Should I now:**

1. ✅ Update the sync code with exact field IDs
2. ✅ Add name parsing (handle Jr, Sr, etc.)
3. ✅ Add phone normalization (E.164 format)
4. ✅ Add address cleaning (title case, fix state/ZIP swaps)
5. ✅ Add country field ("US")
6. ✅ Map to your 3 existing custom fields (lab dates + payment)
7. ✅ Implement inactive → remove ALL tags
8. ✅ Deploy to server
9. ✅ Test with 1 patient

**Then you can see GMH lab dates flowing into GHL correctly!**

Ready to update the code? 🚀
