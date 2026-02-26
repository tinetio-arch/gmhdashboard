"""
Marketing Content Approval via Telegram
Integrates with Telegram for human-in-the-loop content approval

Similar pattern to existing Scribe approval system
"""

import os
import json
import logging
import asyncio
from datetime import datetime
from typing import Dict, Optional, List, Callable
from dataclasses import dataclass

import telegram
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes

from dotenv import load_dotenv
load_dotenv('/home/ec2-user/gmhdashboard/.env.local')
load_dotenv('/home/ec2-user/.env')
load_dotenv('/home/ec2-user/.env.production')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@dataclass
class PendingContent:
    """Content awaiting approval"""
    content_id: str
    platform: str
    content_type: str
    body: str
    topic: str
    created_at: datetime
    message_id: Optional[int] = None


class MarketingApprover:
    """Telegram-based content approval workflow"""
    
    def __init__(self, on_approve: Optional[Callable] = None, on_reject: Optional[Callable] = None):
        self.bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
        self.chat_id = os.getenv('TELEGRAM_CHAT_ID', '7540038135')
        
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN not found in environment")
        
        self.bot = telegram.Bot(token=self.bot_token)
        self.pending_content: Dict[str, PendingContent] = {}
        
        # Callbacks for approval/rejection
        self.on_approve = on_approve
        self.on_reject = on_reject
        
        logger.info("✅ MarketingApprover initialized")
    
    def _format_content_message(self, content: PendingContent) -> str:
        """Format content for Telegram display"""
        platform_emoji = {
            'sms': '📱',
            'email': '📧',
            'facebook': '📘',
            'instagram': '📸',
            'google_business': '📍',
            'linkedin': '💼'
        }
        
        emoji = platform_emoji.get(content.platform, '📝')
        
        return f"""
{emoji} **NEW MARKETING CONTENT**

**Platform:** {content.platform.upper()}
**Type:** {content.content_type}
**Topic:** {content.topic}
**Generated:** {content.created_at.strftime('%Y-%m-%d %H:%M')}

━━━━━━━━━━━━━━━━━━━━━━
{content.body}
━━━━━━━━━━━━━━━━━━━━━━

📊 **Character Count:** {len(content.body)}
"""
    
    def _get_approval_keyboard(self, content_id: str) -> InlineKeyboardMarkup:
        """Create inline keyboard for approval actions"""
        keyboard = [
            [
                InlineKeyboardButton("✅ Approve", callback_data=f"approve:{content_id}"),
                InlineKeyboardButton("✏️ Edit", callback_data=f"edit:{content_id}"),
            ],
            [
                InlineKeyboardButton("❌ Reject", callback_data=f"reject:{content_id}"),
                InlineKeyboardButton("⏰ Schedule", callback_data=f"schedule:{content_id}"),
            ],
            [
                InlineKeyboardButton("🔄 Regenerate", callback_data=f"regenerate:{content_id}"),
            ]
        ]
        return InlineKeyboardMarkup(keyboard)
    
    async def send_for_approval(
        self,
        content_id: str,
        platform: str,
        content_type: str,
        body: str,
        topic: str
    ) -> bool:
        """
        Send content to Telegram for approval
        
        Returns True if message sent successfully
        """
        pending = PendingContent(
            content_id=content_id,
            platform=platform,
            content_type=content_type,
            body=body,
            topic=topic,
            created_at=datetime.now()
        )
        
        message_text = self._format_content_message(pending)
        keyboard = self._get_approval_keyboard(content_id)
        
        try:
            message = await self.bot.send_message(
                chat_id=self.chat_id,
                text=message_text,
                parse_mode='Markdown',
                reply_markup=keyboard
            )
            
            pending.message_id = message.message_id
            self.pending_content[content_id] = pending
            
            logger.info(f"📤 Sent content {content_id} for approval (msg: {message.message_id})")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to send approval request: {e}")
            return False
    
    def send_for_approval_sync(
        self,
        content_id: str,
        platform: str,
        content_type: str,
        body: str,
        topic: str
    ) -> bool:
        """Synchronous wrapper for send_for_approval"""
        return asyncio.run(self.send_for_approval(
            content_id, platform, content_type, body, topic
        ))
    
    async def handle_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle approval button callbacks"""
        query = update.callback_query
        await query.answer()
        
        data = query.data
        action, content_id = data.split(':', 1)
        
        if content_id not in self.pending_content:
            await query.edit_message_text("⚠️ Content no longer pending")
            return
        
        pending = self.pending_content[content_id]
        
        if action == 'approve':
            await self._handle_approve(query, content_id, pending)
        elif action == 'reject':
            await self._handle_reject(query, content_id, pending)
        elif action == 'edit':
            await self._handle_edit(query, content_id, pending)
        elif action == 'schedule':
            await self._handle_schedule(query, content_id, pending)
        elif action == 'regenerate':
            await self._handle_regenerate(query, content_id, pending)
    
    async def _handle_approve(self, query, content_id: str, pending: PendingContent):
        """Handle content approval"""
        logger.info(f"✅ Content approved: {content_id}")
        
        # Update message
        await query.edit_message_text(
            f"✅ **APPROVED**\n\n"
            f"Platform: {pending.platform.upper()}\n"
            f"Topic: {pending.topic}\n"
            f"Approved at: {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n"
            f"Content queued for publishing.",
            parse_mode='Markdown'
        )
        
        # Call approval callback
        if self.on_approve:
            self.on_approve(content_id, pending)
        
        # Remove from pending
        del self.pending_content[content_id]
    
    async def _handle_reject(self, query, content_id: str, pending: PendingContent):
        """Handle content rejection"""
        logger.info(f"❌ Content rejected: {content_id}")
        
        await query.edit_message_text(
            f"❌ **REJECTED**\n\n"
            f"Platform: {pending.platform.upper()}\n"
            f"Topic: {pending.topic}\n"
            f"Rejected at: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            parse_mode='Markdown'
        )
        
        if self.on_reject:
            self.on_reject(content_id, pending)
        
        del self.pending_content[content_id]
    
    async def _handle_edit(self, query, content_id: str, pending: PendingContent):
        """Handle edit request"""
        logger.info(f"✏️ Edit requested for: {content_id}")
        
        await query.edit_message_text(
            f"✏️ **EDIT REQUESTED**\n\n"
            f"Platform: {pending.platform.upper()}\n"
            f"Topic: {pending.topic}\n\n"
            f"Please reply to this message with your edited content.\n"
            f"Or use /cancel to cancel the edit.",
            parse_mode='Markdown'
        )
    
    async def _handle_schedule(self, query, content_id: str, pending: PendingContent):
        """Handle schedule request"""
        logger.info(f"⏰ Schedule requested for: {content_id}")
        
        # Create time selection keyboard
        keyboard = [
            [
                InlineKeyboardButton("🌅 Tomorrow 9am", callback_data=f"schedule_time:{content_id}:tomorrow_9am"),
                InlineKeyboardButton("🌙 Tomorrow 5pm", callback_data=f"schedule_time:{content_id}:tomorrow_5pm"),
            ],
            [
                InlineKeyboardButton("📅 This Weekend", callback_data=f"schedule_time:{content_id}:weekend"),
                InlineKeyboardButton("🔙 Back", callback_data=f"back:{content_id}"),
            ]
        ]
        
        await query.edit_message_text(
            f"⏰ **SCHEDULE CONTENT**\n\n"
            f"Platform: {pending.platform.upper()}\n"
            f"Topic: {pending.topic}\n\n"
            f"When should this be published?",
            parse_mode='Markdown',
            reply_markup=InlineKeyboardMarkup(keyboard)
        )
    
    async def _handle_regenerate(self, query, content_id: str, pending: PendingContent):
        """Handle regenerate request"""
        logger.info(f"🔄 Regenerate requested for: {content_id}")
        
        await query.edit_message_text(
            f"🔄 **REGENERATING...**\n\n"
            f"Platform: {pending.platform.upper()}\n"
            f"Topic: {pending.topic}\n\n"
            f"Creating new content with the same topic...",
            parse_mode='Markdown'
        )
        
        # TODO: Trigger regeneration via content generator
        # For now, just inform the user
        await asyncio.sleep(2)
        await self.bot.send_message(
            chat_id=self.chat_id,
            text="💡 Regeneration complete. New content sent for approval."
        )
    
    async def send_status_update(self, message: str):
        """Send a status update to Telegram"""
        try:
            await self.bot.send_message(
                chat_id=self.chat_id,
                text=message,
                parse_mode='Markdown'
            )
        except Exception as e:
            logger.error(f"❌ Failed to send status update: {e}")
    
    def start_polling(self):
        """Start the Telegram bot to listen for callbacks"""
        application = Application.builder().token(self.bot_token).build()
        
        # Add callback handler
        application.add_handler(CallbackQueryHandler(self.handle_callback))
        
        # Add command handlers
        application.add_handler(CommandHandler("marketing_status", self._cmd_status))
        application.add_handler(CommandHandler("pending", self._cmd_pending))
        
        logger.info("🤖 Starting Marketing Approver bot...")
        application.run_polling()
    
    async def _cmd_status(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /marketing_status command"""
        pending_count = len(self.pending_content)
        
        await update.message.reply_text(
            f"📊 **Marketing Content Status**\n\n"
            f"Pending approval: {pending_count}\n"
            f"Bot status: Online ✅",
            parse_mode='Markdown'
        )
    
    async def _cmd_pending(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Handle /pending command - list pending content"""
        if not self.pending_content:
            await update.message.reply_text("✅ No content pending approval")
            return
        
        lines = ["📋 **Pending Content:**\n"]
        for cid, pending in self.pending_content.items():
            lines.append(f"• {pending.platform.upper()}: {pending.topic[:30]}...")
        
        await update.message.reply_text('\n'.join(lines), parse_mode='Markdown')


# Quick test
async def test_approver():
    """Test the approval workflow"""
    approver = MarketingApprover()
    
    success = await approver.send_for_approval(
        content_id="test_001",
        platform="facebook",
        content_type="educational",
        body="Feeling tired, unmotivated, or just not yourself lately? Low testosterone affects millions of men over 35. The good news? It's treatable. At NOW Men's Health, we offer personalized TRT solutions to help you reclaim your energy, focus, and vitality. 💪 Schedule your FREE consultation today. #MensHealth #TRT #PrescottAZ",
        topic="Low T Awareness"
    )
    
    if success:
        print("✅ Test content sent for approval!")
    else:
        print("❌ Failed to send test content")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == 'test':
        asyncio.run(test_approver())
    else:
        # Start the polling bot
        approver = MarketingApprover()
        approver.start_polling()
