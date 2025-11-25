# Driver's License & UPC Scanner Dispensing System - Implementation Plan

## Executive Summary

This plan outlines the implementation of a barcode scanning system for dispensing testosterone to patients. The system will use a SunMi scanner to:
1. Scan patient driver's licenses to identify and match patients
2. Scan UPC codes on testosterone vials to identify inventory
3. Streamline the dispensing workflow with minimal manual data entry
4. Store multiple driver's licenses per patient for identity verification
5. Store patient photos for visual verification during dispensing

**📋 Related Documents:**
- **SCANNER_WORKFLOW_AND_INTEGRATION.md** - Detailed workflow, multiple licenses, and photo storage
- **SCANNER_LICENSE_FORMAT_REFERENCE.md** - AAMVA license format reference

---

## 1. Understanding the Current System

### 1.1 Current Dispensing Flow
- **Location**: `app/inventory/TransactionForm.tsx`
- **Process**: Manual patient selection via search, manual vial selection from dropdown
- **Data Entry**: Manual entry of dose, syringe count, dates
- **API Endpoint**: `/api/inventory/transactions` (POST) - needs to be located/created

### 1.2 Patient Data Structure
- **Table**: `patients`
- **Key Fields**: 
  - `patient_id` (UUID)
  - `full_name` (for matching)
  - `dob` (date of birth - for matching)
  - `address_line1`, `city`, `state`, `postal_code`
- **Matching Logic**: Currently uses name + DOB matching in `lib/clinicsync.ts`

### 1.3 Inventory/Vial Structure
- **Table**: `vials`
- **Key Fields**:
  - `vial_id` (UUID)
  - `external_id` (currently used for vial identification)
  - `remaining_volume_ml`
  - `dea_drug_name`, `dea_drug_code`
- **Current Identification**: Uses `external_id` field (e.g., "V0001")

### 1.4 Dispense Record Structure
- **Table**: `dispenses`
- **Key Fields**:
  - `patient_id` (links to patients)
  - `vial_id` (links to vials)
  - `vial_external_id` (for display)
  - `total_dispensed_ml`, `syringe_count`, `dose_per_syringe_ml`
  - `dispense_date`, `transaction_type`

---

## 2. Driver's License Data Format Analysis

### 2.1 Sample Scan Data
```
DAU069 in
DAYBLU
DAG616 SUNRISE BLVD
DAIPRESCOTTDAJAZDAK863015872. DCF003403AC3S120805DCGUSADCK48103980197DDAFDDB02282023DAZBRODAW170DDK1
ZAZAANZACN
```

### 2.2 AAMVA Field Codes (American Association of Motor Vehicle Administrators)
Based on the sample data, this appears to be AAMVA-compliant PDF417 barcode data:

- **DAU**: Height (e.g., "069 in")
- **DAY**: Eye Color (e.g., "BLU")
- **DAG**: Street Address (e.g., "616 SUNRISE BLVD")
- **DAI**: City (e.g., "PRESCOTT")
- **DAJ**: State (e.g., "AZ")
- **DAK**: ZIP Code (e.g., "863015872")
- **DCF**: Document Discriminator
- **DDB**: Date of Birth (format: MMDDYYYY, e.g., "02282023" = Feb 28, 2023)
- **DCK**: Document Number / License Number (e.g., "48103980197")
- **DAZ**: Hair Color (e.g., "BRO")
- **DAW**: Weight (e.g., "170")
- **DDK**: Card Revision Date

### 2.3 Parsing Strategy
The data appears to be concatenated without clear delimiters. We'll need to:
1. Parse AAMVA field codes (3-letter prefixes like DAU, DAY, DAG, etc.)
2. Extract values following each code
3. Handle concatenated fields (e.g., "DAIPRESCOTTDAJAZDAK863015872" contains city, state, and ZIP)
4. Normalize dates (MMDDYYYY → YYYY-MM-DD)
5. Extract name (likely in a separate field, possibly DAA for first name, DAB for last name, or DCS for full name)

### 2.4 Patient Matching Strategy

**See SCANNER_WORKFLOW_AND_INTEGRATION.md Section 5 for detailed matching algorithm**

Use multiple matching criteria (in order of confidence):
1. **Exact License Match** - `license_number` + `license_state` match in `patient_driver_licenses` table
2. **License Number Match** - `license_number` matches (any state) - warn if state differs
3. **Name + DOB Match** - `full_name` (normalized) + `dob` match (no stored license)
4. **Name + Address Match** - `full_name` + `address_line1` + `city` + `state`
5. **Fuzzy Name Match + DOB** - Similar name with DOB match

