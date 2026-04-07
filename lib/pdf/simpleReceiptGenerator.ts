import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

export interface SimpleReceiptParams {
    receiptNumber: string;
    date: Date;
    patientName: string;
    description: string; // Actual service/product description from charge
    amount: number;
    paymentMethod: string;
    clinicName?: string;
    providerName?: string;
    isMensHealth?: boolean; // Flag to determine which address to use
}

/**
 * Generates a SIMPLE, SINGLE-PAGE receipt PDF
 * Minimal design to prevent multi-page issues
 *
 * CRITICAL: This receipt MUST show the ACTUAL service purchased (not hardcoded defaults)
 * - Pelleting services show as "Pelleting Service"
 * - Peptide products show their actual names
 * - Other services show their specific descriptions
 */
export async function generateSimpleReceipt(params: SimpleReceiptParams): Promise<Buffer> {
    const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, left: 60, right: 60, bottom: 60 },
        autoFirstPage: true,
        bufferPages: false,  // CRITICAL: Prevent multi-page generation
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });

    const pageWidth = 492; // 612 - 120 margins (matches other PDFs)
    const primaryColor = '#0C141D';
    const accentColor = '#00D4FF';

    // ===== HEADER with Logo =====
    const logoPath = path.join(process.cwd(), 'public', 'nowoptimal_logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 60, 30, { width: 120 });
    } else {
        // Fallback to text logo
        doc.fontSize(24).font('Helvetica-Bold')
           .fillColor(primaryColor)
           .text('NOW', 60, 35)
           .fillColor(accentColor)
           .text('Optimal', 125, 35);
    }

    // Clinic information - MOVED TO RIGHT SIDE to avoid logo overlap
    const clinicName = params.clinicName || 'NOW Optimal Health';
    let clinicAddress: string;
    let clinicPhone: string;

    // CRITICAL: Use correct address based on patient type
    if (params.isMensHealth) {
        // NOWMensHealth.care groups use 215 N. McCormick
        clinicAddress = '215 N. McCormick St, Prescott, AZ 86301';
        clinicPhone = '(928) 277-0001';
    } else {
        // All other receipts use 404 S. Montezuma
        clinicAddress = '404 S. Montezuma St, Prescott, AZ 86301';
        clinicPhone = '(928) 277-0001';
    }

    // Place clinic info on RIGHT side to avoid logo
    doc.fontSize(9).font('Helvetica')
       .fillColor('#666666')
       .text(clinicName, 350, 35, { width: 200, align: 'right' })
       .fontSize(8)
       .text(clinicAddress, 350, 48, { width: 200, align: 'right' })
       .text(clinicPhone, 350, 60, { width: 200, align: 'right' });

    // Receipt title - centered
    doc.fontSize(16).font('Helvetica-Bold')
       .fillColor(primaryColor)
       .text('PAYMENT RECEIPT', 60, 90, { width: pageWidth, align: 'center' });

    // Divider line
    doc.moveTo(60, 115).lineTo(552, 115).lineWidth(1).strokeColor('#e0e0e0').stroke();

    // ===== RECEIPT INFO SECTION =====
    const infoY = 135;
    const labelX = 60;
    const valueX = 180;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
       .text('Receipt Number:', labelX, infoY);
    doc.font('Helvetica').text(params.receiptNumber, valueX, infoY);

    doc.font('Helvetica-Bold').text('Transaction Date:', labelX, infoY + 18);
    doc.font('Helvetica').text(params.date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
    }), valueX, infoY + 18);

    doc.font('Helvetica-Bold').text('Patient Name:', labelX, infoY + 36);
    doc.font('Helvetica').text(params.patientName, valueX, infoY + 36);

    doc.font('Helvetica-Bold').text('Payment Method:', labelX, infoY + 54);
    doc.font('Helvetica').text(params.paymentMethod, valueX, infoY + 54);

    if (params.providerName) {
        doc.font('Helvetica-Bold').text('Provider:', labelX, infoY + 72);
        doc.font('Helvetica').text(params.providerName, valueX, infoY + 72);
    }

    // ===== SERVICE DETAILS SECTION =====
    const serviceY = params.providerName ? 255 : 235;

    // Light background box for service details
    doc.rect(60, serviceY, pageWidth, 70).fillColor('#f8f9fa').fill();

    // Service header
    doc.fontSize(11).font('Helvetica-Bold')
       .fillColor(primaryColor)
       .text('Service/Product Description:', 70, serviceY + 12);

    // CRITICAL: Show ACTUAL description from charge (not hardcoded)
    // This will be the internal description that was preserved from the charge
    doc.fontSize(11).font('Helvetica')
       .fillColor('#000000')
       .text(params.description || 'Service', 70, serviceY + 32, {
           width: pageWidth - 20,
           height: 30,  // Limit height to prevent overflow
           ellipsis: true
       });

    // ===== AMOUNT SECTION =====
    const amountY = serviceY + 90;

    // Amount box with accent color
    doc.rect(60, amountY, pageWidth, 60).fillColor('#f0fdfa').fill();

    doc.fontSize(11).font('Helvetica-Bold')
       .fillColor('#333333')
       .text('Total Amount Paid:', 70, amountY + 12);

    doc.fontSize(22).font('Helvetica-Bold')
       .fillColor(accentColor)
       .text(`$${params.amount.toFixed(2)}`, 70, amountY + 30);

    // Payment status badge
    doc.rect(420, amountY + 20, 70, 24).fill('#10b981');
    doc.fillColor('#FFFFFF')
       .fontSize(10).font('Helvetica-Bold')
       .text('PAID', 420, amountY + 28, { width: 70, align: 'center' });

    // ===== FOOTER =====
    // Keep footer high enough to stay on single page
    const footerY = 480;  // Well below our content but above page limit

    doc.moveTo(60, footerY).lineTo(552, footerY).lineWidth(0.5).strokeColor('#e0e0e0').stroke();

    doc.fontSize(9).font('Helvetica')
       .fillColor('#666666')
       .text('Thank you for choosing NOW Optimal', 60, footerY + 12, { width: pageWidth, align: 'center' })
       .text('This receipt is for your records only', 60, footerY + 26, { width: pageWidth, align: 'center' });

    doc.fontSize(8).fillColor('#bbbbbb')
       .text(`Generated on ${new Date().toLocaleString('en-US')}`, 60, footerY + 42, { width: pageWidth, align: 'center' })
       .text(`Receipt ID: ${params.receiptNumber}`, 60, footerY + 54, { width: pageWidth, align: 'center' });

    // Add a small disclaimer if needed
    doc.fontSize(7).fillColor('#cccccc')
       .text('For questions about this receipt, please contact our office', 60, footerY + 70, { width: pageWidth, align: 'center' });

    doc.end();
    return pdfEnded;
}