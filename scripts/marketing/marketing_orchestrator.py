"""
Marketing Content Orchestrator
Main service that ties together content generation, approval, and distribution

This is the primary entry point for the marketing automation system.
"""

import os
import sys
import json
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from pathlib import Path

# Add parent directory for imports
sys.path.insert(0, str(Path(__file__).parent))

from content_generator import ContentGenerator, ContentType, Platform, ContentPiece
from marketing_approver import MarketingApprover
from ghl_marketing_client import GHLMarketingClient

from dotenv import load_dotenv
load_dotenv('/home/ec2-user/.env.production')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class MarketingOrchestrator:
    """
    Main orchestrator for the marketing automation system
    
    Coordinates:
    - Content generation via Vertex AI
    - Human approval via Telegram
    - Distribution via GHL
    """
    
    def __init__(self):
        # Initialize components
        self.generator = ContentGenerator()
        self.approver = MarketingApprover(
            on_approve=self._handle_approved_content,
            on_reject=self._handle_rejected_content
        )
        self.ghl_client = GHLMarketingClient()
        
        # Content queue (approved content awaiting distribution)
        self.publish_queue: List[ContentPiece] = []
        
        # State storage
        self.state_file = Path(__file__).parent / 'orchestrator_state.json'
        self._load_state()
        
        logger.info("✅ MarketingOrchestrator initialized")
    
    def _load_state(self):
        """Load orchestrator state from file"""
        if self.state_file.exists():
            with open(self.state_file, 'r') as f:
                self.state = json.load(f)
        else:
            self.state = {
                'content_generated': 0,
                'content_approved': 0,
                'content_rejected': 0,
                'content_published': 0,
                'last_run': None
            }
    
    def _save_state(self):
        """Save orchestrator state to file"""
        with open(self.state_file, 'w') as f:
            json.dump(self.state, f, indent=2, default=str)
    
    def _handle_approved_content(self, content_id: str, pending):
        """Callback when content is approved via Telegram"""
        logger.info(f"✅ Content approved: {content_id}")
        self.state['content_approved'] += 1
        self._save_state()
        
        # Add to publish queue
        # In a real implementation, this would trigger actual publishing
        logger.info(f"📤 Queued for publishing: {pending.platform}")
    
    def _handle_rejected_content(self, content_id: str, pending):
        """Callback when content is rejected via Telegram"""
        logger.info(f"❌ Content rejected: {content_id}")
        self.state['content_rejected'] += 1
        self._save_state()
    
    async def generate_and_request_approval(
        self,
        topic: str,
        platform: Platform,
        content_type: ContentType = ContentType.EDUCATIONAL
    ) -> Optional[ContentPiece]:
        """
        Generate content and send for approval
        
        Args:
            topic: Content topic
            platform: Target platform
            content_type: Type of content
            
        Returns:
            ContentPiece if generated successfully
        """
        # Generate content
        content = self.generator.generate_content(
            content_type=content_type,
            platform=platform,
            topic=topic
        )
        
        self.state['content_generated'] += 1
        self._save_state()
        
        # Send for approval
        success = await self.approver.send_for_approval(
            content_id=content.id,
            platform=content.platform.value,
            content_type=content.content_type.value,
            body=content.body,
            topic=topic
        )
        
        if success:
            return content
        else:
            logger.error("❌ Failed to send content for approval")
            return None
    
    def generate_and_request_approval_sync(
        self,
        topic: str,
        platform: Platform,
        content_type: ContentType = ContentType.EDUCATIONAL
    ) -> Optional[ContentPiece]:
        """Synchronous wrapper for generate_and_request_approval"""
        return asyncio.run(
            self.generate_and_request_approval(topic, platform, content_type)
        )
    
    async def run_daily_content(self):
        """
        Generate daily content based on the weekly theme
        
        This is meant to run once daily (e.g., via cron)
        """
        import yaml
        
        # Load prompts to get weekly themes
        prompts_path = Path(__file__).parent / 'content_prompts.yaml'
        with open(prompts_path, 'r') as f:
            prompts = yaml.safe_load(f)
        
        # Get today's theme
        weekday_names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
        today = weekday_names[datetime.now().weekday()]
        theme = prompts.get('weekly_themes', {}).get(today, {})
        
        if not theme:
            logger.warning(f"⚠️ No theme for {today}")
            return
        
        topic = theme.get('focus', 'General wellness')
        content_type_str = theme.get('content_type', 'educational')
        content_type = ContentType(content_type_str)
        
        logger.info(f"📅 Running daily content for {today}: {theme.get('theme')}")
        
        # Generate for multiple platforms
        platforms = [Platform.SMS, Platform.FACEBOOK]
        
        for platform in platforms:
            try:
                await self.generate_and_request_approval(
                    topic=topic,
                    platform=platform,
                    content_type=content_type
                )
                await asyncio.sleep(2)  # Brief delay between generations
            except Exception as e:
                logger.error(f"❌ Failed to generate for {platform.value}: {e}")
        
        self.state['last_run'] = datetime.now().isoformat()
        self._save_state()
    
    def publish_approved_content(self, content: ContentPiece, target_tag: str = "existing") -> bool:
        """
        Publish approved content to GHL
        
        Args:
            content: The approved content piece
            target_tag: GHL tag to target (default: existing patients)
            
        Returns:
            True if published successfully
        """
        if content.platform == Platform.SMS:
            # Send SMS campaign
            result = self.ghl_client.send_sms_campaign(
                tag=target_tag,
                message=content.body,
                personalize=True
            )
            success = result.get('sent', 0) > 0
            
        elif content.platform == Platform.EMAIL:
            # Send email campaign
            contacts = self.ghl_client.get_contacts_by_tag(target_tag)
            success = False
            for contact in contacts[:10]:  # Limit for safety
                if self.ghl_client.send_email(
                    contact_id=contact.get('id'),
                    subject=content.title or "NOW Men's Health Update",
                    body=content.body
                ):
                    success = True
                    
        elif content.platform in [Platform.FACEBOOK, Platform.INSTAGRAM, Platform.GOOGLE_BUSINESS]:
            # Social media post
            post_id = self.ghl_client.create_social_post(
                platform=content.platform.value,
                content=content.body
            )
            success = post_id is not None
            
        else:
            logger.warning(f"⚠️ Unsupported platform for publishing: {content.platform}")
            success = False
        
        if success:
            content.published_at = datetime.now()
            self.state['content_published'] += 1
            self._save_state()
            logger.info(f"✅ Published content to {content.platform.value}")
        
        return success
    
    def get_stats(self) -> Dict[str, Any]:
        """Get orchestrator statistics"""
        return {
            'generated': self.state.get('content_generated', 0),
            'approved': self.state.get('content_approved', 0),
            'rejected': self.state.get('content_rejected', 0),
            'published': self.state.get('content_published', 0),
            'approval_rate': (
                self.state.get('content_approved', 0) / 
                max(1, self.state.get('content_generated', 1))
            ) * 100,
            'last_run': self.state.get('last_run')
        }


