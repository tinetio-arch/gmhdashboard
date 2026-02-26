#!/usr/bin/env python3
"""
Test script to verify AI classification and Google Chat posting
No Gmail required - just tests the core components
"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(__file__))

from email_classifier import EmailClassifier
from google_chat_poster import GoogleChatPoster

def test_classification():
    """Test AI classification with sample emails"""
    
    print("=" * 60)
    print("🧪 Testing AI Email Classification")
    print("=" * 60)
    
    classifier = EmailClassifier()
    poster = GoogleChatPoster()
    
    # Test emails
    tests = [
        {
            'name': 'Lab Results (should → CLINICAL)',
            'email': {
                'from': 'noreply@quest.com',
                'subject': 'Critical Lab Results - Patient Smith',
                'body': 'Patient lab results show creatinine 2.5 (elevated), GFR 42 (decreased). Immediate provider review required.',
                'attachments': [{'filename': 'lab_results.pdf', 'mimeType': 'application/pdf', 'size': 52428}]
            }
        },
        {
            'name': 'Failed Payment (should → OPS_BILLING)',
            'email': {
from': 'billing@stripe.com',
                'subject': 'Payment Failed - Card Declined',
                'body': 'Payment failed for patient appointment. Card ending in 1234 was declined.',
                'attachments': []
            }
        },
        {
            'name': 'Patient Complaint (should → EXEC_FINANCE)',
            'email': {
                'from': 'patient@gmail.com',
                'subject': 'Extremely unhappy with service',
                'body': 'I waited 2 hours for my appointment and the doctor was rushed. This is unacceptable for the price I am paying.',
                'attachments': []
            }
        },
        {
            'name': 'Patient Not Responding (should → PATIENT_OUTREACH)',
            'email': {
                'from': 'staff@nowoptimal.com',
                'subject': 'Patient hasn\'t responded in 2 weeks',
                'body': 'Patient hasn\'t replied to our messages. At risk of churning. Needs human touch.',
                'attachments': []
            }
        }
    ]
    
    for i, test in enumerate(tests, 1):
        print(f"\n{'─' * 60}")
        print(f"Test {i}/{len(tests)}: {test['name']}")
        print(f"{'─' * 60}")
        
        # Classify
        result = classifier.classify(test['email'])
        
        # Show results
        print(f"\n✨ Classification Results:")
        print(f"   Category: {result['category']}")
        print(f"   Confidence: {result['confidence']:.0%}")
        print(f"   Urgency: {result['urgency']}")
        print(f"   Summary: {result['summary']}")
        print(f"   Assignee: {result['suggested_assignee']}")
        print(f"   Key Points:")
        for point in result['key_points']:
            print(f"     • {point}")
        
        # Get webhook
        webhook = classifier.get_webhook(result['category'])
        webhook_name = result['category'].replace('_', ' ').title()
        print(f"\n📤 Would post to: NOW {webhook_name}")
        
        # Ask if user wants to actually post
        print(f"\n🤔 Post to Google Chat? (y/n): ", end='', flush=True)
        try:
            response = input().strip().lower()
            if response == 'y':
                success = poster.post(webhook, result, test['email'])
                if success:
                    print("   ✅ Successfully posted to Google Chat!")
                else:
                    print("   ❌ Failed to post")
            else:
                print("   ⏭️  Skipped posting")
        except:
            print("   ⏭️  Skipped (non-interactive mode)")
    
    print(f"\n{'=' * 60}")
    print("✅ All tests complete!")
    print("=" * 60)

if __name__ == '__main__':
    test_classification()
