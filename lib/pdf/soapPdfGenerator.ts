import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { renderRichText } from './renderRichText';
import { renderSignature } from './renderSignature';
import { getClinicInfo } from './clinicInfo';

export interface SoapPdfParams {
    patientName: string;
    patientDob: string | null;
    visitDate: string;
    visitType: string;
    provider: string;
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
    icd10Codes?: string[];
    cptCodes?: string[];
    fullNoteText?: string;
    patientPhone?: string | null;
    patientEmail?: string | null;
    patientAddress?: string | null;
    patientClinic?: string | null;
    evidenceCitations?: any[];
}

/**
 * Generates a professional SOAP note PDF with NowOptimal branding.
 * Uses rich text rendering for bold sub-headers, bullet points, and inline formatting.
 */
export async function generateSoapPdf(params: SoapPdfParams): Promise<Buffer> {
    const {
        patientName,
        patientDob,
        visitDate,
        visitType,
        provider,
        subjective,
        objective,
        assessment,
        plan,
        icd10Codes,
        cptCodes,
    } = params;

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
    doc.moveTo(60, 82).lineTo(552, 82).lineWidth(1.5).strokeColor('#00b4d8').stroke();

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
        .text(`Visit Date: ${visitDate}`, 300, 94)
        .text(`Visit Type: ${(visitType || '').replace(/_/g, ' ')}`, 300, 107);

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
        .text('SOAP Note', 60, contentStartY + 6, { align: 'center', width: pageWidth });

    doc.moveTo(60, contentStartY + 24).lineTo(552, contentStartY + 24).lineWidth(0.5).strokeColor('#cccccc').stroke();

    // Start writing content
    doc.x = 60;
    doc.y = contentStartY + 32;

    // ─── SOAP SECTIONS ───
    const sections: { letter: string; title: string; content: string; color: string }[] = [
        { letter: 'S', title: 'SUBJECTIVE', content: subjective, color: '#00b4d8' },
        { letter: 'O', title: 'OBJECTIVE', content: objective, color: '#7c3aed' },
        { letter: 'A', title: 'ASSESSMENT', content: assessment, color: '#f59e0b' },
        { letter: 'P', title: 'PLAN', content: plan, color: '#10b981' },
    ];

    for (const section of sections) {
        // Page break if not enough room for header + at least a few lines
        if (doc.y > 660) {
            doc.addPage();
        }

        // Section header with colored accent bar
        const headerY = doc.y;
        doc.rect(60, headerY, 3, 14).fillColor(section.color).fill();
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e')
            .text(`${section.letter} — ${section.title}`, 70, headerY + 1, { continued: false });

        // Thin separator under section header
        doc.moveTo(70, headerY + 16).lineTo(300, headerY + 16)
            .lineWidth(0.3).strokeColor(section.color).stroke();

        doc.y = headerY + 22;

        // Section content with rich text rendering
        if (section.content?.trim()) {
            renderRichText(doc, section.content, {
                x: 70,
                width: pageWidth - 10,
                fontSize: 9,
                lineGap: 2,
            });
        } else {
            doc.fontSize(9).font('Helvetica-Oblique').fillColor('#999999')
                .text('Not documented', 70, doc.y, { width: pageWidth - 10 });
        }

        doc.y += 14; // Gap between sections
    }

    // ─── ICD-10 & CPT CODES ───
    if ((icd10Codes && icd10Codes.length > 0) || (cptCodes && cptCodes.length > 0)) {
        if (doc.y > 680) doc.addPage();

        doc.y += 4;
        doc.moveTo(60, doc.y).lineTo(552, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
        doc.y += 8;

        if (icd10Codes && icd10Codes.length > 0) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e')
                .text('ICD-10 Codes:', 60, doc.y, { continued: false });
            doc.fontSize(8).font('Helvetica').fillColor('#333333')
                .text(icd10Codes.join(', '), { indent: 8, width: pageWidth - 8 });
            doc.y += 4;
        }

        if (cptCodes && cptCodes.length > 0) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e')
                .text('CPT Codes:', { continued: false });
            doc.fontSize(8).font('Helvetica').fillColor('#333333')
                .text(cptCodes.join(', '), { indent: 8, width: pageWidth - 8 });
        }
    }

    // ─── EVIDENCE-BASED REFERENCES ───
    if (params.evidenceCitations && params.evidenceCitations.length > 0) {
        if (doc.y > 660) doc.addPage();
        doc.y += 8;
        doc.moveTo(60, doc.y).lineTo(552, doc.y).lineWidth(0.5).strokeColor('#00b4d8').stroke();
        doc.y += 8;
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#00b4d8')
            .text('Evidence-Based References', 60, doc.y, { width: pageWidth });
        doc.y += 4;
        doc.fontSize(7).font('Helvetica-Oblique').fillColor('#888888')
            .text('Clinical guidelines supporting the assessment and plan:', 60, doc.y, { width: pageWidth });
        doc.y += 8;

        // Group by diagnosis
        const byDx: Record<string, any[]> = {};
        for (const c of params.evidenceCitations) {
            if (!byDx[c.diagnosis]) byDx[c.diagnosis] = [];
            byDx[c.diagnosis].push(c);
        }
        for (const [dx, cites] of Object.entries(byDx)) {
            if (doc.y > 700) doc.addPage();
            doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333')
                .text(dx + ':', 60, doc.y, { width: pageWidth });
            doc.y += 2;
            for (const c of cites) {
                if (doc.y > 720) doc.addPage();
                doc.fontSize(7).font('Helvetica').fillColor('#555555')
                    .text(`${c.number}. ${c.title} ${c.journal}. ${c.year}. `, 68, doc.y, { width: pageWidth - 8, lineGap: 1, continued: true })
                    .fillColor('#0077b6')
                    .text(`PMID: ${c.pmid}`, { link: c.url || `https://pubmed.ncbi.nlm.nih.gov/${c.pmid}/`, underline: true, continued: false });
                doc.y += 2;
            }
            doc.y += 4;
        }
    }

    // ─── SIGNATURE BLOCK ───
    // Needs ~65pt for cursive signature + line + name + date + timestamp
    if (doc.y > 690) doc.addPage();
    doc.y += 14;
    renderSignature(doc, { provider: provider || 'Phil Schafer, NP', visitDate });

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
