"""
Lead Nurture Sequence Manager
Generates and manages lead nurture content for GHL workflows

Can generate personalized nurture content using AI or use pre-built templates
"""

import os
import yaml
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any

from content_generator import ContentGenerator, ContentType, Platform

from dotenv import load_dotenv
load_dotenv('/home/ec2-user/gmhdashboard/.env.local')
load_dotenv('/home/ec2-user/.env')
load_dotenv('/home/ec2-user/.env.production')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class NurtureSequenceManager:
    """Manages lead nurture sequences for GHL workflows"""
    
    def __init__(self):
        self.sequences_path = Path(__file__).parent / 'lead_nurture_sequences.yaml'
        self.sequences = self._load_sequences()
        self.generator = ContentGenerator()
        
        logger.info(f"✅ NurtureSequenceManager initialized with {len(self.sequences.get('sequences', {}))} sequences")
    
    def _load_sequences(self) -> Dict[str, Any]:
        """Load nurture sequences from YAML"""
        if self.sequences_path.exists():
            with open(self.sequences_path, 'r') as f:
                return yaml.safe_load(f)
        else:
            logger.warning("Nurture sequences file not found")
            return {'sequences': {}}
    
    def list_sequences(self) -> List[str]:
        """List available nurture sequences"""
        return list(self.sequences.get('sequences', {}).keys())
    
    def get_sequence(self, sequence_name: str) -> Optional[Dict[str, Any]]:
        """Get a specific sequence by name"""
        return self.sequences.get('sequences', {}).get(sequence_name)
    
    def get_sequence_messages(self, sequence_name: str) -> List[Dict[str, Any]]:
        """Get all messages in a sequence, ordered by delay"""
        sequence = self.get_sequence(sequence_name)
        if not sequence:
            return []
        
        messages = []
        for key, value in sequence.items():
            if key in ['name', 'description', 'trigger']:
                continue
            
            if isinstance(value, dict) and 'message' in value:
                messages.append({
                    'id': key,
                    'type': 'sms',
                    'delay': value.get('delay', '0 days'),
                    'content': value.get('message', '').strip()
                })
            elif isinstance(value, dict) and 'body' in value:
                messages.append({
                    'id': key,
                    'type': 'email',
                    'delay': value.get('delay', '0 days'),
                    'subject': value.get('subject', ''),
                    'content': value.get('body', '').strip()
                })
        
        return messages
    
    def format_for_ghl_import(self, sequence_name: str) -> str:
        """Format sequence for easy copy-paste into GHL workflow"""
        sequence = self.get_sequence(sequence_name)
        if not sequence:
            return f"Sequence '{sequence_name}' not found"
        
        output_lines = [
            f"# {sequence.get('name', sequence_name)}",
            f"# {sequence.get('description', '')}",
            f"# Trigger: {sequence.get('trigger', 'Manual')}",
            "",
            "=" * 50,
        ]
        
        messages = self.get_sequence_messages(sequence_name)
        for msg in messages:
            output_lines.append("")
            output_lines.append(f"## {msg['id']} ({msg['type'].upper()})")
            output_lines.append(f"Delay: {msg['delay']}")
            
            if msg['type'] == 'email':
                output_lines.append(f"Subject: {msg.get('subject', '')}")
            
            output_lines.append("-" * 30)
            output_lines.append(msg['content'])
            output_lines.append("=" * 50)
        
        return '\n'.join(output_lines)
    
    def generate_personalized_sequence(
        self,
        lead_type: str,
        patient_context: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Generate a personalized nurture sequence using AI
        
        Args:
            lead_type: Type of lead (trt, weight_loss, general)
            patient_context: Optional context about the patient
            
        Returns:
            List of generated messages
        """
        prompts = {
            'trt': "Lead interested in Testosterone Replacement Therapy. Focus on energy, vitality, and symptom relief.",
            'weight_loss': "Lead interested in medical weight loss. Focus on GLP-1 benefits and sustainable results.",
            'general': "Lead interested in men's health services. Keep messaging broad but engaging.",
        }
        
        context = prompts.get(lead_type, prompts['general'])
        if patient_context:
            context += f" Additional context: {patient_context}"
        
        sequence = []
        
        # Day 0: Immediate SMS
        sms = self.generator.generate_content(
            content_type=ContentType.ENGAGEMENT,
            platform=Platform.SMS,
            topic=f"Welcome message for {lead_type} lead",
            additional_context=context
        )
        sequence.append({
            'day': 0,
            'type': 'sms',
            'content': sms.body
        })
        
        # Day 1: Educational Email
        email = self.generator.generate_content(
            content_type=ContentType.EDUCATIONAL,
            platform=Platform.EMAIL,
            topic=f"Educational content about {lead_type} benefits",
            additional_context=context
        )
        sequence.append({
            'day': 1,
            'type': 'email',
            'content': email.body
        })
        
        # Day 3: Follow-up SMS
        follow_up = self.generator.generate_content(
            content_type=ContentType.PROMOTIONAL,
            platform=Platform.SMS,
            topic=f"Follow-up with consultation offer for {lead_type}",
            additional_context=context
        )
        sequence.append({
            'day': 3,
            'type': 'sms',
            'content': follow_up.body
        })
        
        return sequence
    
    def export_to_json(self, sequence_name: str, output_path: Optional[str] = None) -> str:
        """Export sequence to JSON for API integration"""
        import json
        
        messages = self.get_sequence_messages(sequence_name)
        
        export_data = {
            'sequence_name': sequence_name,
            'exported_at': datetime.now().isoformat(),
            'messages': messages
        }
        
        json_output = json.dumps(export_data, indent=2)
        
        if output_path:
            with open(output_path, 'w') as f:
                f.write(json_output)
            logger.info(f"✅ Exported to {output_path}")
        
        return json_output


def main():
    """CLI for managing nurture sequences"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Lead Nurture Sequence Manager')
    parser.add_argument('command', choices=['list', 'view', 'export', 'generate'],
                       help='Command to run')
    parser.add_argument('--sequence', type=str, help='Sequence name')
    parser.add_argument('--lead-type', type=str, default='trt',
                       choices=['trt', 'weight_loss', 'general'],
                       help='Lead type for AI generation')
    parser.add_argument('--output', type=str, help='Output file path')
    
    args = parser.parse_args()
    
    manager = NurtureSequenceManager()
    
    if args.command == 'list':
        print("\n📋 Available Nurture Sequences:")
        for seq in manager.list_sequences():
            sequence_data = manager.get_sequence(seq)
            print(f"  • {seq}: {sequence_data.get('description', 'No description')}")
        print()
        
    elif args.command == 'view':
        if not args.sequence:
            print("❌ --sequence is required")
            return
        
        formatted = manager.format_for_ghl_import(args.sequence)
        print(formatted)
        
    elif args.command == 'export':
        if not args.sequence:
            print("❌ --sequence is required")
            return
        
        json_output = manager.export_to_json(args.sequence, args.output)
        if not args.output:
            print(json_output)
        else:
            print(f"✅ Exported to {args.output}")
        
    elif args.command == 'generate':
        print(f"\n🤖 Generating AI nurture sequence for: {args.lead_type}")
        
        sequence = manager.generate_personalized_sequence(args.lead_type)
        
        print("\n" + "="*50)
        for msg in sequence:
            print(f"\nDay {msg['day']} ({msg['type'].upper()}):")
            print("-" * 30)
            print(msg['content'])
        print("="*50 + "\n")


if __name__ == "__main__":
    main()