**Confidence Levels:**
- **HIGH**: Exact license match or license number match
- **MEDIUM**: Name + DOB match (no stored license)
- **LOW**: Fuzzy name match
- **NONE**: No match found

---

## 3. UPC Code Scanning for Vials

### 3.1 Current Vial Identification
- Vials use `external_id` field (e.g., "V0001", "V0002")
- No current UPC/barcode field exists

### 3.2 UPC Integration Strategy
**Option A: Store UPC in existing `external_id` field**
- Pros: No schema changes needed
- Cons: Mixes internal IDs with UPCs, potential conflicts

**Option B: Add new `upc_code` field to `vials` table** (RECOMMENDED)
- Pros: Clear separation, can have both internal ID and UPC
- Cons: Requires schema migration

**Option C: Create lookup table `vial_upc_mapping`**
- Pros: Multiple UPCs per vial, historical tracking
- Cons: More complex queries

### 3.3 UPC Matching Logic
1. Scan UPC code
2. Query `vials` table by `upc_code` (or `external_id` if using Option A)
3. Verify vial is active and has remaining volume
4. Return vial details for dispensing

---

## 4. Database Schema Changes

### 4.1 Add UPC Code Field to Vials
```sql
ALTER TABLE vials
    ADD COLUMN IF NOT EXISTS upc_code TEXT,
    ADD COLUMN IF NOT EXISTS upc_code_indexed TEXT GENERATED ALWAYS AS (LOWER(TRIM(upc_code))) STORED;

CREATE INDEX IF NOT EXISTS idx_vials_upc_code ON vials(upc_code_indexed) WHERE upc_code IS NOT NULL;
```

### 4.2 Add Driver's License Support (Multiple Licenses Per Patient)

**See SCANNER_WORKFLOW_AND_INTEGRATION.md Section 2 for complete schema**

We will create a separate `patient_driver_licenses` table to support:
- Multiple licenses per patient (e.g., AZ license, CA license)
- License photos linked to licenses
- Verification history and tracking
- Primary license designation

**Key Table**: `patient_driver_licenses`
- Stores license number, state, expiration, parsed data
- Links to patient via `patient_id`
- Supports photo storage via `photo_url`
- Tracks verification count and last verified date

### 4.3 Add Patient Photo Storage

**See SCANNER_WORKFLOW_AND_INTEGRATION.md Section 3 for complete schema**

We will create a `patient_photos` table to support:
- Profile photos for patients
- License photos linked to driver's licenses
- Multiple photos per patient
- Primary photo designation

**Key Table**: `patient_photos`
- Stores photo URL, type, metadata
- Links to patient and optionally to license
- Supports file system, database, or cloud storage

### 4.4 Add Scanner Session Tracking (Optional - for audit)
```sql
CREATE TABLE IF NOT EXISTS scanner_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id),
    session_type TEXT NOT NULL, -- 'license_scan', 'upc_scan', 'dispense'
    scanned_data TEXT, -- raw barcode data
    parsed_data JSONB, -- parsed/extracted data
    patient_id UUID REFERENCES patients(patient_id),
    vial_id UUID REFERENCES vials(vial_id),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scanner_sessions_user ON scanner_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanner_sessions_patient ON scanner_sessions(patient_id);
```

---

## 5. API Endpoints Design

### 5.1 Parse Driver's License Barcode
**Endpoint**: `POST /api/scanner/parse-license`

**Request Body**:
```json
{
  "rawBarcodeData": "DAU069 in\nDAYBLU\nDAG616 SUNRISE BLVD\n..."
}
```

**Response**:
```json
{
  "success": true,
  "parsed": {
    "firstName": "BLU",
    "lastName": "BROWN", // extracted from name field
    "fullName": "BLU BROWN",
    "dateOfBirth": "1990-02-28",
    "address": "616 SUNRISE BLVD",
    "city": "PRESCOTT",
    "state": "AZ",
    "zipCode": "86301",
    "licenseNumber": "48103980197",
    "height": "069 in",
    "eyeColor": "BLU",
    "hairColor": "BRO",
    "weight": "170"
  },
  "matchedPatient": {
    "patientId": "uuid-here",
    "patientName": "Blu Brown",
    "matchConfidence": "high", // high, medium, low
    "matchMethod": "license_number" // license_number, name_dob, name_address, fuzzy
  }
}
```

