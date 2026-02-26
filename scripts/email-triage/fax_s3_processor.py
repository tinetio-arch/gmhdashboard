#!/usr/bin/env python3
"""
Fax S3 Processor - Monitors S3 bucket for incoming faxes from SES
Extracts PDF attachments, summarizes with AI, posts to Google Chat
"""

import os
import sys
import json
import time
import email
import base64
import requests
from datetime import datetime
from typing import Optional, Dict, Any, List
import boto3
from botocore.config import Config
import psycopg2
from psycopg2.extras import Json

# Load environment variables from .env file
from dotenv import load_dotenv
load_dotenv('/home/ec2-user/.env')

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))
from fax_pdf_processor import FaxPDFProcessor

# Configuration
S3_BUCKET = 'gmh-incoming-faxes-east1'
S3_PREFIX = 'incoming/'
CHECK_INTERVAL = 60  # Check every 60 seconds
PROCESSED_LOG = '/home/ec2-user/gmhdashboard/data/processed-faxes.json'

# Google Chat webhooks for smart routing
WEBHOOKS = {
    'CLINICAL': 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI',
    'OPS_BILLING': 'https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA',
    'PATIENT_OUTREACH': 'https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A',
    'EXEC_FINANCE': 'https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8'
}

# Fax type to chat space routing
FAX_TYPE_ROUTING = {
    'lab_result': 'CLINICAL',
    'referral': 'CLINICAL',
    'medical_records': 'CLINICAL',
    'prescription': 'CLINICAL',
    'prior_auth': 'OPS_BILLING',
    'billing': 'OPS_BILLING',
    'insurance': 'OPS_BILLING',
    'other': 'CLINICAL'  # Default to clinical
}

# Gemini API for summarization
GEMINI_API_KEY = os.environ.get('GOOGLE_AI_API_KEY', '')
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

# Database config
DB_CONFIG = {
    'host': os.environ.get('DATABASE_HOST', 'clinic-pg.cbkcu8m4geoo.us-east-2.rds.amazonaws.com'),
    'database': os.environ.get('DATABASE_NAME', 'postgres'),
    'user': os.environ.get('DATABASE_USER', 'clinicadmin'),
    'password': os.environ.get('DATABASE_PASSWORD', ''),
    'sslmode': 'require'
}

