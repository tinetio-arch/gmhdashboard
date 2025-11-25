# Driver's License Barcode Format Reference

## Sample Scan Data Analysis

### Raw Scan Output
```
DAU069 in
DAYBLU
DAG616 SUNRISE BLVD
DAIPRESCOTTDAJAZDAK863015872. DCF003403AC3S120805DCGUSADCK48103980197DDAFDDB02282023DAZBRODAW170DDK1
ZAZAANZACN
```

## AAMVA Field Code Breakdown

### Field Code Reference
| Code | Field Name | Example Value | Notes |
|------|------------|---------------|-------|
| **DAA** | First Name | (not in sample) | First name |
| **DAB** | Last Name | (not in sample) | Last name |
| **DAC** | Middle Name | (not in sample) | Middle name |
| **DAD** | Name Suffix | (not in sample) | Jr., Sr., III, etc. |
| **DAE** | Name Prefix | (not in sample) | Mr., Mrs., Dr., etc. |
| **DAF** | Mailing Street Address | (not in sample) | Mailing address |
| **DAG** | Street Address | `616 SUNRISE BLVD` | Physical address |
| **DAH** | City | (not in sample) | City name |
| **DAI** | City | `PRESCOTT` | City (appears in concatenated field) |
| **DAJ** | State | `AZ` | State abbreviation |
| **DAK** | ZIP Code | `863015872` | ZIP code (may include +4) |
| **DAL** | County | (not in sample) | County name |
| **DAM** | Country | (not in sample) | Country name |
| **DAN** | Address Line 2 | (not in sample) | Apartment, suite, etc. |
| **DAO** | Address Line 1 | (not in sample) | Primary address |
| **DAP** | Address Line 2 | (not in sample) | Secondary address |
| **DAQ** | Postal Code | (not in sample) | Postal code |
| **DAR** | Race | (not in sample) | Race/ethnicity |
| **DAS** | Sex | (not in sample) | Gender |
| **DAT** | Hair Color | (not in sample) | Hair color |
| **DAU** | Height | `069 in` | Height in inches |
| **DAV** | Weight | (not in sample) | Weight in pounds |
| **DAW** | Weight | `170` | Weight (appears in sample) |
| **DAX** | Eye Color | (not in sample) | Eye color |
| **DAY** | Eye Color | `BLU` | Eye color (appears in sample) |
| **DAZ** | Hair Color | `BRO` | Hair color (appears in sample) |
| **DBA** | Document Expiration Date | (not in sample) | Expiration date |
| **DBB** | Date of Birth | (not in sample) | Date of birth |
| **DBC** | Document Type | (not in sample) | DL, ID, etc. |
| **DBD** | Document Revision Date | (not in sample) | Revision date |
| **DBE** | Document Issue Date | (not in sample) | Issue date |
| **DBF** | Document Number | (not in sample) | Document number |
| **DBG** | Document Discriminator | (not in sample) | Discriminator |
| **DBH** | Document Discriminator | (not in sample) | Alternative discriminator |
| **DBI** | Issue Date | (not in sample) | Issue date |
| **DBJ** | Organ Donor Indicator | (not in sample) | Organ donor status |
| **DBK** | Compliance Type | (not in sample) | Compliance type |
| **DCF** | Document Discriminator | `003403AC3S120805` | Appears in sample |
| **DCG** | Country | `US` | Country code |
| **DCH** | Federal Commercial Vehicle Codes | (not in sample) | Commercial codes |
| **DCI** | Place of Birth | (not in sample) | Birth place |
| **DCJ** | Audit Information | (not in sample) | Audit data |
| **DCK** | Inventory Control Number | `48103980197` | **License Number** |
| **DCL** | Race/Ethnicity | (not in sample) | Race/ethnicity |
| **DCM** | Standard Vehicle Classification | (not in sample) | Vehicle class |
| **DCN** | Standard Endorsement Code | (not in sample) | Endorsements |
| **DCO** | Standard Restriction Code | (not in sample) | Restrictions |
| **DCP** | Jurisdiction Specific Vehicle Classification | (not in sample) | Vehicle class |
| **DCQ** | Jurisdiction Specific Endorsement Code | (not in sample) | Endorsements |
| **DCR** | Jurisdiction Specific Restriction Code | (not in sample) | Restrictions |
| **DCS** | Customer Full Name | (not in sample) | Full name |
| **DCT** | Customer First Name | (not in sample) | First name |
| **DCU** | Customer Last Name | (not in sample) | Last name |
| **DCV** | Customer Name Suffix | (not in sample) | Name suffix |
| **DDA** | Compliance Type | (appears in sample) | Compliance type |
| **DDB** | Date of Birth | `02282023` | **Date of Birth (MMDDYYYY)** |
| **DDC** | Customer Name Suffix | (not in sample) | Name suffix |
| **DDD** | Name Prefix | (not in sample) | Name prefix |
| **DDE** | Name Suffix | (not in sample) | Name suffix |
| **DDF** | Mailing Street Address | (not in sample) | Mailing address |
| **DDG** | Mailing City | (not in sample) | Mailing city |
| **DDH** | Mailing State | (not in sample) | Mailing state |
| **DDI** | Mailing ZIP Code | (not in sample) | Mailing ZIP |
| **DDJ** | Mailing Country | (not in sample) | Mailing country |
| **DDK** | Card Revision Date | `1` | Revision date (appears in sample) |
| **DDL** | Hazardous Material Endorsement Expiration Date | (not in sample) | HAZMAT expiration |
| **DDM** | Limited Duration Document Indicator | (not in sample) | Limited duration |
| **DDN** | Family Name Truncation | (not in sample) | Name truncation |
| **DDO** | First Names Truncation | (not in sample) | Name truncation |
| **DDP** | Middle Names Truncation | (not in sample) | Name truncation |
| **DDQ** | Under 18 Until | (not in sample) | Under 18 date |
| **DDR** | Under 19 Until | (not in sample) | Under 19 date |
| **DDS** | Under 21 Until | (not in sample) | Under 21 date |
| **DDT** | Organ Donor Indicator | (not in sample) | Organ donor |
| **DDU** | Veteran Indicator | (not in sample) | Veteran status |

