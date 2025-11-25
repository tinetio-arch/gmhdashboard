# Enhanced Scanner Workflow & Patient Profile Integration

## Overview

This document expands on the main implementation plan to detail:
1. **Complete dispensing workflow** with license verification
2. **Multiple driver's licenses** per patient profile
3. **Patient photo storage** and management
4. **Integration with existing patient profile pages**
5. **License management UI/UX**

---

## 1. Complete Dispensing Workflow

### 1.1 Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    DISPENSING WORKFLOW                      │
└─────────────────────────────────────────────────────────────┘

Step 1: SCAN DRIVER'S LICENSE
   │
   ├─> Scanner reads PDF417 barcode
   ├─> Parse AAMVA data (name, DOB, license #, address, etc.)
   ├─> Match against stored licenses in patient_profiles
   │
   ├─> MATCH FOUND?
   │   ├─ YES → Display patient info + photo (if available)
   │   │        Show confidence level (exact match, high, medium)
   │   │        Show all matching licenses (if multiple)
   │   │        → Proceed to Step 2
   │   │
   │   └─ NO → Show parsed license data
   │            Allow manual patient search/selection
   │            Option to "Add License to Profile" (if patient found)
   │            → Proceed to Step 2 (after patient selected)

Step 2: VERIFY PATIENT IDENTITY
   │
   ├─> Display patient photo (if available)
   ├─> Compare scanned license photo with stored photo
   ├─> Show license details (state, expiration, etc.)
   ├─> Verify DOB matches patient record
   │
   ├─> VERIFICATION PASSED?
   │   ├─ YES → Proceed to Step 3
   │   │
   │   └─ NO → Show warning
   │            Require manual override with reason
   │            Log verification failure
   │            → Proceed to Step 3 (with warning flag)

Step 3: SCAN UPC CODE
   │
   ├─> Scanner reads UPC barcode from testosterone vial
   ├─> Lookup vial by UPC code
   ├─> Verify vial is active and has remaining volume
   ├─> Check expiration date
   │
   ├─> VIAL VALID?
   │   ├─ YES → Display vial info
   │   │        Show remaining volume
   │   │        Show expiration date
   │   │        → Proceed to Step 4
   │   │
   │   └─ NO → Show error
   │            Allow manual vial selection
   │            → Proceed to Step 4 (after vial selected)

Step 4: ENTER DISPENSING DETAILS
   │
   ├─> Auto-fill from patient's regimen (if available)
   ├─> Enter/confirm:
   │   ├─ Syringe count
   │   ├─ Dose per syringe (mL)
   │   ├─ Dispense date
   │   └─ Notes
   │
   ├─> Calculate totals:
   │   ├─ Total dispensed (mL)
   │   ├─ Waste (0.1 mL × syringes)
   │   └─ Remaining volume after dispense
   │
   └─> → Proceed to Step 5

Step 5: REVIEW & CONFIRM
   │
   ├─> Display summary:
   │   ├─ Patient: [Name] (verified via license)
   │   ├─ Vial: [External ID] (UPC: [code])
   │   ├─ Volume: [X] mL dispensed + [Y] mL waste
   │   ├─ Remaining: [Z] mL in vial
   │   └─ Lab status warning (if applicable)
   │
   ├─> CONFIRM DISPENSE?
   │   ├─ YES → Create dispense record
   │   │        Update vial remaining volume
   │   │        Create DEA transaction (if controlled)
   │   │        Log scanner session
   │   │        → SUCCESS: Show confirmation
   │   │
   │   └─ NO → Return to Step 4 (edit details)

Step 6: COMPLETE
   │
   ├─> Show success message
   ├─> Display dispense ID
   ├─> Option to print receipt
   └─> Option to start new dispense
```

### 1.2 Workflow States (UI Implementation)

The scanner dispensing page will have these states:

1. **STATE_IDLE**: Initial state, waiting for license scan
2. **STATE_LICENSE_SCANNED**: License parsed, matching patients
3. **STATE_PATIENT_SELECTED**: Patient identified, ready for verification
4. **STATE_VERIFIED**: Patient verified, ready for UPC scan
5. **STATE_UPC_SCANNED**: Vial identified, ready for dispensing details
6. **STATE_DETAILS_ENTERED**: All details entered, ready to confirm
7. **STATE_CONFIRMING**: Processing dispense
8. **STATE_SUCCESS**: Dispense completed
9. **STATE_ERROR**: Error occurred, show error message

### 1.3 Identity Verification Logic

When a license is scanned and matched to a patient:

1. **Exact License Match** (license number matches stored license):
   - ✅ **HIGH CONFIDENCE**: Auto-select patient
   - Show: "License verified - [Patient Name]"
   - Show stored photo (if available) for visual confirmation
   - Proceed automatically to UPC scan

2. **Name + DOB Match** (no stored license, but name and DOB match):
   - ⚠️ **MEDIUM CONFIDENCE**: Show patient with warning
   - Show: "Potential match - verify identity"
   - Show: "Add this license to patient profile?" button
   - Require manual confirmation before proceeding

3. **Fuzzy Match** (similar name, different DOB or address):
   - ⚠️ **LOW CONFIDENCE**: Show list of potential matches
   - Require manual selection
   - Show: "No exact match found - select patient manually"

4. **No Match**:
   - ❌ **NO MATCH**: Show parsed license data
   - Allow manual patient search
   - Option to create new patient (if authorized)

---

## 2. Multiple Driver's Licenses Per Patient

### 2.1 Database Schema

**New Table: `patient_driver_licenses`**

```sql
CREATE TABLE IF NOT EXISTS patient_driver_licenses (
    license_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    
    -- License Identification
    license_number TEXT NOT NULL, -- DCK field from AAMVA
    license_state TEXT NOT NULL,  -- DAJ field (e.g., "AZ", "CA")
    
    -- Parsed License Data (for matching and display)
    first_name TEXT,
    last_name TEXT,
    middle_name TEXT,
    date_of_birth DATE, -- DDB field (MMDDYYYY → YYYY-MM-DD)
    
    -- Address from License
    address_line1 TEXT, -- DAG field
    city TEXT,          -- DAI field
    postal_code TEXT,   -- DAK field (first 5 digits)
    
    -- Physical Characteristics (for verification)
    height TEXT,        -- DAU field (e.g., "069 in")
    eye_color TEXT,     -- DAY field
    hair_color TEXT,    -- DAZ field
    weight TEXT,        -- DAW field
    
    -- License Metadata
    expiration_date DATE, -- DBA field (if available)
    issue_date DATE,      -- DBE field (if available)
    document_type TEXT,   -- DBC field (DL, ID, etc.)
    
    -- License Photo (stored as file path or base64)
    photo_url TEXT,      -- Path to stored photo file
    photo_storage_type TEXT DEFAULT 'file', -- 'file', 's3', 'base64'
    
    -- Raw Data (for audit/debugging)
    raw_barcode_data TEXT, -- Original scanned barcode data
    parsed_data JSONB,     -- Full parsed AAMVA data
    
    -- Metadata
    is_primary BOOLEAN DEFAULT FALSE, -- Primary license for this patient
    is_active BOOLEAN DEFAULT TRUE,   -- License is still valid/active
    notes TEXT,                       -- Staff notes about this license
    
    -- Audit Fields
    added_by UUID REFERENCES users(user_id),
    added_at TIMESTAMP DEFAULT NOW(),
    last_verified_at TIMESTAMP, -- Last time this license was used for verification
    verification_count INTEGER DEFAULT 0, -- How many times this license was used
    
    -- Constraints
    CONSTRAINT unique_license_per_state UNIQUE (license_number, license_state)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_patient_licenses_patient ON patient_driver_licenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_licenses_number ON patient_driver_licenses(license_number, license_state);
CREATE INDEX IF NOT EXISTS idx_patient_licenses_active ON patient_driver_licenses(patient_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_patient_licenses_primary ON patient_driver_licenses(patient_id, is_primary) WHERE is_primary = TRUE;
```

### 2.2 License Management Features

#### 2.2.1 Adding a License to Patient Profile

**Method 1: During Dispensing (Quick Add)**
- When license is scanned and patient is matched
- Show button: "Add License to Profile"
- On click: Save license data to `patient_driver_licenses` table
- Set as primary if no other primary exists
- Show success message

**Method 2: From Patient Profile Page**
- Navigate to patient detail page (`/patients/[id]`)
- Click "Add Driver's License" button
- Two options:
  - **Scan License**: Use scanner to scan license
  - **Manual Entry**: Enter license details manually
- Fill in license details form
- Upload photo (optional)
- Save to profile

#### 2.2.2 Viewing/Managing Licenses

On patient profile page, show section:

```
┌─────────────────────────────────────────────────┐
│  Driver's Licenses                              │
│  ─────────────────────────────────────────────  │
│                                                 │
│  [Primary] Arizona DL #48103980197              │
│  State: AZ | Expires: 02/28/2028 | Active      │
│  [View Details] [Edit] [Set as Primary] [Remove]│
│                                                 │
│  California DL #C123456789                      │
│  State: CA | Expires: 12/31/2025 | Active      │
│  [View Details] [Edit] [Set as Primary] [Remove]│
│                                                 │
│  [+ Add License]                                │
└─────────────────────────────────────────────────┘
```

#### 2.2.3 License Matching Priority

When scanning a license, match against stored licenses in this order:

1. **Exact Match**: `license_number` + `license_state` match
2. **Number Match**: `license_number` matches (any state) - warn if state differs
3. **Name + DOB Match**: First name, last name, and DOB match (no stored license)
4. **Name + Address Match**: Name and address match
5. **Fuzzy Name Match**: Similar name with DOB match

### 2.3 License Verification During Dispensing

When a license is scanned:

1. **Check Stored Licenses First**:
   ```sql
   SELECT * FROM patient_driver_licenses
   WHERE license_number = $1 AND license_state = $2
   AND is_active = TRUE
   ```

2. **If Found**:
   - Load patient from `patient_id`
   - Show: "License verified - [Patient Name]"
   - Increment `verification_count`
   - Update `last_verified_at`
   - Display license photo (if available)
   - **HIGH CONFIDENCE MATCH**

3. **If Not Found**:
   - Try matching by name + DOB
   - If patient found, offer to add license
   - If no patient found, show manual search

---

## 3. Patient Photo Storage

### 3.1 Storage Strategy

**Option A: File System Storage (Recommended for simplicity)**
- Store photos in: `/public/patient-photos/[patient_id]/[filename]`
- Database stores: `photo_url = '/patient-photos/[patient_id]/license-[license_id].jpg'`
- Pros: Simple, no additional services needed
- Cons: Requires file system access, backup strategy needed

**Option B: Database Storage (Base64/BLOB)**
- Store photo as base64 in `patient_photos` table
- Pros: All data in one place, easier backup
- Cons: Larger database, slower queries, size limits

**Option C: Cloud Storage (S3, etc.)**
- Store photos in S3 bucket
- Database stores: `photo_url = 'https://s3.../patient-photos/[patient_id]/[filename]'`
- Pros: Scalable, reliable, CDN support
- Cons: Additional service, costs, complexity

**RECOMMENDATION: Option A (File System)** for initial implementation, can migrate to Option C later.

### 3.2 Database Schema for Photos

**New Table: `patient_photos`**

```sql
CREATE TABLE IF NOT EXISTS patient_photos (
    photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    
    -- Photo Metadata
    photo_type TEXT NOT NULL, -- 'profile', 'license', 'id_card', 'other'
    photo_url TEXT NOT NULL,  -- Path to photo file
    file_name TEXT,            -- Original filename
    file_size INTEGER,         -- Size in bytes
    mime_type TEXT,            -- 'image/jpeg', 'image/png', etc.
    width INTEGER,             -- Image width in pixels
    height INTEGER,            -- Image height in pixels
    
    -- Linking
    license_id UUID REFERENCES patient_driver_licenses(license_id) ON DELETE SET NULL,
    
    -- Metadata
    is_primary BOOLEAN DEFAULT FALSE, -- Primary photo for patient
    description TEXT,                  -- Description/caption
    notes TEXT,                        -- Staff notes
    
    -- Audit
    uploaded_by UUID REFERENCES users(user_id),
    uploaded_at TIMESTAMP DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_photo_type CHECK (photo_type IN ('profile', 'license', 'id_card', 'other'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_patient_photos_patient ON patient_photos(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_photos_primary ON patient_photos(patient_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_patient_photos_license ON patient_photos(license_id) WHERE license_id IS NOT NULL;
```

### 3.3 Photo Management UI

#### 3.3.1 Patient Profile Page - Photo Section

Add to patient detail page (`/patients/[id]/page.tsx`):

```
┌─────────────────────────────────────────────────┐
│  Patient Photo                                  │
│  ─────────────────────────────────────────────  │
│                                                 │
│  [Photo Display Area]                          │
│  ┌─────────────┐                               │
│  │             │                               │
│  │   [Photo]   │  [Upload New] [Remove]      │
│  │             │                               │
│  └─────────────┘                               │
│                                                 │
│  Photo Type: Profile Photo                     │
│  Uploaded: Jan 15, 2024 by John Doe           │
│                                                 │
│  ─────────────────────────────────────────────  │
│                                                 │
│  License Photos                                │
│  ─────────────────────────────────────────────  │
│  • AZ License #48103980197                     │
│    [View Photo]                                │
│                                                 │
│  • CA License #C123456789                      │
│    [View Photo]                                │
└─────────────────────────────────────────────────┘
```

#### 3.3.2 Photo Upload Component

**Features**:
- Drag-and-drop upload
- File type validation (JPEG, PNG only)
- File size limit (e.g., 5MB max)
- Image preview before upload
- Crop/resize functionality (optional)
- Progress indicator during upload

**API Endpoint**: `POST /api/patients/[id]/photos`

**Request**:
- Multipart form data with file
- `photo_type`: 'profile' | 'license' | 'id_card' | 'other'
- `license_id`: UUID (if linking to license)
- `description`: Optional text

**Response**:
```json
{
  "success": true,
  "photo": {
    "photoId": "uuid",
    "photoUrl": "/patient-photos/[patient_id]/photo-[uuid].jpg",
    "photoType": "profile",
    "uploadedAt": "2024-01-15T10:30:00Z"
  }
}
```

### 3.4 Photo Display During Dispensing

When patient is matched during dispensing:

1. **Load Primary Photo**:
   ```sql
   SELECT photo_url FROM patient_photos
   WHERE patient_id = $1 AND is_primary = TRUE
   LIMIT 1
   ```

2. **Display Photo**:
   - Show photo next to patient info
   - Size: 150x150px thumbnail
   - Click to enlarge

3. **Visual Verification**:
   - Staff can compare scanned license photo with stored photo
   - Helps confirm patient identity

---

## 4. Integration with Patient Profile Page

### 4.1 Patient Detail Page Enhancements

**Location**: `app/patients/[id]/page.tsx`

**New Sections to Add**:

1. **Patient Photo Section** (top of page, next to name)
2. **Driver's Licenses Section** (new section)
3. **Identity Verification History** (optional, for audit)

### 4.2 New Components Needed

#### 4.2.1 `PatientPhotoSection.tsx`
- Display patient photo
- Upload new photo
- Remove photo
- Set as primary

#### 4.2.2 `DriverLicensesList.tsx`
- List all licenses for patient
- Show license details
- Add new license (scan or manual)
- Edit license
- Set primary license
- Remove license

#### 4.2.3 `LicenseForm.tsx`
- Form to add/edit license
- Fields: license number, state, expiration, etc.
- Photo upload for license
- Link to existing license photo

#### 4.2.4 `LicenseScanner.tsx`
- Scanner input field
- Parse license barcode
- Auto-fill form with parsed data
- Save to patient profile

### 4.3 API Endpoints for License Management

#### 4.3.1 Get Patient Licenses
**Endpoint**: `GET /api/patients/[id]/licenses`

**Response**:
```json
{
  "licenses": [
    {
      "licenseId": "uuid",
      "licenseNumber": "48103980197",
      "licenseState": "AZ",
      "firstName": "John",
      "lastName": "Doe",
      "dateOfBirth": "1990-02-28",
      "expirationDate": "2028-02-28",
      "isPrimary": true,
      "isActive": true,
      "photoUrl": "/patient-photos/[id]/license-[id].jpg",
      "lastVerifiedAt": "2024-01-15T10:30:00Z",
      "verificationCount": 5
    }
  ]
}
```

#### 4.3.2 Add License to Patient
**Endpoint**: `POST /api/patients/[id]/licenses`

**Request Body**:
```json
{
  "licenseNumber": "48103980197",
  "licenseState": "AZ",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "1990-02-28",
  "addressLine1": "616 SUNRISE BLVD",
  "city": "PRESCOTT",
  "postalCode": "86301",
  "expirationDate": "2028-02-28",
  "rawBarcodeData": "...",
  "parsedData": {...},
  "setAsPrimary": true
}
```

#### 4.3.3 Update License
**Endpoint**: `PUT /api/patients/[id]/licenses/[licenseId]`

#### 4.3.4 Delete License
**Endpoint**: `DELETE /api/patients/[id]/licenses/[licenseId]`

#### 4.3.5 Set Primary License
**Endpoint**: `POST /api/patients/[id]/licenses/[licenseId]/set-primary`

---

## 5. Enhanced Matching Logic with Stored Licenses

### 5.1 Matching Algorithm

When a license is scanned:

```javascript
async function matchLicenseToPatient(scannedLicense) {
  const { licenseNumber, licenseState, firstName, lastName, dateOfBirth } = scannedLicense;
  
  // Step 1: Try exact license match
  const exactMatch = await query(`
    SELECT pl.*, p.patient_id, p.full_name, p.dob
    FROM patient_driver_licenses pl
    JOIN patients p ON p.patient_id = pl.patient_id
    WHERE pl.license_number = $1 
      AND pl.license_state = $2
      AND pl.is_active = TRUE
  `, [licenseNumber, licenseState]);
  
  if (exactMatch.length > 0) {
    return {
      patient: exactMatch[0],
      confidence: 'high',
      matchMethod: 'exact_license',
      licenses: exactMatch
    };
  }
  
  // Step 2: Try license number match (any state)
  const numberMatch = await query(`
    SELECT pl.*, p.patient_id, p.full_name, p.dob
    FROM patient_driver_licenses pl
    JOIN patients p ON p.patient_id = pl.patient_id
    WHERE pl.license_number = $1
      AND pl.is_active = TRUE
  `, [licenseNumber]);
  
  if (numberMatch.length > 0) {
    return {
      patient: numberMatch[0],
      confidence: 'high',
      matchMethod: 'license_number',
      licenses: numberMatch,
      warning: `License state mismatch: scanned ${licenseState}, stored ${numberMatch[0].license_state}`
    };
  }
  
  // Step 3: Try name + DOB match (no stored license)
  const nameDobMatch = await query(`
    SELECT patient_id, full_name, dob
    FROM patients
    WHERE LOWER(TRIM(full_name)) = LOWER(TRIM($1))
      AND dob = $2
  `, [`${firstName} ${lastName}`, dateOfBirth]);
  
  if (nameDobMatch.length > 0) {
    return {
      patient: nameDobMatch[0],
      confidence: 'medium',
      matchMethod: 'name_dob',
      suggestion: 'Add this license to patient profile?'
    };
  }
  
  // Step 4: Try fuzzy name + DOB match
  const fuzzyMatch = await query(`
    SELECT patient_id, full_name, dob
    FROM patients
    WHERE SIMILARITY(LOWER(TRIM(full_name)), LOWER(TRIM($1))) > 0.7
      AND dob = $2
  `, [`${firstName} ${lastName}`, dateOfBirth]);
  
  if (fuzzyMatch.length > 0) {
    return {
      patient: fuzzyMatch[0],
      confidence: 'low',
      matchMethod: 'fuzzy_name_dob',
      matches: fuzzyMatch
    };
  }
  
  // Step 5: No match found
  return {
    patient: null,
    confidence: 'none',
    matchMethod: 'no_match',
    parsedData: scannedLicense
  };
}
```

### 5.2 Confidence Levels

- **HIGH**: Exact license match or license number match
- **MEDIUM**: Name + DOB match (no stored license)
- **LOW**: Fuzzy name match
- **NONE**: No match found

---

## 6. Workflow Integration Points

### 6.1 Scanner Dispensing Page

**Location**: `app/scanner-dispense/page.tsx`

**Integration with License Storage**:
- When license is scanned and patient matched → Offer to save license
- When license is scanned and no match → Show "Add to Profile" option
- Display stored photos during verification
- Show license history/verification count

### 6.2 Patient Profile Page

**Location**: `app/patients/[id]/page.tsx`

**New Features**:
- Photo upload/management section
- Driver's licenses list section
- "Scan License" button to add new license
- Link to scanner dispensing page with patient pre-selected

### 6.3 Inventory/Transaction Form

**Location**: `app/inventory/TransactionForm.tsx`

**Optional Enhancement**:
- Add "Scan License" button to quickly identify patient
- Pre-fill patient from license scan
- Still allow manual patient selection

---

## 7. Security & Privacy Considerations

### 7.1 License Data Storage
- **Store**: License number, state, expiration (for matching)
- **Don't Store**: Full raw barcode data (unless needed for audit)
- **Encrypt**: Sensitive PII if stored (address, DOB already in patient record)

### 7.2 Photo Storage
- **Access Control**: Only authorized users can view/upload photos
- **File Permissions**: Restrict file system access
- **Backup**: Include photos in backup strategy
- **Retention**: Follow HIPAA retention policies

### 7.3 Audit Trail
- Log all license scans
- Log all photo uploads/deletions
- Log license additions/removals
- Track verification counts

---

## 8. Implementation Priority

### Phase 1: Core Functionality
1. Database schema for licenses and photos
2. License parsing and matching
3. Basic license storage (single license per patient)
4. Scanner dispensing workflow (without photos)

### Phase 2: Multiple Licenses
1. Multiple licenses per patient
2. License management UI
3. Primary license selection
4. License matching improvements

### Phase 3: Photo Storage
1. Photo upload functionality
2. Photo storage (file system)
3. Photo display in patient profile
4. Photo display during dispensing

### Phase 4: Enhanced Features
1. Photo verification during dispensing
2. License verification history
3. Advanced matching algorithms
4. Analytics and reporting

---

## 9. Database Migration Script

```sql
-- Migration: Add driver's licenses and photos support
-- File: migrations/YYYYMMDD_add_licenses_and_photos.sql

-- Create patient_driver_licenses table
CREATE TABLE IF NOT EXISTS patient_driver_licenses (
    license_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    license_number TEXT NOT NULL,
    license_state TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    middle_name TEXT,
    date_of_birth DATE,
    address_line1 TEXT,
    city TEXT,
    postal_code TEXT,
    height TEXT,
    eye_color TEXT,
    hair_color TEXT,
    weight TEXT,
    expiration_date DATE,
    issue_date DATE,
    document_type TEXT,
    photo_url TEXT,
    photo_storage_type TEXT DEFAULT 'file',
    raw_barcode_data TEXT,
    parsed_data JSONB,
    is_primary BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    added_by UUID REFERENCES users(user_id),
    added_at TIMESTAMP DEFAULT NOW(),
    last_verified_at TIMESTAMP,
    verification_count INTEGER DEFAULT 0,
    CONSTRAINT unique_license_per_state UNIQUE (license_number, license_state)
);

-- Create patient_photos table
CREATE TABLE IF NOT EXISTS patient_photos (
    photo_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    photo_type TEXT NOT NULL,
    photo_url TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    width INTEGER,
    height INTEGER,
    license_id UUID REFERENCES patient_driver_licenses(license_id) ON DELETE SET NULL,
    is_primary BOOLEAN DEFAULT FALSE,
    description TEXT,
    notes TEXT,
    uploaded_by UUID REFERENCES users(user_id),
    uploaded_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT valid_photo_type CHECK (photo_type IN ('profile', 'license', 'id_card', 'other'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_patient_licenses_patient ON patient_driver_licenses(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_licenses_number ON patient_driver_licenses(license_number, license_state);
CREATE INDEX IF NOT EXISTS idx_patient_licenses_active ON patient_driver_licenses(patient_id, is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_patient_licenses_primary ON patient_driver_licenses(patient_id, is_primary) WHERE is_primary = TRUE;

CREATE INDEX IF NOT EXISTS idx_patient_photos_patient ON patient_photos(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_photos_primary ON patient_photos(patient_id, is_primary) WHERE is_primary = TRUE;
CREATE INDEX IF NOT EXISTS idx_patient_photos_license ON patient_photos(license_id) WHERE license_id IS NOT NULL;
```

---

## 10. File Structure

```
gmh-dashboard/
├── app/
│   ├── patients/
│   │   ├── [id]/
│   │   │   ├── page.tsx (enhanced with photo/license sections)
│   │   │   └── PatientPhotoSection.tsx (new)
│   │   │   └── DriverLicensesList.tsx (new)
│   │   │   └── LicenseForm.tsx (new)
│   │   │   └── LicenseScanner.tsx (new)
│   │   └── ...
│   ├── scanner-dispense/
│   │   ├── page.tsx (new)
│   │   └── components/
│   │       ├── ScannerInput.tsx
│   │       ├── PatientMatchDisplay.tsx
│   │       ├── VialDisplay.tsx
│   │       └── QuickDispenseForm.tsx
│   └── api/
│       ├── scanner/
│       │   ├── parse-license/route.ts
│       │   ├── match-patient/route.ts
│       │   ├── scan-upc/route.ts
│       │   └── quick-dispense/route.ts
│       └── patients/
│           └── [id]/
│               ├── licenses/
│               │   ├── route.ts (GET, POST)
│               │   └── [licenseId]/
│               │       └── route.ts (PUT, DELETE)
│               └── photos/
│                   └── route.ts (GET, POST, DELETE)
├── lib/
│   ├── scanner/
│   │   ├── aamvaParser.ts (new)
│   │   ├── patientMatcher.ts (new)
│   │   └── licenseManager.ts (new)
│   └── ...
├── public/
│   └── patient-photos/ (new directory)
│       └── [patient_id]/
│           └── [photo files]
└── migrations/
    └── YYYYMMDD_add_licenses_and_photos.sql (new)
```

---

**Document Version**: 1.0  
**Created**: 2024-01-XX  
**Last Updated**: 2024-01-XX