### 5.2 Search Patients by License Data
**Endpoint**: `POST /api/scanner/match-patient`

**Request Body**:
```json
{
  "firstName": "BLU",
  "lastName": "BROWN",
  "dateOfBirth": "1990-02-28",
  "licenseNumber": "48103980197",
  "address": "616 SUNRISE BLVD",
  "city": "PRESCOTT",
  "state": "AZ",
  "zipCode": "86301"
}
```

**Response**:
```json
{
  "matches": [
    {
      "patientId": "uuid-here",
      "patientName": "Blu Brown",
      "dateOfBirth": "1990-02-28",
      "matchConfidence": "high",
      "matchMethod": "license_number",
      "statusKey": "active",
      "labStatus": "current"
    }
  ],
  "exactMatch": true
}
```

### 5.3 Scan UPC Code for Vial
**Endpoint**: `POST /api/scanner/scan-upc`

**Request Body**:
```json
{
  "upcCode": "0123456789012"
}
```

**Response**:
```json
{
  "success": true,
  "vial": {
    "vialId": "uuid-here",
    "externalId": "V0001",
    "upcCode": "0123456789012",
    "remainingVolumeMl": "25.5",
    "sizeMl": "30.0",
    "status": "Active",
    "deaDrugName": "Carrie Boyd - 30ML",
    "expirationDate": "2025-12-31"
  },
  "available": true
}
```

### 5.4 Quick Dispense (Combined Workflow)
**Endpoint**: `POST /api/scanner/quick-dispense`

**Request Body**:
```json
{
  "patientId": "uuid-here", // from license scan
  "vialUpc": "0123456789012", // from UPC scan
  "dispenseDate": "2024-01-15",
  "syringeCount": 16,
  "dosePerSyringeMl": 0.5,
  "notes": "Scanned via SunMi scanner"
}
```

**Response**:
```json
{
  "success": true,
  "dispenseId": "uuid-here",
  "patientName": "Blu Brown",
  "vialExternalId": "V0001",
  "totalDispensedMl": 8.0,
  "wasteMl": 1.6,
  "remainingVolumeMl": "15.9"
}
```

---

## 6. Frontend UI/UX Design

### 6.1 New Scanner Dispensing Page
**Location**: `app/scanner-dispense/page.tsx`

**See SCANNER_WORKFLOW_AND_INTEGRATION.md Section 1 for complete workflow diagram**

**Workflow States**:
1. **Initial State**: "Scan Driver's License" prompt
2. **License Scanned**: Parse license, match to patient, display patient info + photo
3. **Patient Verified**: Identity verified via stored license, "Scan UPC Code" prompt
4. **UPC Scanned**: Display vial info, show dispensing form
5. **Details Entered**: All dispensing details entered, show summary
6. **Ready to Dispense**: Review summary, confirm button
7. **Dispensed**: Success message, option to start new dispense

**Key Features**:
- Display patient photo during verification (if available)
- Show all matching licenses if multiple exist
- Offer to save license to profile if not already stored
- Visual identity verification using stored photos

### 6.2 UI Components Needed

#### 6.2.1 ScannerInput Component
- Large, visible input field for barcode data
- Auto-submit on scan (detect Enter key or scanner input)
- Visual feedback (success/error states)
- Clear button to reset

#### 6.2.2 PatientMatchDisplay Component
- Show parsed license data
- Display matched patient with confidence indicator
- Allow manual patient selection if no match
- Show patient status warnings (lab overdue, etc.)

#### 6.2.3 VialDisplay Component
- Show vial details from UPC scan
- Display remaining volume
- Show expiration date warning if applicable
- Indicate if vial is available for dispensing

#### 6.2.4 QuickDispenseForm Component
- Pre-filled with patient and vial info
- Editable fields: syringe count, dose per syringe
- Auto-calculate totals
- Show warnings (lab status, vial volume, etc.)
- Submit button

### 6.3 Integration with Patient Profile Page

**See SCANNER_WORKFLOW_AND_INTEGRATION.md Section 4 for complete integration details**

**New Sections on Patient Profile Page** (`app/patients/[id]/page.tsx`):
1. **Patient Photo Section**: Upload, view, manage patient photos
2. **Driver's Licenses Section**: List all licenses, add new, edit, set primary
3. **License Management**: Scan new license or manual entry
4. **Photo Management**: Upload profile photos and license photos

