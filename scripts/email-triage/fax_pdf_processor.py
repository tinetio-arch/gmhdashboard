#!/usr/bin/env python3
"""
Fax PDF Processor - Extract text from fax PDF attachments
Uses pdfplumber for text extraction, falls back to OCR if needed
"""

import io
import os
from typing import Optional, Tuple
import pdfplumber

# Try to import pytesseract for OCR fallback
try:
    import pytesseract
    from PIL import Image
    HAS_OCR = True
except ImportError:
    HAS_OCR = False


class FaxPDFProcessor:
    """Extract text from PDF attachments, with OCR fallback for image-only PDFs"""
    
    def __init__(self):
        self.has_ocr = HAS_OCR
        if self.has_ocr:
            # Check if tesseract binary is available
            try:
                pytesseract.get_tesseract_version()
            except Exception:
                self.has_ocr = False
    
    def extract_text_from_bytes(self, pdf_bytes: bytes) -> Tuple[str, str]:
        """
        Extract text from PDF bytes.
        
        Returns:
            Tuple of (extracted_text, method_used)
            method_used is 'text_layer', 'ocr', or 'failed'
        """
        try:
            with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
                all_text = []
                
                for i, page in enumerate(pdf.pages):
                    # Try to extract text directly (works if PDF has text layer)
                    text = page.extract_text()
                    
                    if text and len(text.strip()) > 50:
                        all_text.append(f"--- Page {i+1} ---\n{text}")
                    elif self.has_ocr:
                        # Fall back to OCR for image-only pages
                        ocr_text = self._ocr_page(page)
                        if ocr_text:
                            all_text.append(f"--- Page {i+1} (OCR) ---\n{ocr_text}")
                
                if all_text:
                    combined = "\n\n".join(all_text)
                    method = 'ocr' if '(OCR)' in combined else 'text_layer'
                    return combined, method
                
                return "", "failed"
                
        except Exception as e:
            print(f"❌ PDF extraction error: {e}")
            return "", "failed"
    
    def _ocr_page(self, page) -> Optional[str]:
        """OCR a single page using pytesseract"""
        if not self.has_ocr:
            return None
        
        try:
            # Convert page to image
            img = page.to_image(resolution=200)
            pil_image = img.original
            
            # Run OCR
            text = pytesseract.image_to_string(pil_image)
            return text.strip() if text else None
            
        except Exception as e:
            print(f"⚠️ OCR error: {e}")
            return None
    
    def extract_text_from_file(self, file_path: str) -> Tuple[str, str]:
        """Extract text from a PDF file path"""
        with open(file_path, 'rb') as f:
            return self.extract_text_from_bytes(f.read())


def is_ooma_fax(from_email: str, subject: str) -> bool:
    """Detect if email is an Ooma fax"""
    from_lower = from_email.lower()
    subject_lower = subject.lower()
    
    return (
        'ooma' in from_lower or 
        'no_reply@ooma.com' in from_lower or
        ('fax' in subject_lower and 'page' in subject_lower)
    )


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: fax_pdf_processor.py <path_to_pdf>")
        sys.exit(1)
    
    processor = FaxPDFProcessor()
    print(f"OCR available: {processor.has_ocr}")
    
    text, method = processor.extract_text_from_file(sys.argv[1])
    print(f"\nExtraction method: {method}")
    print(f"\n{'-'*50}\n{text[:2000]}...")
