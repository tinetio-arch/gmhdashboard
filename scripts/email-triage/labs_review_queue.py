#!/usr/bin/env python3
"""
Labs Review Queue Manager
Handles provider approval workflow for lab results before Healthie upload
"""

import os
import json
import boto3
import requests
from datetime import datetime
from typing import Dict, Any, List, Optional

# Configuration
S3_BUCKET = 'gmh-clinical-data-lake'
REVIEW_QUEUE_FILE = '/home/ec2-user/gmhdashboard/data/labs-review-queue.json'
HEALTHIE_API_URL = 'https://api.gethealthie.com/graphql'


class LabsReviewQueue:
    """
    Manages pending lab results awaiting provider review:
    - Loads/saves review queue from JSON
    - Supports approve/reject/edit actions
    - Uploads to Healthie on approval
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3', region_name='us-east-2')
        self.healthie_api_key = os.environ.get('HEALTHIE_API_KEY')
        
        if not self.healthie_api_key:
            # Try loading from .env.production
            try:
                from dotenv import load_dotenv
                load_dotenv('/home/ec2-user/.env.production')
                self.healthie_api_key = os.environ.get('HEALTHIE_API_KEY')
            except:
                pass
    
    def load_queue(self) -> List[Dict[str, Any]]:
        """Load review queue from file"""
        if os.path.exists(REVIEW_QUEUE_FILE):
            try:
                with open(REVIEW_QUEUE_FILE, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []
    
    def save_queue(self, queue: List[Dict[str, Any]]) -> None:
        """Save review queue to file"""
        os.makedirs(os.path.dirname(REVIEW_QUEUE_FILE), exist_ok=True)
        with open(REVIEW_QUEUE_FILE, 'w') as f:
            json.dump(queue, f, indent=2)
    
    def get_pending_items(self) -> List[Dict[str, Any]]:
        """Get all items pending review"""
        queue = self.load_queue()
        return [item for item in queue if item.get('status') == 'pending_review']
    
    def get_item(self, item_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific queue item by ID"""
        queue = self.load_queue()
        return next((item for item in queue if item['id'] == item_id), None)
    
    def update_item(self, item_id: str, updates: Dict[str, Any]) -> bool:
        """Update a queue item"""
        queue = self.load_queue()
        
        for item in queue:
            if item['id'] == item_id:
                item.update(updates)
                item['updated_at'] = datetime.now().isoformat()
                self.save_queue(queue)
                return True
        
        return False
    
    def approve(self, item_id: str, corrected_patient_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Approve a lab result for upload to Healthie.
        
        Args:
            item_id: Queue item ID
            corrected_patient_id: If provided, use this Healthie patient ID instead of auto-matched
        
        Returns:
            Result dict with success status and document ID
        """
        item = self.get_item(item_id)
        if not item:
            return {'success': False, 'error': 'Item not found'}
        
        # Use corrected patient ID if provided, otherwise use matched
        patient_id = corrected_patient_id or item.get('healthie_id')
        
        if not patient_id:
            return {'success': False, 'error': 'No patient ID available. Please select a patient.'}
        
        # Load PDF bytes
        pdf_path = item.get('pdf_path')
        if not pdf_path or not os.path.exists(pdf_path):
            return {'success': False, 'error': 'PDF file not found'}
        
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()
        
        # Generate filename
        patient_name = item.get('patient_name', 'Unknown').replace(',', '').replace(' ', '_')
        collection_date = item.get('collection_date', datetime.now().strftime('%Y-%m-%d'))
        filename = f"Lab_Results_{patient_name}_{collection_date}.pdf"
        
        # Upload to Healthie
        result = self.upload_to_healthie(patient_id, pdf_bytes, filename)
        
        if result.get('success'):
            # Update queue item status
            self.update_item(item_id, {
                'status': 'approved',
                'uploaded_at': datetime.now().isoformat(),
                'healthie_document_id': result.get('document_id'),
                'final_patient_id': patient_id
            })
            
            # Clean up local PDF
            try:
                os.remove(pdf_path)
            except:
                pass
        
        return result
    
    def reject(self, item_id: str, reason: str = '') -> bool:
        """Reject a lab result (won't be uploaded)"""
        return self.update_item(item_id, {
            'status': 'rejected',
            'rejection_reason': reason
        })
    
    def upload_to_healthie(self, patient_id: str, pdf_bytes: bytes, filename: str) -> Dict[str, Any]:
        """Upload PDF document to patient's Healthie chart"""
        if not self.healthie_api_key:
            return {'success': False, 'error': 'HEALTHIE_API_KEY not configured'}
        
        import base64
        
        # Encode PDF as base64
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        mutation = '''
mutation CreateDocument($input: createDocumentInput!) {
    createDocument(input: $input) {
        document {
            id
            display_name
        }
        messages {
            field
            message
        }
    }
}
'''
        
        variables = {
            "input": {
                "rel_user_id": patient_id,
                "display_name": filename,
                "file_string": f"data:application/pdf;base64,{pdf_base64}",
                "description": "Lab results uploaded via automated email processing",
                "share_with_rel": True  # Share with patient portal
            }
        }
        
        headers = {
            "Authorization": f"Basic {self.healthie_api_key}",
            "AuthorizationSource": "API",
            "Content-Type": "application/json"
        }
        
        try:
            response = requests.post(
                HEALTHIE_API_URL,
                json={"query": mutation, "variables": variables},
                headers=headers,
                timeout=30
            )
            result = response.json()
            
            if result.get('data', {}).get('createDocument', {}).get('document'):
                doc_id = result['data']['createDocument']['document']['id']
                print(f"✅ Uploaded to Healthie: {filename} (ID: {doc_id})")
                return {'success': True, 'document_id': doc_id}
            else:
                error = result.get('errors', result.get('data', {}).get('createDocument', {}).get('messages', []))
                print(f"❌ Healthie upload failed: {error}")
                return {'success': False, 'error': str(error)}
                
        except Exception as e:
            print(f"❌ Healthie request error: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_presigned_url(self, item_id: str) -> Optional[str]:
        """Get presigned URL for viewing a lab PDF"""
        item = self.get_item(item_id)
        if not item or not item.get('s3_key'):
            return None
        
        try:
            url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': S3_BUCKET, 'Key': item['s3_key']},
                ExpiresIn=3600
            )
            return url
        except:
            return None


# Telegram callback handler integration
def handle_telegram_callback(callback_data: str) -> str:
    """
    Handle Telegram inline button callbacks for lab review.
    
    Callback format: labs_approve_<item_id> or labs_reject_<item_id> or labs_select_<item_id>_<patient_index>
    """
    queue = LabsReviewQueue()
    
    if callback_data.startswith('labs_approve_'):
        item_id = callback_data.replace('labs_approve_', '')
        result = queue.approve(item_id)
        
        if result['success']:
            return f"✅ Lab results uploaded to patient chart!\nDocument ID: {result['document_id']}"
        else:
            return f"❌ Upload failed: {result['error']}"
    
    elif callback_data.startswith('labs_reject_'):
        item_id = callback_data.replace('labs_reject_', '')
        queue.reject(item_id, reason='Rejected by provider')
        return "❌ Lab results rejected and archived."
    
    elif callback_data.startswith('labs_select_'):
        # Format: labs_select_<item_id>_<patient_index>
        parts = callback_data.replace('labs_select_', '').split('_')
        item_id = parts[0]
        patient_index = int(parts[1])
        
        item = queue.get_item(item_id)
        if item and item.get('top_matches') and len(item['top_matches']) > patient_index:
            _, _, patient_id = item['top_matches'][patient_index]
            result = queue.approve(item_id, corrected_patient_id=patient_id)
            
            if result['success']:
                return f"✅ Lab results uploaded to selected patient!\nDocument ID: {result['document_id']}"
            else:
                return f"❌ Upload failed: {result['error']}"
        
        return "❌ Invalid patient selection"
    
    return "❓ Unknown action"


if __name__ == '__main__':
    import sys
    
    queue = LabsReviewQueue()
    
    if len(sys.argv) < 2:
        # Show pending items
        pending = queue.get_pending_items()
        print(f"\n📋 Pending Lab Reviews: {len(pending)}\n")
        
        for item in pending:
            conf_emoji = "🟢" if item.get('match_confidence', 0) >= 0.9 else "🟡" if item.get('match_confidence', 0) >= 0.7 else "🔴"
            print(f"ID: {item['id'][:8]}...")
            print(f"   Patient: {item['patient_name']}")
            print(f"   {conf_emoji} Match: {item.get('matched_name', 'None')} ({item.get('match_confidence', 0):.0%})")
            print(f"   Created: {item.get('created_at', 'Unknown')}")
            print()
    
    elif sys.argv[1] == 'approve':
        item_id = sys.argv[2]
        patient_id = sys.argv[3] if len(sys.argv) > 3 else None
        result = queue.approve(item_id, patient_id)
        print(json.dumps(result, indent=2))
    
    elif sys.argv[1] == 'reject':
        item_id = sys.argv[2]
        reason = sys.argv[3] if len(sys.argv) > 3 else ''
        queue.reject(item_id, reason)
        print("Rejected")
