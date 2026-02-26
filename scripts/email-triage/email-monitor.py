#!/usr/bin/env python3
"""
Email Monitor for hello@nowoptimal.com
Checks inbox every 2 minutes, processes emails with AI, routes to Google Chat
"""

import os
import json
import time
import base64
from datetime import datetime
from email.mime.text import MIMEText
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
import pickle

# Gmail API scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

# Configuration
EMAIL_ADDRESS = 'hello@nowoptimal.com'
CHECK_INTERVAL = 600  # 10 minutes
PROCESSED_LOG = '/home/ec2-user/gmhdashboard/data/processed-emails.json'
CREDENTIALS_FILE = '/home/ec2-user/gmhdashboard/config/gmail-credentials.json'
TOKEN_FILE = '/home/ec2-user/gmhdashboard/config/gmail-token.pickle'

class EmailMonitor:
    def __init__(self):
        self.service = None
        self.processed_ids = self.load_processed_ids()
        
    def load_processed_ids(self):
        """Load list of already processed email IDs"""
        if os.path.exists(PROCESSED_LOG):
            with open(PROCESSED_LOG, 'r') as f:
                data = json.load(f)
                return set(data.get('processed_ids', []))
        return set()
    
    def save_processed_id(self, email_id):
        """Save email ID as processed"""
        self.processed_ids.add(email_id)
        
        data = {'processed_ids': list(self.processed_ids)}
        os.makedirs(os.path.dirname(PROCESSED_LOG), exist_ok=True)
        
        with open(PROCESSED_LOG, 'w') as f:
            json.dump(data, f, indent=2)
    
    def authenticate(self):
        """Authenticate with Gmail API"""
        creds = None
        
        # Load existing token
        if os.path.exists(TOKEN_FILE):
            with open(TOKEN_FILE, 'rb') as token:
                creds = pickle.load(token)
        
        # If no valid credentials, authenticate
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                if not os.path.exists(CREDENTIALS_FILE):
                    print(f"❌ Credentials file not found: {CREDENTIALS_FILE}")
                    print("\nTo set up Gmail API:")
                    print("1. Go to https://console.cloud.google.com")
                    print("2. Enable Gmail API")
                    print("3. Create OAuth 2.0 credentials")
                    print("4. Download and save as gmail-credentials.json")
                    return False
                
                flow = InstalledAppFlow.from_client_secrets_file(
                    CREDENTIALS_FILE, SCOPES)
                creds = flow.run_local_server(port=0)
            
            # Save credentials
            os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
            with open(TOKEN_FILE, 'wb') as token:
                pickle.dump(creds, token)
        
        self.service = build('gmail', 'v1', credentials=creds)
        print("✅ Authenticated with Gmail API")
        return True
    
    def get_unread_emails(self):
        """Fetch unread emails from inbox"""
        try:
            results = self.service.users().messages().list(
                userId='me',
                q='is:unread',
                maxResults=50
            ).execute()
            
            messages = results.get('messages', [])
            return messages
            
        except Exception as e:
            print(f"❌ Error fetching emails: {e}")
            return []
    
    def get_email_details(self, msg_id):
        """Get full email details including body and attachments"""
        try:
            message = self.service.users().messages().get(
                userId='me',
                id=msg_id,
                format='full'
            ).execute()
            
            headers = message['payload']['headers']
            
            # Extract key headers
            subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '')
            from_email = next((h['value'] for h in headers if h['name'] == 'From'), '')
            date = next((h['value'] for h in headers if h['name'] == 'Date'), '')
            
            # Get body
            body = self.get_body(message['payload'])
            
            # Get attachments
            attachments = self.get_attachments(msg_id, message['payload'])
            
            return {
                'id': msg_id,
                'subject': subject,
                'from': from_email,
                'date': date,
                'body': body,
                'attachments': attachments,
                'snippet': message.get('snippet', '')
            }
            
        except Exception as e:
            print(f"❌ Error getting email details: {e}")
            return None
    
    def get_body(self, payload):
        """Extract email body from payload"""
        body = ''
        
        if 'parts' in payload:
            for part in payload['parts']:
                if part['mimeType'] == 'text/plain':
                    if 'data' in part['body']:
                        body = base64.urlsafe_b64decode(
                            part['body']['data']).decode('utf-8')
                        break
                elif part['mimeType'] == 'text/html' and not body:
                    if 'data' in part['body']:
                        body = base64.urlsafe_b64decode(
                            part['body']['data']).decode('utf-8')
        elif 'body' in payload and 'data' in payload['body']:
            body = base64.urlsafe_b64decode(
                payload['body']['data']).decode('utf-8')
        
        return body
    
    def get_attachments(self, msg_id, payload):
        """Download email attachments"""
        attachments = []
        
        if 'parts' not in payload:
            return attachments
        
        for part in payload['parts']:
            if part.get('filename'):
                attachment_id = part['body'].get('attachmentId')
                
                if attachment_id:
                    attachment = self.service.users().messages().attachments().get(
                        userId='me',
                        messageId=msg_id,
                        id=attachment_id
                    ).execute()
                    
                    file_data = base64.urlsafe_b64decode(
                        attachment['data'])
                    
                    attachments.append({
                        'filename': part['filename'],
                        'mimeType': part['mimeType'],
                        'size': part['body']['size'],
                        'data': file_data
                    })
        
        return attachments
    
    def mark_as_read(self, msg_id):
        """Mark email as read"""
        try:
            self.service.users().messages().modify(
                userId='me',
                id=msg_id,
                body={'removeLabelIds': ['UNREAD']}
            ).execute()
        except Exception as e:
            print(f"⚠️  Could not mark as read: {e}")
    
    def archive_email(self, msg_id):
        """Archive email (remove from inbox)"""
        try:
            self.service.users().messages().modify(
                userId='me',
                id=msg_id,
                body={'removeLabelIds': ['INBOX']}
            ).execute()
        except Exception as e:
            print(f"⚠️  Could not archive: {e}")
    
    def process_email(self, email_data):
        """Process single email with AI classification and route to Google Chat"""
        print(f"\n📧 New Email:")
        print(f"   From: {email_data['from']}")
        print(f"   Subject: {email_data['subject']}")
        print(f"   Body: {email_data['body'][:100]}...")
        print(f"   Attachments: {len(email_data['attachments'])}")
        
        try:
            # Import modules directly for better data passing
            import sys
            sys.path.insert(0, '/home/ec2-user/gmhdashboard/scripts/email-triage')
            
            from email_classifier import EmailClassifier
            from google_chat_poster import post_to_google_chat
            
            # Check for Access Medical Labs FIRST (special handling)
            from_lower = email_data['from'].lower()
            subject_lower = email_data['subject'].lower()
            
            is_access_labs = any(pattern in from_lower for pattern in [
                'accessmedicallabs', 'accesslabs', 'access medical'
            ]) or 'access medical labs' in subject_lower
            
            if is_access_labs:
                print("   🧪 Detected: Access Medical Labs - special processing")
                
                # Check for PDF attachments
                pdf_attachments = [a for a in email_data['attachments'] 
                                   if a.get('mimeType') == 'application/pdf']
                
                if pdf_attachments:
                    # Process with Access Labs handler
                    try:
                        from access_labs_processor import AccessLabsProcessor
                        processor = AccessLabsProcessor()
                        
                        for pdf_att in pdf_attachments:
                            print(f"   📄 Processing PDF: {pdf_att['filename']}")
                            processor.process_pdf(
                                pdf_bytes=pdf_att['data'],
                                filename=pdf_att['filename'],
                                email_id=email_data['id']
                            )
                        
                        print("   ✓ Access Labs PDFs queued for provider review")
                        return True
                        
                    except ImportError:
                        print("   ⚠️  Access Labs processor not yet implemented, using standard flow")
                    except Exception as e:
                        print(f"   ⚠️  Access Labs processing error: {e}, using standard flow")
            
            # Standard AI classification
            classifier = EmailClassifier()
            classification = classifier.classify(
                email_data['body'], 
                email_data['subject'], 
                email_data['from']
            )
            
            print(f"   ✓ Classified as: {classification['category']}")
            print(f"   ✓ Urgency: {classification['urgency']}")
            print(f"   ✓ Confidence: {classification['confidence']}")
            
            # Prepare attachments for Google Chat (exclude binary data for JSON serialization)
            attachments_metadata = []
            for att in email_data['attachments']:
                attachments_metadata.append({
                    'filename': att.get('filename', 'attachment'),
                    'mimeType': att.get('mimeType', 'application/octet-stream'),
                    'size': att.get('size', len(att.get('data', b''))),
                    'data': att.get('data')  # Binary data for S3 upload
                })
            
            # Post to Google Chat with attachments
            success = post_to_google_chat(
                category=classification['category'],
                subject=email_data['subject'],
                from_email=email_data['from'],
                body=email_data['body'],
                summary=classification['summary'],
                urgency=classification['urgency'],
                attachments=attachments_metadata if attachments_metadata else None,
                msg_id=email_data['id']
            )
            
            if not success:
                print(f"⚠️  Google Chat posting failed")
                return False
            
            print(f"   ✓ Posted to Google Chat: {classification['category']} space")
            return True
            
        except Exception as e:
            print(f"❌ Error processing email: {e}")
            import traceback
            traceback.print_exc()
            return False

    
    def run(self):
        """Main monitoring loop"""
        if not self.authenticate():
            return
        
        print(f"\n🔄 Starting email monitor for {EMAIL_ADDRESS}")
        print(f"   Checking every {CHECK_INTERVAL} seconds\n")
        
        while True:
            try:
                # Get unread emails
                messages = self.get_unread_emails()
                
                if messages:
                    print(f"📬 Found {len(messages)} unread emails")
                    
                    for msg in messages:
                        msg_id = msg['id']
                        
                        # Skip if already processed
                        if msg_id in self.processed_ids:
                            continue
                        
                        # Get full email details
                        email_data = self.get_email_details(msg_id)
                        
                        if email_data:
                            # Process email
                            success = self.process_email(email_data)
                            
                            if success:
                                # Mark as processed
                                self.save_processed_id(msg_id)
                                self.mark_as_read(msg_id)
                                # Optionally archive
                                # self.archive_email(msg_id)
                else:
                    print(f"✓ No new emails ({datetime.now().strftime('%H:%M:%S')})")
                
            except Exception as e:
                print(f"❌ Error in monitoring loop: {e}")
            
            # Wait before next check
            time.sleep(CHECK_INTERVAL)

if __name__ == '__main__':
    monitor = EmailMonitor()
    monitor.run()
