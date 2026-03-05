import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

/**
 * Strip markdown formatting from text for clean PDF rendering.
 */
function stripMarkdown(text: string): string {
    if (!text) return '';
    return text
        // Remove bold/italic markers
        .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        // Remove heading markers
        .replace(/^#{1,6}\s+/gm, '')
        // Remove code blocks
        .replace(/```[\s\S]*?```/g, '')
        // Remove inline code
        .replace(/`([^`]+)`/g, '$1')
        // Remove horizontal rules
        .replace(/^[-*_]{3,}\s*$/gm, '')
        // Remove link formatting [text](url) → text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Remove bullet markers (keep the text)
        .replace(/^[\s]*[-•]\s+/gm, '• ')
        // Remove numbered list markers but keep numbers
        .replace(/^(\s*)\d+\.\s+/gm, '$1')
        // Collapse excessive blank lines
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

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
}

/**
 * Generates a professional SOAP note PDF with NowOptimal branding.
 * Uses continuous text flow — no aggressive manual page breaks.
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
        bufferPages: true,
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    const pageWidth = 612 - 120; // Letter width minus margins

    // ─── HEADER ───
    const logoPath = path.join(process.cwd(), 'public', 'nowoptimal_logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 60, 30, { width: 120 });
    } else {
        doc.fontSize(16).font('Helvetica-Bold').text('NowOptimal', 60, 35);
    }

    // Clinic info top right
    doc.fontSize(8).font('Helvetica')
        .text('NowOptimal Network', 350, 35, { width: 200, align: 'right' })
        .text('215 N McCormick St', 350, 46, { width: 200, align: 'right' })
        .text('Prescott, AZ 86301', 350, 57, { width: 200, align: 'right' })
        .text('(928) 910-9232', 350, 68, { width: 200, align: 'right' });

    // Divider
    doc.moveTo(60, 82).lineTo(552, 82).lineWidth(1.5).strokeColor('#00b4d8').stroke();

    // ─── PATIENT DEMOGRAPHICS BAR ───
    doc.rect(60, 88, pageWidth, 36).fillColor('#f0f7fa').fill();
    doc.fillColor('#1a1a2e');

    doc.fontSize(9).font('Helvetica-Bold')
        .text(`Patient: ${patientName}`, 68, 94);
    doc.fontSize(8).font('Helvetica')
        .text(`DOB: ${patientDob || '—'}`, 68, 107);

    doc.fontSize(8).font('Helvetica')
        .text(`Visit Date: ${visitDate}`, 300, 94)
        .text(`Visit Type: ${(visitType || '').replace(/_/g, ' ')}`, 300, 107);

    // ─── TITLE ───
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a2e')
        .text('SOAP Note', 60, 132, { align: 'center', width: pageWidth });

    doc.moveTo(60, 150).lineTo(552, 150).lineWidth(0.5).strokeColor('#cccccc').stroke();

    // Start writing content using PDFKit's natural flow
    doc.x = 60;
    doc.y = 158;

    // ─── SOAP SECTIONS ───
    const sections: { letter: string; title: string; content: string; color: string }[] = [
        { letter: 'S', title: 'SUBJECTIVE', content: subjective, color: '#00b4d8' },
        { letter: 'O', title: 'OBJECTIVE', content: objective, color: '#7c3aed' },
        { letter: 'A', title: 'ASSESSMENT', content: assessment, color: '#f59e0b' },
        { letter: 'P', title: 'PLAN', content: plan, color: '#10b981' },
    ];

    for (const section of sections) {
        const y = doc.y;

        // Only break page if header won't fit (need ~40px for header + some content)
        if (y > 710) {
            doc.addPage();
        }

        // Section header with colored accent bar
        const headerY = doc.y;
        doc.rect(60, headerY, 3, 14).fillColor(section.color).fill();
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a1a2e')
            .text(`${section.letter} — ${section.title}`, 68, headerY + 1, { continued: false });
        doc.y = headerY + 18;

        // Section content — let PDFKit handle page flow naturally
        doc.fontSize(9).font('Helvetica').fillColor('#333333');
        const cleanContent = stripMarkdown(section.content) || 'Not documented';
        doc.text(cleanContent, 68, doc.y, {
            width: pageWidth - 8,
            lineGap: 1.5,
        });
        doc.y += 10; // Small gap between sections
    }

    // ─── ICD-10 & CPT CODES ───
    if ((icd10Codes && icd10Codes.length > 0) || (cptCodes && cptCodes.length > 0)) {
        if (doc.y > 710) doc.addPage();

        doc.moveDown(0.5);
        doc.moveTo(60, doc.y).lineTo(552, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
        doc.moveDown(0.5);

        if (icd10Codes && icd10Codes.length > 0) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e')
                .text('ICD-10 Codes:', 60, doc.y, { continued: false });
            doc.fontSize(8).font('Helvetica').fillColor('#333333')
                .text(icd10Codes.join(', '), { indent: 8, width: pageWidth - 8 });
        }

        if (cptCodes && cptCodes.length > 0) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a1a2e')
                .text('CPT Codes:', { continued: false });
            doc.fontSize(8).font('Helvetica').fillColor('#333333')
                .text(cptCodes.join(', '), { indent: 8, width: pageWidth - 8 });
        }
    }

    // ─── SIGNATURE LINE ───
    if (doc.y > 700) doc.addPage();
    doc.moveDown(1.5);
    const sigY = doc.y;
    doc.moveTo(60, sigY).lineTo(250, sigY).lineWidth(0.5).strokeColor('#999999').stroke();
    doc.fontSize(8).font('Helvetica').fillColor('#666666')
        .text(provider || 'Phil Schafer, NP', 60, sigY + 4)
        .text(`Date: ${visitDate}`);

    // ─── FOOTER on every page ───
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#999999')
            .text(
                `NowOptimal Network — CONFIDENTIAL — Page ${i + 1} of ${pages.count}`,
                60, 740,
                { width: pageWidth, align: 'center' }
            );
    }

    doc.end();
    return await pdfEnded;
}
