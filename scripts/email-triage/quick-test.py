#!/usr/bin/env python3
"""Quick test of Google Chat webhook"""
import requests
import json

# Clinical Alerts webhook
webhook = 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI'

# Simple test message
message = {
    'text': '🧪 **Test Message from Email Triage System**\n\nIf you see this, the webhook is working!'
}

print("Posting test message to NOW Clinical Alerts...")
response = requests.post(webhook, json=message)

if response.status_code == 200:
    print("✅ SUCCESS! Check your Google Chat space")
else:
    print(f"❌ ERROR: {response.status_code}")
    print(response.text)
