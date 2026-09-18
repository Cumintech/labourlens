"""The single source of truth for LabourLens's Privacy Policy content --
served two ways from here: GET /privacy-policy.json (fetched and
rendered natively by the mobile app's PrivacyPolicyScreen) and
GET /privacy-policy (a plain HTML page, publicly reachable, for the
URL Play Console's Data Safety form and App Store Connect's App
Privacy section both require). Editing the text here updates both --
neither the app nor the HTML page hardcodes its own copy.

This is a hosting/reachability fix only: the content below is a
verbatim mirror of what PrivacyPolicyScreen.tsx already said before
this file existed, not a rewrite of what's disclosed.
"""

TITLE = "Privacy Policy"
LAST_UPDATED = "Last updated: 2026"

SECTIONS = [
    {
        "heading": "What we store",
        "body": (
            "Worker Aadhaar numbers are encrypted before they're stored -- only the last 4 digits are ever shown "
            "on screen or in any downloaded form. Attendance, wage rates, and payment records are stored only on "
            "your own factory's account and are never shared with any other factory owner."
        ),
    },
    {
        "heading": "Worker ID photos",
        "body": (
            "If you generate a worker's ID card, their photo is captured from your camera or photo library, "
            "compressed on your device, and stored the same way as their other records -- scoped to your "
            "factory's account, never shared with any other Labour Lens account. The photo is used only to print "
            "or reprint that worker's ID card and is kept for as long as their other worker records are (see "
            '"How long we keep it" below).'
        ),
    },
    {
        "heading": "Who can see it",
        "body": (
            "Only your own login can see your factory's data. Every record is scoped to your account on the "
            "server -- no other Labour Lens account can query or view it."
        ),
    },
    {
        "heading": "Where it goes",
        "body": (
            "Data stays on this app's backend unless you explicitly download or email a form or report yourself. "
            "We don't sell or share worker data with advertisers or other third parties."
        ),
    },
    {
        "heading": "App Lock PIN",
        "body": (
            "If you turn on App Lock, your 4-digit PIN is stored only on this device, in its secure "
            "hardware-backed storage (Android Keystore / iOS Keychain) -- it's never sent to our servers."
        ),
    },
    {
        "heading": "How long we keep it",
        "body": (
            "Worker records, attendance, wage, and compliance data are kept for as long as your factory's account "
            "is active, and afterward for as long as the Tamil Nadu Factories Act requires factories to retain "
            "these statutory registers -- deactivating a worker does not delete their record, since the law "
            "requires the register to keep showing everyone who has ever been employed. If you close your "
            "account, we retain data only as long as the law requires before deleting it. Your consent to this "
            "policy, and when you gave it, is itself kept as a record of that consent."
        ),
    },
    {
        "heading": "Your control",
        "body": (
            "You can deactivate a worker's record at any time from the app. Contact us via Help & Support if you "
            "need a worker's data corrected or removed, or if you have questions about how long a specific record "
            "will be kept."
        ),
    },
]


def render_html() -> str:
    sections_html = "\n".join(
        f"<h2>{s['heading']}</h2>\n<p>{s['body']}</p>" for s in SECTIONS
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITLE} — Labour Lens</title>
<style>
  html {{ background: #FFFFFF; color-scheme: light; }}
  body {{ font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 20px 64px; background: #FFFFFF; color: #1B2340; line-height: 1.5; }}
  h1 {{ font-size: 24px; margin-bottom: 4px; }}
  .updated {{ font-size: 13px; color: #6B7280; margin-bottom: 24px; }}
  h2 {{ font-size: 16px; margin-top: 28px; margin-bottom: 6px; }}
  p {{ font-size: 14px; color: #374151; margin: 0; }}
</style>
</head>
<body>
<h1>{TITLE}</h1>
<p class="updated">{LAST_UPDATED}</p>
{sections_html}
</body>
</html>
"""
