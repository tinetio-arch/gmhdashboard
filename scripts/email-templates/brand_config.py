"""
Brand configuration for GHL email templates.

One dict per brand. The generator renders the same 5 workflow emails
(booking-confirmation, appointment-reminder, cancellation, reschedule,
post-visit) for every brand using these values.

Hard rules:
  - reset_password_url must point at a brand-owned endpoint. Never Healthie.
  - No Healthie branding, copy, or URLs anywhere in a brand config.
  - include_app_store is False everywhere until we have a real iOS + Android
    app live on both stores. Broken badge links ruin the "crazy professional"
    bar we are targeting.
"""

BRAND_ABXTAC = {
    "slug": "abxtac",
    "display_name": "ABXTAC",
    "short_name": "ABXTAC",
    "tagline_hero": "Peptide Therapy",
    "tagline_footer": "Heal \u00b7 Optimize \u00b7 Thrive",
    "visit_noun": "consultation",
    "product_noun": "peptide therapy",

    "app_name": "Now Optimal",
    "ios_app_url": "https://apps.apple.com/us/app/now-optimal/id6759345635",
    "android_app_url": "https://play.google.com/store/apps/details?id=com.nowoptimal.patient",
    "app_icon_url": "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/84/ec/22/84ec2226-394d-82e1-8255-d91319d8245e/AppIcon-0-0-1x_U007epad-0-1-85-220.png/512x512bb.jpg",

    "website": "https://abxtac.com",
    "shop_url": "https://abxtac.com/shop",
    "biobox_url": "https://abxtac.com/shop#biobox",
    "membership_url": "https://abxtac.com/membership",
    "booking_url": "https://abxtac.com/booking",
    "portal_url": "https://abxtac.com/portal",
    "open_app_url": "https://abxtac.com/open-app",
    "reset_password_url": "https://abxtac.com/reset-password?email={{contact.email}}",
    "set_password_url": "https://abxtac.com/set-password?email={{contact.email}}",

    "phone": "928-212-2772",
    "phone_href": "tel:9282122772",

    "logo_white_url": "https://abxtac.com/abxtac-logo-white.png",
    "logo_width_hero": 260,
    "logo_width_footer": 200,

    "primary_color": "#22c55e",
    "primary_dark": "#16a34a",
    "hero_bg": "#0a0a0a",
    "accent_bg": "#F4FBF6",

    "parent_brand_html": (
        '<div style="color:#94a3b8; font-size:11px; letter-spacing:0.2em; '
        'text-transform:uppercase; margin-bottom:8px;">Part of the</div>'
        '<div style="color:#ffffff; font-size:20px; font-weight:300; letter-spacing:0.24em;">'
        'NOW<span style="font-weight:700;">OPTIMAL</span></div>'
        '<div style="color:#22c55e; font-size:10px; letter-spacing:0.3em; '
        'font-weight:700; text-transform:uppercase; margin-top:4px;">Network</div>'
    ),

    "ghl_api_key_env": "GHL_ABXTAC_API_KEY",
    "ghl_location_env": "GHL_ABXTAC_LOCATION_ID",
    "ghl_user_id": "tEucCWPrrfl1Q8HiGvRb",

    "include_shop": True,
    "include_biobox": True,
    "include_membership": True,
    "include_member_pricing_copy": True,
    "include_app_store": True,
    "include_portal_cta": True,
    "include_feature_grid": True,
}


BRAND_MENS_HEALTH = {
    "slug": "mens-health",
    "display_name": "NOW Men's Health",
    "short_name": "NOW Men's Health",
    "tagline_hero": "Performance \u00b7 Hormone \u00b7 Longevity",
    "tagline_footer": "Stronger \u00b7 Sharper \u00b7 Longer",
    "visit_noun": "appointment",
    "product_noun": "men's health care",

    "website": "https://nowmenshealth.care",
    "shop_url": "",
    "biobox_url": "",
    "membership_url": "https://nowmenshealth.care/membership",
    "booking_url": "https://nowmenshealth.care/book",
    "portal_url": "https://nowmenshealth.care/portal",
    "reset_password_url": "https://nowmenshealth.care/reset-password?email={{contact.email}}",
    "set_password_url": "https://nowmenshealth.care/set-password?email={{contact.email}}",

    "phone": "928-212-2772",
    "phone_href": "tel:9282122772",

    "logo_white_url": "https://nowmenshealth.care/logo-white.png",
    "logo_width_hero": 260,
    "logo_width_footer": 200,

    "primary_color": "#1E3A8A",
    "primary_dark": "#172B6A",
    "hero_bg": "#0a0a0a",
    "accent_bg": "#F5F7FC",

    "parent_brand_html": (
        '<div style="color:#6b7280; font-size:11px; letter-spacing:0.2em; '
        'text-transform:uppercase; margin-bottom:8px;">Part of the</div>'
        '<div style="color:#ffffff; font-size:20px; font-weight:300; letter-spacing:0.24em;">'
        'NOW<span style="font-weight:700;">OPTIMAL</span></div>'
        '<div style="color:#1E3A8A; font-size:10px; letter-spacing:0.3em; '
        'font-weight:700; text-transform:uppercase; margin-top:4px;">Network</div>'
    ),

    "ghl_api_key_env": "GHL_MENS_HEALTH_API_KEY",
    "ghl_location_env": "GHL_MENS_HEALTH_LOCATION_ID",
    "ghl_user_id": "",

    "include_shop": False,
    "include_biobox": False,
    "include_membership": True,
    "include_member_pricing_copy": False,
    "include_app_store": False,
    "include_portal_cta": True,
}


