"""
NowMensHealth.Care AI Content Generator
Uses Vertex AI (Gemini 2.0) for agentic marketing content generation

This module generates marketing content for multiple platforms:
- SMS campaigns
- Email marketing
- Social media posts
- Google Business Profile updates
"""

import os
import json
import logging
import yaml
import requests
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass
from enum import Enum

# Load environment variables from multiple locations
from dotenv import load_dotenv
load_dotenv('/home/ec2-user/gmhdashboard/.env.local')
load_dotenv('/home/ec2-user/.env')
load_dotenv('/home/ec2-user/.env.production')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class ContentType(Enum):
    """Types of marketing content"""
    EDUCATIONAL = "educational"
    PROMOTIONAL = "promotional"
    ENGAGEMENT = "engagement"
    REMINDER = "reminder"


class Platform(Enum):
    """Distribution platforms"""
    SMS = "sms"
    EMAIL = "email"
    FACEBOOK = "facebook"
    INSTAGRAM = "instagram"
    GOOGLE_BUSINESS = "google_business"
    LINKEDIN = "linkedin"


@dataclass
class ContentPiece:
    """Represents a generated piece of content"""
    id: str
    content_type: ContentType
    platform: Platform
    title: Optional[str]
    body: str
    hashtags: Optional[List[str]]
    call_to_action: Optional[str]
    target_audience: str
    generated_at: datetime
    approved: bool = False
    published_at: Optional[datetime] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            'id': self.id,
            'content_type': self.content_type.value,
            'platform': self.platform.value,
            'title': self.title,
            'body': self.body,
            'hashtags': self.hashtags,
            'call_to_action': self.call_to_action,
            'target_audience': self.target_audience,
            'generated_at': self.generated_at.isoformat(),
            'approved': self.approved,
            'published_at': self.published_at.isoformat() if self.published_at else None
        }


