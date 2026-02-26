#!/usr/bin/env python3
"""
Google Chat Poster - Enhanced with Email Attachments
Posts email classifications to Google Chat with S3-hosted attachments
"""

import json
import sys
import os
import requests
import boto3
from typing import Dict, Any, List, Optional
from datetime import datetime
from botocore.config import Config

WEBHOOKS = {
    'OPS_BILLING': 'https://chat.googleapis.com/v1/spaces/AAQAuw3Rvdc/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=DXw_3jUF-tpu-IVQuL2bPj0fC-GuHXJAbwOkKCjGrSA',
    'EXEC_FINANCE': 'https://chat.googleapis.com/v1/spaces/AAQARw60cl0/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=m7E2GmVPaGoNE2mnYyvaRUiEtlRzv9crhs7LqvQmvA8',
    'PATIENT_OUTREACH': 'https://chat.googleapis.com/v1/spaces/AAQAR7R9T3w/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=A8GwUsPKzf7JEqoMaMA0Ova1gqP98vnePcoSYY03N7A',
    'CLINICAL': 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI',
    'CLINICAL_LABS': 'https://chat.googleapis.com/v1/spaces/AAQANhoAdgo/messages?key=AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI&token=qmp8OHOsnK6mr9ERMnMX4Ejn2wLfYOwWO925dMBxFxI'  # Labs go to CLINICAL
}

S3_BUCKET = 'gmh-clinical-data-lake'
S3_PREFIX = 'incoming/emails'

class S3AttachmentHandler:
    """Handles uploading email attachments to S3 and generating presigned URLs"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3', 
            region_name='us-east-2',
            config=Config(signature_version='s3v4')
        )
    
    def upload_attachment(self, msg_id: str, filename: str, file_data: bytes, content_type: str) -> Optional[str]:
        """Upload attachment to S3 and return presigned URL"""
        today = datetime.now().strftime('%Y-%m-%d')
        s3_key = f"{S3_PREFIX}/{today}/{msg_id}/{filename}"
        
        try:
            self.s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=file_data,
                ContentType=content_type,
                Metadata={
                    'email_id': msg_id,
                    'uploaded_at': datetime.now().isoformat()
                }
            )
            
            # Generate presigned URL valid for 7 days
            presigned_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': S3_BUCKET, 'Key': s3_key},
                ExpiresIn=604800  # 7 days
            )
            
            print(f"✅ Uploaded {filename} to S3: {s3_key}")
            return presigned_url
            
        except Exception as e:
            print(f"❌ S3 upload error: {e}")
            return None


def format_file_size(size_bytes: int) -> str:
    """Format file size in human-readable format"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f} MB"


def post_to_google_chat(
    category: str, 
    subject: str, 
    from_email: str, 
    body: str, 
    summary: str, 
    urgency: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    msg_id: Optional[str] = None
) -> bool:
    """Post email to Google Chat with optional attachments"""
    
    webhook_url = WEBHOOKS.get(category, WEBHOOKS['EXEC_FINANCE'])
    
    # Map category to emoji
    category_emoji = {
        'OPS_BILLING': '💰',
        'EXEC_FINANCE': '📊',
        'PATIENT_OUTREACH': '👥',
        'CLINICAL': '🏥',
        'CLINICAL_LABS': '🧪'
    }
    emoji = category_emoji.get(category, '📧')
    
    # Map urgency to indicator
    urgency_indicators = {
        'critical': '🚨 CRITICAL',
        'high': '🔴 HIGH',
        'medium': '🟡 MEDIUM',
        'low': '🟢 LOW'
    }
    urgency_text = urgency_indicators.get(urgency, urgency.upper())
    
    # Build attachment section
    attachment_section = ""
    if attachments and msg_id:
        s3_handler = S3AttachmentHandler()
        attachment_lines = []
        
        for att in attachments:
            filename = att.get('filename', 'attachment')
            file_size = format_file_size(att.get('size', 0))
            mime_type = att.get('mimeType', 'application/octet-stream')
            file_data = att.get('data')
            
            if file_data:
                url = s3_handler.upload_attachment(msg_id, filename, file_data, mime_type)
                if url:
                    # PDF icon for PDFs, paperclip for others
                    icon = "📄" if 'pdf' in mime_type.lower() else "📎"
                    attachment_lines.append(f"{icon} [{filename}]({url}) ({file_size})")
                else:
                    attachment_lines.append(f"📎 {filename} ({file_size}) - upload failed")
            else:
                attachment_lines.append(f"📎 {filename} ({file_size})")
        
        if attachment_lines:
            attachment_section = "\n\n**Attachments:**\n" + "\n".join(attachment_lines)
    
    # Truncate body for preview
    body_preview = body[:800] if len(body) > 800 else body
    if len(body) > 800:
        body_preview += "..."
    
    # Build message
    message = {
        'text': f"""{emoji} **{category.replace('_', ' ').title()}** - {urgency_text}

**From:** {from_email}
**Subject:** {subject}

**AI Summary:** {summary}

**Email Preview:**
```
{body_preview}
```
{attachment_section}

_Classified at {datetime.now().strftime('%I:%M %p on %b %d')}_"""
    }
    
    try:
        response = requests.post(
            webhook_url,
            json=message,
            headers={'Content-Type': 'application/json'},
            timeout=15
        )
        
        print(f"DEBUG: Status Code: {response.status_code}")
        print(f"DEBUG: Response: {response.text[:200]}")
        
        if response.status_code == 200:
            print(f"✅ Posted to Google Chat: {category}")
            return True
        else:
            print(f"❌ Google Chat error: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Error posting to Google Chat: {e}")
        return False


if __name__ == '__main__':
    # Support both old (6 args) and new (with attachments JSON) calling conventions
    if len(sys.argv) < 7:
        print("Usage: google-chat-poster.py <category> <subject> <from> <body> <summary> <urgency> [attachments_json] [msg_id]")
        sys.exit(1)
    
    category = sys.argv[1]
    subject = sys.argv[2]
    from_email = sys.argv[3]
    body = sys.argv[4]
    summary = sys.argv[5]
    urgency = sys.argv[6]
    
    attachments = None
    msg_id = None
    
    if len(sys.argv) > 7:
        try:
            attachments = json.loads(sys.argv[7])
        except:
            attachments = None
    
    if len(sys.argv) > 8:
        msg_id = sys.argv[8]
    
    success = post_to_google_chat(category, subject, from_email, body, summary, urgency, attachments, msg_id)
    sys.exit(0 if success else 1)
