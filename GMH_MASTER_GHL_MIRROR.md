# GMH → GHL Data Flow: GMH is ALWAYS the Master

## 🎯 Critical Architecture Rule

```
GMH Control Center = SOURCE OF TRUTH (Parent)
GoHighLevel = MIRROR/DISPLAY ONLY (Child)

GMH Data ALWAYS OVERWRITES GHL Data
NEVER merge or keep GHL values
```

---

## ⚠️ IMPORTANT: One-Way Data Flow

### GMH Lab Dates → GHL Lab Fields

```javascript
// WRONG - Don't do this:
if (!ghlContact.customFields.last_lab_date) {
  ghlContact.customFields.last_lab_date = gmhPatient.last_lab;
}

// CORRECT - Always overwrite:
ghlContact.customFields.last_lab_date = gmhPatient.last_lab;  // ALWAYS
ghlContact.customFields.next_lab_date = gmhPatient.next_lab;  // ALWAYS
```

### Every Sync Operation:
```
1. Get patient data from GMH (master)
2. Find contact in GHL
3. OVERWRITE all GHL fields with GMH data
4. OVERWRITE custom fields with GMH data
5. RECALCULATE and REPLACE all tags
6. Never read/merge GHL values back to GMH
```

---

## 🔒 Specific Fields That ALWAYS Trump

### Lab Information (Your Priority!)
| GMH Field | GHL Field | Behavior |
|-----------|-----------|----------|
| `last_lab` | Date of Last Lab Test (M9UY8UHBU8vI4lKBWN7w) | **OVERWRITE every sync** |
| `next_lab` | Date of Next Lab Test (cMaBe12wckOiBAYb6T3e) | **OVERWRITE every sync** |
| `lab_status` | Lab Status (TBD) | **OVERWRITE every sync** |

**If GMH has `last_lab = null`:**
- Set GHL field to empty/null (clear it)
- Don't keep old GHL value

**If GMH has `next_lab = "2024-12-15"`:**
- Set GHL field to "2024-12-15"
- Don't care what GHL had before

### All Other Fields Too
Every single field follows the same rule:
- Contact info (name, email, phone, address) → **OVERWRITE**
- Status fields → **OVERWRITE**
- Membership info → **OVERWRITE**
- Dates → **OVERWRITE**
- Tags → **RECALCULATE and REPLACE**

---

## 📋 Sync Code Logic

```javascript
async function syncPatientToGHL(gmhPatient) {
  // 1. Get current state from GMH (master)
  const masterData = {
    name: gmhPatient.full_name,
    email: gmhPatient.email,
    phone: normalizePhone(gmhPatient.phone_primary),
    lastLab: gmhPatient.last_lab,      // Master value
    nextLab: gmhPatient.next_lab,      // Master value
    status: gmhPatient.status_key,     // Master value
    // ... all other GMH fields
  };
  
  // 2. Find GHL contact
  const ghlContact = await findContact(masterData.email);
  
  // 3. OVERWRITE GHL with GMH data
  const updatePayload = {
    firstName: masterData.firstName,
    lastName: masterData.lastName,
    phone: masterData.phone,
    address1: masterData.address,
    // ... etc
    customFields: [
      {
        id: 'M9UY8UHBU8vI4lKBWN7w',  // Last Lab
        value: masterData.lastLab || ''  // GMH value or empty
      },
      {
        id: 'cMaBe12wckOiBAYb6T3e',  // Next Lab
        value: masterData.nextLab || ''  // GMH value or empty
      }
      // ... all other custom fields FROM GMH
    ]
  };
  
  // 4. Update GHL (no merge, just replace)
  await ghlClient.updateContact(ghlContact.id, updatePayload);
  
  // 5. REPLACE tags (calculated from GMH data)
  const newTags = calculateTagsFromGMH(gmhPatient);
  
  // Remove all existing tags first
  if (ghlContact.tags.length > 0) {
    await ghlClient.removeTagsFromContact(ghlContact.id, ghlContact.tags);
  }
  
  // Add new tags
  await ghlClient.addTagsToContact(ghlContact.id, newTags);
  
  // 6. Log in GMH database
  await logSync(gmhPatient.id, ghlContact.id);
}
```

---

## ⚠️ What This Means for Lab Dates

**Scenario 1: GMH has lab dates**
```
GMH: last_lab = "2024-11-15"
GHL: last_lab = "2024-10-01" (old)

Action: Update GHL to "2024-11-15"
Result: GHL now shows "2024-11-15"
```

**Scenario 2: GMH has no lab dates**
```
GMH: last_lab = null
GHL: last_lab = "2024-10-01" (old value)

Action: Clear GHL field (set to null)
Result: GHL field is empty
```

**Scenario 3: GMH staff updates lab date**
```
GMH: last_lab changes from "2024-11-15" to "2024-11-20"

Action: Next sync overwrites GHL
Result: GHL immediately shows "2024-11-20"
```

---

## 🚫 What We NEVER Do

❌ **Never** read lab dates from GHL back to GMH  
❌ **Never** merge GHL values with GMH values  
❌ **Never** keep GHL data if GMH is different  
❌ **Never** skip update if GHL seems "newer"  
❌ **Never** preserve GHL tags that GMH doesn't want  

---

## ✅ Guaranteed Behavior

**Every single sync:**
1. GMH data → Read from database
2. GHL contact → Found by email/phone
3. GHL fields ← **Completely replaced** with GMH data
4. GHL tags ← **Completely recalculated** from GMH status
5. GMH database ← Log what we did

**GMH is the boss. GHL obeys. Period.** 🎯

---

## 🎓 Summary

- **Lab dates in GMH** → Always write to GHL
- **Lab dates in GHL** → Ignored (overwritten)
- **Every field works this way** → GMH trumps all
- **One-way flow** → GMH ➜ GHL only
- **No backflow** → GHL never updates GMH

**Ready to code this with GMH as the absolute master?** 🚀
