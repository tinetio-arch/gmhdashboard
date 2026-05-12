#!/usr/bin/env python3
"""
Brand-parameterized GHL email template generator.

Given a brand slug (see brand_config.py), render the 5 workflow emails
(booking-confirmation, appointment-reminder, cancellation, reschedule,
post-visit) and sync them to the brand's GHL sub-account.

Behavior:
  - If docs/emails/_ghl_template_ids_<slug>.json exists, UPDATE IN PLACE
    via POST /emails/builder/data + PATCH /emails/builder/{id}. This keeps
    workflow bindings stable.
  - Otherwise, CREATE fresh templates via the 3-step sequence and write
    the IDs out to _ghl_template_ids_<slug>.json.

Usage:
    python build_brand_emails.py abxtac
    python build_brand_emails.py abxtac --local-only   # render to disk, skip GHL
    python build_brand_emails.py mens-health           # after setting env vars

No Healthie references. No app store badges. All CTAs point to brand-owned
URLs. Reset-password flow uses each brand's own domain.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from brand_config import BRANDS  # noqa: E402

BASE = "https://services.leadconnectorhq.com"
ENV_PATH = os.path.expanduser("~/gmhdashboard/.env.local")
DOCS_DIR = os.path.expanduser("~/gmhdashboard/docs/emails")
os.makedirs(DOCS_DIR, exist_ok=True)


# ---------- ENV ----------

def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


# ---------- HTTP ----------

def api(method, path, token, params=None, body=None):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Version", "2021-07-28")
    req.add_header("Accept", "application/json")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "curl/8.4.0")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            raw = json.loads(raw)
        except Exception:
            pass
        return e.code, raw


# ---------- SHELL ----------

def style_block(brand):
    return f"""
  body, table, td, a {{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }}
  table, td {{ mso-table-lspace:0pt; mso-table-rspace:0pt; }}
  img {{ -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; display:block; }}
  body {{ margin:0 !important; padding:0 !important; width:100% !important; background:#0a0a0a; font-family:'Inter',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; color:#1f2937; }}
  a {{ color:{brand['primary_color']}; text-decoration:none; }}
  h1, h2, h3 {{ margin:0; font-weight:700; color:#0a0a0a; letter-spacing:-0.01em; }}
  p {{ margin:0 0 14px 0; font-size:16px; line-height:1.6; color:#1f2937; }}
  .eyebrow {{ font-family:'Rajdhani','Inter',sans-serif; font-weight:700; letter-spacing:0.28em; text-transform:uppercase; }}
  @media only screen and (max-width:620px) {{
    .container {{ width:100% !important; max-width:100% !important; border-radius:0 !important; }}
    .px-32 {{ padding-left:22px !important; padding-right:22px !important; }}
    .hero-pad {{ padding:36px 22px !important; }}
    .app-pad {{ padding:36px 22px !important; }}
    .app-icon {{ width:108px !important; height:108px !important; }}
    .badge-td {{ display:inline-block !important; padding:6px 4px !important; text-align:center !important; }}
    .feature-cell-dark {{ display:block !important; width:100% !important; padding:10px 0 !important; }}
    h1 {{ font-size:26px !important; line-height:1.2 !important; }}
    h2 {{ font-size:22px !important; }}
    .open-app-btn a {{ font-size:16px !important; padding:16px 28px !important; }}
  }}
"""


def hero_block(brand):
    return f"""
        <tr>
          <td align="center" style="background:{brand['hero_bg']}; padding:40px 24px;">
            <img src="{brand['logo_white_url']}" alt="{brand['display_name']}" width="{brand['logo_width_hero']}" style="max-width:{brand['logo_width_hero']}px; height:auto; margin:0 auto;">
            <div style="color:{brand['primary_color']}; font-size:12px; letter-spacing:0.28em; margin-top:14px; text-transform:uppercase; font-weight:700;">
              {brand['tagline_hero']}
            </div>
          </td>
        </tr>
        <tr><td style="background:{brand['primary_color']}; height:4px; line-height:4px; font-size:0;">&nbsp;</td></tr>
    """


def footer_block(brand):
    shop_line = ""
    if brand.get("include_shop") and brand.get("shop_url"):
        shop_line = f' &nbsp;&middot;&nbsp; <a href="{brand["shop_url"]}" style="color:#4ADE80;">Shop</a>'
    website_display = brand["website"].replace("https://", "").replace("http://", "")
    website_display = website_display.rstrip("/")
    return f"""
        <tr>
          <td align="center" style="background:{brand['hero_bg']}; padding:36px 24px;">
            <img src="{brand['logo_white_url']}" alt="{brand['display_name']}" width="{brand['logo_width_footer']}" style="max-width:{brand['logo_width_footer']}px; height:auto; margin:0 auto 16px auto;">
            <div style="color:{brand['primary_color']}; font-size:11px; letter-spacing:0.28em; font-weight:700; text-transform:uppercase; margin-bottom:20px;">
              {brand['tagline_footer']}
            </div>
            {brand['parent_brand_html']}
            <div style="border-top:1px solid #1f2937; margin:26px auto 18px auto; max-width:320px;"></div>
            <div style="color:#9ca3af; font-size:12px; line-height:1.7;">
              <a href="{brand['website']}" style="color:#4ADE80;">{website_display}</a> &nbsp;&middot;&nbsp; <a href="{brand['phone_href']}" style="color:#4ADE80;">{brand['phone']}</a>{shop_line}
            </div>
            <div style="color:#6b7280; font-size:10px; margin-top:18px; line-height:1.6;">
              You're receiving this because you're a patient or contact of {brand['display_name']}.<br>
              {{{{unsubscribe_link}}}}
            </div>
          </td>
        </tr>
    """


def body_intro(headline, intro_html):
    return f"""
        <tr>
          <td class="px-32" style="padding:40px 48px 12px 48px;">
            <h1 style="font-size:30px; line-height:1.2; color:#0a0a0a; margin:0 0 18px 0; letter-spacing:-0.02em; font-weight:700;">
              {headline}
            </h1>
            {intro_html}
          </td>
        </tr>
    """


def appointment_callout(brand, title="Appointment Details", include_amount=False, include_type=True):
    rows = [
        ("Date", "{{contact.appointment_date}}"),
        ("Time", "{{contact.appointment_time}} (Arizona Time)"),
    ]
    if include_type:
        rows.append(("Type", "{{contact.appointment_type}}"))
    if include_amount:
        rows.append(("Paid", "${{contact.amount_paid}}"))
    inner = "".join(
        f'<tr><td style="padding:6px 0; font-size:13px; color:#4b5563; width:90px;">{label}</td>'
        f'<td style="padding:6px 0; font-size:15px; font-weight:700; color:#0a0a0a;">{value}</td></tr>'
        for label, value in rows
    )
    return f"""
        <tr>
          <td class="px-32" style="padding:8px 48px 24px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background:{brand['accent_bg']}; border-left:4px solid {brand['primary_color']}; border-radius:4px;">
              <tr>
                <td style="padding:20px 24px;">
                  <div style="font-size:12px; font-weight:700; color:{brand['primary_color']}; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:10px;">
                    {title}
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    {inner}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def button_row(brand, text, href, style="primary", note_html=None):
    if style == "primary":
        bg = brand["primary_color"]
        color = "#ffffff"
        border = ""
    else:
        bg = "#ffffff"
        color = brand["primary_color"]
        border = f"border:2px solid {brand['primary_color']};"
    note = ""
    if note_html:
        note = f'<div style="font-size:13px; color:#6b7280; margin-top:10px; text-align:center;">{note_html}</div>'
    return f"""
        <tr>
          <td align="center" style="padding:10px 48px 20px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="{bg}" style="border-radius:6px; {border}">
                  <a href="{href}" style="background:{bg}; color:{color}; font-weight:700; font-size:16px; padding:14px 32px; border-radius:6px; display:inline-block; text-decoration:none; {border} letter-spacing:0.02em;">
                    {text}
                  </a>
                </td>
              </tr>
            </table>
            {note}
          </td>
        </tr>
    """


def numbered_steps(brand, steps, heading="What to Expect"):
    out = [f'<tr><td class="px-32" style="padding:26px 48px 6px 48px;">']
    out.append(f'<h2 style="text-align:center; font-size:22px; line-height:1.3; color:#0a0a0a; margin:0 0 22px 0;">{heading}</h2>')
    for i, (title, desc) in enumerate(steps, 1):
        out.append(f"""
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:14px;">
            <tr>
              <td width="56" valign="top">
                <div style="width:40px; height:40px; background:{brand['primary_color']}; color:#ffffff; border-radius:50%; line-height:40px; text-align:center; font-weight:700; font-size:16px; font-family:Arial,sans-serif;">{i}</div>
              </td>
              <td valign="top" style="padding-left:6px;">
                <div style="font-size:16px; font-weight:700; color:#0a0a0a; margin-bottom:2px;">{title}</div>
                <div style="font-size:14px; color:#4b5563; line-height:1.55;">{desc}</div>
              </td>
            </tr>
          </table>
        """)
    out.append('</td></tr>')
    return "\n".join(out)


def divider():
    return """
        <tr><td class="px-32" style="padding:16px 48px 0 48px;">
          <div style="border-top:1px solid #e5e7eb; height:0; line-height:0; font-size:0;">&nbsp;</div>
        </td></tr>
    """


def yellow_notice(label, body_html):
    return f"""
        <tr>
          <td class="px-32" style="padding:10px 48px 22px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FEF3C7; border-left:4px solid #F59E0B; border-radius:4px;">
              <tr>
                <td style="padding:18px 20px;">
                  <div style="font-size:14px; font-weight:700; color:#92400E; letter-spacing:0.08em; text-transform:uppercase; margin-bottom:6px;">
                    \u26A0 {label}
                  </div>
                  <div style="font-size:15px; line-height:1.55; color:#78350F;">
                    {body_html}
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def app_badges(brand):
    return f"""
        <tr>
          <td class="px-32" align="center" style="padding:8px 48px 8px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:4px auto 8px auto;">
              <tr>
                <td style="padding:0 6px;">
                  <a href="{brand['ios_app_url']}">
                    <img src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83" alt="Download on the App Store" width="160" style="height:auto; max-width:160px; display:block;">
                  </a>
                </td>
                <td style="padding:0 6px;">
                  <a href="{brand['android_app_url']}">
                    <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="180" style="height:auto; max-width:180px; display:block;">
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def compass_section(brand, icon_emoji, title, body_html, show_badges=True):
    """Legacy alias — now renders the open_app_panel."""
    return open_app_panel(brand, title=title, body_html=body_html)


def open_app_panel(brand, title=None, body_html=None, primary_label=None,
                   eyebrow=None, show_badges=True, show_icon=True):
    """Black app panel. Copy + CTAs are flow-aware:
       - show_badges=True  → first-touch (booking-confirmation), includes
         'Don't have the app yet?' with store badges.
       - show_badges=False → later-stage emails; patient already has app.
    """
    title = title or f"Open the {brand['app_name']} app"
    body_html = body_html or ""
    primary_label = primary_label or f"Open the {brand['app_name']} App"
    eyebrow = eyebrow or brand["app_name"].upper()
    icon_url = brand.get("app_icon_url", "")
    icon_html = ""
    if show_icon and icon_url:
        icon_html = f"""
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 22px auto;">
                    <tr>
                      <td align="center" style="padding:0; border-radius:28px;">
                        <img src="{icon_url}" alt="{brand['app_name']}" width="96" height="96" class="app-icon" style="width:96px; height:96px; border-radius:22px; display:block; border:1px solid #1f2937;">
                      </td>
                    </tr>
                  </table>"""

    body_p = ""
    if body_html:
        body_p = (
            f'<p style="color:#cbd5e1; font-size:16px; line-height:1.6; '
            f'margin:0 auto 26px auto; max-width:440px; text-align:center;">'
            f'{body_html}</p>'
        )

    badges_block = ""
    if show_badges:
        badges_block = f"""
                  <div style="color:#64748b; font-size:12px; margin:22px 0 14px 0; letter-spacing:0.18em; text-transform:uppercase; font-weight:700;">
                    Don't have the app yet?
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
                    <tr>
                      <td class="badge-td" align="center" valign="middle" style="padding:6px 6px;">
                        <a href="{brand['ios_app_url']}" style="display:inline-block; line-height:0; text-decoration:none;">
                          <img src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83" alt="Download on the App Store" width="162" height="54" style="width:162px; height:54px; display:block; border:0; outline:none;">
                        </a>
                      </td>
                      <td class="badge-td" align="center" valign="middle" style="padding:6px 6px;">
                        <a href="{brand['android_app_url']}" style="display:inline-block; line-height:0; text-decoration:none;">
                          <img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" width="182" height="54" style="width:182px; height:54px; display:block; border:0; outline:none;">
                        </a>
                      </td>
                    </tr>
                  </table>"""

    return f"""
        <tr>
          <td style="background:#0a0a0a; padding:0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td class="app-pad" align="center" style="padding:44px 48px;">
                  {icon_html}
                  <div class="eyebrow" style="color:{brand['primary_color']}; font-size:11px; letter-spacing:0.28em; margin-bottom:10px;">
                    {eyebrow}
                  </div>
                  <h2 style="color:#ffffff; font-size:26px; line-height:1.25; margin:0 0 14px 0; font-weight:700; letter-spacing:-0.01em;">
                    {title}
                  </h2>
                  {body_p}
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" class="open-app-btn">
                    <tr>
                      <td align="center" bgcolor="{brand['primary_color']}" style="border-radius:999px;">
                        <a href="{brand.get('open_app_url') or brand['ios_app_url']}" style="background:{brand['primary_color']}; color:#0a0a0a !important; font-weight:700; font-size:17px; padding:16px 38px; border-radius:999px; display:inline-block; text-decoration:none; letter-spacing:0.02em; font-family:'Inter',-apple-system,BlinkMacSystemFont,Arial,sans-serif;">
                          {primary_label} \u2192
                        </a>
                      </td>
                    </tr>
                  </table>
                  {badges_block}
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def peptide_shop_card(brand):
    """Rich shop callout — the shop is a section INSIDE the Now Optimal iOS
    app, not a web page. The CTA always deep-links to the app (the open-app
    dispatcher handles scheme → store fallback)."""
    if not brand.get("include_shop"):
        return ""
    href = brand.get("open_app_url") or brand["ios_app_url"]
    return f"""
        <tr>
          <td class="px-32" style="padding:20px 48px 8px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background:#ffffff; border:1px solid #e5e7eb; border-top:4px solid {brand['primary_color']}; border-radius:6px;">
              <tr>
                <td style="padding:26px 28px;">
                  <div style="font-size:11px; font-weight:700; color:{brand['primary_color']}; letter-spacing:0.22em; text-transform:uppercase; margin-bottom:8px;">
                    The {brand['display_name']} Peptide Shop
                  </div>
                  <h2 style="font-size:22px; line-height:1.25; color:#0a0a0a; margin:0 0 10px 0; letter-spacing:-0.01em;">
                    Shop peptides, inside the app
                  </h2>
                  <p style="margin:0 0 18px 0; font-size:15px; line-height:1.55; color:#4b5563;">
                    Open the {brand['app_name']} app and tap <strong>Shop</strong> to browse the full {brand['display_name']} lineup \u2014 GLP\u20111s, growth-hormone peptides, recovery stacks, and BioBox bundles \u2014 and order securely in a few taps.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td align="center" bgcolor="{brand['primary_color']}" style="border-radius:999px;">
                        <a href="{href}" style="background:{brand['primary_color']}; color:#0a0a0a !important; font-weight:700; font-size:15px; padding:13px 28px; border-radius:999px; display:inline-block; text-decoration:none; letter-spacing:0.02em;">
                          Open the {brand['app_name']} App \u2192
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def shop_in_app_button(brand, label="\U0001F9EA  Shop Peptides in the App", href=None):
    href = href or brand["ios_app_url"]
    return f"""
        <tr>
          <td align="center" style="padding:14px 48px 28px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="{brand['primary_color']}" style="border-radius:6px;">
                  <a href="{href}" class="btn-shop" style="background:{brand['primary_color']}; color:#ffffff; font-weight:700; font-size:16px; padding:14px 36px; border-radius:6px; display:inline-block; letter-spacing:0.04em; text-transform:uppercase; text-decoration:none;">
                    {label}
                  </a>
                </td>
              </tr>
            </table>
            <div style="font-size:13px; color:#6b7280; margin-top:10px;">
              Open on <a href="{brand['ios_app_url']}" style="color:{brand['primary_color']}; font-weight:700;">iPhone</a> or <a href="{brand['android_app_url']}" style="color:{brand['primary_color']}; font-weight:700;">Android</a>
            </div>
          </td>
        </tr>
    """


FEATURE_GRID_ITEMS = [
    ("\U0001F4C5", "Book Appointments", "Schedule consults in seconds"),
    ("\U0001F4AC", "Secure Messaging", "HIPAA-compliant chat with your team"),
    ("\U0001F916", "Ask Jarvis AI", "Instant answers about your protocol", "NEW"),
    ("\U0001F4C4", "Documents &amp; Labs", "Every result, visit note, and record"),
    ("\U0001F4DD", "Digital Forms", "Intake and consents from your phone"),
    ("\U0001F4CA", "Health Metrics", "Track biomarkers over time"),
    ("\U0001F4D3", "My Journal", "Log how you're feeling day to day"),
    ("\U0001F4B3", "Billing &amp; Payments", "View invoices and pay securely"),
    ("\U0001F512", "HIPAA Secure", "End-to-end encrypted"),
]


APP_FEATURES_DARK = [
    ("\U0001F4C5", "Book Appointments", "Schedule visits in seconds"),
    ("\U0001F4AC", "Secure Messaging", "HIPAA chat with your care team"),
    ("\U0001F916", "Ask Jarvis AI", "Instant answers on your protocol", "NEW"),
    ("\U0001F9EA", "Labs &amp; Documents", "Every result and visit note"),
    ("\U0001F4CA", "Health Metrics", "Track biomarkers over time"),
    ("\U0001F4DD", "Digital Forms", "Intake &amp; consents from your phone"),
]


def app_features_dark(brand, title="What's inside the app", subtitle=None):
    """Dark-themed 2-column feature grid. Designed to sit directly under the
    open_app_panel on the same black background so the flow reads as a single
    'here's what you get' story without a visual seam."""
    subtitle = subtitle or f"Your entire {brand['display_name']} care experience, in one place."
    cells_html = ""
    for i in range(0, len(APP_FEATURES_DARK), 2):
        row_cells = APP_FEATURES_DARK[i:i + 2]
        tds = ""
        for item in row_cells:
            if len(item) == 4:
                icon, label, desc, badge = item
                badge_html = (
                    f' <span style="display:inline-block; background:{brand["primary_color"]}; '
                    f'color:#0a0a0a; font-size:9px; font-weight:800; padding:2px 6px; '
                    f'border-radius:4px; margin-left:6px; letter-spacing:0.12em; '
                    f'vertical-align:middle;">{badge}</span>'
                )
            else:
                icon, label, desc = item
                badge_html = ""
            tds += f"""
                  <td width="50%" valign="top" class="feature-cell-dark" style="padding:14px 12px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tr>
                        <td width="52" valign="top">
                          <div style="width:44px; height:44px; background:#0f1a12; border:1px solid #1f2937; border-radius:10px; line-height:44px; text-align:center; font-size:20px;">{icon}</div>
                        </td>
                        <td valign="top" style="padding-left:10px;">
                          <div style="font-size:14px; font-weight:700; color:#ffffff; margin-bottom:3px; line-height:1.3;">{label}{badge_html}</div>
                          <div style="font-size:13px; color:#94a3b8; line-height:1.5;">{desc}</div>
                        </td>
                      </tr>
                    </table>
                  </td>"""
        if len(row_cells) == 1:
            tds += '<td width="50%" style="padding:14px 12px;">&nbsp;</td>'
        cells_html += f"                <tr>{tds}\n                </tr>\n"

    return f"""
        <tr>
          <td style="background:#0a0a0a; padding:0 0 44px 0;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td class="app-pad" style="padding:0 36px 0 36px;">
                  <div style="border-top:1px solid #1f2937; margin:0 0 26px 0;"></div>
                  <div align="center" style="color:{brand['primary_color']}; font-size:11px; letter-spacing:0.28em; font-weight:700; text-transform:uppercase; margin-bottom:8px;">
                    {title}
                  </div>
                  <p style="text-align:center; font-size:14px; color:#94a3b8; margin:0 0 18px 0; line-height:1.5;">
                    {subtitle}
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
{cells_html}                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def feature_grid_3x3(brand, title="Everything You Need In One App", subtitle="Nine powerful features, one login."):
    tile_bg = "#E8F3E6" if brand["primary_color"] == "#3A7D32" else "#F1F5F9"
    cells = []
    for item in FEATURE_GRID_ITEMS:
        if len(item) == 4:
            icon, label, desc, badge = item
            badge_html = f' <span style="display:inline-block; background:{brand["primary_color"]}; color:#fff; font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; margin-left:4px; letter-spacing:0.08em; vertical-align:middle;">{badge}</span>'
        else:
            icon, label, desc = item
            badge_html = ""
        cells.append(f"""
                <td width="33%" class="feature-cell" align="center" valign="top" style="padding:12px 8px;">
                  <div style="width:56px; height:56px; background:{tile_bg}; border-radius:12px; line-height:56px; font-size:26px; margin:0 auto 10px auto;">{icon}</div>
                  <div style="font-size:15px; font-weight:700; color:#0a0a0a; margin-bottom:4px;">{label}{badge_html}</div>
                  <div style="font-size:13px; color:#6b7280; line-height:1.45;">{desc}</div>
                </td>""")
    rows_html = ""
    for i in range(0, 9, 3):
        rows_html += "              <tr>" + "".join(cells[i:i+3]) + "\n              </tr>\n"
    return f"""
        <tr>
          <td class="px-32" style="padding:30px 48px 10px 48px;">
            <h2 style="text-align:center; font-size:22px; line-height:1.3; color:#0a0a0a; margin:0 0 8px 0;">
              {title}
            </h2>
            <p style="text-align:center; font-size:15px; color:#6b7280; margin:0 0 26px 0;">
              {subtitle}
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
{rows_html}            </table>
          </td>
        </tr>
    """


def numbered_step_large(brand, n, title, body_html, cta_text=None, cta_href=None, is_last=False):
    margin_bottom = "10px" if is_last else "18px"
    cta_html = ""
    if cta_text and cta_href:
        cta_html = f"""
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">
                    <tr>
                      <td bgcolor="{brand['primary_color']}" style="border-radius:6px;">
                        <a href="{cta_href}" style="background:{brand['primary_color']}; color:#ffffff; font-weight:700; font-size:15px; padding:12px 26px; border-radius:6px; display:inline-block; text-decoration:none;">
                          {cta_text} \u2192
                        </a>
                      </td>
                    </tr>
                  </table>"""
    return f"""
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:{margin_bottom};">
              <tr>
                <td width="60" valign="top">
                  <div style="width:44px; height:44px; background:{brand['primary_color']}; color:#ffffff; border-radius:50%; line-height:44px; text-align:center; font-weight:700; font-size:18px; font-family:Arial,sans-serif;">{n}</div>
                </td>
                <td valign="top" style="padding-left:8px;">
                  <div style="font-size:17px; font-weight:700; color:#0a0a0a; margin-bottom:4px;">{title}</div>
                  <div style="font-size:15px; color:#4b5563; line-height:1.55;">{body_html}</div>
                  {cta_html}
                </td>
              </tr>
            </table>
    """


def three_step_onboarding(brand, steps, heading="Get Started in 3 Easy Steps"):
    step_blocks = ""
    for i, step in enumerate(steps, 1):
        is_last = (i == len(steps))
        step_blocks += numbered_step_large(
            brand, i, step["title"], step["body"],
            cta_text=step.get("cta_text"), cta_href=step.get("cta_href"),
            is_last=is_last,
        )
    return f"""
        <tr>
          <td class="px-32" style="padding:30px 48px 10px 48px;">
            <h2 style="text-align:center; font-size:22px; line-height:1.3; color:#0a0a0a; margin:0 0 26px 0;">
              {heading}
            </h2>
            {step_blocks}
          </td>
        </tr>
    """


def need_a_hand(brand):
    return f"""
        <tr>
          <td class="px-32" style="padding:30px 48px 34px 48px; background:#ffffff;">
            <h2 style="font-size:18px; line-height:1.3; color:#0a0a0a; margin:0 0 8px 0;">Need a hand?</h2>
            <p style="margin:0; font-size:15px; color:#4b5563;">
              Reply to this email \u2014 it goes straight to our care team. Or call <a href="{brand['phone_href']}" style="font-weight:700; color:{brand['primary_color']};">{brand['phone']}</a>.
            </p>
          </td>
        </tr>
    """


def render_shell(brand, subject, preview, body_sections):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{subject}</title>
<style type="text/css">{style_block(brand)}</style>
</head>
<body style="margin:0; padding:0; background:#f4f4f4;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">{preview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f4f4f4;">
  <tr>
    <td align="center" style="padding:20px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="width:600px; max-width:600px; background:#ffffff; border-radius:4px; overflow:hidden;">
{hero_block(brand)}
{body_sections}
{need_a_hand(brand)}
{footer_block(brand)}
      </table>
    </td>
  </tr>
</table>
</body>
</html>
"""


# ---------- TEMPLATES (per brand) ----------

def password_callout_new(brand):
    """Shown to brand-NEW patients. Temp password comes from GHL custom field
    populated by the booking route after setting the Healthie password."""
    return f"""
        <tr>
          <td class="px-32" style="padding:8px 48px 24px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background:{brand['accent_bg']}; border-left:4px solid {brand['primary_color']}; border-radius:4px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-size:12px; font-weight:700; color:{brand['primary_color']}; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:10px;">
                    Your Account
                  </div>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr><td style="padding:4px 0; font-size:13px; color:#4b5563; width:110px;">Email</td>
                        <td style="padding:4px 0; font-size:15px; font-weight:700; color:#0a0a0a; word-break:break-all;">{{{{contact.email}}}}</td></tr>
                    <tr><td style="padding:4px 0; font-size:13px; color:#4b5563;">Temp Password</td>
                        <td style="padding:4px 0; font-family:'SFMono-Regular',Menlo,monospace; font-size:18px; font-weight:700; color:#0a0a0a; letter-spacing:0.04em; word-break:break-all;">{{{{contact.temp_password}}}}</td></tr>
                  </table>
                  <div style="font-size:13px; color:#4b5563; margin-top:12px; line-height:1.5;">
                    Case-sensitive. Please change it to something memorable after you log in \u2014 you can do that from the profile screen inside the app.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def password_callout_reset(brand):
    """Shown to EXISTING patients at booking. They already have a password;
    if they don't remember it, a branded reset link."""
    return f"""
        <tr>
          <td class="px-32" style="padding:8px 48px 24px 48px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                   style="background:{brand['accent_bg']}; border-left:4px solid {brand['primary_color']}; border-radius:4px;">
              <tr>
                <td style="padding:22px 24px;">
                  <div style="font-size:12px; font-weight:700; color:{brand['primary_color']}; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:10px;">
                    Welcome Back
                  </div>
                  <div style="font-size:15px; color:#1f2937; line-height:1.55; margin-bottom:12px;">
                    Your account email is <strong style="color:#0a0a0a; word-break:break-all;">{{{{contact.email}}}}</strong>. Use the password you already have to log in.
                  </div>
                  <div style="font-size:14px; color:#4b5563; line-height:1.55;">
                    Forgot it? <a href="{brand['reset_password_url']}" style="color:{brand['primary_color']}; font-weight:700;">Reset your password</a> and we'll send a new one to your inbox.
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
    """


def onboarding_four_steps(brand):
    """Four chronological steps for a brand-new ABXTAC patient. Step 2 is
    the one carrying real weight: shows the generated temp password inline
    and asks the patient to set a profile photo so the provider recognizes
    them on video. All CTAs resolve to the app (the shop is inside the app)."""
    open_href = brand.get("open_app_url") or brand["ios_app_url"]

    step2_body = f"""
      <p style="margin:0 0 14px 0; font-size:15px; color:#4b5563; line-height:1.55;">
        Log in with the email and temporary password below. Keep this email safe until you're logged in.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:{brand['accent_bg']}; border-left:3px solid {brand['primary_color']}; border-radius:4px; margin:0 0 14px 0;">
        <tr>
          <td style="padding:14px 18px;">
            <div style="font-size:11px; font-weight:700; color:{brand['primary_color']}; letter-spacing:0.14em; text-transform:uppercase; margin-bottom:6px;">
              Your Login
            </div>
            <div style="font-size:13px; color:#4b5563; margin-bottom:2px;">
              Email: <strong style="color:#0a0a0a; word-break:break-all;">{{{{contact.email}}}}</strong>
            </div>
            <div style="font-size:13px; color:#4b5563;">
              Temp Password:
              <span style="font-family:'SFMono-Regular',Menlo,monospace; font-size:16px; font-weight:700; color:#0a0a0a; letter-spacing:0.04em;">{{{{contact.temp_password}}}}</span>
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:0; font-size:14px; color:#4b5563; line-height:1.55;">
        Once you're in, please <strong style="color:#0a0a0a;">add a profile photo</strong> under your profile \u2014 it helps your provider recognize you on video. Need a new password? Reset it any time at
        <a href="{brand['reset_password_url']}" style="color:{brand['primary_color']}; font-weight:700;">{brand['website'].replace('https://','').replace('http://','').rstrip('/')}/reset-password</a>.
      </p>
    """

    step4_body = f"""
      After your {brand['visit_noun']}, your provider designs a protocol and recommends a membership tier \u2014
      <strong>Heal</strong> (10% off peptides), <strong>Optimize</strong> (20% off), or <strong>Thrive</strong> (30% off).
      Your peptides then ship directly to your door, ordered right from the <strong>Shop</strong> tab inside the {brand['app_name']} app.
    """

    dash = "\u2014"
    step1_title = f"Download the {brand['app_name']} app"
    step1_body = f"Grab the app on iPhone or Android {dash} badges are below. Your {brand['visit_noun']} happens inside the app."
    step3_title = f"Do your video {brand['visit_noun']}"
    step3_body = "At your scheduled time, open the app and tap your booking to start the secure video call with your provider."
    step4_cta = f"Open the {brand['app_name']} App"
    s1 = numbered_step_large(brand, 1, step1_title, step1_body)
    s2 = numbered_step_large(brand, 2, "Change your password &amp; add a photo", step2_body)
    s3 = numbered_step_large(brand, 3, step3_title, step3_body)
    s4 = numbered_step_large(brand, 4, "Shop inside the app", step4_body,
                             cta_text=step4_cta, cta_href=open_href, is_last=True)
    return f"""
        <tr>
          <td class="px-32" style="padding:30px 48px 10px 48px;">
            <h2 style="text-align:center; font-size:22px; line-height:1.3; color:#0a0a0a; margin:0 0 26px 0;">
              Get Ready in Four Steps
            </h2>
            {s1}
            {s2}
            {s3}
            {s4}
          </td>
        </tr>
    """


def tmpl_booking_confirmation(brand):
    """NEW-PATIENT booking confirmation. Triggered by tag
    'abxtac-new-patient'. The 4-step onboarding block carries everything:
    download, password + photo, video call, shop."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Hi {{{{contact.first_name}}}}, your {brand['display_name']} {visit} is booked. Everything \u2014 your video visit, your provider messages, your peptide shop \u2014 lives inside the <strong>{brand['app_name']}</strong> app. Here's how to get set up.</p>
    """
    sections = body_intro(f"Your {visit.title()} is Booked", intro)
    sections += appointment_callout(brand, "Appointment Details", include_amount=True, include_type=True)
    sections += onboarding_four_steps(brand)
    sections += open_app_panel(
        brand,
        eyebrow="Step 1 \u2014 Install the App",
        title=f"Get the {brand['app_name']} app",
        body_html="Download it now so it's ready when your appointment time comes around.",
        primary_label=f"Open the {brand['app_name']} App",
        show_badges=True,
    )
    return {
        "slug": "booking-confirmation",
        "name": f"{brand['display_name']} \u2014 Booking Confirmation (New Patient)",
        "subject": f"Your {brand['short_name']} {visit.title()} is Booked \u2014 Here's Your Login",
        "preview": f"Four steps to get ready \u2014 download, log in, join the call, shop in the app.",
        "sections": sections,
    }


def tmpl_booking_confirmation_existing(brand):
    """EXISTING-PATIENT booking confirmation. Triggered by tag
    'abxtac-existing-patient'. They already have a password; we offer a
    reset link instead of printing credentials in the email."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Welcome back {{{{contact.first_name}}}} \u2014 your new {brand['display_name']} {visit} is booked. Your video visit happens inside the <strong>{brand['app_name']}</strong> app, same as before.</p>
      <p>Open the app at your scheduled time and tap your booking to start the call. If you forgot your password, the reset link below will send you a new one.</p>
    """
    sections = body_intro(f"Your {visit.title()} is Booked", intro)
    sections += appointment_callout(brand, "Appointment Details", include_amount=True, include_type=True)
    sections += password_callout_reset(brand)
    sections += open_app_panel(
        brand,
        eyebrow="Ready to Join",
        title=f"Open the {brand['app_name']} app",
        body_html=f"Everything for your {visit} is already inside \u2014 just log in and tap your booking.",
        primary_label=f"Open the {brand['app_name']} App",
        show_badges=True,
    )
    sections += peptide_shop_card(brand)
    return {
        "slug": "booking-confirmation-existing",
        "name": f"{brand['display_name']} \u2014 Booking Confirmation (Returning Patient)",
        "subject": f"You're Booked \u2014 See You in the {brand['app_name']} App",
        "preview": f"Your {visit} is booked \u2014 open the {brand['app_name']} app to join.",
        "sections": sections,
    }


def tmpl_appointment_reminder(brand):
    """24h before. Patient already has app from booking email. No badges."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Hi {{{{contact.first_name}}}}, quick reminder \u2014 your {brand['display_name']} {visit} is <strong>tomorrow</strong>.</p>
      <p>Open the <strong>{brand['app_name']}</strong> app about 5 minutes early and tap your booking to start the video call. Make sure camera and microphone are allowed.</p>
    """
    sections = body_intro("Tomorrow's the Day", intro)
    sections += appointment_callout(brand, "Tomorrow's Appointment", include_amount=False, include_type=True)
    sections += open_app_panel(
        brand,
        eyebrow="Ready to Join",
        title="Open the app tomorrow",
        body_html=f"Tap below to jump straight to your {visit} at the scheduled time.",
        primary_label=f"Open the {brand['app_name']} App",
        show_badges=True,
    )
    return {
        "slug": "appointment-reminder",
        "name": f"{brand['display_name']} \u2014 Appointment Reminder (24h)",
        "subject": f"Tomorrow: Your {brand['short_name']} {visit.title()}",
        "preview": f"Open the {brand['app_name']} app tomorrow to join your {visit}.",
        "sections": sections,
    }


def tmpl_cancellation(brand):
    """Terminal state. Soft rebook. Don't hard-push the app."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Hi {{{{contact.first_name}}}}, your {brand['display_name']} {visit} has been <strong>cancelled</strong>. No charge, nothing to do.</p>
      <p>Whenever you're ready to come back, rebooking takes under a minute.</p>
    """
    sections = body_intro(f"{visit.title()} Cancelled", intro)
    sections += open_app_panel(
        brand,
        eyebrow="When You're Ready",
        title="Rebook any time",
        body_html="Every open slot, live, right from the app. Or just reply to this email and we'll handle it for you.",
        primary_label="Rebook in the App",
        show_badges=True,
    )
    return {
        "slug": "cancellation",
        "name": f"{brand['display_name']} \u2014 Cancellation",
        "subject": f"Your {brand['short_name']} {visit.title()} Has Been Cancelled",
        "preview": "Cancelled \u2014 rebook when you're ready.",
        "sections": sections,
    }


def tmpl_reschedule(brand):
    """Patient already has app. Just inform them of the new time."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Hi {{{{contact.first_name}}}}, your {brand['display_name']} {visit} has been <strong>rescheduled</strong>. Same provider, same video format \u2014 just a new time.</p>
    """
    sections = body_intro("New Time Confirmed", intro)
    sections += appointment_callout(brand, "Updated Appointment", include_amount=False, include_type=True)
    sections += open_app_panel(
        brand,
        eyebrow="Updated in Your App",
        title="See the new time",
        body_html="Your booking has been updated inside the app. Open it to view the new time or make another change.",
        primary_label=f"Open the {brand['app_name']} App",
        show_badges=True,
    )
    return {
        "slug": "reschedule",
        "name": f"{brand['display_name']} \u2014 Reschedule",
        "subject": f"New Time: Your {brand['short_name']} {visit.title()}",
        "preview": f"Updated time below \u2014 see it in the {brand['app_name']} app.",
        "sections": sections,
    }


def tmpl_post_visit(brand):
    """Patient just finished the video visit INSIDE the app. They already
    have it and already logged in. No 'welcome', no download badges, no
    set-password. Just: protocol is coming, we'll notify you."""
    visit = brand["visit_noun"]
    intro = f"""
      <p>Hi {{{{contact.first_name}}}}, thanks for meeting with us today. Your provider is writing your personalized plan now.</p>
      <p>You'll get a <strong>push notification in the {brand['app_name']} app</strong> as soon as it's ready to review \u2014 usually within 24 hours.</p>
    """
    sections = body_intro(f"Thanks for Your {visit.title()}", intro)
    sections += open_app_panel(
        brand,
        eyebrow="Your Plan Is On The Way",
        title="We'll notify you in the app",
        body_html="Keep an eye out for a push notification when your protocol is ready to review.",
        primary_label=f"Open the {brand['app_name']} App",
        show_badges=True,
    )
    sections += app_features_dark(
        brand,
        title="While You Wait",
        subtitle="Everything you need is already inside the app \u2014 message your provider, review labs, and more.",
    )
    sections += peptide_shop_card(brand)
    return {
        "slug": "post-visit",
        "name": f"{brand['display_name']} \u2014 Post-Visit",
        "subject": f"Thanks \u2014 Your {brand['short_name']} Plan is on the Way",
        "preview": "Your provider is writing your plan \u2014 we'll notify you in the app.",
        "sections": sections,
    }


TEMPLATES = [
    tmpl_booking_confirmation,
    tmpl_booking_confirmation_existing,
    tmpl_appointment_reminder,
    tmpl_cancellation,
    tmpl_reschedule,
    tmpl_post_visit,
]


# ---------- GHL SYNC ----------

def create_template(api_key, location_id, user_id, name, subject, preview_text, html):
    code, body = api("POST", "/emails/builder", api_key, body={
        "title": name,
        "locationId": location_id,
        "type": "html",
        "subject": subject,
        "html": html,
    })
    if code not in (200, 201):
        return None, f"create shell failed: {code} {body}"
    tid = body.get("id") or body.get("redirect")
    if not tid:
        return None, f"no id returned: {body}"

    code2, body2 = api("POST", "/emails/builder/data", api_key, body={
        "locationId": location_id,
        "templateId": tid,
        "editorType": "html",
        "updatedBy": user_id,
        "html": html,
        "previewText": preview_text,
        "subject": subject,
    })
    if code2 not in (200, 201):
        return None, f"upload html failed: {code2} {body2}"

    code3, body3 = api("PATCH", f"/emails/builder/{tid}", api_key, body={
        "locationId": location_id,
        "name": name,
        "subjectLine": subject,
        "previewText": preview_text,
    })
    if code3 not in (200, 201):
        return tid, f"patch meta failed: {code3} {body3}"

    preview_url = body2.get("previewUrl") if isinstance(body2, dict) else None
    return {"id": tid, "previewUrl": preview_url}, None


def update_template(api_key, location_id, user_id, tid, name, subject, preview_text, html):
    code, body = api("POST", "/emails/builder/data", api_key, body={
        "locationId": location_id,
        "templateId": tid,
        "editorType": "html",
        "updatedBy": user_id,
        "html": html,
        "previewText": preview_text,
        "subject": subject,
    })
    if code not in (200, 201):
        return None, f"update html failed: {code} {body}"

    code2, body2 = api("PATCH", f"/emails/builder/{tid}", api_key, body={
        "locationId": location_id,
        "name": name,
        "subjectLine": subject,
        "previewText": preview_text,
    })
    if code2 not in (200, 201):
        return None, f"patch meta failed: {code2} {body2}"

    preview_url = body.get("previewUrl") if isinstance(body, dict) else None
    return {"id": tid, "previewUrl": preview_url}, None


def ids_path(slug):
    return os.path.join(DOCS_DIR, f"_ghl_template_ids_{slug}.json")


def legacy_ids_path():
    return os.path.join(DOCS_DIR, "_ghl_template_ids.json")


def load_existing_ids(slug):
    """Look up existing IDs. For abxtac, fall back to legacy filename."""
    p = ids_path(slug)
    if os.path.exists(p):
        with open(p) as f:
            data = json.load(f)
        return {r["slug"]: r for r in data}
    if slug == "abxtac" and os.path.exists(legacy_ids_path()):
        with open(legacy_ids_path()) as f:
            data = json.load(f)
        return {r["slug"]: r for r in data}
    return {}


# ---------- MAIN ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("brand", choices=sorted(BRANDS.keys()))
    parser.add_argument("--local-only", action="store_true", help="Render to disk, skip GHL sync")
    parser.add_argument("--force-create", action="store_true", help="Ignore existing IDs, create fresh")
    args = parser.parse_args()

    brand = BRANDS[args.brand]
    env = load_env()

    api_key = env.get(brand["ghl_api_key_env"], "")
    location_id = env.get(brand["ghl_location_env"], "")
    user_id = brand.get("ghl_user_id", "")

    existing_ids = {} if args.force_create else load_existing_ids(args.brand)

    results = []
    for fn in TEMPLATES:
        cfg = fn(brand)
        html = render_shell(brand, cfg["subject"], cfg["preview"], cfg["sections"])
        out_path = os.path.join(DOCS_DIR, f"{brand['slug']}-{cfg['slug']}.html")
        with open(out_path, "w") as f:
            f.write(html)
        print(f"\n### {cfg['slug']}: wrote {out_path} ({len(html)} bytes)")

        if args.local_only:
            results.append({"slug": cfg["slug"], "name": cfg["name"], "subject": cfg["subject"], "local_only": True})
            continue

        if not api_key or not location_id:
            print(f"  SKIP (missing {brand['ghl_api_key_env']} or {brand['ghl_location_env']})")
            results.append({"slug": cfg["slug"], "name": cfg["name"], "subject": cfg["subject"], "skipped": "missing env"})
            continue
        if not user_id:
            print(f"  SKIP (no ghl_user_id set in brand config for {args.brand})")
            results.append({"slug": cfg["slug"], "name": cfg["name"], "subject": cfg["subject"], "skipped": "missing user_id"})
            continue

        prior = existing_ids.get(cfg["slug"])
        if prior and prior.get("id"):
            print(f"  UPDATE IN PLACE id={prior['id']}")
            info, err = update_template(
                api_key, location_id, user_id, prior["id"],
                cfg["name"], cfg["subject"], cfg["preview"], html,
            )
        else:
            print(f"  CREATE fresh template")
            info, err = create_template(
                api_key, location_id, user_id,
                cfg["name"], cfg["subject"], cfg["preview"], html,
            )
        if err:
            print(f"  !! {err}")
            results.append({"slug": cfg["slug"], "name": cfg["name"], "subject": cfg["subject"], "error": err})
            continue
        print(f"  OK id={info['id']}")
        print(f"  preview: {info.get('previewUrl')}")
        results.append({
            "slug": cfg["slug"],
            "name": cfg["name"],
            "subject": cfg["subject"],
            "id": info["id"],
            "previewUrl": info.get("previewUrl"),
        })

    # Only persist the ID mapping when we actually touched GHL and got IDs.
    # --local-only must never clobber the canonical mapping.
    if args.local_only:
        print(f"\n(--local-only: not writing {ids_path(args.brand)})")
    else:
        out_ids = ids_path(args.brand)
        with open(out_ids, "w") as f:
            json.dump(results, f, indent=2)
        print(f"\nSaved summary: {out_ids}")

    print("\nSUMMARY:")
    for r in results:
        if r.get("error"):
            print(f"  [ERR]  {r['name']}: {r['error']}")
        elif r.get("skipped"):
            print(f"  [SKIP] {r['name']}: {r['skipped']}")
        elif r.get("local_only"):
            print(f"  [LOCAL] {r['name']}")
        else:
            print(f"  [OK]   {r['name']:<42}  id={r['id']}")


if __name__ == "__main__":
    main()
