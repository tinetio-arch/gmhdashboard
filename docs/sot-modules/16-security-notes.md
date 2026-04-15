# Appointment Types Available for Online Booking:
#   TRT_INITIAL: 504725 (Initial TRT Consultation, 30 min, Free)
#   TRT_SUPPLY_REFILL: 504735 (TRT Supply Refill, 20 min, $79)
#   EVEXIPEL_MALE_INITIAL: 504727 (Pellet Therapy Initial, 60 min, $499)
#   EVEXIPEL_MALE_REPEAT: 504728 (Pellet Therapy Repeat, 45 min, $399)
#   WEIGHT_LOSS_CONSULT: 504717 (Weight Loss Consultation, 45 min, Free)
#   IV_THERAPY_GFE: 505647 (IV Therapy Consultation, 15 min, $50)
#
# API Routes:
#   POST /api/healthie/slots - Fetch available slots
#   POST /api/healthie/book - Book appointment & create patient
#
# Key Files:
#   lib/healthie-booking.ts - Healthie client with config
#   components/BookingWidget.tsx - Multi-step booking UI
#   app/book/page.tsx - Booking page
# ============================================


# Healthie Appointment Types (26 total - queried Dec 31, 2024)
# === URGENT/SICK VISITS ===
HEALTHIE_APPT_TYPE_SICK_VISIT_INPERSON=504715     # 50 min, In Person+Video, $129
HEALTHIE_APPT_TYPE_SICK_VISIT_TELE=505646         # 30 min, Video, $79