class ContentGenerator:
    """AI-powered content generator using Vertex AI / Gemini"""
    
    # Platform character limits
    PLATFORM_LIMITS = {
        Platform.SMS: 160,
        Platform.EMAIL: 5000,
        Platform.FACEBOOK: 2200,
        Platform.INSTAGRAM: 2200,
        Platform.GOOGLE_BUSINESS: 1500,
        Platform.LINKEDIN: 3000
    }
    
    def __init__(self):
        self.api_key = os.getenv('GOOGLE_AI_API_KEY')
        self.model = "gemini-2.0-flash"
        self.prompts = self._load_prompts()
        
        if not self.api_key:
            raise ValueError("GOOGLE_AI_API_KEY not found in environment")
        
        logger.info("✅ ContentGenerator initialized with Gemini 2.0 Flash")
    
    def _load_prompts(self) -> Dict[str, Any]:
        """Load prompt templates from YAML file"""
        prompts_path = Path(__file__).parent / 'content_prompts.yaml'
        
        if prompts_path.exists():
            with open(prompts_path, 'r') as f:
                return yaml.safe_load(f)
        else:
            logger.warning("Prompts file not found, using defaults")
            return self._get_default_prompts()
    
    def _get_default_prompts(self) -> Dict[str, Any]:
        """Default prompts if YAML file not found"""
        return {
            'brand_voice': {
                'tone': 'professional, confident, caring, discrete',
                'clinic_name': 'NOW Men\'s Health',
                'phone': '928-212-2772',
                'website': 'nowmenshealth.care',
                'location': 'Prescott, Arizona',
                'tagline': 'Optimize Your Health. Reclaim Your Life.',
            },
            'services': {
                'trt': 'Testosterone Replacement Therapy',
                'weight_loss': 'Medical Weight Loss (GLP-1)',
                'iv_therapy': 'IV Hydration & Vitamin Therapy',
                'sexual_health': 'Sexual Health & ED Treatment',
            }
        }
    
    def _call_gemini(self, prompt: str, max_tokens: int = 500) -> str:
        """Call Gemini API for content generation"""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent?key={self.api_key}"
        
        payload = {
            "contents": [{
                "parts": [{
                    "text": prompt
                }]
            }],
            "generationConfig": {
                "temperature": 0.7,
                "maxOutputTokens": max_tokens,
                "topP": 0.9,
            },
            "safetySettings": [
                {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
                {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_MEDIUM_AND_ABOVE"},
            ]
        }
        
        try:
            response = requests.post(url, json=payload, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            text = result['candidates'][0]['content']['parts'][0]['text']
            return text.strip()
            
        except Exception as e:
            logger.error(f"❌ Gemini API call failed: {e}")
            raise
    
    def _build_system_prompt(self, content_type: ContentType, platform: Platform) -> str:
        """Build the system prompt for content generation"""
        brand = self.prompts.get('brand_voice', {})
        char_limit = self.PLATFORM_LIMITS[platform]
        
        # Extract values to avoid backslashes in f-string
        clinic_name = brand.get('clinic_name', "NOW Men's Health")
        location = brand.get('location', 'Prescott, Arizona')
        tone = brand.get('tone', 'professional, confident, caring, discrete')
        tagline = brand.get('tagline', 'Optimize Your Health. Reclaim Your Life.')
        phone = brand.get('phone', '928-212-2772')
        website = brand.get('website', 'nowmenshealth.care')
        platform_upper = platform.value.upper()
        content_type_upper = content_type.value.upper()
        
        prompt = f"""You are a marketing content creator for {clinic_name}, 
a men's health clinic in {location}.

BRAND VOICE:
- Tone: {tone}
- Tagline: {tagline}
- Phone: {phone}
- Website: {website}

SERVICES OFFERED:
- Testosterone Replacement Therapy (TRT) - for Low T symptoms
- Medical Weight Loss - GLP-1 medications like Semaglutide
- IV Hydration & Vitamin Therapy - recovery and wellness
- Sexual Health & ED Treatment - discrete, effective solutions

CONTENT REQUIREMENTS:
- Platform: {platform_upper}
- Content Type: {content_type_upper}
- Maximum Length: {char_limit} characters
- HIPAA Compliance: Never mention specific patient information
- Be discrete about sensitive topics (ED, sexual health)
- Include a clear call-to-action when appropriate
- Be encouraging and solution-focused

FORMAT:
Return ONLY the content text itself. No explanations, no markdown formatting.
For social posts, you may include relevant hashtags at the end."""
        
        return prompt
    
    def generate_content(
        self,
        content_type: ContentType,
        platform: Platform,
        topic: str,
        target_audience: str = "men 35-65",
        additional_context: Optional[str] = None
    ) -> ContentPiece:
        """
        Generate marketing content for a specific platform and type
        
        Args:
            content_type: Type of content (educational, promotional, etc.)
            platform: Target platform (SMS, email, social, etc.)
            topic: The main topic/service to focus on
            target_audience: Description of target audience
            additional_context: Any additional context for the AI
            
        Returns:
            ContentPiece with generated content
        """
        system_prompt = self._build_system_prompt(content_type, platform)
        
        user_prompt = f"""Create a {content_type.value} {platform.value} post about: {topic}

Target Audience: {target_audience}
"""
        if additional_context:
            user_prompt += f"Additional Context: {additional_context}\n"
        
        user_prompt += f"""
Remember:
- Stay within {self.PLATFORM_LIMITS[platform]} characters
- Match the brand voice
- Include a call-to-action if appropriate
- Be HIPAA compliant - no specific patient info"""
        
        full_prompt = f"{system_prompt}\n\n{user_prompt}"
        
        logger.info(f"🤖 Generating {content_type.value} content for {platform.value}: {topic}")
        
        generated_text = self._call_gemini(full_prompt)
        
        # Extract hashtags if present (for social platforms)
        hashtags = None
        if platform in [Platform.FACEBOOK, Platform.INSTAGRAM, Platform.LINKEDIN]:
            import re
            hashtag_pattern = r'#\w+'
            hashtags = re.findall(hashtag_pattern, generated_text)
        
        # Generate unique ID
        content_id = f"content_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{platform.value}"
        
        content_piece = ContentPiece(
            id=content_id,
            content_type=content_type,
            platform=platform,
            title=topic if platform == Platform.EMAIL else None,
            body=generated_text,
            hashtags=hashtags,
            call_to_action=None,  # Could be extracted from text
            target_audience=target_audience,
            generated_at=datetime.now()
        )
        
        logger.info(f"✅ Generated content ({len(generated_text)} chars): {content_id}")
        
        return content_piece
    
    def generate_campaign_batch(
        self,
        topic: str,
        platforms: List[Platform],
        content_type: ContentType = ContentType.EDUCATIONAL
    ) -> List[ContentPiece]:
        """
        Generate content for multiple platforms at once
        
        Args:
            topic: The campaign topic
            platforms: List of platforms to generate for
            content_type: Type of content
            
        Returns:
            List of ContentPiece objects
        """
        content_pieces = []
        
        for platform in platforms:
            try:
                piece = self.generate_content(
                    content_type=content_type,
                    platform=platform,
                    topic=topic
                )
                content_pieces.append(piece)
            except Exception as e:
                logger.error(f"❌ Failed to generate for {platform.value}: {e}")
        
        return content_pieces
    
    def generate_weekly_content_plan(self) -> List[Dict[str, Any]]:
        """
        Generate a week's worth of content suggestions
        
        Returns content plan with topics and platforms for each day
        """
        plan_prompt = """Create a 7-day marketing content calendar for a men's health clinic.

Services: TRT, Weight Loss, IV Therapy, Sexual Health

For each day, suggest:
1. Topic/Theme
2. Content Type (educational, promotional, engagement)
3. Best platform(s)
4. Brief description of the content

Format as JSON array with objects containing: day, topic, content_type, platforms, description

Focus on:
- Monday: Motivation/New week energy
- Tuesday-Thursday: Educational content
- Friday: Weekend wellness tips
- Saturday: Engagement/Community
- Sunday: Rest/Reflection

Return ONLY valid JSON, no markdown."""
        
        try:
            response = self._call_gemini(plan_prompt, max_tokens=1500)
            
            # Try to parse JSON
            # Clean up response if needed
            response = response.strip()
            if response.startswith('```'):
                response = response.split('```')[1]
                if response.startswith('json'):
                    response = response[4:]
            
            plan = json.loads(response)
            logger.info(f"✅ Generated weekly content plan with {len(plan)} items")
            return plan
            
        except json.JSONDecodeError as e:
            logger.error(f"❌ Failed to parse content plan JSON: {e}")
            return []
        except Exception as e:
            logger.error(f"❌ Failed to generate content plan: {e}")
            return []


# Quick test function
def test_generator():
    """Test the content generator"""
    generator = ContentGenerator()
    
    print("\n" + "="*60)
    print("🧪 TESTING CONTENT GENERATOR")
    print("="*60 + "\n")
    
    # Test 1: Generate SMS content
    print("📱 Test 1: Generating SMS content...")
    sms_content = generator.generate_content(
        content_type=ContentType.EDUCATIONAL,
        platform=Platform.SMS,
        topic="Low T Symptoms Awareness"
    )
    print(f"SMS ({len(sms_content.body)} chars):\n{sms_content.body}\n")
    
    # Test 2: Generate Facebook post
    print("📘 Test 2: Generating Facebook post...")
    fb_content = generator.generate_content(
        content_type=ContentType.EDUCATIONAL,
        platform=Platform.FACEBOOK,
        topic="Benefits of TRT for Men Over 40"
    )
    print(f"Facebook ({len(fb_content.body)} chars):\n{fb_content.body}\n")
    
    # Test 3: Generate email content
    print("📧 Test 3: Generating Email content...")
    email_content = generator.generate_content(
        content_type=ContentType.PROMOTIONAL,
        platform=Platform.EMAIL,
        topic="January New Patient Special - Free TRT Consultation"
    )
    print(f"Email ({len(email_content.body)} chars):\n{email_content.body}\n")
    
    print("="*60)
    print("✅ All tests completed!")
    print("="*60)


if __name__ == "__main__":
    test_generator()
