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
import requests
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
    
    # ---------------------------------------------------------------------
    # Active-patient defense-in-depth helpers
    # FIX(2026-05-17): Snowflake HEALTHIE_PATIENTS table still contains archived
    # Healthie IDs (the per-sync active filter is leaky/stale), and PATIENT_360_VIEW
    # uses *dashboard* status, not Healthie's archived flag. Net effect: the fuzzy
    # matcher in match_to_healthie() can pick an archived-duplicate Healthie ID,
    # which then writes a stuck "inactive patient" row into lab_review_queue.
    # Three-step defense:
    #   1. Verify every Snowflake-matched id against live Healthie API.
    #   2. If archived, look up the clinic-curated Postgres `patients` table
    #      (same source of truth that /home/ec2-user/scripts/labs/fetch_results.py
    #      uses as Tier 1) for the canonical active healthie_client_id.
    #   3. If Postgres also misses, search Healthie API directly for an active dup.
    # ---------------------------------------------------------------------

    @staticmethod
    def _unpack_fuzz_match(m):
        """thefuzz.process.extract returns 2-tuples for list input and 3-tuples for
        dict input. Normalize to (name, score)."""
        if len(m) >= 2:
            return m[0], m[1]
        return None, 0

    # ---------------------------------------------------------------------
    # HARD DOB GATE (PATIENT SAFETY)
    # FIX(2026-05-20): Lab PDFs were matched to patients by fuzzy NAME only.
    # DOB from the PDF was passed into match_to_healthie() but never used as a
    # gate — it was at most a soft tiebreaker inside the Healthie fallback
    # searches. A name collision with a DIFFERENT DOB (or a candidate whose DOB
    # we can't verify) could pre-fill a high-confidence Healthie match that a
    # reviewer rubber-stamps, crossing a lab result onto the wrong patient
    # (the "Snyder lab crossover"). The gate below makes DOB mandatory:
    #   - PDF DOB missing/unparseable  -> route to human review (dob_missing)
    #   - candidate DOB missing/unknown -> route to human review (dob_unverifiable)
    #   - PDF DOB != candidate DOB      -> route to human review (dob_mismatch)
    #   - name match AND DOB match      -> auto-assign (the ONLY safe path)
    # ---------------------------------------------------------------------

    @staticmethod
    def _normalize_dob(raw) -> Optional[str]:
        """Normalize a DOB from any of the formats we see (PDF 'MM/DD/YYYY',
        Snowflake/Postgres 'YYYY-MM-DD', datetime strings with a time component)
        to a canonical 'YYYY-MM-DD'. Returns None if it can't be parsed or is a
        sentinel like 'Unknown'."""
        if raw is None:
            return None
        s = str(raw).strip()
        if not s or s.lower() in ('unknown', 'none', 'null', 'n/a'):
            return None
        for c in (s, s[:10]):  # try full string, then leading date of a datetime
            for fmt in ('%Y-%m-%d', '%m/%d/%Y', '%m-%d-%Y', '%Y/%m/%d'):
                try:
                    return datetime.strptime(c, fmt).strftime('%Y-%m-%d')
                except Exception:
                    continue
        return None

    def _route_to_review(self, reason: str, matched_name, top_matches,
                         pdf_dob, candidate_dob, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Build a deliberate NO-AUTO-ASSIGN result: patient_id/healthie_id are
        None so add_to_review_queue() stores no linked patient and the human
        reviewer must select the patient manually. Logs one clear line per case."""
        logger.warning(
            f"DOB GATE: routing lab to human review (reason={reason}) — "
            f"name_match='{matched_name}' pdf_dob={pdf_dob!r} candidate_dob={candidate_dob!r}. "
            f"NOT auto-assigning."
        )
        result = {
            'patient_id': None,
            'healthie_id': None,
            'confidence': 0.0,
            'matched_name': matched_name,
            'top_matches': top_matches or [],
            'review_required': True,
            'review_reason': reason,
        }
        if extra:
            result.update(extra)
        return result

    def _dob_gate(self, match_result: Dict[str, Any], pdf_dob) -> Dict[str, Any]:
        """HARD gate applied to every would-be positive match. `match_result`
        must carry 'candidate_dob' (the DOB of the patient we're about to assign
        to), 'matched_name', and 'top_matches'. Returns match_result unchanged
        ONLY when the PDF DOB is present AND equals the candidate DOB; otherwise
        returns a route-to-review no-match dict."""
        candidate_dob = match_result.get('candidate_dob')
        matched_name = match_result.get('matched_name')
        top_matches = match_result.get('top_matches', [])
        norm_pdf = self._normalize_dob(pdf_dob)
        norm_cand = self._normalize_dob(candidate_dob)

        if norm_pdf is None:
            return self._route_to_review('dob_missing', matched_name, top_matches, pdf_dob, candidate_dob)
        if norm_cand is None:
            return self._route_to_review('dob_unverifiable', matched_name, top_matches, pdf_dob, candidate_dob)
        if norm_pdf != norm_cand:
            return self._route_to_review('dob_mismatch', matched_name, top_matches, pdf_dob, candidate_dob)

        # Name matched AND DOB matched — the only path that may auto-assign.
        match_result.pop('candidate_dob', None)  # internal-only, don't leak into queue item
        logger.info(
            f"DOB GATE PASSED: name+DOB match for '{matched_name}' (dob={norm_pdf}) — auto-assign OK"
        )
        return match_result

    def _lookup_postgres_active(self, normalized_name: str, dob: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Fuzzy-match against the Postgres `patients` table (active only).
        Returns {'healthie_id','name','dob','patient_id'} or None.
        This is the same source-of-truth fetch_results.py uses as Tier 1."""
        try:
            import psycopg2
            from thefuzz import fuzz, process
            conn = psycopg2.connect(
                host=os.environ.get('DATABASE_HOST', 'localhost'),
                port=int(os.environ.get('DATABASE_PORT', '5432')),
                database=os.environ.get('DATABASE_NAME', 'postgres'),
                user=os.environ.get('DATABASE_USER', 'clinicadmin'),
                password=os.environ.get('DATABASE_PASSWORD'),
                sslmode=os.environ.get('DATABASE_SSLMODE', 'require'),
                connect_timeout=10
            )
            cur = conn.cursor()
            cur.execute("""
                SELECT patient_id, full_name, healthie_client_id, dob
                  FROM patients
                 WHERE healthie_client_id IS NOT NULL
                   AND (status IS NULL OR LOWER(status) NOT IN ('inactive', 'hold_patient_research', 'hold_payment_research'))
            """)
            rows = cur.fetchall()
            cur.close()
            conn.close()
            if not rows:
                return None
            by_name = {(r[1] or 'Unknown'): {
                'patient_id': str(r[0]),
                'name': r[1] or 'Unknown',
                'healthie_id': str(r[2]),
                'dob': str(r[3]) if r[3] else None
            } for r in rows}
            matches = process.extract(normalized_name, list(by_name.keys()), scorer=fuzz.token_sort_ratio, limit=5)
            if not matches:
                return None
            best_name, score = self._unpack_fuzz_match(matches[0])
            if score < 85 or not best_name:
                return None
            return by_name[best_name]
        except Exception as e:
            logger.warning(f"Postgres active lookup failed for '{normalized_name}': {e}")
            return None

    def _verify_healthie_active(self, healthie_id: str) -> Optional[bool]:
        """Look up a Healthie user by id; return True if active, False if archived
        or unknown-to-Healthie, None only if the HTTP lookup itself failed (network
        error or non-200) so the caller can fall through rather than block on a
        transient API problem.

        We trust Healthie's `active` boolean — `archived_at` is unreliable
        (we've seen rows with active=True AND archived_at set, where the patient
        is in fact the live record; see Shawn Antrim 12742287, Phillip Schafer
        12123979 in production data 2026-05-17)."""
        api_key = os.environ.get('HEALTHIE_API_KEY')
        if not api_key or not healthie_id:
            return None
        try:
            query = """
            query VerifyActive($id: ID) {
                user(id: $id) {
                    id
                    active
                }
            }
            """
            response = requests.post(
                'https://api.gethealthie.com/graphql',
                json={'query': query, 'variables': {'id': str(healthie_id)}},
                headers={
                    'Authorization': f'Basic {api_key}',
                    'AuthorizationSource': 'API',
                    'Content-Type': 'application/json'
                },
                timeout=10
            )
            if response.status_code != 200:
                logger.warning(f"Healthie verify HTTP {response.status_code} for id={healthie_id}")
                return None
            data = response.json()
            user = (data.get('data') or {}).get('user')
            if user is None:
                # Healthie doesn't recognize this id (deleted/never existed).
                # Treat as "not active" so caller falls back to rescue tiers.
                return False
            return bool(user.get('active'))
        except Exception as e:
            logger.warning(f"Healthie verify failed for id={healthie_id}: {e}")
            return None

    def _search_healthie_direct_active(self, normalized_name: str, dob: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Direct Healthie API search restricted to ACTIVE patients only.
        Used as fallback when Snowflake candidate match resolves to an archived id."""
        api_key = os.environ.get('HEALTHIE_API_KEY')
        if not api_key or not normalized_name:
            return None
        try:
            query = """
            query SearchActivePatients($keywords: String) {
                users(keywords: $keywords, active_status: "Active") {
                    id
                    first_name
                    last_name
                    dob
                    active
                }
            }
            """
            response = requests.post(
                'https://api.gethealthie.com/graphql',
                json={'query': query, 'variables': {'keywords': normalized_name}},
                headers={
                    'Authorization': f'Basic {api_key}',
                    'AuthorizationSource': 'API',
                    'Content-Type': 'application/json'
                },
                timeout=10
            )
            if response.status_code != 200:
                logger.warning(f"Healthie search HTTP {response.status_code} for '{normalized_name}'")
                return None
            users = (response.json().get('data') or {}).get('users') or []
            # Defense in depth — re-filter even though active_status:Active was set.
            # Trust the `active` boolean alone; archived_at is unreliable in Healthie.
            active_users = [u for u in users if u.get('active')]
            if not active_users:
                return None
            # Prefer DOB match if available
            if dob:
                # Normalize "MM/DD/YYYY" → "YYYY-MM-DD" for comparison
                try:
                    target_dob = datetime.strptime(dob.strip(), '%m/%d/%Y').strftime('%Y-%m-%d')
                except Exception:
                    target_dob = dob.strip()
                for u in active_users:
                    if (u.get('dob') or '').strip() == target_dob:
                        return {
                            'id': str(u['id']),
                            'name': f"{u.get('first_name','')} {u.get('last_name','')}".strip(),
                            'dob': u.get('dob')
                        }
            u = active_users[0]
            return {
                'id': str(u['id']),
                'name': f"{u.get('first_name','')} {u.get('last_name','')}".strip(),
                'dob': u.get('dob')
            }
        except Exception as e:
            logger.warning(f"Healthie direct search failed for '{normalized_name}': {e}")
            return None

    def match_to_healthie(self, patient_name: str, dob: Optional[str] = None) -> Dict[str, Any]:
        """
        Find patient in Healthie using fuzzy matching.
        Returns match info with confidence score.

        Defense-in-depth: after the Snowflake-backed fuzzy match resolves a
        Healthie ID, verify against the live Healthie API that the ID is still
        active. If archived, fall back to a direct Healthie API search restricted
        to active patients. See FIX(2026-05-17) comment above.
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
                # No Snowflake candidates — fall straight to direct Healthie active-only search.
                api_match = self._search_healthie_direct_active(normalized_name, dob)
                if api_match:
                    logger.info(f"Matched via direct Healthie search (no Snowflake candidates): {api_match['name']} ({api_match['id']})")
                    return self._dob_gate({
                        'patient_id': api_match['id'],
                        'healthie_id': api_match['id'],
                        'confidence': 0.95,
                        'matched_name': api_match['name'],
                        'top_matches': [],
                        'source': 'healthie_api',
                        'candidate_dob': api_match.get('dob'),
                    }, dob)
                return {'patient_id': None, 'confidence': 0.0, 'matched_name': None, 'top_matches': []}

            from thefuzz import fuzz, process

            name_to_patient = {p['name']: p for p in candidates}
            patient_names = list(name_to_patient.keys())

            matches = process.extract(normalized_name, patient_names, scorer=fuzz.token_sort_ratio, limit=5)

            # thefuzz returns 2-tuples for list input on this box's version; the
            # original `name, score, _ = matches[0]` unpack raised silently and
            # forced every match through the except branch (always returning
            # None). Normalize to (name, score).
            top_matches_serializable = [
                (*self._unpack_fuzz_match(m), name_to_patient[self._unpack_fuzz_match(m)[0]].get('id'))
                for m in matches[:3] if self._unpack_fuzz_match(m)[0]
            ]

            if matches:
                best_match_name, score = self._unpack_fuzz_match(matches[0])
                if not best_match_name:
                    return {'patient_id': None, 'confidence': 0.0, 'matched_name': None, 'top_matches': []}
                best_patient = name_to_patient[best_match_name]
                matched_id = best_patient.get('healthie_id') or best_patient['id']

                # --- Defense-in-depth: verify ID is still active in Healthie ---
                active_check = self._verify_healthie_active(matched_id)
                if active_check is False:
                    logger.warning(
                        f"Snowflake matched archived Healthie id={matched_id} "
                        f"for '{normalized_name}' — looking for active dup"
                    )
                    # Rescue tier A: Postgres `patients` table (clinic-curated SoT,
                    # same primary tier fetch_results.py uses).
                    pg_match = self._lookup_postgres_active(normalized_name, dob)
                    if pg_match and pg_match.get('healthie_id') and pg_match['healthie_id'] != str(matched_id):
                        # Verify the Postgres-chosen id is still active in Healthie
                        # before swapping. If Healthie says it's archived too, fall
                        # through to direct API search.
                        pg_active = self._verify_healthie_active(pg_match['healthie_id'])
                        if pg_active is not False:
                            logger.info(
                                f"Replaced archived id {matched_id} with Postgres active id "
                                f"{pg_match['healthie_id']} ({pg_match['name']})"
                            )
                            return self._dob_gate({
                                'patient_id': pg_match['healthie_id'],
                                'healthie_id': pg_match['healthie_id'],
                                'confidence': max(score / 100.0, 0.9),
                                'matched_name': pg_match['name'],
                                'top_matches': top_matches_serializable,
                                'source': 'postgres_fallback',
                                'replaced_archived_id': str(matched_id),
                                'candidate_dob': pg_match.get('dob'),
                            }, dob)
                    # Rescue tier B: direct Healthie API search restricted to active.
                    api_match = self._search_healthie_direct_active(normalized_name, dob)
                    if api_match:
                        logger.info(
                            f"Replaced archived id {matched_id} with Healthie API active id "
                            f"{api_match['id']} ({api_match['name']})"
                        )
                        return self._dob_gate({
                            'patient_id': api_match['id'],
                            'healthie_id': api_match['id'],
                            'confidence': max(score / 100.0, 0.9),
                            'matched_name': api_match['name'],
                            'top_matches': top_matches_serializable,
                            'source': 'healthie_api_fallback',
                            'replaced_archived_id': str(matched_id),
                            'candidate_dob': api_match.get('dob'),
                        }, dob)
                    # No active dup found anywhere — return no-match rather than the archived id.
                    logger.error(
                        f"Archived id={matched_id} matched and no active dup found for "
                        f"'{normalized_name}' — refusing to write archived id to queue. "
                        f"Item will surface in review queue for manual patient selection."
                    )
                    return {
                        'patient_id': None,
                        'healthie_id': None,
                        'confidence': 0.0,
                        'matched_name': best_match_name,
                        'top_matches': top_matches_serializable,
                        'rejected_archived_id': str(matched_id)
                    }
                # active_check is True or None (unknown). If unknown, fall through
                # — better to keep working than to block on a transient API failure.

                # Low-confidence rescue: if the Snowflake fuzzy match is below
                # 85% (the same gate scribe_orchestrator.identify_patient uses),
                # consult Postgres before accepting the match. Postgres is
                # clinic-curated and often holds the patient when Snowflake
                # candidate-list pagination/limit misses it. See production
                # incident 2026-05-17 where 'ANTRIM, SHAWN' fuzzy-matched
                # 'Katie Sheehan' at 64% because the Antrim duplicate cluster
                # was not in the 5000-row candidate list.
                if score < 85:
                    pg_match = self._lookup_postgres_active(normalized_name, dob)
                    if pg_match and pg_match.get('healthie_id'):
                        pg_active = self._verify_healthie_active(pg_match['healthie_id'])
                        if pg_active is not False:
                            logger.info(
                                f"Low-confidence Snowflake match ({score}%) → upgraded via Postgres "
                                f"to {pg_match['name']} ({pg_match['healthie_id']})"
                            )
                            return self._dob_gate({
                                'patient_id': pg_match['healthie_id'],
                                'healthie_id': pg_match['healthie_id'],
                                'confidence': 0.9,
                                'matched_name': pg_match['name'],
                                'top_matches': top_matches_serializable,
                                'source': 'postgres_low_confidence_rescue',
                                'snowflake_below_threshold_match': best_match_name,
                                'candidate_dob': pg_match.get('dob'),
                            }, dob)

                return self._dob_gate({
                    'patient_id': best_patient['id'],
                    'confidence': score / 100.0,
                    'matched_name': best_match_name,
                    'healthie_id': best_patient.get('healthie_id'),
                    'top_matches': top_matches_serializable,
                    'candidate_dob': best_patient.get('dob'),
                }, dob)

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
