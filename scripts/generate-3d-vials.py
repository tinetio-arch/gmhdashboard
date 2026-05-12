#!/usr/bin/env python3
"""
Generate 3D vial mockup images using Gemini image generation.
Matches the existing ABXTAC vial style: dark pharmaceutical vial with
black cap, silver rim, dark label, ABXTAC logo, product name, dose.

Usage: python3 scripts/generate-3d-vials.py [--dry-run]
"""

import os
import sys
import time
import base64
import json
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [VialGen] %(message)s')
logger = logging.getLogger(__name__)

DRY_RUN = '--dry-run' in sys.argv
OUTPUT_DIR = Path('/home/ec2-user/abxtac-website/public/3d-vials')
NGINX_DIR = Path('/var/www/abxtac/3d-vials')

# Load env
env_path = '/home/ec2-user/gmhdashboard/.env.local'
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                key = key.strip()
                if key not in os.environ:
                    os.environ[key] = val.strip()

API_KEY = os.environ.get('GOOGLE_AI_API_KEY', '')

PRODUCTS = [
    ('YPB.250', 'AICAR', '50 mg'),
    ('YPB.251', 'B12', '10 ml'),
    ('YPB.252', 'DSIP', '5 mg'),
    ('YPB.253', 'Epitalon', '10 mg'),
    ('YPB.254', 'Epitalon', '50 mg'),
    ('YPB.255', 'FOXO4', '10 mg'),
    ('YPB.256', 'HCG', '10000 iu'),
    ('YPB.257', 'GHRP-6', '10 mg'),
    ('YPB.258', 'HMG', '75 iu'),
    ('YPB.259', 'Glutathione', '1500 mg'),
    ('YPB.261', 'Hexarelin', '5 mg'),
    ('YPB.262', 'IGF-1 LR3', '1 mg'),
    ('YPB.263', 'Ipamorelin', '10 mg'),
    ('YPB.264', 'KLOW Blend', '70 mg'),
    ('YPB.265', 'KPV', '10 mg'),
    ('YPB.266', 'KissPeptin', '10 mg'),
    ('YPB.267', 'Lipotropic 8X', 'Multi'),
    ('YPB.268', 'MIC Blend 4X', 'Multi'),
    ('YPB.269', 'Mazdutide', '100 mg'),
    ('YPB.270', 'Melanotan 2', '10 mg'),
    ('YPB.271', 'MOTS-c', '40 mg'),
    ('YPB.272', 'Snap-8', '10 mg'),
    ('YPB.273', 'Pinealon', '20 mg'),
    ('YPB.274', 'PT-141', '10 mg'),
    ('YPB.275', 'PNC-27', '10 mg'),
    ('YPB.277', 'ARA-290', '10 mg'),
    ('YPB.278', 'Survodutide', '10 mg'),
    ('YPB.279', 'Tesamorelin', '10 mg'),
    ('YPB.280', 'Thymalin', '10 mg'),
    ('YPB.281', 'VIP10', '10 mg'),
    ('YPB.282', 'GHRP-6', '5 mg'),
    ('YPB.283', 'Glutathione', '600 mg'),
    ('YPB.285', 'IGF-1 LR3', '0.1 mg'),
    ('YPB.286', 'IGF-DES', '0.1 mg'),
    ('YPB.287', 'GLP-3 RZ', '60 mg'),
    ('YPB.288', 'Tesamorelin', '20 mg'),
]

# Read a reference vial image to use as style reference
REFERENCE_IMAGE_PATH = OUTPUT_DIR / 'YPB.212_mockup.png'


def generate_vial_image(sku, name, dose, reference_b64):
    """Generate a 3D vial mockup using Imagen 4."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=API_KEY)

    prompt = (
        f"A professional product photograph of a single pharmaceutical research peptide vial "
        f"on a clean white background with soft shadow. The vial has a dark black glass body "
        f"with subtle reflections, a black rubber flip-off cap on top, and a silver aluminum "
        f"crimp seal below the cap. On the front of the vial is a dark matte label featuring "
        f"the ABXTAC brand logo (a stylized letter X inside a circle) at the top in white, "
        f"the text 'ABXTAC' in small white letters below the logo, the product name "
        f"'{name}' in large bold white text in the center, and the dosage '{dose}' in green "
        f"text below the product name. Studio lighting, pharmaceutical product photography, "
        f"centered composition, photorealistic, high detail, no other objects or text."
    )

    try:
        response = client.models.generate_images(
            model='imagen-4.0-generate-001',
            prompt=prompt,
            config=types.GenerateImagesConfig(
                number_of_images=1,
                aspect_ratio='1:1',
            )
        )

        if response.generated_images and len(response.generated_images) > 0:
            return response.generated_images[0].image.image_bytes
    except Exception as e:
        # Fall back to gemini-2.5-flash-image for multimodal generation
        logger.info(f'  Imagen failed ({e}), trying gemini-2.5-flash-image...')
        try:
            ref_image = types.Part.from_bytes(
                data=base64.b64decode(reference_b64),
                mime_type='image/png'
            )
            response = client.models.generate_content(
                model='gemini-2.5-flash-image',
                contents=[ref_image, prompt],
                config=types.GenerateContentConfig(
                    response_modalities=['IMAGE', 'TEXT'],
                )
            )
            for part in response.candidates[0].content.parts:
                if hasattr(part, 'inline_data') and part.inline_data and part.inline_data.mime_type.startswith('image/'):
                    return part.inline_data.data
        except Exception as e2:
            raise Exception(f'Both Imagen and Gemini failed: {e2}')

    return None


def main():
    logger.info(f'Generating {len(PRODUCTS)} 3D vial mockups...')
    if DRY_RUN:
        logger.info('(DRY RUN)')

    # Load reference image
    if not REFERENCE_IMAGE_PATH.exists():
        logger.error(f'Reference image not found: {REFERENCE_IMAGE_PATH}')
        return

    ref_b64 = base64.b64encode(REFERENCE_IMAGE_PATH.read_bytes()).decode()
    logger.info(f'Loaded reference image: {REFERENCE_IMAGE_PATH.name}')

    created = 0
    skipped = 0
    failed = 0

    for sku, name, dose in PRODUCTS:
        filename = f'{sku}_mockup.png'
        out_path = OUTPUT_DIR / filename

        # Check if a proper 3D vial already exists (not our flat card)
        if out_path.exists() and out_path.stat().st_size > 180000:
            logger.info(f'  SKIP (exists, >180KB): {filename}')
            skipped += 1
            continue

        if DRY_RUN:
            logger.info(f'  WOULD GENERATE: {filename} — {name} {dose}')
            created += 1
            continue

        try:
            logger.info(f'  Generating: {filename} — {name} {dose}...')
            image_data = generate_vial_image(sku, name, dose, ref_b64)

            if image_data:
                out_path.write_bytes(image_data)
                size_kb = len(image_data) / 1024
                logger.info(f'  CREATED: {filename} ({size_kb:.0f}KB)')

                # Also copy to nginx directory
                if NGINX_DIR.exists():
                    nginx_path = NGINX_DIR / filename
                    nginx_path.write_bytes(image_data)

                created += 1
            else:
                logger.error(f'  FAILED: {filename} — no image in response')
                failed += 1

            # Rate limit: ~10 requests/minute for Gemini
            time.sleep(6)

        except Exception as e:
            logger.error(f'  FAILED: {filename} — {e}')
            failed += 1
            time.sleep(10)

    logger.info(f'\nDone: {created} created, {skipped} skipped, {failed} failed')


if __name__ == '__main__':
    main()
