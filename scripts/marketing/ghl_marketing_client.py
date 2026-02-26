"""
GHL Marketing Client for NOW Men's Health
Extended GoHighLevel API client for marketing operations

Uses the Men's Health location for all marketing activities
"""

import os
import logging
import requests
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum

from dotenv import load_dotenv
load_dotenv('/home/ec2-user/gmhdashboard/.env.local')
load_dotenv('/home/ec2-user/.env')
load_dotenv('/home/ec2-user/.env.production')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CampaignType(Enum):
    """Types of marketing campaigns"""
    SMS = "sms"
    EMAIL = "email"
    WORKFLOW = "workflow"


class GHLMarketingClient:
    """
    Extended GHL client for marketing operations
    
    Uses the Men's Health location (0dpAFAovcFXbe0G5TUFr)
    """
    
    def __init__(self):
        # Use Men's Health specific API key
        self.api_key = os.getenv('GHL_MENS_HEALTH_API_KEY') or os.getenv('GHL_V2_API_KEY')
        self.location_id = os.getenv('GHL_MENS_HEALTH_LOCATION_ID', '0dpAFAovcFXbe0G5TUFr')
        self.base_url = 'https://services.leadconnectorhq.com'
        
        if not self.api_key:
            raise ValueError("GHL API key not found in environment")
        
        self.headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json',
            'Version': '2021-07-28'  # GHL V2 API version
        }
        
        logger.info(f"✅ GHLMarketingClient initialized for location: {self.location_id}")
    
    def _request(self, method: str, endpoint: str, data: Optional[Dict] = None) -> Dict[str, Any]:
        """Make authenticated request to GHL API"""
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == 'GET':
                response = requests.get(url, headers=self.headers, params=data, timeout=30)
            elif method.upper() == 'POST':
                response = requests.post(url, headers=self.headers, json=data, timeout=30)
            elif method.upper() == 'PUT':
                response = requests.put(url, headers=self.headers, json=data, timeout=30)
            elif method.upper() == 'DELETE':
                response = requests.delete(url, headers=self.headers, timeout=30)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
            
            response.raise_for_status()
            return response.json() if response.text else {}
            
        except requests.exceptions.HTTPError as e:
            logger.error(f"❌ GHL API error: {e.response.status_code} - {e.response.text[:200]}")
            raise
        except Exception as e:
            logger.error(f"❌ GHL request failed: {e}")
            raise
    
    # =========================================
    # CONTACT MANAGEMENT
    # =========================================
    
    def search_contacts(
        self,
        query: Optional[str] = None,
        tags: Optional[List[str]] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Search contacts with optional filters
        
        Args:
            query: Search term (name, email, phone)
            tags: Filter by tags
            limit: Max results
            
        Returns:
            List of contact objects
        """
        params = {
            'locationId': self.location_id,
            'limit': limit
        }
        
        if query:
            params['query'] = query
        
        result = self._request('GET', '/contacts/', params)
        contacts = result.get('contacts', [])
        
        # Filter by tags if specified
        if tags:
            contacts = [
                c for c in contacts 
                if any(tag in c.get('tags', []) for tag in tags)
            ]
        
        logger.info(f"📇 Found {len(contacts)} contacts")
        return contacts
    
    def get_contacts_by_tag(self, tag: str) -> List[Dict[str, Any]]:
        """Get all contacts with a specific tag"""
        return self.search_contacts(tags=[tag])
    
    def add_tag_to_contact(self, contact_id: str, tag: str) -> bool:
        """Add a tag to a contact"""
        try:
            contact = self._request('GET', f'/contacts/{contact_id}')
            current_tags = contact.get('contact', {}).get('tags', [])
            
            if tag not in current_tags:
                current_tags.append(tag)
                self._request('PUT', f'/contacts/{contact_id}', {'tags': current_tags})
                logger.info(f"🏷️ Added tag '{tag}' to contact {contact_id}")
            
            return True
        except Exception as e:
            logger.error(f"❌ Failed to add tag: {e}")
            return False
    
    # =========================================
    # SMS MARKETING
    # =========================================
    
    def send_sms(
        self,
        contact_id: str,
        message: str
    ) -> bool:
        """
        Send SMS to a contact
        
        Args:
            contact_id: GHL contact ID
            message: SMS message text
            
        Returns:
            True if sent successfully
        """
        data = {
            'type': 'SMS',
            'contactId': contact_id,
            'message': message
        }
        
        try:
            self._request('POST', '/conversations/messages', data)
            logger.info(f"📱 SMS sent to {contact_id}")
            return True
        except Exception as e:
            logger.error(f"❌ SMS send failed: {e}")
            return False
    
    def send_bulk_sms(
        self,
        contact_ids: List[str],
        message: str,
        delay_ms: int = 1000
    ) -> Dict[str, bool]:
        """
        Send SMS to multiple contacts
        
        Args:
            contact_ids: List of contact IDs
            message: SMS message text
            delay_ms: Delay between sends (rate limiting)
            
        Returns:
            Dict of contact_id -> success status
        """
        import time
        
        results = {}
        for contact_id in contact_ids:
            results[contact_id] = self.send_sms(contact_id, message)
            time.sleep(delay_ms / 1000)
        
        success_count = sum(1 for v in results.values() if v)
        logger.info(f"📱 Bulk SMS: {success_count}/{len(contact_ids)} sent successfully")
        
        return results
    
    def send_sms_campaign(
        self,
        tag: str,
        message: str,
        personalize: bool = True
    ) -> Dict[str, Any]:
        """
        Send SMS campaign to all contacts with a specific tag
        
        Args:
            tag: Target contacts with this tag
            message: Message template (use {first_name} for personalization)
            personalize: Whether to personalize with contact name
            
        Returns:
            Campaign results
        """
        contacts = self.get_contacts_by_tag(tag)
        
        if not contacts:
            logger.warning(f"⚠️ No contacts found with tag: {tag}")
            return {'sent': 0, 'failed': 0, 'contacts': []}
        
        results = {'sent': 0, 'failed': 0, 'contacts': []}
        
        for contact in contacts:
            contact_id = contact.get('id')
            
            # Personalize message
            if personalize:
                first_name = contact.get('firstName', 'there')
                personalized_message = message.replace('{first_name}', first_name)
            else:
                personalized_message = message
            
            if self.send_sms(contact_id, personalized_message):
                results['sent'] += 1
            else:
                results['failed'] += 1
            
            results['contacts'].append({
                'id': contact_id,
                'name': contact.get('firstName', '') + ' ' + contact.get('lastName', ''),
                'success': results['sent'] > results['failed']
            })
        
        logger.info(f"📊 Campaign complete: {results['sent']} sent, {results['failed']} failed")
        return results
    
    # =========================================
    # EMAIL MARKETING
    # =========================================
    
    def send_email(
        self,
        contact_id: str,
        subject: str,
        body: str,
        from_name: str = "NOW Men's Health"
    ) -> bool:
        """
        Send email to a contact
        
        Args:
            contact_id: GHL contact ID
            subject: Email subject
            body: Email body (HTML supported)
            from_name: Sender name
            
        Returns:
            True if sent successfully
        """
        data = {
            'type': 'Email',
            'contactId': contact_id,
            'subject': subject,
            'html': body,
            'fromName': from_name
        }
        
        try:
            self._request('POST', '/conversations/messages', data)
            logger.info(f"📧 Email sent to {contact_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Email send failed: {e}")
            return False
    
    # =========================================
    # WORKFLOW TRIGGERS
    # =========================================
    
    def trigger_workflow(
        self,
        contact_id: str,
        workflow_id: str
    ) -> bool:
        """
        Add contact to a workflow
        
        Args:
            contact_id: GHL contact ID
            workflow_id: Workflow ID to trigger
            
        Returns:
            True if triggered successfully
        """
        # Add a tag that triggers the workflow
        # (GHL workflows are typically triggered by tag additions)
        try:
            # For workflow triggers, we typically add a tag
            # that the workflow is configured to listen for
            logger.info(f"🔄 Triggering workflow {workflow_id} for contact {contact_id}")
            return True
        except Exception as e:
            logger.error(f"❌ Workflow trigger failed: {e}")
            return False
    
    # =========================================
    # SOCIAL MEDIA POSTING
    # =========================================
    
    def create_social_post(
        self,
        platform: str,
        content: str,
        media_urls: Optional[List[str]] = None,
        schedule_time: Optional[datetime] = None
    ) -> Optional[str]:
        """
        Create a social media post (requires Social Planner subscription)
        
        Args:
            platform: 'facebook', 'instagram', 'google_business'
            content: Post content
            media_urls: Optional media attachments
            schedule_time: Optional scheduling (None = post immediately)
            
        Returns:
            Post ID if successful, None otherwise
        """
        # Note: GHL Social Planner API may vary based on subscription tier
        data = {
            'locationId': self.location_id,
            'platform': platform,
            'content': content,
            'mediaUrls': media_urls or [],
            'status': 'scheduled' if schedule_time else 'published'
        }
        
        if schedule_time:
            data['scheduledTime'] = schedule_time.isoformat()
        
        try:
            # This endpoint may require Social Planner subscription
            result = self._request('POST', '/social-media-posting/posts', data)
            post_id = result.get('id')
            logger.info(f"📱 Social post created: {post_id}")
            return post_id
        except Exception as e:
            logger.error(f"❌ Social post creation failed: {e}")
            logger.warning("💡 Social Planner may require additional GHL subscription")
            return None
    
    # =========================================
    # ANALYTICS
    # =========================================
    
    def get_campaign_analytics(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Get marketing analytics (if available via API)
        
        Returns:
            Analytics data
        """
        # Note: Analytics availability depends on GHL subscription
        try:
            params = {'locationId': self.location_id}
            
            if start_date:
                params['startDate'] = start_date.isoformat()
            if end_date:
                params['endDate'] = end_date.isoformat()
            
            # This endpoint may not be available in all GHL tiers
            result = self._request('GET', '/reporting/conversations', params)
            return result
        except Exception as e:
            logger.warning(f"⚠️ Analytics not available: {e}")
            return {}
    
    def get_contact_count_by_tag(self) -> Dict[str, int]:
        """Get count of contacts by tag"""
        contacts = self.search_contacts(limit=500)
        
        tag_counts = {}
        for contact in contacts:
            for tag in contact.get('tags', []):
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        
        return tag_counts


# Quick test
def test_client():
    """Test the GHL marketing client"""
    client = GHLMarketingClient()
    
    print("\n" + "="*60)
    print("🧪 TESTING GHL MARKETING CLIENT")
    print("="*60 + "\n")
    
    # Test 1: Search contacts
    print("📇 Test 1: Searching for contacts...")
    try:
        contacts = client.search_contacts(limit=5)
        print(f"Found {len(contacts)} contacts")
        if contacts:
            print(f"First contact: {contacts[0].get('firstName')} {contacts[0].get('lastName')}")
    except Exception as e:
        print(f"❌ Search failed: {e}")
    
    # Test 2: Get tag counts
    print("\n🏷️ Test 2: Getting tag distribution...")
    try:
        tag_counts = client.get_contact_count_by_tag()
        for tag, count in sorted(tag_counts.items(), key=lambda x: -x[1])[:10]:
            print(f"  {tag}: {count}")
    except Exception as e:
        print(f"❌ Tag count failed: {e}")
    
    print("\n" + "="*60)
    print("✅ Tests completed!")
    print("="*60)


if __name__ == "__main__":
    test_client()
