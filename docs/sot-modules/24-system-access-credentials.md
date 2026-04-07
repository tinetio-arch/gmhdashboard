## System Access Credentials (Updated Feb 19, 2026)

### Healthie EMR Login
- **URL**: https://healthie.com
- **Email**: admin@granitemountainhealth.com
- **Password**: (see `.env.local`)

### GoHighLevel CRM Login
- **URL**: https://app.gohighlevel.com
- **Email**: phil@tricitymenshealth.com
- **Password**: (see `.env.local`)

### Patient Creation Integration Status
- **Database**: ✅ IMPLEMENTED - Clinic field added, Healthie client ID field added
- **Form**: ✅ IMPLEMENTED - Clinic dropdown added (NOW Primary Care / NOW Men's Health)
- **Healthie Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct group based on clinic
- **GHL Sync**: ✅ IMPLEMENTED - Auto-creates patients in correct location based on clinic
- **Men's Health Tag**: ✅ IMPLEMENTED - Automatically adds 'existing' tag to Men's Health patients in GHL

---

## 📦 UPS Shipping Integration (March 5, 2026)

**Purpose**: Ship medical supplies (TRT kits, syringes, etc.) to patients directly from the patient profile page.

### UPS Developer Account
- **Client ID**: `UPS_CLIENT_ID` in `.env.local`
- **Account Number**: `158V7K`
- **Billing**: Account #158V7K
- **API Products Enabled**: Rating, Address Validation, Authorization (OAuth), Tracking, Shipping, Locator, Time In Transit, Smart Pickup, UPS SCS Transportation

### Verified API Endpoints (Production: `https://onlinetools.ups.com`)
| API | Method | Path | Status |
|-----|--------|------|--------|
| OAuth | POST | `/security/v1/oauth/token` | ✅ |
| Address Validation | POST | `/api/addressvalidation/v1/3` | ✅ |
| Rating | POST | `/api/rating/v2403/Rate` (or `/Shop`) | ✅ |
| Shipping | POST | `/api/shipments/v2409/ship` | ✅ |
| Tracking | GET | `/api/track/v1/details/{trackingNumber}` | ✅ |
| Void | DELETE | `/api/shipments/v2409/void/cancel/{id}` | ✅ |

### Files
- **API Client**: `lib/ups.ts` — OAuth2 token management, address validation, rating, shipping, tracking, void
- **DB Queries**: `lib/upsShipmentQueries.ts` — CRUD for `ups_shipments` table
- **API Routes**: `app/api/ups/` — validate-address, rate, ship, track, shipments, void
- **Frontend**: `app/patients/[id]/ShippingPanel.tsx` — shipping UI component in patient profile
- **Migration**: `migrations/20260305_ups_shipments.sql`

### Default Package Settings
- **Weight**: 0.4 lbs
- **Dimensions**: 12" × 8" × 3"
- **Service**: UPS Ground (code `03`)
- **Shipper**: NOW Men's Health, 215 N McCormick, Prescott AZ 86301

### Environment Variables
`UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`, `UPS_SHIPPER_NAME`, `UPS_SHIPPER_PHONE`, `UPS_SHIPPER_ADDRESS_LINE1`, `UPS_SHIPPER_CITY`, `UPS_SHIPPER_STATE`, `UPS_SHIPPER_POSTAL`, `UPS_SHIPPER_COUNTRY`

### Database
Table: `ups_shipments` (24 columns, 3 indexes on patient_id, tracking_number, status)

---

*Last Updated: March 5, 2026*
*Maintained by: AntiGravity AI Assistant + manual updates*
*Update this document after any significant system changes.*

