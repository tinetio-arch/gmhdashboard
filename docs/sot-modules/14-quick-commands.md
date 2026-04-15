# GHL V2 API Notes (CRITICAL - Updated Jan 8, 2026):
# - V2 Base URL: https://services.leadconnectorhq.com
# - V1 Base URL: https://rest.gohighlevel.com/v1 (legacy)
# - V2 Header: "Version: 2021-07-28" required
# - Contact Search: Use "query=" param (NOT "email=" or "phone=")
# - Workflows: CANNOT be created via API - must use GHL UI
# - SMS: POST /conversations/messages (works with PIT token)
#
# **CRITICAL - Private Integration Token Scoping (Updated Jan 9, 2026):**
# - V2 Private Integration Tokens (PIT) are SUB-ACCOUNT SCOPED by default
# - When you create a PIT from within a GHL sub-account (e.g., NOW Men's Health),
#   the token is AUTOMATICALLY associated with that sub-account for AUTHENTICATION
# - The token "knows" which location it belongs to and enforces this in auth
#
# **HOWEVER** - locationId still needed in API request bodies:
# - Certain GHL API operations (like /contacts/search, /tags) REQUIRE locationId
#   IN THE REQUEST BODY, even when using a sub-account-scoped token
# - This is a quirk of GHL API v2 design - the token is scoped, but the API
#   still wants locationId explicitly in certain request payloads
# - Solution: Pass locationId to GHLClient constructor, which will include it
#   in request bodies where needed
# - The token's sub-account scope is still enforced - passing a different
#   locationId will result in "token does not have access" errors
#
# Current setup:
# - Token: pit-cb1c18dd-... (scoped to NOW Men's Health sub-account)
# - GHL_MENS_HEALTH_LOCATION_ID=0dpAFAovcFXbe0G5TUFr (used in request bodies)
# - These MUST match or you'll get "token does not have access" errors
#
# **DUAL LOCATION SETUP (Updated Jan 15, 2026):**
# Two separate tokens are needed, one for each GHL sub-account:
#
# Men's Health Location:
#   - Token: GHL_MENS_HEALTH_API_KEY=pit-d5e53eeb-...
#   - Location ID: 0dpAFAovcFXbe0G5TUFr
#
# Primary Care Location:
#   - Token: GHL_PRIMARY_CARE_API_KEY=pit-9383d96a-...
#   - Location ID: NyfcCiwUMdmXafnUMML8
#
# ==== GHL PATIENT ROUTING RULES (CRITICAL - Updated Jan 15, 2026) ====
#
# MEN'S HEALTH Location (default for most patients):
#   - QBO TCMH $180/Month (qbo_tcmh_180_month)
#   - QBO F&F/FR/Veteran $140/Month (qbo_f_f_fr_veteran_140_month)
#   - Jane TCMH $180/Month (jane_tcmh_180_month)
#   - Jane F&F/FR/Veteran $140/Month (jane_f_f_fr_veteran_140_month)
#   - Approved Disc / Pro-Bono PT (approved_disc_pro_bono_pt)
#   - NowMensHealth.Care (nowmenshealth)
#   - Ins. Supp. $60/Month (ins_supp_60_month)
#
# PRIMARY CARE Location (only these 3 client types):
#   - NowPrimary.Care (nowprimarycare)
#   - PrimeCare Premier $50/Month (primecare_premier_50_month)
#   - PrimeCare Elite $100/Month (primecare_elite_100_month)
#
