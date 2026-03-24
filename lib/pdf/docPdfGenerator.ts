import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { renderRichText } from './renderRichText';
import { renderSignature } from './renderSignature';
import { getClinicInfo } from './clinicInfo';

export interface DocPdfParams {
    patientName: string;
    patientDob: string | null;
    visitDate: string;
    provider: string;
    docType: 'work_note' | 'school_note' | 'discharge_instructions' | 'care_plan';
    content: string;
    patientPhone?: string | null;
    patientEmail?: string | null;
    patientAddress?: string | null;
    patientClinic?: string | null;
}

const DOC_TITLES: Record<string, string> = {
    work_note: 'Medical Excuse — Work',
    school_note: 'Medical Excuse — School',
    discharge_instructions: 'Discharge Instructions',
    care_plan: 'Care Plan',
};

const DOC_COLORS: Record<string, string> = {
    work_note: '#2563eb',
    school_note: '#7c3aed',
    discharge_instructions: '#00b4d8',
    care_plan: '#10b981',
};

/**
 * Generates a professional supplementary document PDF with NowOptimal branding.
 * Uses rich text rendering for bold sub-headers, bullet points, and inline formatting.
 */
export async function generateDocPdf(params: DocPdfParams): Promise<Buffer> {
    const { patientName, patientDob, visitDate, provider, docType, content } = params;

    const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, left: 60, right: 60, bottom: 60 },
        autoFirstPage: true,
        bufferPages: true,
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    const pageWidth = 612 - 120; // Letter width minus margins
    const accentColor = DOC_COLORS[docType] || '#00b4d8';
    const title = DOC_TITLES[docType] || 'Clinical Document';

    // ─── HEADER ───
    const clinic = getClinicInfo(params.patientClinic);

    const logoPath = path.join(process.cwd(), 'public', 'nowoptimal_logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 60, 30, { width: 120 });
    } else {
        doc.fontSize(16).font('Helvetica-Bold').text('NowOptimal', 60, 35);
    }

    // Clinic info top right
    doc.fontSize(8).font('Helvetica')
        .text(clinic.name, 350, 30, { width: 200, align: 'right' })
        .text(clinic.address, 350, 41, { width: 200, align: 'right' })
        .text(clinic.city, 350, 52, { width: 200, align: 'right' })
        .text(`Phone: ${clinic.phone}`, 350, 63, { width: 200, align: 'right' })
        .text(`Fax: ${clinic.fax}`, 350, 74, { width: 200, align: 'right' });

    // Divider
    doc.moveTo(60, 82).lineTo(552, 82).lineWidth(1.5).strokeColor(accentColor).stroke();

    // ─── PATIENT DEMOGRAPHICS BAR ───
    const hasContactInfo = params.patientPhone || params.patientEmail || params.patientAddress;
    const demoBarHeight = hasContactInfo ? 52 : 36;
    doc.rect(60, 88, pageWidth, demoBarHeight).fillColor('#f0f7fa').fill();
    doc.fillColor('#1a1a2e');

    doc.fontSize(9).font('Helvetica-Bold')
        .text(`Patient: ${patientName}`, 68, 94);
    doc.fontSize(8).font('Helvetica')
        .text(`DOB: ${patientDob || '—'}`, 68, 107);

    doc.fontSize(8).font('Helvetica')
        .text(`Date: ${visitDate}`, 300, 94)
        .text(`Provider: ${provider}`, 300, 107);

    if (hasContactInfo) {
        const contactParts: string[] = [];
        if (params.patientPhone) contactParts.push(`Phone: ${params.patientPhone}`);
        if (params.patientEmail) contactParts.push(`Email: ${params.patientEmail}`);
        doc.fontSize(7.5).font('Helvetica').fillColor('#555555');
        if (contactParts.length > 0) {
            doc.text(contactParts.join('    |    '), 68, 120, { width: pageWidth - 16 });
        }
        if (params.patientAddress) {
            doc.text(`Address: ${params.patientAddress}`, 68, 130, { width: pageWidth - 16 });
        }
    }

    const contentStartY = 88 + demoBarHeight;

    // ─── TITLE ───
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text(title, 60, contentStartY + 6, { align: 'center', width: pageWidth });

    // Accent bar under title
    doc.rect(60, contentStartY + 24, pageWidth, 2).fillColor(accentColor).fill();

    // ─── DOCUMENT CONTENT ───
    doc.x = 60;
    doc.y = contentStartY + 34;

    const isLetter = docType === 'work_note' || docType === 'school_note';

    if (content?.trim()) {
        if (isLetter) {
            // ─── LETTER FORMAT for work/school notes ───
            // Strip the AI-generated signature block — we'll render our own professional one
            let letterBody = content
                .replace(/---/g, '')
                .replace(/Sincerely,[\s\S]*$/i, '')
                .trim();

            // Render letter body with larger font and generous line spacing
            renderRichText(doc, letterBody, {
                x: 60,
                width: pageWidth,
                fontSize: 10.5,
                lineGap: 4,
            });

            // ─── FORMAL LETTER SIGNATURE BLOCK ───
            if (doc.y > 600) doc.addPage();
            doc.y += 24;

            doc.fontSize(10.5).font('Helvetica').fillColor('#333333')
                .text('Sincerely,', 60, doc.y, { width: pageWidth });
            doc.y += 20;

            // Cursive signature + typed name + credentials + timestamp
            renderSignature(doc, { provider: provider || 'Phil Schafer, NP', visitDate });

            // Clinic contact info below signature
            doc.y += 8;
            doc.fontSize(8.5).font('Helvetica').fillColor('#555555')
                .text(clinic.name, 60, doc.y, { lineBreak: false });
            doc.y += 11;
            doc.text(`${clinic.address}, ${clinic.city}`, 60, doc.y, { lineBreak: false });
            doc.y += 11;
            doc.text(`Phone: ${clinic.phone}  |  Fax: ${clinic.fax}`, 60, doc.y, { lineBreak: false });
            doc.y += 11;
            doc.text(`Email: ${clinic.email}`, 60, doc.y, { lineBreak: false });
        } else {
            // Standard rich text rendering for discharge/care plan
            renderRichText(doc, content, {
                x: 60,
                width: pageWidth,
                fontSize: 9.5,
                lineGap: 2.5,
            });

            // Standard signature with cursive
            if (doc.y > 680) doc.addPage();
            doc.y += 14;
            renderSignature(doc, { provider: provider || 'Phil Schafer, NP', visitDate });
        }
    } else {
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999999')
            .text('No content generated', 60, doc.y, { width: pageWidth });

        // Signature for empty docs
        doc.y += 14;
        renderSignature(doc, { provider: provider || 'Phil Schafer, NP', visitDate });
    }

    // ─── FOOTER on every page ───
    // Temporarily remove bottom margin so writing at y=748 doesn't trigger a new page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const savedMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(7).font('Helvetica').fillColor('#999999')
            .text(
                `NowOptimal Network — CONFIDENTIAL — Page ${i - range.start + 1} of ${range.count}`,
                60, 748,
                { width: pageWidth, align: 'center', lineBreak: false }
            );
        doc.page.margins.bottom = savedMargin;
    }

    doc.end();
    return await pdfEnded;
}
