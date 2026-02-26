#!/usr/bin/env python3
"""
Test Google AI Gemini API (alternative to Vertex AI)
Uses API key approach instead of service account
"""

import requests
import os

# Get API key from environment or use placeholder
API_KEY = os.environ.get('GOOGLE_AI_API_KEY', 'YOUR_API_KEY_HERE')
MODEL = "gemini-1.5-flash"

def test_gemini_ai_studio():
    """Test Gemini via AI Studio API."""
    print("💬 Testing Gemini via Google AI Studio API...")
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={API_KEY}"
    
    data = {
        "contents": [{
            "parts": [{
                "text": "Respond with exactly: 'Gemini is working!'"
            }]
        }]
    }
    
    response = requests.post(url, json=data)
    
    if response.status_code == 200:
        result = response.json()
        text = result['candidates'][0]['content']['parts'][0]['text']
        print(f"\n✅ Response from Gemini:\n{text}")
        return True
    else:
        print(f"\n❌ Error {response.status_code}:")
        print(response.text[:500])
        return False

def check_vertex_ai_models():
    """List available models in Vertex AI."""
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    
    print("\n🔍 Checking available Vertex AI models...")
    
    SERVICE_ACCOUNT_FILE = "/home/ec2-user/notebooklm-sync/service-account-key.json"
    PROJECT_ID = "constant-rig-481816-j0"
    
    credentials = service_account.Credentials.from_service_account_file(
        SERVICE_ACCOUNT_FILE,
        scopes=['https://www.googleapis.com/auth/cloud-platform']
    )
    credentials.refresh(Request())
    
    # Try listing models
    url = f"https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models"
    
    headers = {
        "Authorization": f"Bearer {credentials.token}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(url, headers=headers)
    
    if response.status_code == 200:
        models = response.json()
        print("Available models:")
        for model in models.get('models', []):
            print(f"  - {model.get('name')}")
    else:
        print(f"Error listing models: {response.status_code}")
        print(response.text[:300])

if __name__ == "__main__":
    # First check what models are available
    check_vertex_ai_models()
    
    # Then test AI Studio if API key is set
    if API_KEY != 'YOUR_API_KEY_HERE':
        test_gemini_ai_studio()
    else:
        print("\n💡 To test via AI Studio, set GOOGLE_AI_API_KEY environment variable")
        print("   Get a key at: https://aistudio.google.com/apikey")
