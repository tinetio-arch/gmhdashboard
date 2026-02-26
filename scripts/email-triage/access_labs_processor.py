#!/usr/bin/env python3
"""
Access Medical Labs PDF Processor
Extracts patient lab results from multi-patient PDFs and queues for provider review
"""

import os
import json
import boto3
import base64
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import PDF libraries
try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    logger.warning("PyMuPDF not installed, will use Textract for PDF processing")

# Configuration
S3_BUCKET = 'gmh-clinical-data-lake'
REVIEW_QUEUE_FILE = '/home/ec2-user/gmhdashboard/data/labs-review-queue.json'
PROCESSED_LABS_DIR = '/home/ec2-user/gmhdashboard/data/processed-labs'


class AccessLabsProcessor:
    """
    Processes Access Medical Labs PDF attachments:
    1. Extracts text from PDF using PyMuPDF or AWS Textract
    2. Uses Claude AI to identify individual patient sections
    3. Splits multi-patient PDF into individual patient PDFs
    4. Matches patients to Healthie records
    5. Queues for provider review before upload
    """
    
    SENDER_PATTERNS = [
        'accessmedicallabs',
        'accesslabs',
        'access medical'
    ]
    
    def __init__(self):
        self.s3_client = boto3.client('s3', region_name='us-east-2')
        self.bedrock_client = boto3.client('bedrock-runtime', region_name='us-east-1')
        self.textract_client = boto3.client('textract', region_name='us-east-1')
        
        # Ensure directories exist
        os.makedirs(PROCESSED_LABS_DIR, exist_ok=True)
        os.makedirs(os.path.dirname(REVIEW_QUEUE_FILE), exist_ok=True)
    
    def detect(self, from_email: str, subject: str) -> bool:
        """Returns True if email is from Access Medical Labs"""
        from_lower = from_email.lower()
        subject_lower = subject.lower()
        
        return any(pattern in from_lower for pattern in self.SENDER_PATTERNS) or \
               'access medical labs' in subject_lower
    
    def extract_pdf_text(self, pdf_bytes: bytes) -> Tuple[str, int]:
        """
        Extract text from PDF.
        Returns: (extracted_text, page_count)
        """
        if HAS_PYMUPDF:
            return self._extract_with_pymupdf(pdf_bytes)
        else:
            return self._extract_with_textract(pdf_bytes)
    
    def _extract_with_pymupdf(self, pdf_bytes: bytes) -> Tuple[str, int]:
        """Extract text using PyMuPDF (fast, for native PDFs)"""
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            text_parts = []
            
            for page_num, page in enumerate(doc, 1):
                page_text = page.get_text()
                if page_text.strip():
                    text_parts.append(f"--- PAGE {page_num} ---\n{page_text}")
            
            page_count = len(doc)
            doc.close()
            
            full_text = "\n\n".join(text_parts)
            
            # If very little text extracted, PDF might be scanned - fallback to Textract
            if len(full_text) < 100 and page_count > 0:
                logger.info("PyMuPDF extracted minimal text, trying Textract OCR...")
                return self._extract_with_textract(pdf_bytes)
            
            return full_text, page_count
            
        except Exception as e:
            logger.error(f"PyMuPDF extraction failed: {e}")
            return self._extract_with_textract(pdf_bytes)
    
    def _extract_with_textract(self, pdf_bytes: bytes) -> Tuple[str, int]:
        """Extract text using AWS Textract (OCR for scanned PDFs)"""
        try:
            # Upload to S3 temporarily for Textract async processing
            temp_key = f"temp/textract/{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
            
            self.s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=temp_key,
                Body=pdf_bytes
            )
            
            # For single-page PDFs, use synchronous API
            # For multi-page, need async (simplified here)
            response = self.textract_client.detect_document_text(
                Document={'Bytes': pdf_bytes}
            )
            
            lines = []
            for block in response.get('Blocks', []):
                if block['BlockType'] == 'LINE':
                    lines.append(block['Text'])
            
            # Clean up temp file
            try:
                self.s3_client.delete_object(Bucket=S3_BUCKET, Key=temp_key)
            except:
                pass
            
            return "\n".join(lines), 1  # Textract sync API is single page
            
        except Exception as e:
            logger.error(f"Textract extraction failed: {e}")
            return "", 0
    
    def identify_patients(self, full_text: str) -> List[Dict[str, Any]]:
        """
        Use Claude AI to identify patient names/sections in the document.
        Returns list of patient info with page ranges.
        """
        prompt = """Analyze this lab report and identify ALL patients in the document.
        
For each patient found, return a JSON object with:
- patient_name: Full name exactly as shown (Last, First format typically)
- page_start: First page number containing their results
- page_end: Last page number containing their results
- tests_found: List of lab test names found for this patient
- collection_date: Date specimens were collected (if visible)
- dob: Date of birth if visible

Return ONLY a JSON array, no other text. Example:
[
  {"patient_name": "Smith, John", "page_start": 1, "page_end": 2, "tests_found": ["CBC", "CMP"], "collection_date": "12/30/2024", "dob": "05/15/1985"},
  {"patient_name": "Doe, Jane", "page_start": 3, "page_end": 4, "tests_found": ["Lipid Panel"], "collection_date": "12/30/2024", "dob": null}
]

If only one patient is in the document, return a single-item array.
If you cannot identify any patients, return an empty array: []

Lab Report Text:
""" + full_text[:15000]  # Limit context size
        
        try:
            payload = {
                'anthropic_version': 'bedrock-2023-05-31',
                'max_tokens': 2000,
                'messages': [{'role': 'user', 'content': prompt}],
                'temperature': 0.1
            }
            
            response = self.bedrock_client.invoke_model(
                modelId='us.anthropic.claude-3-5-sonnet-20241022-v2:0',
                contentType='application/json',
                accept='application/json',
                body=json.dumps(payload)
            )
            
            response_body = json.loads(response['body'].read())
            ai_text = response_body['content'][0]['text'].strip()
            
            # Extract JSON from response
            if '```json' in ai_text:
                ai_text = ai_text.split('```json')[1].split('```')[0]
            elif '```' in ai_text:
                ai_text = ai_text.split('```')[1].split('```')[0]
            
            patients = json.loads(ai_text.strip())
            logger.info(f"AI identified {len(patients)} patient(s) in lab report")
            return patients
            
        except Exception as e:
            logger.error(f"AI patient identification failed: {e}")
            return []
    
    def split_pdf_by_patient(self, pdf_bytes: bytes, patients: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Split multi-patient PDF into individual PDFs per patient.
        Returns list of dicts with patient info and their PDF bytes.
        """
        if not HAS_PYMUPDF:
            logger.warning("PyMuPDF not available, cannot split PDF")
            # Return the full PDF for each patient (they'll review together)
            return [{**p, 'pdf_bytes': pdf_bytes} for p in patients]
        
        results = []
        
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            
            for patient in patients:
                start_page = patient.get('page_start', 1) - 1  # 0-indexed
                end_page = patient.get('page_end', len(doc))
                
                # Clamp to valid range
                start_page = max(0, min(start_page, len(doc) - 1))
                end_page = max(start_page + 1, min(end_page, len(doc)))
                
                # Create new PDF with just this patient's pages
                new_doc = fitz.open()
                new_doc.insert_pdf(doc, from_page=start_page, to_page=end_page - 1)
                
                patient_pdf_bytes = new_doc.tobytes()
                new_doc.close()
                
                results.append({
                    **patient,
                    'pdf_bytes': patient_pdf_bytes,
                    'page_count': end_page - start_page
                })
            
            doc.close()
            
        except Exception as e:
            logger.error(f"PDF splitting failed: {e}")
            # Fallback: return original PDF for all patients
            return [{**p, 'pdf_bytes': pdf_bytes} for p in patients]
        
        return results
    
    def match_to_healthie(self, patient_name: str, dob: Optional[str] = None) -> Dict[str, Any]:
        """
        Find patient in Healthie using fuzzy matching.
        Returns match info with confidence score.
        """
        # Import patient matching from scribe orchestrator
        try:
            import sys
            sys.path.insert(0, '/home/ec2-user/scripts/scribe')
            from scribe_orchestrator import ScribeOrchestrator
            
            orchestrator = ScribeOrchestrator()
            
            # Normalize name from "Last, First" to "First Last"
            if ',' in patient_name:
                parts = patient_name.split(',')
                normalized_name = f"{parts[1].strip()} {parts[0].strip()}"
            else:
                normalized_name = patient_name
            
            # Use existing fuzzy matching
            candidates = orchestrator.get_patient_candidate_list()
            
            if not candidates:
                return {'patient_id': None, 'confidence': 0.0, 'matched_name': None, 'top_matches': []}
            
            from thefuzz import fuzz, process
            
            name_to_patient = {p['name']: p for p in candidates}
            patient_names = list(name_to_patient.keys())
            
            matches = process.extract(normalized_name, patient_names, scorer=fuzz.token_sort_ratio, limit=5)
            
            if matches:
                best_match_name, score, _ = matches[0]
                best_patient = name_to_patient[best_match_name]
                
                return {
                    'patient_id': best_patient['id'],
                    'confidence': score / 100.0,
                    'matched_name': best_match_name,
                    'healthie_id': best_patient.get('healthie_id'),
                    'top_matches': [(m[0], m[1], name_to_patient[m[0]].get('id')) for m in matches[:3]]
                }
            
            return {'patient_id': None, 'confidence': 0.0, 'matched_name': None, 'top_matches': []}
            
        except Exception as e:
            logger.error(f"Patient matching failed: {e}")
            return {'patient_id': None, 'confidence': 0.0, 'matched_name': None, 'error': str(e)}
    
    def add_to_review_queue(self, patient_result: Dict[str, Any], email_id: str) -> str:
        """Add processed lab result to review queue for provider approval"""
        import uuid
        
        queue_item = {
            'id': str(uuid.uuid4()),
            'email_id': email_id,
            'patient_name': patient_result['patient_name'],
            'healthie_id': patient_result.get('healthie_id'),
            'match_confidence': patient_result.get('confidence', 0.0),
            'matched_name': patient_result.get('matched_name'),
            'top_matches': patient_result.get('top_matches', []),
            'tests_found': patient_result.get('tests_found', []),
            'collection_date': patient_result.get('collection_date'),
            'status': 'pending_review',
            'created_at': datetime.now().isoformat()
        }
        
        # Save PDF to disk
        pdf_filename = f"{queue_item['id']}.pdf"
        pdf_path = os.path.join(PROCESSED_LABS_DIR, pdf_filename)
        
        with open(pdf_path, 'wb') as f:
            f.write(patient_result.get('pdf_bytes', b''))
        
        queue_item['pdf_path'] = pdf_path
        
        # Also upload to S3 for presigned URL access
        s3_key = f"incoming/labs/pending/{queue_item['id']}.pdf"
        try:
            self.s3_client.put_object(
                Bucket=S3_BUCKET,
                Key=s3_key,
                Body=patient_result.get('pdf_bytes', b''),
                ContentType='application/pdf'
            )
            queue_item['s3_key'] = s3_key
        except Exception as e:
            logger.error(f"S3 upload for review queue failed: {e}")
        
        # Load existing queue
        queue = []
        if os.path.exists(REVIEW_QUEUE_FILE):
            try:
                with open(REVIEW_QUEUE_FILE, 'r') as f:
                    queue = json.load(f)
            except:
                queue = []
        
        queue.append(queue_item)
        
        with open(REVIEW_QUEUE_FILE, 'w') as f:
            json.dump(queue, f, indent=2)
        
        logger.info(f"Added to review queue: {queue_item['id']} for patient {patient_result['patient_name']}")
        
        return queue_item['id']
    
    def send_telegram_review_request(self, queue_item_id: str) -> bool:
        """Send Telegram notification for provider review"""
        try:
            # Load queue item
            with open(REVIEW_QUEUE_FILE, 'r') as f:
                queue = json.load(f)
            
            item = next((i for i in queue if i['id'] == queue_item_id), None)
            if not item:
                return False
            
            # Use existing Telegram bot
            import sys
            sys.path.insert(0, '/home/ec2-user/scripts/scribe')
            from telegram_approver import TelegramApprover
            
            approver = TelegramApprover()
            
            # Use the convenience method with full queue item
            msg_info = approver.send_lab_review_request(queue_item_id, item)
            logger.info(f"Sent Telegram review request: {msg_info}")
            
            return True
            
        except Exception as e:
            logger.error(f"Telegram review request failed: {e}")
            return False
    
    def process_pdf(self, pdf_bytes: bytes, filename: str, email_id: str) -> List[str]:
        """
        Main entry point: Process a lab PDF and queue results for review.
        Returns list of queue item IDs.
        """
        logger.info(f"Processing Access Labs PDF: {filename}")
        
        # Step 1: Extract text
        full_text, page_count = self.extract_pdf_text(pdf_bytes)
        logger.info(f"Extracted {len(full_text)} chars from {page_count} pages")
        
        if not full_text:
            logger.error("Failed to extract text from PDF")
            return []
        
        # Step 2: Identify patients
        patients = self.identify_patients(full_text)
        
        if not patients:
            logger.warning("No patients identified in lab report")
            # Create a single item for manual review
            patients = [{'patient_name': 'UNKNOWN - Manual Review Required', 'page_start': 1, 'page_end': page_count}]
        
        # Step 3: Split PDF by patient
        patient_results = self.split_pdf_by_patient(pdf_bytes, patients)
        
        # Step 4: Match each patient to Healthie and queue for review
        queue_ids = []
        for result in patient_results:
            # Match to Healthie
            match_info = self.match_to_healthie(result['patient_name'], result.get('dob'))
            result.update(match_info)
            
            # Add to review queue
            queue_id = self.add_to_review_queue(result, email_id)
            queue_ids.append(queue_id)
            
            # Send Telegram notification
            self.send_telegram_review_request(queue_id)
        
        logger.info(f"Processed {len(queue_ids)} patient lab results from {filename}")
        return queue_ids


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: access_labs_processor.py <path-to-pdf> [email_id]")
        print("       access_labs_processor.py --test <path-to-pdf>")
        sys.exit(1)
    
    if sys.argv[1] == '--test':
        # Test mode: extract and identify patients, don't queue
        pdf_path = sys.argv[2]
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()
        
        processor = AccessLabsProcessor()
        text, pages = processor.extract_pdf_text(pdf_bytes)
        print(f"\n📄 Extracted {len(text)} characters from {pages} pages\n")
        print("First 1000 chars:")
        print(text[:1000])
        
        print("\n🔍 Identifying patients...")
        patients = processor.identify_patients(text)
        print(json.dumps(patients, indent=2))
    else:
        # Normal mode
        pdf_path = sys.argv[1]
        email_id = sys.argv[2] if len(sys.argv) > 2 else f"manual-{datetime.now().strftime('%Y%m%d%H%M%S')}"
        
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()
        
        processor = AccessLabsProcessor()
        queue_ids = processor.process_pdf(pdf_bytes, os.path.basename(pdf_path), email_id)
        
        print(f"\n✅ Queued {len(queue_ids)} lab results for review")
        for qid in queue_ids:
            print(f"   - {qid}")
