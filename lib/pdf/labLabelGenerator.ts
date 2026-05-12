import PDFDocument from 'pdfkit';

export interface LabLabelParams {
    patientName: string;
    patientDob: string;
    drawDateTime: string; // ISO string — when the order was placed
    orderId?: string;
}

/**
 * Generate 3 specimen entries on ONE Zebra 3"x2" label (216pt x 144pt).
 * All 3 fit on a single sticker — staff cuts along dashed lines.
 *
 * Layout: 3 compact rows (~42pt each) with scissors-cut dashed lines.
 * Each row: Name + DOB on line 1, Draw + Order# on line 2.
 */
export async function generateLabLabels(params: LabLabelParams): Promise<Buffer> {
    const { patientName, patientDob, drawDateTime, orderId } = params;

    // Zebra GK420d: 3" x 2" = 216pt x 144pt (same stock as peptide labels)
    const W = 216;
    const H = 144;
    const L = 8;  // left margin
    const R = 8;  // right margin
    const PW = W - L - R; // printable width = 200pt

    const doc = new PDFDocument({
        size: [W, H],
        margins: { top: 0, left: 0, right: 0, bottom: 0 },
        autoFirstPage: true,
    });

    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    const dob = formatDate(patientDob);

    const drawDate = new Date(drawDateTime);
    const drawStr = drawDate.toLocaleDateString('en-US', {
        month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Phoenix'
    }) + ' ' + drawDate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Phoenix'
    });

    const rowH = 44;  // 3 rows × 44pt = 132pt, fits in 144pt

    for (let i = 0; i < 3; i++) {
        const y = 6 + (i * rowH);

        // Line 1: Name (left) + DOB (right)
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000')
           .text(patientName.toUpperCase(), L, y, {
               width: PW * 0.6, align: 'left', lineBreak: false });

        doc.fontSize(8).font('Helvetica').fillColor('#000000')
           .text(`DOB: ${dob}`, L + PW * 0.6, y + 2, {
               width: PW * 0.4, align: 'right', lineBreak: false });

        // Line 2: Draw date (left) + Order# (right)
        doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
           .text(`Draw: ${drawStr}`, L, y + 16, {
               width: PW * 0.65, align: 'left', lineBreak: false });

        if (orderId) {
            doc.fontSize(7).font('Helvetica').fillColor('#555555')
               .text(`${orderId}  |  NOW Optimal`, L + PW * 0.5, y + 17, {
                   width: PW * 0.5, align: 'right', lineBreak: false });
        }

        // Dashed cut line (scissors) between rows
        if (i < 2) {
            const lineY = y + rowH - 8;
            doc.save();
            doc.strokeColor('#AAAAAA').lineWidth(0.4).dash(4, { space: 3 });
            doc.moveTo(L, lineY).lineTo(W - R, lineY).stroke();
            doc.restore();
            // Tiny scissors icon hint
            doc.fontSize(5).font('Helvetica').fillColor('#BBBBBB')
               .text('✂', 1, lineY - 3);
        }
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
