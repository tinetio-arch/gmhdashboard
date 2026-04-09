import PDFDocument from 'pdfkit';

export interface LabLabelParams {
    patientName: string;
    patientDob: string;
    drawDateTime: string; // ISO string — when the order was placed
    orderId?: string;
}

/**
 * Generate 3 specimen labels on a single page for Dymo printing.
 * Each label: 3.5" x 1.125" (standard Dymo 30252 address label)
 * Layout: 3 labels stacked vertically on one page
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
    const labelGap = 8;
    const pageHeight = (labelHeight * 3) + (labelGap * 2) + 20; // 3 labels + gaps + margin

    const doc = new PDFDocument({
        size: [labelWidth + 20, pageHeight],
        margins: { top: 10, left: 10, right: 10, bottom: 10 },
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    // Format DOB
    const dob = formatDate(patientDob);

    // Format draw date/time
    const drawDate = new Date(drawDateTime);
    const drawStr = drawDate.toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric'
    }) + ' ' + drawDate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Draw 3 identical labels
    for (let i = 0; i < 3; i++) {
        const y = 10 + (i * (labelHeight + labelGap));

        // Label border (light gray dashed for cut guide)
        doc.rect(10, y, labelWidth, labelHeight)
           .dash(3, { space: 3 })
           .strokeColor('#CCCCCC')
           .stroke()
           .undash();

        // Patient name — large and bold
        doc.fontSize(14).font('Helvetica-Bold')
           .fillColor('#000000')
           .text(patientName.toUpperCase(), 16, y + 6, {
               width: labelWidth - 12,
               align: 'left',
           });

        // DOB
        doc.fontSize(10).font('Helvetica')
           .fillColor('#333333')
           .text(`DOB: ${dob}`, 16, y + 26, {
               width: labelWidth - 12,
           });

        // Draw date/time
        doc.fontSize(10).font('Helvetica-Bold')
           .fillColor('#000000')
           .text(`Draw: ${drawStr}`, 16, y + 40, {
               width: labelWidth - 12,
           });

        // Order ID (small, bottom right)
        if (orderId) {
            doc.fontSize(7).font('Helvetica')
               .fillColor('#999999')
               .text(`Order: ${orderId}`, 16, y + 56, {
                   width: labelWidth - 12,
                   align: 'right',
               });
        }

        // Clinic name (small, bottom left)
        doc.fontSize(7).font('Helvetica')
           .fillColor('#999999')
           .text('NOW Optimal Health', 16, y + 56, {
               width: labelWidth - 12,
               align: 'left',
           });
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
