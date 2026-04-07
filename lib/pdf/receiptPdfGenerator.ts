import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { getClinicInfo } from './clinicInfo';

export interface ReceiptItem {
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
}

export interface ReceiptPdfParams {
    receiptNumber: string;
    transactionDate: Date;
    patientName: string;
    patientEmail?: string;
    patientPhone?: string;
    items: ReceiptItem[];
    subtotal: number;
    tax?: number;
    total: number;
    paymentMethod: string;
    paymentLast4?: string;
    notes?: string;
    clinicLocation?: string;
}

/**
 * Generates a professional receipt PDF for iPad billing transactions
 * Shows actual item details while Stripe shows generic "NOWOptimal Service"
 */
export async function generateReceiptPdf(params: ReceiptPdfParams): Promise<Buffer> {
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
    const accentColor = '#00D4FF'; // NOW Optimal cyan
    const primaryColor = '#0C141D'; // NOW Optimal navy

    // ─── HEADER ───
    const clinic = getClinicInfo(params.clinicLocation);

    // Logo
    const logoPath = path.join(process.cwd(), 'public', 'nowoptimal_logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 60, 30, { width: 120 });
    } else {
        doc.fontSize(20).font('Helvetica-Bold')
           .fillColor(primaryColor)
           .text('NOW', 60, 35)
           .fillColor(accentColor)
           .text('Optimal', 110, 35);
    }

    // Clinic info top right
    doc.fontSize(8).font('Helvetica').fillColor('#333333')
        .text(clinic.name, 350, 30, { width: 200, align: 'right' })
        .text(clinic.address, 350, 41, { width: 200, align: 'right' })
        .text(clinic.city, 350, 52, { width: 200, align: 'right' })
        .text(`Phone: ${clinic.phone}`, 350, 63, { width: 200, align: 'right' })
        .text(`Fax: ${clinic.fax}`, 350, 74, { width: 200, align: 'right' });

    // Title bar
    doc.rect(60, 90, pageWidth, 35).fillColor(primaryColor).fill();
    doc.fillColor('#FFFFFF')
        .fontSize(16).font('Helvetica-Bold')
        .text('RECEIPT', 60, 100, { width: pageWidth, align: 'center' });

    // Receipt info section
    doc.fillColor('#333333');
    const infoY = 140;

    // Left column - Patient info
    doc.fontSize(9).font('Helvetica-Bold')
        .text('BILL TO:', 60, infoY);
    doc.fontSize(9).font('Helvetica')
        .text(params.patientName, 60, infoY + 15);

    if (params.patientEmail) {
        doc.text(params.patientEmail, 60, infoY + 30);
    }
    if (params.patientPhone) {
        doc.text(params.patientPhone, 60, infoY + 45);
    }

    // Right column - Receipt details
    doc.fontSize(9).font('Helvetica-Bold')
        .text('Receipt #:', 380, infoY, { width: 80, align: 'right' })
        .text('Date:', 380, infoY + 15, { width: 80, align: 'right' })
        .text('Payment:', 380, infoY + 30, { width: 80, align: 'right' });

    doc.fontSize(9).font('Helvetica')
        .text(params.receiptNumber, 465, infoY, { width: 87, align: 'right' })
        .text(params.transactionDate.toLocaleDateString('en-US'), 465, infoY + 15, { width: 87, align: 'right' })
        .text(params.paymentMethod, 465, infoY + 30, { width: 87, align: 'right' });

    if (params.paymentLast4) {
        doc.fontSize(8).fillColor('#666666')
            .text(`ending ${params.paymentLast4}`, 465, infoY + 42, { width: 87, align: 'right' });
    }

    // Items table header
    const tableY = infoY + 70;
    doc.rect(60, tableY, pageWidth, 25).fillColor('#f0f7fa').fill();

    doc.fillColor('#333333').fontSize(9).font('Helvetica-Bold')
        .text('Description', 68, tableY + 7)
        .text('Qty', 350, tableY + 7, { width: 40, align: 'center' })
        .text('Unit Price', 400, tableY + 7, { width: 70, align: 'right' })
        .text('Total', 480, tableY + 7, { width: 65, align: 'right' });

    // Items
    let currentY = tableY + 30;
    doc.fontSize(9).font('Helvetica');

    params.items.forEach((item) => {
        // Item name
        doc.fillColor('#000000')
            .text(item.name, 68, currentY, { width: 270 });

        // Quantity
        doc.text(item.quantity.toString(), 350, currentY, { width: 40, align: 'center' });

        // Unit price
        doc.text(`$${item.unitPrice.toFixed(2)}`, 400, currentY, { width: 70, align: 'right' });

        // Total
        doc.text(`$${item.total.toFixed(2)}`, 480, currentY, { width: 65, align: 'right' });

        currentY += 20;

        // Add line separator
        doc.moveTo(60, currentY - 5)
            .lineTo(552, currentY - 5)
            .lineWidth(0.5)
            .strokeColor('#e0e0e0')
            .stroke();
    });

    // Totals section
    currentY += 10;

    // Subtotal
    doc.fontSize(9).font('Helvetica')
        .fillColor('#666666')
        .text('Subtotal:', 400, currentY, { width: 70, align: 'right' })
        .text(`$${params.subtotal.toFixed(2)}`, 480, currentY, { width: 65, align: 'right' });

    currentY += 18;

    // Tax (if applicable)
    if (params.tax && params.tax > 0) {
        doc.text('Tax:', 400, currentY, { width: 70, align: 'right' })
            .text(`$${params.tax.toFixed(2)}`, 480, currentY, { width: 65, align: 'right' });
        currentY += 18;
    }

    // Total line
    doc.moveTo(400, currentY)
        .lineTo(545, currentY)
        .lineWidth(1)
        .strokeColor('#333333')
        .stroke();

    currentY += 8;

    // Total amount
    doc.fontSize(11).font('Helvetica-Bold')
        .fillColor('#000000')
        .text('TOTAL:', 400, currentY, { width: 70, align: 'right' })
        .fillColor(accentColor)
        .text(`$${params.total.toFixed(2)}`, 480, currentY, { width: 65, align: 'right' });

    // Payment status badge
    currentY += 30;
    doc.rect(60, currentY, 100, 25).fillColor('#10b981').fill();
    doc.fillColor('#FFFFFF')
        .fontSize(9).font('Helvetica-Bold')
        .text('PAID', 60, currentY + 7, { width: 100, align: 'center' });

    // Notes section (if any)
    if (params.notes) {
        currentY += 40;
        doc.fontSize(8).font('Helvetica-Bold')
            .fillColor('#666666')
            .text('Notes:', 60, currentY);
        doc.fontSize(8).font('Helvetica')
            .text(params.notes, 60, currentY + 12, { width: pageWidth });
    }

    // Footer
    const footerY = 700;
    doc.moveTo(60, footerY - 10)
        .lineTo(552, footerY - 10)
        .lineWidth(0.5)
        .strokeColor('#e0e0e0')
        .stroke();

    doc.fontSize(8).font('Helvetica')
        .fillColor('#999999')
        .text('Thank you for choosing NOWOptimal', 60, footerY, { width: pageWidth, align: 'center' })
        .text('This receipt serves as your official record of payment', 60, footerY + 12, { width: pageWidth, align: 'center' })
        .text('For questions about this charge, please contact our office', 60, footerY + 24, { width: pageWidth, align: 'center' });

    // Generate receipt ID barcode-style number at bottom
    doc.fontSize(7).font('Helvetica')
        .fillColor('#cccccc')
        .text(`Receipt ID: ${params.receiptNumber}`, 60, footerY + 40, { width: pageWidth, align: 'center' });

    doc.end();
    return pdfEnded;
}