class FaxS3Processor:
    def __init__(self):
        # S3 client for incoming faxes bucket (us-east-1)
        self.s3 = boto3.client('s3', region_name='us-east-1', config=Config(signature_version='s3v4'))
        # S3 client for clinical data lake bucket (us-east-2)
        self.s3_east2 = boto3.client('s3', region_name='us-east-2', config=Config(signature_version='s3v4'))
        self.pdf_processor = FaxPDFProcessor()
        self.processed_keys = self.load_processed_keys()
    
    def load_processed_keys(self) -> set:
        """Load already processed S3 keys"""
        if os.path.exists(PROCESSED_LOG):
            with open(PROCESSED_LOG, 'r') as f:
                data = json.load(f)
                return set(data.get('processed_keys', []))
        return set()
    
    def save_processed_key(self, key: str):
        """Save S3 key as processed"""
        self.processed_keys.add(key)
        data = {'processed_keys': list(self.processed_keys)[-500:]}  # Keep last 500
        os.makedirs(os.path.dirname(PROCESSED_LOG), exist_ok=True)
        with open(PROCESSED_LOG, 'w') as f:
            json.dump(data, f, indent=2)
    
    def list_new_faxes(self) -> List[str]:
        """List unprocessed fax emails in S3"""
        try:
            response = self.s3.list_objects_v2(
                Bucket=S3_BUCKET,
                Prefix=S3_PREFIX,
                MaxKeys=50
            )
            
            keys = []
            for obj in response.get('Contents', []):
                key = obj['Key']
                if key not in self.processed_keys and not key.endswith('/'):
                    keys.append(key)
            
            return keys
        except Exception as e:
            print(f"❌ Error listing S3 objects: {e}")
            return []
    
    def download_email(self, key: str) -> Optional[bytes]:
        """Download raw email from S3"""
        try:
            response = self.s3.get_object(Bucket=S3_BUCKET, Key=key)
            return response['Body'].read()
        except Exception as e:
            print(f"❌ Error downloading {key}: {e}")
            return None
    
    def parse_email(self, raw_email: bytes) -> Dict[str, Any]:
        """Parse email and extract attachments"""
        msg = email.message_from_bytes(raw_email)
        
        result = {
            'from': msg.get('From', ''),
            'subject': msg.get('Subject', ''),
            'date': msg.get('Date', ''),
            'body': '',
            'attachments': []
        }
        
        # Extract body and attachments
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                content_disposition = str(part.get('Content-Disposition', ''))
                
                # Get PDF attachments
                if 'attachment' in content_disposition or content_type == 'application/pdf':
                    filename = part.get_filename() or 'fax.pdf'
                    payload = part.get_payload(decode=True)
                    if payload:
                        result['attachments'].append({
                            'filename': filename,
                            'data': payload,
                            'size': len(payload),
                            'type': 'pdf' if filename.lower().endswith('.pdf') or content_type == 'application/pdf' else 'other'
                        })
                
                # Get audio attachments (voicemails)
                elif content_type.startswith('audio/') or any(filename.lower().endswith(ext) for ext in ['.mp3', '.wav', '.ogg', '.m4a'] if (filename := part.get_filename())):
                    filename = part.get_filename() or 'voicemail.mp3'
                    payload = part.get_payload(decode=True)
                    if payload:
                        result['attachments'].append({
                            'filename': filename,
                            'data': payload,
                            'size': len(payload),
                            'type': 'audio'
                        })
                
                
                # Get email body - prefer text/plain but also extract text/html
                elif content_type == 'text/plain':
                    payload = part.get_payload(decode=True)
                    if payload:
                        result['body'] = payload.decode('utf-8', errors='ignore')
                elif content_type == 'text/html' and not result['body']:
                    # Extract HTML if no plain text found
                    payload = part.get_payload(decode=True)
                    if payload:
                        import re
                        html_content = payload.decode('utf-8', errors='ignore')
                        # Strip HTML tags and decode entities
                        text = re.sub(r'<[^>]+>', '', html_content)
                        text = text.replace('&nbsp;', ' ').replace('&amp;', '&')
                        text = text.replace('&lt;', '<').replace('&gt;', '>')
                        text = text.replace('&quot;', '"').replace('&#39;', "'")
                        result['body'] = text.strip()
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                result['body'] = payload.decode('utf-8', errors='ignore')
        
        return result
    
    def summarize_with_ai(self, fax_text: str, from_email: str, subject: str) -> Dict[str, Any]:
        """Use Gemini to summarize fax content"""
        if not GEMINI_API_KEY:
            return {
                'summary': 'AI summarization unavailable - missing API key',
                'patient_name': None,
                'urgency': 'medium',
                'fax_type': 'unknown'
            }
        
        prompt = f"""You are analyzing a fax received at a medical practice. Extract key information and provide a concise summary.

Fax Details:
- From: {from_email}
- Subject: {subject}

Fax Content:
{fax_text[:8000]}

Respond with valid JSON only:
{{
    "summary": "2-3 sentence summary of what this fax contains and any required actions",
    "patient_name": "Patient name if found, otherwise null",
    "sending_facility": "Name of sending facility/office if found",
    "urgency": "low|medium|high|critical",
    "fax_type": "lab_result|referral|medical_records|prior_auth|prescription|other",
    "key_findings": ["finding 1", "finding 2"]
}}"""
        
        try:
            response = requests.post(
                GEMINI_URL,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.3,
                        "responseMimeType": "application/json"
                    }
                },
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                ai_text = result['candidates'][0]['content']['parts'][0]['text']
                return json.loads(ai_text)
            else:
                print(f"⚠️ Gemini API error: {response.status_code}")
                return {'summary': f'AI error: {response.status_code}', 'urgency': 'medium'}
                
        except Exception as e:
            print(f"⚠️ AI summarization error: {e}")
            return {'summary': 'AI summarization failed', 'urgency': 'medium'}
    
    def upload_to_clinical_bucket(self, pdf_data: bytes, filename: str, s3_key: str) -> Optional[str]:
        """Upload PDF to clinical data lake and return presigned URL"""
        today = datetime.now().strftime('%Y-%m-%d')
        clinical_key = f"faxes/{today}/{s3_key.replace('incoming/', '')}/{filename}"
        clinical_bucket = 'gmh-clinical-data-lake'
        
        try:
            self.s3_east2.put_object(
                Bucket=clinical_bucket,
                Key=clinical_key,
                Body=pdf_data,
                ContentType='application/pdf',
                Metadata={'source': 'fax', 'received': datetime.now().isoformat()}
            )
            
            # Generate presigned URL (7 days) using us-east-2 client
            url = self.s3_east2.generate_presigned_url(
                'get_object',
                Params={'Bucket': clinical_bucket, 'Key': clinical_key},
                ExpiresIn=604800
            )
            return url
        except Exception as e:
            print(f"⚠️ Error uploading to clinical bucket: {e}")
            return None
    
    def upload_audio_to_bucket(self, audio_data: bytes, filename: str, s3_key: str) -> Optional[str]:
        """Upload audio file (voicemail) to clinical data lake and return presigned URL"""
        today = datetime.now().strftime('%Y-%m-%d')
        clinical_key = f"voicemails/{today}/{s3_key.replace('incoming/', '')}/{filename}"
        clinical_bucket = 'gmh-clinical-data-lake'
        
        # Determine content type
        ext = filename.lower().split('.')[-1] if '.' in filename else 'mp3'
        content_types = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'm4a': 'audio/mp4'
        }
        content_type = content_types.get(ext, 'audio/mpeg')
        
        try:
            self.s3_east2.put_object(
                Bucket=clinical_bucket,
                Key=clinical_key,
                Body=audio_data,
                ContentType=content_type,
                Metadata={'source': 'voicemail', 'received': datetime.now().isoformat()}
            )
            
            # Generate presigned URL (7 days) using us-east-2 client
            url = self.s3_east2.generate_presigned_url(
                'get_object',
                Params={'Bucket': clinical_bucket, 'Key': clinical_key},
                ExpiresIn=604800
            )
            return url
        except Exception as e:
            print(f"⚠️ Error uploading audio to bucket: {e}")
            return None
    
    def post_to_google_chat(self, ai_result: Dict, email_data: Dict, attachment_url: Optional[str], full_content: str, audio_url: Optional[str] = None):
        """Post formatted fax alert to Google Chat with smart routing"""
        
        urgency_emoji = {
            'critical': '🚨 CRITICAL',
            'high': '🔴 HIGH',
            'medium': '🟡 MEDIUM',
            'low': '🟢 LOW'
        }
        
        fax_type_emoji = {
            'lab_result': '🧪 Lab Result',
            'referral': '📋 Referral',
            'medical_records': '📁 Medical Records',
            'prior_auth': '📝 Prior Authorization',
            'prescription': '💊 Prescription',
            'billing': '💰 Billing',
            'insurance': '🏥 Insurance',
            'voicemail': '🎤 Voicemail',
            'other': '📠 Fax'
        }
        
        urgency = urgency_emoji.get(ai_result.get('urgency', 'medium'), '🟡 MEDIUM')
        fax_type = ai_result.get('fax_type', 'other')
        fax_type_display = fax_type_emoji.get(fax_type, '📠 Fax')
        
        # Smart routing based on fax type
        route_to = FAX_TYPE_ROUTING.get(fax_type, 'CLINICAL')
        webhook_url = WEBHOOKS.get(route_to, WEBHOOKS['CLINICAL'])
        
        patient_line = ""
        if ai_result.get('patient_name'):
            patient_line = f"\n**Patient:** {ai_result['patient_name']}"
        
        facility_line = ""
        if ai_result.get('sending_facility'):
            facility_line = f"\n**From Facility:** {ai_result['sending_facility']}"
        
        attachment_line = ""
        if attachment_url:
            attachment_line = f"\n\n📄 [**View Full Fax PDF**]({attachment_url})"
        
        # Add audio link if present
        audio_line = ""
        if audio_url:
            audio_line = f"\n\n🎤 [**▶️ Play Voicemail Recording**]({audio_url})"
        
        # Include full content (truncated to 3000 chars for Google Chat limits)
        content_preview = full_content[:3000]
        if len(full_content) > 3000:
            content_preview += "\n... (truncated, see PDF for full content)"
        
        message = f"""📠 **Incoming Fax** - {urgency}

**Type:** {fax_type_display}{patient_line}{facility_line}
**From:** {email_data.get('from', 'Unknown')}
**Subject:** {email_data.get('subject', 'No subject')}

**AI Summary:** {ai_result.get('summary', 'No summary available')}{attachment_line}{audio_line}

---
**Full Content:**
```
{content_preview}
```

_Received at {datetime.now().strftime('%I:%M %p on %b %d, %Y')} • Routed to {route_to}_"""
        
        try:
            response = requests.post(
                webhook_url,
                json={'text': message},
                headers={'Content-Type': 'application/json'},
                timeout=15
            )
            
            if response.status_code == 200:
                print(f"✅ Posted to Google Chat ({route_to})")
                return True
            else:
                print(f"❌ Google Chat error: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Error posting to Google Chat: {e}")
            return False
    
    def process_fax(self, s3_key: str) -> bool:
        """Process a single fax from S3"""
        print(f"\n📠 Processing fax: {s3_key}")
        
        # Download email
        raw_email = self.download_email(s3_key)
        if not raw_email:
            return False
        
        # Parse email
        email_data = self.parse_email(raw_email)
        print(f"   From: {email_data['from']}")
        print(f"   Subject: {email_data['subject']}")
        print(f"   Attachments: {len(email_data['attachments'])}")
        
        # Extract text from PDF attachments - start with email headers and body
        email_context = f"""Email From: {email_data['from']}
Subject: {email_data['subject']}
Date: {email_data['date']}

--- Email Body ---
{email_data.get('body', '(No text body)')}
"""
        
        all_text = email_context
        attachment_url = None
        audio_url = None
        
        for att in email_data['attachments']:
            att_type = att.get('type', 'other')
            
            # Handle PDF attachments
            if att_type == 'pdf' or att['filename'].lower().endswith('.pdf'):
                print(f"   📄 Extracting text from {att['filename']}...")
                
                # Extract text
                text, method = self.pdf_processor.extract_text_from_bytes(att['data'])
                if text:
                    all_text += f"\n\n--- PDF Attachment Content ({method}) ---\n{text}"
                    print(f"   ✓ Extracted {len(text)} chars via {method}")
                else:
                    all_text += f"\n\n--- PDF Attachment: {att['filename']} ---\n(Text extraction failed - see PDF link below)"
                
                # Upload to clinical bucket
                attachment_url = self.upload_to_clinical_bucket(
                    att['data'], att['filename'], s3_key
                )
                if attachment_url:
                    print(f"   ✓ Uploaded PDF to clinical bucket")
            
            # Handle audio attachments (voicemails)
            elif att_type == 'audio':
                print(f"   🎤 Uploading audio: {att['filename']}...")
                audio_url = self.upload_audio_to_bucket(
                    att['data'], att['filename'], s3_key
                )
                if audio_url:
                    print(f"   ✓ Uploaded audio to clinical bucket")
        
        # Summarize with AI
        print("   🤖 Summarizing with AI...")
        ai_result = self.summarize_with_ai(
            all_text, 
            email_data['from'], 
            email_data['subject']
        )
        print(f"   ✓ Summary: {ai_result.get('summary', '')[:100]}...")
        
        # Insert into database for dashboard review
        pdf_s3_key = None
        if attachment_url:
            # Extract S3 key from presigned URL
            pdf_s3_key = attachment_url.split('?')[0].split('.com/')[-1] if attachment_url else None
        
        self.insert_into_fax_queue(
            s3_key=s3_key,
            email_data=email_data,
            ai_result=ai_result,
            full_content=all_text,
            pdf_s3_key=pdf_s3_key
        )
        
        # Post to Google Chat with full content and audio link
        success = self.post_to_google_chat(ai_result, email_data, attachment_url, all_text, audio_url)
        
        return success
    
    def insert_into_fax_queue(self, s3_key: str, email_data: Dict, ai_result: Dict, full_content: str, pdf_s3_key: Optional[str] = None):
        """Insert fax into database queue for dashboard review"""
        try:
            conn = psycopg2.connect(**DB_CONFIG)
            cur = conn.cursor()
            
            cur.execute("""
                INSERT INTO fax_queue (
                    s3_key, from_address, subject, body_text, pdf_s3_key,
                    ai_summary, ai_fax_type, ai_patient_name, ai_sending_facility,
                    ai_urgency, ai_key_findings, status
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending_review')
            """, (
                s3_key,
                email_data.get('from', ''),
                email_data.get('subject', ''),
                full_content[:50000],  # Limit to 50k chars (increased for full email content)
                pdf_s3_key,
                ai_result.get('summary'),
                ai_result.get('fax_type'),
                ai_result.get('patient_name'),
                ai_result.get('sending_facility'),
                ai_result.get('urgency'),
                Json(ai_result.get('key_findings')) if ai_result.get('key_findings') else None
            ))
            
            conn.commit()
            cur.close()
            conn.close()
            print("   ✅ Inserted into fax_queue database")
        except Exception as e:
            print(f"   ⚠️ Database insert failed: {e}")
    
    def run(self):
        """Main processing loop"""
        print("=" * 60)
        print("📠 Fax S3 Processor Starting")
        print("=" * 60)
        print(f"Monitoring: s3://{S3_BUCKET}/{S3_PREFIX}")
        print(f"Posting to: Clinical Alerts (Google Chat)")
        print(f"Check interval: {CHECK_INTERVAL} seconds")
        print("=" * 60)
        print()
        
        while True:
            try:
                # List new faxes
                new_keys = self.list_new_faxes()
                
                if new_keys:
                    print(f"📬 Found {len(new_keys)} new fax(es)")
                    
                    for key in new_keys:
                        success = self.process_fax(key)
                        if success:
                            self.save_processed_key(key)
                            print(f"   ✅ Fax processed successfully")
                        else:
                            print(f"   ⚠️ Fax processing failed, will retry")
                else:
                    print(f"✓ No new faxes ({datetime.now().strftime('%H:%M:%S')})")
                
            except Exception as e:
                print(f"❌ Error in processing loop: {e}")
                import traceback
                traceback.print_exc()
            
            time.sleep(CHECK_INTERVAL)


if __name__ == '__main__':
    processor = FaxS3Processor()
    processor.run()