**Integration Points**:
- Add "Scanner Dispense" button/link to inventory page
- Add "Scan License" button on patient profile page
- Option to use scanner in existing TransactionForm
- Show scanner icon/indicator when scanner is active
- Link from patient profile to scanner dispensing (with patient pre-selected)

---

## 7. SunMi Scanner Integration

### 7.1 Scanner Configuration
- **Scanner Type**: SunMi (Android-based scanner)
- **Input Method**: Scanner acts as keyboard input (HID mode)
- **Data Format**: Raw barcode data sent as text input

### 7.2 Handling Scanner Input
1. **Detect Scanner Input**:
   - Monitor input fields for rapid text entry (scanner sends data quickly)
   - Detect Enter key after scan (scanners typically send Enter after data)
   - Use debouncing to distinguish manual typing from scanning

2. **Input Processing**:
   - Capture raw barcode data
   - Determine scan type (license vs UPC) based on:
     - Context (which field is focused)
     - Data format (AAMVA format vs numeric UPC)
     - Manual mode selection

3. **Error Handling**:
   - Invalid barcode format
   - No patient match found
   - No vial match found
   - Network errors
   - Scanner connection issues

### 7.3 Scanner Setup Requirements
- Ensure SunMi scanner is configured for:
  - PDF417 barcode reading (for licenses)
  - UPC/EAN barcode reading (for medication)
  - Keyboard wedge mode (HID input)
  - Auto-Enter after scan enabled

---

## 8. Implementation Steps

### Phase 1: Driver's License Parsing (Week 1)
1. ✅ Create AAMVA parser library (`lib/scanner/aamvaParser.ts`)
2. ✅ Create API endpoint for license parsing (`/api/scanner/parse-license`)
3. ✅ Create patient matching logic (`lib/scanner/patientMatcher.ts`)
4. ✅ Add database fields for license number (optional)
5. ✅ Test with sample license data

### Phase 2: UPC Code Integration (Week 1-2)
1. ✅ Add `upc_code` field to `vials` table
2. ✅ Create migration script
3. ✅ Update vial creation/editing to include UPC
4. ✅ Create API endpoint for UPC scanning (`/api/scanner/scan-upc`)
5. ✅ Test UPC scanning with sample codes

### Phase 3: Frontend Scanner Interface (Week 2)
1. ✅ Create scanner dispensing page (`app/scanner-dispense/page.tsx`)
2. ✅ Create ScannerInput component
3. ✅ Create PatientMatchDisplay component
4. ✅ Create VialDisplay component
5. ✅ Integrate with existing dispensing API
6. ✅ Add navigation/routing

### Phase 4: Integration & Testing (Week 2-3)
1. ✅ Test end-to-end workflow
2. ✅ Test with real SunMi scanner
3. ✅ Test error handling and edge cases
4. ✅ User acceptance testing
5. ✅ Performance optimization

### Phase 5: Deployment (Week 3)
1. ✅ Deploy database migrations
2. ✅ Deploy backend API endpoints
3. ✅ Deploy frontend changes
4. ✅ Train staff on new workflow
5. ✅ Monitor and gather feedback

---

## 9. Error Handling & Edge Cases

### 9.1 License Scanning Errors
- **Invalid Format**: Show error, allow manual entry
- **No Patient Match**: Show parsed data, allow manual patient selection
- **Multiple Matches**: Show list of potential matches, allow selection
- **Expired License**: Warn but allow dispensing (check DOB validity)

### 9.2 UPC Scanning Errors
- **Invalid UPC**: Show error, allow manual vial selection
- **Vial Not Found**: Suggest similar UPCs or manual selection
- **Vial Inactive/Expired**: Show warning, prevent dispensing
- **Insufficient Volume**: Calculate and show available volume

### 9.3 Workflow Errors
- **Network Disconnection**: Cache data locally, retry on reconnect
- **Concurrent Dispenses**: Lock vial during dispense process
- **Patient Status Issues**: Show warnings (lab overdue, inactive status)
- **Vial Volume Issues**: Auto-suggest vial splitting if needed

---

## 10. Security & Compliance Considerations

### 10.1 Data Privacy
- **License Data**: 
  - Don't store full license data in database
  - Only store license number (if needed for matching)
  - Clear parsed data from memory after use
  - Log scanner sessions for audit (optional)

### 10.2 Access Control
- **Authentication**: Require user login for scanner dispensing
- **Authorization**: Check user role (write permission required)
- **Audit Trail**: Log all scanner-based dispenses with user ID

