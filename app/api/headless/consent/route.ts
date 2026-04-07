/**
 * Mobile App — Peptide Consent Form Generator & Upload
 *
 * Generates a professional PDF consent form listing the specific peptides
 * the patient is purchasing, includes their signature timestamp,
 * and uploads it to their Healthie chart as a document.
 *
 * POST /api/headless/consent
 * Headers: x-jarvis-secret
 * Body: {
 *   healthie_id: string,
 *   patient_name: string,
 *   peptides: Array<{ name: string, price: number, quantity: number }>,
 *   signature_text: string,  // "Signed by [Name] on [Date]"
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import PDFDocument from 'pdfkit';

export const maxDuration = 30;

// Healthie GraphQL helper
async function healthieGraphQL(gqlQuery: string, variables: any) {
    const apiKey = process.env.HEALTHIE_API_KEY;
    if (!apiKey) throw new Error('HEALTHIE_API_KEY not configured');

    const response = await fetch('https://api.gethealthie.com/graphql', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`,
            'AuthorizationSource': 'API',
        },
        body: JSON.stringify({ query: gqlQuery, variables }),
    });

    const result = await response.json();
    if (result.errors) {
        throw new Error(`Healthie GraphQL error: ${result.errors[0]?.message}`);
    }
    return result.data;
}

interface ConsentPeptide {
    name: string;
    price: number;
    quantity: number;
}

async function generateConsentPDF(
    patientName: string,
    peptides: ConsentPeptide[],
    signatureText: string,
    signatureImage: string | null,
    date: Date,
): Promise<Buffer> {
    const path = require('path');
    const fs = require('fs');

    const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, left: 60, right: 60, bottom: 60 },
        autoFirstPage: true,
        bufferPages: false,
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const total = peptides.reduce((sum, p) => sum + p.price * p.quantity, 0);
    const primaryColor = '#0C141D';
    const accentColor = '#00D4FF';

    // Header with NOW Optimal logo (same as receipts)
    const logoPath = path.join(process.cwd(), 'public', 'nowoptimal_logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 60, 30, { width: 120 });
    } else {
        doc.fontSize(24).font('Helvetica-Bold')
           .fillColor(primaryColor).text('NOW', 60, 35)
           .fillColor(accentColor).text('Optimal', 125, 35);
    }

    // Clinic info on right side
    doc.fontSize(9).font('Helvetica')
       .fillColor('#666666')
       .text('NOW Optimal Health', 350, 35, { width: 200, align: 'right' })
       .fontSize(8)
       .text('404 S. Montezuma St, Prescott, AZ 86301', 350, 48, { width: 200, align: 'right' })
       .text('(928) 277-0001 | nowoptimal.com', 350, 60, { width: 200, align: 'right' });

    doc.moveDown(3);
    doc.moveTo(60, doc.y).lineTo(552, doc.y).strokeColor('#CCCCCC').stroke();
    doc.moveDown(0.5);

    // Title
    doc.fontSize(18).fillColor('#000000')
        .text('PEPTIDE INFORMED CONSENT', { align: 'center' })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#666666')
        .text(`Date: ${dateStr}  |  Patient: ${patientName}`, { align: 'center' })
        .moveDown(1);

    // Products section
    doc.fontSize(12).fillColor('#000000')
        .text('Products Being Purchased:', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333');
    for (const p of peptides) {
        const qty = p.quantity > 1 ? ` (x${p.quantity})` : '';
        doc.text(`  •  ${p.name}${qty} — $${(p.price * p.quantity).toFixed(2)}`);
    }
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#000000')
        .text(`  Total: $${total.toFixed(2)}`, { bold: true } as any);
    doc.moveDown(1);

    // Research Peptide Acknowledgment
    doc.fontSize(12).fillColor('#000000')
        .text('1. RESEARCH PEPTIDE ACKNOWLEDGMENT', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333')
        .text(
            'I understand that the products listed above are classified as research peptides and are NOT approved by the U.S. Food and Drug Administration (FDA) for the treatment, cure, or prevention of any disease or medical condition. These compounds are provided under the supervision of a licensed medical provider as part of a personalized treatment protocol.',
            { lineGap: 2 }
        )
        .moveDown(0.8);

    // Understanding of Risks
    doc.fontSize(12).fillColor('#000000')
        .text('2. UNDERSTANDING OF RISKS', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333');
    const risks = [
        'These peptides have not undergone full FDA approval for safety and efficacy in humans.',
        'Potential side effects may include: injection site reactions (redness, swelling, pain), nausea, headache, dizziness, fatigue, flushing, and allergic reactions.',
        'Long-term effects of these compounds may not be fully established.',
        'Individual results may vary and are not guaranteed.',
        'I should immediately discontinue use and contact my provider or seek emergency medical attention if I experience severe adverse reactions.',
    ];
    for (const risk of risks) {
        doc.text(`  •  ${risk}`, { lineGap: 1 });
    }
    doc.moveDown(0.8);

    // Provider Supervision
    doc.fontSize(12).fillColor('#000000')
        .text('3. PROVIDER SUPERVISION', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333')
        .text(
            'I confirm that I have been evaluated by a licensed medical provider at NOW Optimal Health and that the above peptide(s) have been recommended as part of my individualized treatment plan. I agree to use them only as directed by my prescribing provider and to report any adverse effects promptly.',
            { lineGap: 2 }
        )
        .moveDown(0.8);

    // Administration & Storage
    doc.fontSize(12).fillColor('#000000')
        .text('4. ADMINISTRATION & STORAGE', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333');
    const admin = [
        'I will follow all reconstitution and injection instructions provided by my provider.',
        'I will store peptides refrigerated (2-8°C / 36-46°F) after reconstitution.',
        'I will use reconstituted peptides within 4 weeks unless otherwise directed.',
        'I will use sterile injection technique and never share needles or vials.',
        'I will properly dispose of sharps in an approved container.',
    ];
    for (const item of admin) {
        doc.text(`  •  ${item}`, { lineGap: 1 });
    }
    doc.moveDown(0.8);

    // Payment Authorization
    doc.fontSize(12).fillColor('#000000')
        .text('5. PAYMENT & SHIPPING AUTHORIZATION', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333')
        .text(
            `I authorize NOW Optimal Health to charge my card on file $${total.toFixed(2)} for the products listed above, plus applicable shipping fees (USPS Priority Mail; free on orders over $200). Products will be shipped to my address on file. I understand that all sales of research peptides are final and non-refundable.`,
            { lineGap: 2 }
        )
        .moveDown(0.8);

    // Voluntary Consent
    doc.fontSize(12).fillColor('#000000')
        .text('6. VOLUNTARY CONSENT', { underline: true })
        .moveDown(0.3);

    doc.fontSize(10).fillColor('#333333')
        .text(
            'I have read and understand all sections of this consent form. I have had the opportunity to ask questions and have received satisfactory answers. I voluntarily consent to the purchase and use of the above research peptide(s). I understand that I may withdraw my consent and discontinue use at any time by contacting the clinic.',
            { lineGap: 2 }
        )
        .moveDown(1);

    // Signature section
    doc.fontSize(12).fillColor('#000000')
        .text('SIGNATURE', { underline: true })
        .moveDown(0.5);

    // Finger signature image if provided
    if (signatureImage) {
        try {
            const sigBuffer = Buffer.from(signatureImage.replace(/^data:image\/\w+;base64,/, ''), 'base64');
            doc.image(sigBuffer, 60, doc.y, { width: 200, height: 60 });
            doc.moveDown(3);
        } catch (e) {
            // Fallback to text if image fails
            doc.fontSize(11).text(signatureText);
        }
    } else {
        doc.moveDown(0.3);
    }

    doc.moveTo(60, doc.y).lineTo(300, doc.y).strokeColor('#000000').stroke();
    doc.moveDown(0.3);

    doc.fontSize(10).fillColor('#000000')
        .text(signatureText, { align: 'left' })
        .moveDown(0.2);

    doc.fontSize(10).fillColor('#666666')
        .text(`Date: ${dateStr}`, { align: 'left' })
        .text(`Patient: ${patientName}`, { align: 'left' });

    doc.moveDown(1);
    doc.fontSize(8).fillColor('#999999')
        .text('This document has been electronically signed via the NOW Optimal mobile application.', { align: 'center' })
        .text(`Document generated: ${date.toISOString()}`, { align: 'center' });

    doc.end();
    return pdfEnded;
}

export async function POST(request: NextRequest) {
    const secret = request.headers.get('x-jarvis-secret');
    if (secret !== process.env.JARVIS_SHARED_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { healthie_id, patient_name, peptides, signature_text, signature_image } = body as {
            healthie_id: string;
            patient_name: string;
            peptides: ConsentPeptide[];
            signature_text: string;
            signature_image?: string; // base64 data URL of finger signature
        };

        if (!healthie_id || !patient_name || !peptides?.length || !signature_text) {
            return NextResponse.json({
                error: 'healthie_id, patient_name, peptides, and signature_text are required',
            }, { status: 400 });
        }

        // 1. Generate the consent PDF with logo and signature
        const date = new Date();
        const pdfBuffer = await generateConsentPDF(patient_name, peptides, signature_text, signature_image || null, date);

        console.log(`[Consent] Generated PDF for ${patient_name}: ${pdfBuffer.length} bytes, ${peptides.length} peptides`);

        // 2. Upload to Healthie patient chart
        const base64 = pdfBuffer.toString('base64');
        const dataUrl = `data:application/pdf;base64,${base64}`;
        const dateShort = date.toISOString().split('T')[0];
        const filename = `Peptide_Consent_${patient_name.replace(/\s+/g, '_')}_${dateShort}.pdf`;

        const uploadResult = await healthieGraphQL(
            `mutation CreateDocument($input: createDocumentInput!) {
                createDocument(input: $input) {
                    document { id display_name }
                    messages { field message }
                }
            }`,
            {
                input: {
                    rel_user_id: String(healthie_id),
                    display_name: filename,
                    file_string: dataUrl,
                    include_in_charting: true,
                    share_with_rel: true,
                    description: `Peptide Informed Consent — ${peptides.map(p => p.name).join(', ')}`,
                },
            }
        );

        const documentId = uploadResult?.createDocument?.document?.id;

        console.log(`[Consent] Uploaded to Healthie: document ${documentId} for patient ${healthie_id}`);

        // 3. Log in database
        try {
            const [patient] = await query<any>(
                `SELECT patient_id FROM patients WHERE healthie_client_id = $1 LIMIT 1`,
                [healthie_id]
            );
            if (patient) {
                await query(
                    `INSERT INTO payment_transactions
                     (patient_id, amount, description, stripe_account, status, created_at, healthie_document_id)
                     VALUES ($1::uuid, 0, $2, 'none', 'consent_signed', NOW(), $3)`,
                    [patient.patient_id, `Peptide consent signed: ${peptides.map(p => p.name).join(', ')}`, documentId]
                );
            }
        } catch (dbErr) {
            console.warn('[Consent] DB log failed (non-critical):', dbErr);
        }

        return NextResponse.json({
            success: true,
            document_id: documentId,
            filename,
            message: `Consent form signed and uploaded to your chart.`,
        });

    } catch (error: any) {
        console.error('[Consent] Error:', error);
        return NextResponse.json({
            error: 'Failed to process consent form. Please try again or call (928) 212-2772.',
        }, { status: 500 });
    }
}