async def demo_workflow():
    """Demonstrate the full marketing workflow"""
    print("\n" + "="*60)
    print("🚀 MARKETING SYSTEM DEMO")
    print("="*60 + "\n")
    
    orchestrator = MarketingOrchestrator()
    
    # Generate content for different platforms
    test_cases = [
        ("Low T Symptoms - Are you experiencing fatigue?", Platform.SMS, ContentType.EDUCATIONAL),
        ("TRT Benefits for Men Over 40", Platform.FACEBOOK, ContentType.EDUCATIONAL),
        ("January New Patient Special", Platform.EMAIL, ContentType.PROMOTIONAL),
    ]
    
    for topic, platform, content_type in test_cases:
        print(f"\n📝 Generating: {topic}")
        print(f"   Platform: {platform.value}")
        print(f"   Type: {content_type.value}")
        
        try:
            content = await orchestrator.generate_and_request_approval(
                topic=topic,
                platform=platform,
                content_type=content_type
            )
            
            if content:
                print(f"   ✅ Generated ({len(content.body)} chars)")
                print(f"   📤 Sent to Telegram for approval")
            else:
                print(f"   ❌ Generation failed")
                
        except Exception as e:
            print(f"   ❌ Error: {e}")
        
        await asyncio.sleep(2)
    
    # Show stats
    stats = orchestrator.get_stats()
    print("\n" + "-"*40)
    print("📊 Session Stats:")
    print(f"   Generated: {stats['generated']}")
    print(f"   Approved: {stats['approved']}")
    print(f"   Rejected: {stats['rejected']}")
    print(f"   Published: {stats['published']}")
    
    print("\n" + "="*60)
    print("✅ Demo complete! Check Telegram for approval requests.")
    print("="*60 + "\n")


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Marketing System Orchestrator')
    parser.add_argument('command', choices=['demo', 'daily', 'stats', 'generate'],
                       help='Command to run')
    parser.add_argument('--topic', type=str, help='Topic for content generation')
    parser.add_argument('--platform', type=str, default='sms',
                       choices=['sms', 'email', 'facebook', 'instagram'],
                       help='Target platform')
    parser.add_argument('--type', type=str, default='educational',
                       choices=['educational', 'promotional', 'engagement'],
                       help='Content type')
    
    args = parser.parse_args()
    
    if args.command == 'demo':
        asyncio.run(demo_workflow())
        
    elif args.command == 'daily':
        orchestrator = MarketingOrchestrator()
        asyncio.run(orchestrator.run_daily_content())
        
    elif args.command == 'stats':
        orchestrator = MarketingOrchestrator()
        stats = orchestrator.get_stats()
        print("\n📊 Marketing System Stats:")
        for key, value in stats.items():
            if isinstance(value, float):
                print(f"   {key}: {value:.1f}%")
            else:
                print(f"   {key}: {value}")
        print()
        
    elif args.command == 'generate':
        if not args.topic:
            print("❌ --topic is required for generate command")
            sys.exit(1)
            
        orchestrator = MarketingOrchestrator()
        platform = Platform(args.platform)
        content_type = ContentType(args.type)
        
        content = orchestrator.generate_and_request_approval_sync(
            topic=args.topic,
            platform=platform,
            content_type=content_type
        )
        
        if content:
            print(f"\n✅ Content generated and sent for approval!")
            print(f"ID: {content.id}")
            print(f"Check Telegram for approval request.")
        else:
            print("❌ Content generation failed")


if __name__ == "__main__":
    main()