## Parsing Strategy for Sample Data

### Line-by-Line Analysis

**Line 1**: `DAU069 in`
- **DAU** = Height
- Value: `069 in` (69 inches)

**Line 2**: `DAYBLU`
- **DAY** = Eye Color
- Value: `BLU` (Blue)

**Line 3**: `DAG616 SUNRISE BLVD`
- **DAG** = Street Address
- Value: `616 SUNRISE BLVD`

**Line 4**: `DAIPRESCOTTDAJAZDAK863015872. DCF003403AC3S120805DCGUSADCK48103980197DDAFDDB02282023DAZBRODAW170DDK1`
- This is a concatenated line with multiple fields:
  - **DAI** = City → `PRESCOTT`
  - **DAJ** = State → `AZ`
  - **DAK** = ZIP Code → `863015872` (86301-5872)
  - **DCF** = Document Discriminator → `003403AC3S120805`
  - **DCG** = Country → `US`
  - **DCK** = Inventory Control Number (License Number) → `48103980197`
  - **DDA** = Compliance Type → `F`
  - **DDB** = Date of Birth → `02282023` (February 28, 2023)
  - **DAZ** = Hair Color → `BRO` (Brown)
  - **DAW** = Weight → `170` (170 pounds)
  - **DDK** = Card Revision Date → `1`

**Line 5**: `ZAZAANZACN`
- This appears to be additional encoded data, possibly:
  - Name fields (DAA, DAB, DCS, etc.)
  - Or jurisdiction-specific fields

## Key Fields for Patient Matching

### Primary Matching Fields
1. **DCK (License Number)**: `48103980197` - Most reliable if stored
2. **DDB (Date of Birth)**: `02282023` → `2023-02-28` - Convert MMDDYYYY to YYYY-MM-DD
3. **Name Fields**: Need to extract from DAA/DAB/DCS or line 5
4. **DAG (Address)**: `616 SUNRISE BLVD`
5. **DAI (City)**: `PRESCOTT`
6. **DAJ (State)**: `AZ`
7. **DAK (ZIP)**: `863015872` → `86301` (first 5 digits)

### Date Conversion
- **Input Format**: `DDB02282023` = MMDDYYYY
- **Output Format**: `2023-02-28` = YYYY-MM-DD
- **Parsing**: 
  - Month: `02`
  - Day: `28`
  - Year: `2023`

### Name Extraction Challenge
The sample data doesn't clearly show the name fields. Common patterns:
- **DAA** = First Name
- **DAB** = Last Name
- **DCS** = Full Name (Customer Full Name)

Line 5 (`ZAZAANZACN`) might contain name data, but the format is unclear. We may need to:
1. Test with real license scans to identify name field locations
2. Use OCR on the visible license text if available
3. Fall back to manual entry if name can't be parsed

## Parser Implementation Notes

### Regex Pattern for Field Extraction
```javascript
// Pattern to match AAMVA field codes
const AAMVA_PATTERN = /([A-Z]{3})([^A-Z]*?)(?=[A-Z]{3}|$)/g;

// Example: Extract DAG field
const match = rawData.match(/DAG([^A-Z]*?)(?=[A-Z]{3}|$)/);
const address = match ? match[1].trim() : null;
```

### Parsing Algorithm
1. Split input by newlines
2. For each line, extract field codes and values
3. Handle concatenated fields (like line 4)
4. Normalize dates (MMDDYYYY → YYYY-MM-DD)
5. Normalize names (uppercase → title case)
6. Extract ZIP code (first 5 digits from DAK)

### Error Handling
- Missing fields: Use null/undefined
- Invalid dates: Log warning, skip field
- Unparseable concatenated fields: Try regex extraction
- Unknown field codes: Log for analysis, skip

## Testing Requirements

### Test Cases Needed
1. **Various License Formats**: Different states may format differently
2. **Missing Fields**: Handle licenses with missing optional fields
3. **Name Variations**: Test with different name formats
4. **Date Formats**: Verify date parsing across formats
5. **Concatenated Fields**: Test parsing of combined fields
6. **Special Characters**: Handle addresses with special characters

### Sample Test Data
Create test cases with:
- Complete license data
- Partial license data (missing fields)
- Different state formats
- Edge cases (long names, special addresses)

---

**Note**: This format analysis is based on the provided sample. Real-world testing with actual license scans will be necessary to refine the parser.

