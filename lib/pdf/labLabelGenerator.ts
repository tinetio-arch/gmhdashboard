import PDFDocument from 'pdfkit';

export interface LabLabelParams {
    patientName: string;
    patientDob: string;
    drawDateTime: string; // ISO string — when the order was placed
    orderId?: string;
}

/**
 * Generate 3 specimen labels for Dymo 30252 printing.
 * Each label: 3.5" x 1.125" (252pt x 81pt)
 *
 * FIX(2026-04-09): Each label is now a SEPARATE PDF PAGE so the Dymo
 * feeds one label per page. Previously all 3 were on a single canvas
 * which the Dymo couldn't print correctly.
 *
 * Each label contains:
 *   - Patient full name (large, bold)
 *   - Date of Birth
 *   - Date and time of draw
 *   - Order ID (if available)
 */
export async function generateLabLabels(params: LabLabelParams): Promise<Buffer> {
    const { patientName, patientDob, drawDateTime, orderId } = params;

    // Dymo 30252 label: 3.5" x 1.125" = 252pt x 81pt
    const labelWidth = 252;
    const labelHeight = 81;

    const doc = new PDFDocument({
        size: [labelWidth, labelHeight],
        margins: { top: 4, left: 6, right: 6, bottom: 4 },
        autoFirstPage: false,
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    // Format DOB
    const dob = formatDate(patientDob);

    // Format draw date/time in Arizona timezone
    const drawDate = new Date(drawDateTime);
    const drawStr = drawDate.toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Phoenix'
    }) + ' ' + drawDate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Phoenix'
    });

    const printableWidth = labelWidth - 12;

    // 3 identical labels — each on its own page
    for (let i = 0; i < 3; i++) {
        doc.addPage({ size: [labelWidth, labelHeight], margins: { top: 4, left: 6, right: 6, bottom: 4 } });

        // Patient name — large and bold
        doc.fontSize(13).font('Helvetica-Bold')
           .fillColor('#000000')
           .text(patientName.toUpperCase(), 6, 4, {
               width: printableWidth,
               align: 'left',
               lineBreak: false,
           });

        // DOB
        doc.fontSize(9).font('Helvetica')
           .fillColor('#000000')
           .text(`DOB: ${dob}`, 6, 22, {
               width: printableWidth,
           });

        // Draw date/time
        doc.fontSize(9).font('Helvetica-Bold')
           .fillColor('#000000')
           .text(`Draw: ${drawStr}`, 6, 36, {
               width: printableWidth,
           });

        // Bottom row: clinic name left, order ID right
        doc.fontSize(6.5).font('Helvetica')
           .fillColor('#666666')
           .text('NOW Optimal Health', 6, 52, {
               width: printableWidth / 2,
               align: 'left',
           });

        if (orderId) {
            doc.fontSize(6.5).font('Helvetica')
               .fillColor('#666666')
               .text(`#${orderId}`, labelWidth / 2, 52, {
                   width: printableWidth / 2,
                   align: 'right',
               });
        }

        // Thin separator line at bottom
        doc.moveTo(6, 64).lineTo(labelWidth - 6, 64)
           .strokeColor('#CCCCCC').lineWidth(0.5).stroke();
    }

    doc.end();
    return pdfEnded;
}

function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
        }
        // Try MM-DD-YYYY or YYYY-MM-DD
        const iso = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
        return dateStr;
    } catch {
        return dateStr;
    }
}
