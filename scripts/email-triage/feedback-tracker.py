#!/usr/bin/env python3
"""
Feedback tracking system for email routing
Stores corrections and improves AI over time
"""

import json
import os
from datetime import datetime
from typing import Dict, Any, List

FEEDBACK_DB = '/home/ec2-user/gmhdashboard/data/email-triage-feedback.json'

class FeedbackTracker:
    def __init__(self):
        self.feedback_data = self.load_feedback()
    
    def load_feedback(self) -> Dict:
        """Load existing feedback data"""
        if os.path.exists(FEEDBACK_DB):
            with open(FEEDBACK_DB, 'r') as f:
                return json.load(f)
        return {
            'corrections': [],
            'patterns': {},
            'accuracy': {
                'total_classified': 0,
                'total_corrected': 0,
                'accuracy_rate': 1.0
            }
        }
    
    def save_feedback(self):
        """Save feedback data"""
        os.makedirs(os.path.dirname(FEEDBACK_DB), exist_ok=True)
        with open(FEEDBACK_DB, 'w') as f:
            json.dump(self.feedback_data, f, indent=2)
    
    def record_correction(self, email_data: Dict, ai_category: str, correct_category: str, reason: str = ''):
        """Record a routing correction"""
        correction = {
            'timestamp': datetime.now().isoformat(),
            'email_subject': email_data.get('subject', ''),
            'email_from': email_data.get('from', ''),
            'email_body_snippet': email_data.get('body', '')[:200],
            'ai_classified_as': ai_category,
            'should_be': correct_category,
            'user_reason': reason,
            'attachments': [a.get('filename', '') for a in email_data.get('attachments', [])]
        }
        
        self.feedback_data['corrections'].append(correction)
        
        # Update accuracy tracking
        self.feedback_data['accuracy']['total_classified'] += 1
        self.feedback_data['accuracy']['total_corrected'] += 1
        self.feedback_data['accuracy']['accuracy_rate'] = 1 - (
            self.feedback_data['accuracy']['total_corrected'] / 
            self.feedback_data['accuracy']['total_classified']
        )
        
        # Extract patterns
        self._extract_pattern(email_data, ai_category, correct_category)
        
        self.save_feedback()
        
        print(f"✅ Correction recorded: {ai_category} → {correct_category}")
        print(f"   Current accuracy: {self.feedback_data['accuracy']['accuracy_rate']:.1%}")
    
    def _extract_pattern(self, email_data: Dict, wrong: str, correct: str):
        """Extract patterns from corrections to improve future routing"""
        # Look for keywords in subject/body
        text = f"{email_data.get('subject', '')} {email_data.get('body', '')}".lower()
        
        # Extract significant words (simple approach - could be enhanced with NLP)
        words = [w for w in text.split() if len(w) > 4][:10]  # Top 10 meaningful words
        
        pattern_key = f"{wrong}_to_{correct}"
        if pattern_key not in self.feedback_data['patterns']:
            self.feedback_data['patterns'][pattern_key] = {
                'count': 0,
                'keywords': {},
                'from_domains': {}
            }
        
        self.feedback_data['patterns'][pattern_key]['count'] += 1
        
        # Track keywords
        for word in words:
            if word not in self.feedback_data['patterns'][pattern_key]['keywords']:
                self.feedback_data['patterns'][pattern_key]['keywords'][word] = 0
            self.feedback_data['patterns'][pattern_key]['keywords'][word] += 1
        
        # Track sender domains
        if 'from' in email_data:
            domain = email_data['from'].split('@')[-1] if '@' in email_data['from'] else 'unknown'
            if domain not in self.feedback_data['patterns'][pattern_key]['from_domains']:
                self.feedback_data['patterns'][pattern_key]['from_domains'][domain] = 0
            self.feedback_data['patterns'][pattern_key]['from_domains'][domain] += 1
    
    def get_learned_patterns(self) -> str:
        """Generate learned patterns as text to include in AI prompt"""
        if not self.feedback_data['patterns']:
            return ""
        
        prompt_addition = "\n\nLEARNED PATTERNS FROM USER FEEDBACK:\n"
        
        for pattern_key, data in self.feedback_data['patterns'].items():
            if data['count'] < 2:  # Only include patterns seen multiple times
                continue
            
            wrong, correct = pattern_key.replace('_to_', '|').split('|')
            prompt_addition += f"\n- When emails were classified as {wrong} but should be {correct} ({data['count']} times):\n"
            
            # Top keywords
            top_keywords = sorted(data['keywords'].items(), key=lambda x: x[1], reverse=True)[:5]
            if top_keywords:
                keywords = ', '.join([k for k, _ in top_keywords])
                prompt_addition += f"  Keywords: {keywords}\n"
            
            # Top domains
            top_domains = sorted(data['from_domains'].items(), key=lambda x: x[1], reverse=True)[:3]
            if top_domains:
                domains = ', '.join([d for d, _ in top_domains])
                prompt_addition += f"  Common senders: {domains}\n"
        
        return prompt_addition
    
    def get_stats(self) -> Dict:
        """Get feedback statistics"""
        total = len(self.feedback_data['corrections'])
        
        if total == 0:
            return {'total_corrections': 0, 'accuracy': 1.0, 'common_mistakes': []}
        
        # Count most common mistakes
        mistakes = {}
        for correction in self.feedback_data['corrections']:
            key = f"{correction['ai_classified_as']} → {correction['should_be']}"
            mistakes[key] = mistakes.get(key, 0) + 1
        
        common = sorted(mistakes.items(), key=lambda x: x[1], reverse=True)[:5]
        
        return {
            'total_corrections': total,
            'accuracy': self.feedback_data['accuracy']['accuracy_rate'],
            'common_mistakes': [{'route': k, 'count': v} for k, v in common]
        }

if __name__ == '__main__':
    tracker = FeedbackTracker()
    stats = tracker.get_stats()
    
    print("Feedback System Statistics:")
    print(f"  Total corrections: {stats['total_corrections']}")
    print(f"  Current accuracy: {stats['accuracy']:.1%}")
    
    if stats['common_mistakes']:
        print("\n  Most common routing mistakes:")
        for mistake in stats['common_mistakes']:
            print(f"    • {mistake['route']}: {mistake['count']} times")
    
    patterns = tracker.get_learned_patterns()
    if patterns:
        print("\n" + patterns)
