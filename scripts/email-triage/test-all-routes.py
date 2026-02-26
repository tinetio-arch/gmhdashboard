#!/usr/bin/env python3
"""Test all 4 Google Chat routing paths"""
import requests
import json
import time

WEBHOOKS = {
    'OPS_BILLING': {
        'url': 'https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA',
        'test': '💰 Test: Payment failed for patient - card declined'
    },
    'EXEC_FINANCE': {
        'url': 'https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8',
        'test': '📊 Test: Weekly revenue down 15% - patient complaints increasing'
    },
    'PATIENT_OUTREACH': {
        'url': 'https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A',
        'test': '👥 Test: Patient hasn\'t responded in 2 weeks - churn risk'
    },
    'CLINICAL': {
        'url': 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI',
        'test': '🏥 Test: Lab results - creatinine 2.8 (elevated)'
    }
}

print("Testing all 4 Google Chat routing paths...\n")
print("=" * 60)

for space_name, config in WEBHOOKS.items():
    print(f"\n📤 Testing: NOW {space_name.replace('_', ' ').title()}")
    
    message = {'text': f"✅ **Routing Test**\n{config['test']}\n\n_AI Email Triage System is working!_"}
    
    response = requests.post(config['url'], json=message)
    
    if response.status_code == 200:
        print(f"   ✅ Posted successfully")
    else:
        print(f"   ❌ Error: {response.status_code}")
    
    time.sleep(1)  # Rate limit protection

print("\n" + "=" * 60)
print("✅ All routing tests complete!")
print("\nCheck each Google Chat space - you should see 4 test messages:")
print("  • NOW Ops & Billing")
print("  • NOW Exec/Finance")
print("  • NOW Patient Outreach")  
print("  • NOW Clinical Alerts")
