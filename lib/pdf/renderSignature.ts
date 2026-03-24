import fs from 'fs';
import path from 'path';

/**
 * Render a professional provider signature block on a PDF document.
 * Uses Dancing Script (cursive) font for the handwriting-style signature,
 * with typed name, credentials, date, and electronic signature timestamp below.
 */
export function renderSignature(doc: any, opts: {
    provider: string;
    visitDate: string;
    x?: number;
}): void {
    const { provider = 'Phil Schafer, NP', visitDate, x = 60 } = opts;

    // Extract just the name without credentials for the cursive signature
    const sigName = provider.replace(/,?\s*(NP|NMD|MD|DO|RN|PA|PA-C|DNP|FNP|APRN)$/i, '').trim();

    // Load cursive font
    const fontPath = path.join(process.cwd(), 'public', 'fonts', 'DancingScript.ttf');
    const hasCursiveFont = fs.existsSync(fontPath);

    if (hasCursiveFont) {
        // Register the font if not already registered
        try {
            doc.font(fontPath);
        } catch {
            // Font already registered or load failed — fall back
        }
    }

    // Cursive signature
    if (hasCursiveFont) {
        doc.fontSize(22).font(fontPath).fillColor('#1a1a2e')
            .text(sigName, x, doc.y, { lineBreak: false });
        doc.y += 28;
    } else {
        // Fallback: italic Helvetica
        doc.fontSize(14).font('Helvetica-BoldOblique').fillColor('#1a1a2e')
            .text(sigName, x, doc.y, { lineBreak: false });
        doc.y += 20;
    }

    // Signature line
    doc.moveTo(x, doc.y).lineTo(x + 200, doc.y).lineWidth(0.5).strokeColor('#999999').stroke();
    doc.y += 4;

    // Typed name and credentials
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#333333')
        .text(provider, x, doc.y, { lineBreak: false });
    doc.y += 12;

    // Date
    doc.fontSize(8).font('Helvetica').fillColor('#666666')
        .text(`Date: ${visitDate}`, x, doc.y, { lineBreak: false });
    doc.y += 12;

    // Electronic signature timestamp
    const timestamp = new Date().toLocaleString('en-US', {
        timeZone: 'America/Phoenix',
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    doc.fontSize(7).font('Helvetica-Oblique').fillColor('#888888')
        .text(`Electronically signed by ${provider} on ${timestamp}`, x, doc.y, { lineBreak: false });
}