BRAND_PRIMARY_CARE = {
    "slug": "primary-care",
    "display_name": "NOW Primary Care",
    "short_name": "NOW Primary Care",
    "tagline_hero": "Modern Primary Care",
    "tagline_footer": "Care \u00b7 Prevention \u00b7 Partnership",
    "visit_noun": "appointment",
    "product_noun": "primary care",

    "website": "https://nowprimarycare.com",
    "shop_url": "",
    "biobox_url": "",
    "membership_url": "https://nowprimarycare.com/membership",
    "booking_url": "https://nowprimarycare.com/book",
    "portal_url": "https://nowprimarycare.com/portal",
    "reset_password_url": "https://nowprimarycare.com/reset-password?email={{contact.email}}",
    "set_password_url": "https://nowprimarycare.com/set-password?email={{contact.email}}",

    "phone": "928-212-2772",
    "phone_href": "tel:9282122772",

    "logo_white_url": "https://nowprimarycare.com/logo-white.png",
    "logo_width_hero": 260,
    "logo_width_footer": 200,

    "primary_color": "#0F766E",
    "primary_dark": "#0B5953",
    "hero_bg": "#0a0a0a",
    "accent_bg": "#F3FAF8",

    "parent_brand_html": (
        '<div style="color:#6b7280; font-size:11px; letter-spacing:0.2em; '
        'text-transform:uppercase; margin-bottom:8px;">Part of the</div>'
        '<div style="color:#ffffff; font-size:20px; font-weight:300; letter-spacing:0.24em;">'
        'NOW<span style="font-weight:700;">OPTIMAL</span></div>'
        '<div style="color:#0F766E; font-size:10px; letter-spacing:0.3em; '
        'font-weight:700; text-transform:uppercase; margin-top:4px;">Network</div>'
    ),

    "ghl_api_key_env": "GHL_PRIMARY_CARE_API_KEY",
    "ghl_location_env": "GHL_PRIMARY_CARE_LOCATION_ID",
    "ghl_user_id": "",

    "include_shop": False,
    "include_biobox": False,
    "include_membership": False,
    "include_member_pricing_copy": False,
    "include_app_store": False,
    "include_portal_cta": True,
}


BRAND_MENTAL_HEALTH = {
    "slug": "mental-health",
    "display_name": "NOW Mental Health",
    "short_name": "NOW Mental Health",
    "tagline_hero": "Mental Health Care",
    "tagline_footer": "Clarity \u00b7 Calm \u00b7 Connection",
    "visit_noun": "session",
    "product_noun": "mental health care",

    "website": "https://nowmentalhealth.care",
    "shop_url": "",
    "biobox_url": "",
    "membership_url": "",
    "booking_url": "https://nowmentalhealth.care/book",
    "portal_url": "https://nowmentalhealth.care/portal",
    "reset_password_url": "https://nowmentalhealth.care/reset-password?email={{contact.email}}",
    "set_password_url": "https://nowmentalhealth.care/set-password?email={{contact.email}}",

    "phone": "928-212-2772",
    "phone_href": "tel:9282122772",

    "logo_white_url": "https://nowmentalhealth.care/logo-white.png",
    "logo_width_hero": 260,
    "logo_width_footer": 200,

    "primary_color": "#7C3AED",
    "primary_dark": "#5B21B6",
    "hero_bg": "#0a0a0a",
    "accent_bg": "#F7F4FD",

    "parent_brand_html": (
        '<div style="color:#6b7280; font-size:11px; letter-spacing:0.2em; '
        'text-transform:uppercase; margin-bottom:8px;">Part of the</div>'
        '<div style="color:#ffffff; font-size:20px; font-weight:300; letter-spacing:0.24em;">'
        'NOW<span style="font-weight:700;">OPTIMAL</span></div>'
        '<div style="color:#7C3AED; font-size:10px; letter-spacing:0.3em; '
        'font-weight:700; text-transform:uppercase; margin-top:4px;">Network</div>'
    ),

    "ghl_api_key_env": "GHL_MENTAL_HEALTH_API_KEY",
    "ghl_location_env": "GHL_MENTAL_HEALTH_LOCATION_ID",
    "ghl_user_id": "",

    "include_shop": False,
    "include_biobox": False,
    "include_membership": False,
    "include_member_pricing_copy": False,
    "include_app_store": False,
    "include_portal_cta": True,
}


BRANDS = {
    "abxtac": BRAND_ABXTAC,
    "mens-health": BRAND_MENS_HEALTH,
    "primary-care": BRAND_PRIMARY_CARE,
    "mental-health": BRAND_MENTAL_HEALTH,
}
