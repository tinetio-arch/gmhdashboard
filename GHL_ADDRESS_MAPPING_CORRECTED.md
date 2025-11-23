# GHL Address Mapping - CRITICAL CORRECTIONS NEEDED

## 🚨 Issues Found in Current Address Data

### Problem 1: Phone Number Formatting
**GMH has inconsistent formats:**
- `+16024810656` (international format) ✅ Good
- `(330) 635-2135` (US format with parentheses) ⚠️ Needs normalization
- `(928) 963-2255` (US format with parentheses) ⚠️ Needs normalization

**GHL expects:** `+1` prefix with 10 digits (E.164 format)

### Problem 2: City/State Capitalization
**GMH has inconsistent:**
- `Prescott` ✅ Proper case
- `prescott` ❌ Lowercase
- `Prescott Valley` ✅ Proper case

**GHL displays as-is:** Need to standardize capitalization

### Problem 3: State in Postal Code Field
**Patient 3 has:**
- City: `Prescott Valley`
- State: `86315` ❌ **ZIP CODE IN STATE FIELD!**
- Postal: `null` ❌ **MISSING!**

**This is a DATA QUALITY issue in GMH!**

### Problem 4: Missing Country Field
**GMH doesn't store country**
- All addresses are presumably USA
- GHL has `country` field (should be "US")

### Problem 5: Address Line 2
**GMH only has `address_line1`**
- GHL supports `address1` AND optional fields
- No way to store apartment/suite numbers separately

---

## ✅ CORRECTED ADDRESS MAPPING

### Native GHL Fields (Standard)

| GMH Field | Clean/Transform | GHL Field | Notes |
|-----------|----------------|-----------|-------|
| `address_line1` | Trim & title case | `address1` | Street address |
| - | null (not stored in GMH) | `address2` | Apartment/Suite (optional) |
| `city` | Trim & title case | `city` | Fix lowercase |
| `state` | Validate 2-letter code | `state` | Must be AZ, CA, etc. |
| `postal_code` | Validate 5-digit ZIP | `postalCode` | Must be numeric |
| - | Always "US" | `country` | Default to United States |

### Phone Number Normalization

```javascript
Function: normalizePhone(phone)
  Input: "(928) 963-2255" or "+16024810656" or "928-963-2255"
  
  Steps:
  1. Strip all non-digits: "9289632255"
  2. If 10 digits, prefix "+1": "+19289632255"
  3. If 11 digits starting with "1", prefix "+": "+19289632255"
  4. If already has "+1", keep as-is
  5. Validate: Must be +1 followed by 10 digits
  
  Output: "+19289632255"
```

### Address Cleaning

```javascript
Function: cleanAddress(address_line1, city, state, postal_code)
  
  // Clean street address
  address1 = trim(address_line1)
  address1 = toTitleCase(address1)  // "815 whipple st" → "815 Whipple St"
  
  // Clean city
  city = trim(city)
  city = toTitleCase(city)  // "prescott" → "Prescott"
  
  // Validate & fix state
  state = trim(state).toUpperCase()
  if (state.length != 2) {
    // Check if postal code in state field
    if (isNumeric(state) && state.length == 5) {
      // Swap: state has ZIP, postal might be empty
      temp = state
      state = lookupStateFromZip(temp) or "AZ"  // Default to AZ
      postal_code = temp
    } else {
      state = "AZ"  // Default for Arizona clinic
    }
  }
  
  // Validate postal code
  postal_code = trim(postal_code)
  postal_code = postal_code.replace(/[^0-9]/g, '')  // Remove dashes
  if (postal_code.length < 5) {
    postal_code = null  // Invalid
  } else {
    postal_code = postal_code.substring(0, 5)  // Take first 5 digits
  }
  
  // Add country
  country = "US"
  
  return {
    address1,
    city,
    state,
    postalCode: postal_code,
    country
  }
```

---

## 🔧 COMPLETE CORRECTED MAPPING

### Patient Contact Info → GHL

| GMH Field | Transform Function | GHL Field | Example |
|-----------|-------------------|-----------|---------|
| `full_name` (first word) | trim | `firstName` | "Chris" |
| `full_name` (rest) | trim | `lastName` | "Marley" |
| `full_name` | trim | `name` | "Chris Marley" |
| `email` | lowercase & trim | `email` | "chris@example.com" |
| `phone_primary` | **normalizePhone()** | `phone` | "+19289632255" |
| `address_line1` | **cleanAddress()** | `address1` | "815 Whipple St" |
| `city` | **cleanAddress()** | `city` | "Prescott" |
| `state` | **cleanAddress()** | `state` | "AZ" |
| `postal_code` | **cleanAddress()** | `postalCode` | "86301" |
| - | always "US" | `country` | "US" |
| `dob` | ISO format | `dateOfBirth` | "1969-03-20" |
| - | "GMH Dashboard" | `source` | "GMH Dashboard" |

---

## ⚠️ DATA QUALITY ISSUES TO FIX

### Critical Issues in GMH Database:
1. **State/ZIP swapped** (Patient 3: state="86315", postal=null)
2. **Lowercase cities** (Patient 2: city="prescott")
3. **Inconsistent phone formats** (Mix of +1, (), and plain)
4. **Missing country** (Assume all US but not stored)

### Recommendations:
1. **Before syncing:** Run data cleanup on GMH database
2. **Add validation:** When staff enters addresses
3. **Normalize on save:** Auto-format phone/address on patient save
4. **Add country field:** To patients table (default "US")

---

## 🚀 UPDATED SYNC CODE REQUIREMENTS

### Must Add:
1. ✅ `normalizePhone()` function - Clean phone numbers
2. ✅ `cleanAddress()` function - Fix capitalization & validation
3. ✅ State validation - Detect ZIP in state field
4. ✅ Country field - Always add "US"
5. ✅ Title case conversion - Standardize names/addresses
6. ✅ Postal code validation - 5-digit ZIP only

### Edge Cases to Handle:
- Phone with no area code
- International phones (non-US)
- PO Box addresses
- Missing city/state
- Invalid ZIP codes
- Extra spaces in addresses

---

## 📋 BEFORE WE SYNC - ACTION ITEMS

1. **I'll update the sync code** with all address cleaning
2. **Test with Patient 3** (the problematic one with swapped state/ZIP)
3. **Verify the corrections** work properly
4. **Then sync all patients** with clean data

---

## ❓ YOUR DECISION NEEDED

**Should I proceed to update the sync code with:**

1. ✅ Phone number normalization (+1 format)
2. ✅ Address cleaning (title case, validation)
3. ✅ State/ZIP swap detection & fix
4. ✅ Country field addition (US)
5. ✅ All the data quality fixes

**Once you approve, I'll update the code and test with 1 patient before bulk sync!**