### 10.3 DEA Compliance
- **Controlled Substance Tracking**: Ensure all dispenses are recorded
- **Signature Requirements**: Maintain existing signature workflow
- **Audit Logs**: Scanner dispenses must be fully auditable

---

## 11. Testing Strategy

### 11.1 Unit Tests
- AAMVA parser with various license formats
- Patient matching logic with different scenarios
- UPC code validation and matching
- Date parsing and normalization

### 11.2 Integration Tests
- End-to-end scanner workflow
- API endpoint testing
- Database transaction testing
- Error handling scenarios

### 11.3 User Acceptance Testing
- Test with real SunMi scanner
- Test with various driver's license formats
- Test with different UPC codes
- Test error recovery
- Test workflow efficiency vs. manual entry

---

## 12. Future Enhancements

### 12.1 Additional Features
- **Batch Scanning**: Scan multiple vials for one patient
- **Prescription Verification**: Check prescription before dispensing
- **Inventory Auto-Update**: Update inventory when receiving new vials with UPCs
- **Mobile App**: Native mobile app for scanner integration
- **Offline Mode**: Cache data for offline scanning

### 12.2 Analytics
- Track scanner usage vs. manual entry
- Measure time savings
- Error rate tracking
- Most common scan errors

---

## 13. Dependencies & Requirements

### 13.1 Backend
- Node.js/Next.js (existing)
- PostgreSQL (existing)
- No new external dependencies needed (AAMVA parsing can be custom)

### 13.2 Frontend
- React/Next.js (existing)
- No new UI libraries needed

### 13.3 Hardware
- SunMi Scanner (provided)
- Scanner configured for PDF417 and UPC/EAN codes
- Scanner in keyboard wedge/HID mode

---

## 14. Questions & Decisions Needed

### 14.1 Open Questions
1. **UPC Storage**: Should we add `upc_code` field or use `external_id`? ✅ **DECIDED: Add `upc_code` field (Option B)**
2. **License Storage**: Multiple licenses per patient? ✅ **DECIDED: Yes, separate `patient_driver_licenses` table**
3. **Photo Storage**: File system, database, or cloud? ✅ **DECIDED: File system initially (can migrate to cloud later)**
4. **Scanner Mode**: Should scanner have dedicated page or integrate into existing form? ✅ **DECIDED: Dedicated page with integration options**
5. **Name Parsing**: How to extract first/last name from license data? (May need to test with real scans)
6. **Fallback**: What if scanner fails? Manual entry still available? ✅ **DECIDED: Yes, always allow manual entry**

### 14.2 Decisions Made
- [x] Choose UPC storage approach: **Option B - Add `upc_code` field to `vials` table**
- [x] License storage: **Separate `patient_driver_licenses` table supporting multiple licenses**
- [x] Photo storage: **File system storage in `/public/patient-photos/`**
- [x] Scanner page: **Dedicated `/scanner-dispense` page with integration links**
- [x] Multiple licenses: **Support multiple licenses per patient with primary designation**
- [x] Patient photos: **Support profile photos and license photos**

### 14.3 Remaining Decisions
- [ ] Set confidence thresholds for patient matching (high/medium/low)
- [ ] Define error handling user experience details
- [ ] Photo upload size limits and file type restrictions
- [ ] License verification requirements (always required vs. optional)

---

## 15. Estimated Timeline

- **Phase 1 (License Parsing)**: 3-5 days
- **Phase 2 (UPC Integration)**: 2-3 days
- **Phase 3 (Frontend)**: 4-5 days
- **Phase 4 (Testing)**: 3-4 days
- **Phase 5 (Deployment)**: 1-2 days

**Total**: ~2-3 weeks

---

## 16. Risk Assessment

### 16.1 Technical Risks
- **Low**: AAMVA parsing complexity (mitigated by testing with real data)
- **Low**: Scanner compatibility (SunMi is standard)
- **Medium**: Patient matching accuracy (mitigated by multiple matching strategies)

### 16.2 Business Risks
- **Low**: User adoption (scanner should be faster/easier)
- **Low**: Training requirements (minimal, intuitive workflow)
- **Medium**: Data accuracy (mitigated by validation and manual override)

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Make decisions** on open questions (section 14)
3. **Set up development environment** for testing
4. **Obtain sample license scans** for testing parser
5. **Begin Phase 1** implementation

---

**Document Version**: 1.0  
**Created**: 2024-01-XX  
**Last Updated**: 2024-01-XX

