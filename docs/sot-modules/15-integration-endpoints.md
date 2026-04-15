# Implementation: getGHLClientForPatient() in lib/ghl.ts
# - Routes based on client_type_key field
# - Primary Care types explicitly listed, all others default to Men's Health



# Healthie Provider IDs (for appointment routing)
HEALTHIE_MENS_HEALTH_PROVIDER_ID=12093125
HEALTHIE_PRIMARY_CARE_PROVIDER_ID=12088269  # Phil Schafer, NP

# ============================================
# NowMensHealth.Care Website Healthie Integration [NEW Jan 2026]
# ============================================
#
# Website: https://www.nowmenshealth.care
# Directory: /home/ec2-user/nowmenshealth-website/
# PM2 Service: nowmenshealth-website (port 3005)
#
# Healthie Configuration:
#   Location ID: 13029260 (215 N. McCormick St, Prescott)
#   Group ID: 75522 (NowMensHealth.Care)
#   Provider ID: 12093125 (Dr. Aaron Whitten)
#   Timezone: America/Phoenix
#
