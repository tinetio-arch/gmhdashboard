#!/usr/bin/env python3
"""Update Healthie appointment type available_contact_types via GraphQL contact_type_override fields."""
import json
import os
import sys
import urllib.request

# Load API key from .env.local
api_key = None
with open("/home/ec2-user/gmhdashboard/.env.local") as f:
    for line in f:
        if line.startswith("HEALTHIE_API_KEY="):
            api_key = line.strip().split("=", 1)[1]
            break

if not api_key:
    print("ERROR: HEALTHIE_API_KEY not found")
    sys.exit(1)

URL = "https://api.gethealthie.com/graphql"
HEADERS = {
    "Authorization": f"Basic {api_key}",
    "AuthorizationSource": "API",
    "Content-Type": "application/json",
}

def gql_request(query):
    payload = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(URL, data=payload, headers=HEADERS, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))

# Groups: map to which contact_type_overrides to enable
# "Healthie Video Call" = video_chat, "In Person" = in_person
groups = [
    {
        "label": "Healthie Video Call only",
        "video_chat": True,
        "in_person": False,
        "phone_call": False,
        "ids": [505646, 519749, 519753, 519754, 519755, 519756, 519757, 519758, 519760, 519761, 519762, 519766, 519771],
    },
    {
        "label": "In Person only",
        "video_chat": False,
        "in_person": True,
        "phone_call": False,
        "ids": [504759, 504760, 505647, 505648, 519768, 519770],
    },
    {
        "label": "Healthie Video Call + In Person",
        "video_chat": True,
        "in_person": True,
        "phone_call": False,
        "ids": [504715, 504717, 519759, 519763, 519764, 519765],
    },
]

results = {"success": [], "failed": []}

for group in groups:
    vc = str(group["video_chat"]).lower()
    ip = str(group["in_person"]).lower()
    pc = str(group["phone_call"]).lower()
    print(f"\n{'='*70}")
    print(f"GROUP: {group['label']} (video={vc}, in_person={ip}, phone={pc})")
    print(f"IDs: {group['ids']}")
    print(f"{'='*70}")

    for appt_id in group["ids"]:
        mutation = f'''mutation {{
  updateAppointmentType(input: {{
    id: "{appt_id}",
    contact_type_override_video_chat: {{ show: {vc} }},
    contact_type_override_in_person: {{ show: {ip} }},
    contact_type_override_phone_call: {{ show: {pc} }}
  }}) {{
    appointmentType {{
      id
      name
      available_contact_types
    }}
    messages {{
      field
      message
    }}
  }}
}}'''
        try:
            data = gql_request(mutation)
            if "errors" in data:
                print(f"  FAIL ID {appt_id}: {data['errors'][0]['message']}")
                results["failed"].append({"id": appt_id, "error": data["errors"][0]["message"]})
                continue

            at = data["data"]["updateAppointmentType"]
            apt = at["appointmentType"]
            msgs = at.get("messages", [])

            if msgs:
                print(f"  FAIL ID {appt_id}: {msgs}")
                results["failed"].append({"id": appt_id, "messages": msgs})
            else:
                ct = apt.get("available_contact_types", [])
                print(f"  OK   ID {apt['id']:>6s} | {apt['name']:<55s} | {ct}")
                results["success"].append({"id": apt["id"], "name": apt["name"], "contact_types": ct})

        except Exception as e:
            print(f"  ERROR ID {appt_id}: {e}")
            results["failed"].append({"id": appt_id, "error": str(e)})

print(f"\n{'='*70}")
print(f"SUMMARY: {len(results['success'])} succeeded, {len(results['failed'])} failed")
if results["failed"]:
    for f in results["failed"]:
        print(f"  FAILED: {f}")
print(f"{'='*70}")

# Verification
print("\n\nVERIFICATION: Fetching all appointment types...")
data = gql_request("{ appointmentTypes { id name available_contact_types } }")
if "errors" in data:
    print(f"Verification error: {data['errors']}")
else:
    all_ids = set()
    for g in groups:
        all_ids.update(str(i) for i in g["ids"])
    appt_types = data["data"]["appointmentTypes"]
    print(f"\n{'ID':<10} {'Name':<55} {'Contact Types'}")
    print("-" * 120)
    for at in sorted(appt_types, key=lambda x: x["id"]):
        if at["id"] in all_ids:
            print(f"{at['id']:<10} {at.get('name','N/A'):<55} {at.get('available_contact_types')}")
