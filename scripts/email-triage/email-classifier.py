#!/usr/bin/env python3
"""
Email Classifier using Google Gemini 2.0 Flash
Analyzes email content and routes to appropriate Google Chat space
"""

import json
import requests
import os
import sys
from typing import Dict, Any
from dotenv import load_dotenv

# Load environment variables
env_path = os.path.expanduser('/home/ec2-user/.env')
if not os.path.exists(env_path):
    # Fallback for dev environment or different structure
    env_path = os.path.join(os.path.dirname(__file__), '../../../.env')
load_dotenv(env_path)

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

# Webhooks
WEBHOOKS = {
    'OPS_BILLING': 'https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA',
    'EXEC_FINANCE': 'https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8',
    'PATIENT_OUTREACH': 'https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A',
    'CLINICAL': 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI'
}

BASE_PROMPT = """You are an intelligent email router for a medical practice. Analyze this email and classify it into ONE category:

1. OPS_BILLING: Billing, payments, insurance, claims, scheduling issues, no-shows, cancellations
2. EXEC_FINANCE: KPIs, revenue, financial decisions, patient complaints, leadership matters
3. PATIENT_OUTREACH: Retention, engagement, human touch needed, follow-up requests
4. CLINICAL: Lab results, vitals, medications, clinical follow-ups, faxed medical reports

Email:
From: {from_email}
Subject: {subject}
Body: {body}

Respond ONLY with valid JSON (no markdown):
{{
  "category": "OPS_BILLING" | "EXEC_FINANCE" | "PATIENT_OUTREACH" | "CLINICAL",
  "confidence": 0.0-1.0,
  "summary": "2-3 sentence action-oriented summary",
  "suggested_assignee": "name or role",
  "urgency": "low" | "medium" | "high" | "critical",
  "key_points": ["point 1", "point 2", "point 3"],
  "reasoning": "why this category"
}}"""

class EmailClassifier:
    def __init__(self):
        self.api_key = os.environ.get('GOOGLE_AI_API_KEY')
        if not self.api_key:
            print("⚠️ Warning: GOOGLE_AI_API_KEY not found in environment")
            
        self.model = 'gemini-2.0-flash'
        self.api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
    
    def classify(self, email_body: str, subject: str, from_email: str) -> Dict[str, Any]:
        """Classify email using Gemini"""
        
        if not self.api_key:
            return self._error_result("Missing API Key")

        prompt = BASE_PROMPT.format(
            from_email=from_email,
            subject=subject,
            body=email_body[:5000]  # Increased context size for Gemini
        )
        
        try:
            payload = {
                "contents": [{
                    "parts": [{"text": prompt}]
                }],
                "generationConfig": {
                    "temperature": 0.3,
                    "responseMimeType": "application/json"
                }
            }
            
            response = requests.post(self.api_url, json=payload, headers={'Content-Type': 'application/json'})
            
            if response.status_code != 200:
                raise Exception(f"API Error {response.status_code}: {response.text}")
                
            result_json = response.json()
            
            # Extract text content
            try:
                ai_text = result_json['candidates'][0]['content']['parts'][0]['text']
                result = json.loads(ai_text)
                # Gemini sometimes wraps the JSON in an array — unwrap it
                if isinstance(result, list) and len(result) > 0:
                    result = result[0]
                return result
            except (KeyError, IndexError, json.JSONDecodeError) as e:
                raise Exception(f"Failed to parse AI response: {str(e)}")
            
        except Exception as e:
            print(f"❌ AI classification error: {e}")
            return self._error_result(str(e))
            
    def _error_result(self, error_msg: str) -> Dict[str, Any]:
        return {
            'category': 'EXEC_FINANCE',  # Default safe fallback
            'confidence': 0.0,
            'summary': 'AI classification failed - needs manual review',
            'suggested_assignee': 'Phil',
            'urgency': 'medium',
            'key_points': ['AI error', 'Manual triage needed'],
            'reasoning': f'Error: {error_msg}'
        }
    
    def get_webhook(self, category: str) -> str:
        """Get webhook URL for category"""
        return WEBHOOKS.get(category, WEBHOOKS['EXEC_FINANCE'])

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Usage: email-classifier.py <body> <subject> <from_email>")
        sys.exit(1)
    
    classifier = EmailClassifier()
    result = classifier.classify(sys.argv[1], sys.argv[2], sys.argv[3])
    print(json.dumps(result, indent=2))
