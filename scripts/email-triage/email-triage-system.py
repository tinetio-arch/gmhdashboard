#!/usr/bin/env python3
"""
Complete Email Triage System
Monitors hello@nowoptimal.com, classifies with AI, posts to Google Chat
"""

import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(__file__))

from email_monitor import EmailMonitor
from email_classifier import EmailClassifier
from google_chat_poster import GoogleChatPoster

class EmailTriageSystem(EmailMonitor):
    """Extended email monitor with AI classification and Google Chat posting"""
    
    def __init__(self):
        super().__init__()
        self.classifier = EmailClassifier()
        self.poster = GoogleChatPoster()
    
    def process_email(self, email_data):
        """Process email with AI classification and Google Chat posting"""
        print(f"\n📧 Processing Email:")
        print(f"   From: {email_data['from']}")
        print(f"   Subject: {email_data['subject']}")
        
        # Classify with AI
        classification = self.classifier.classify(email_data)
        
        # Get webhook for category
        webhook = self.classifier.get_webhook(classification['category'])
        
        # Post to Google Chat
        success = self.poster.post(webhook, classification, email_data)
        
        if success:
            print(f"   ✅ Successfully processed and routed to {classification['category']}")
        else:
            print(f"   ⚠️  Processed but Google Chat posting failed")
        
        return True

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Email Triage System Starting")
    print("=" * 60)
    print(f"Monitoring: hello@nowoptimal.com")
    print(f"AI: AWS Bedrock (Claude 3.5 Sonnet)")
    print("Routing to 4 Google Chat spaces:")
    print("  • NOW Ops & Billing")
    print("  • NOW Exec/Finance")
    print("  • NOW Patient Outreach")
    print("  • NOW Clinical Alerts")
    print("=" * 60)
    print()
    
    system = EmailTriageSystem()
    system.run()
