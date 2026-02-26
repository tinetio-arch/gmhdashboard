import PDFDocument from "pdfkit";
import fs from "fs";

export interface LabelParams {
    type: "peptide" | "testosterone";
    patientName: string;
    patientDob: string;
    medication: string;
    dosage: string;
    lotNumber: string;
    volume: string;
    vialNumber?: string;
    amountDispensed?: string;
    provider?: string;
    dateDispensed?: string;
    expDate?: string;
}

/**
 * Normalize any date string to MM-DD-YYYY format
 */
function formatDateMMDDYYYY(dateStr: string | null | undefined): string {
    if (!dateStr || dateStr === '—' || dateStr === 'Unknown') return dateStr || '';
    try {
        // Handle YYYY-MM-DD (ISO)
        const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return `${isoMatch[2]}-${isoMatch[3]}-${isoMatch[1]}`;

        // Handle MM/DD/YYYY
        const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) return `${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}-${slashMatch[3]}`;

        // Handle MM-DD-YYYY (already correct)
        const dashMatch = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (dashMatch) return dateStr;

        // Try parsing as Date object
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
        }

        return dateStr; // Return as-is if unparseable
    } catch {
        return dateStr;
    }
}

/**
 * Generates a 3x2 inch label PDF Buffer using PDFKit
 */
export async function generateLabelPdf(params: LabelParams): Promise<Buffer> {
    const {
        type,
        patientName,
        medication,
        lotNumber,
        volume
    } = params;

    const patientDob = formatDateMMDDYYYY(params.patientDob);
    const vialNumber = params.vialNumber || "";
    const amountDispensed = params.amountDispensed || "";
    const providerRaw = params.provider || "Phil Schafer, NP";
    const dateDispensed = formatDateMMDDYYYY(params.dateDispensed) || formatDateMMDDYYYY(new Date().toISOString());
    const expDate = formatDateMMDDYYYY(params.expDate) || "";

    // Parse Dosage
    let dosage = params.dosage || "";
    dosage = dosage.replace(/(\d+(?:\.\d+)?)\s*Q\s*(\d+)D/ig, 'Inject $1ml Intramuscularly Every $2 Days');
    // If it's already got ml
    dosage = dosage.replace(/(\d+(?:\.\d+)?)\s*ml\s*Q\s*(\d+)D/ig, 'Inject $1ml Intramuscularly Every $2 Days');

    // Parse Provider and DEA (Provider is passed as "Dr. Name - DEA: 1234")
    let providerName = providerRaw;
    let providerDea = "";
    if (providerRaw.includes(" - DEA: ")) {
        const parts = providerRaw.split(" - DEA: ");
        providerName = parts[0];
        providerDea = `DEA: ${parts[1]}`;
    }

    // Zebra GK420d 3x2 inch label = 216 x 144 points (72 points per inch)
    const doc = new PDFDocument({
        size: [216, 144],
        margins: { top: 10, left: 10, right: 10, bottom: 10 }
    });

    const buffers: Buffer[] = [];
    doc.on("data", buffers.push.bind(buffers));

    const pdfEnded = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(buffers)));
    });

    if (type === "testosterone") {
        // --- NOW MENS HEALTH LABEL ---
        const logoPath = "/home/ec2-user/nowmenshealth-website/public/logo.png";
        if (fs.existsSync(logoPath)) {
            // Embed the actual NOW Mens Health logo
            doc.image(logoPath, 10, 10, { width: 90 });
        } else {
            doc.fontSize(12).font('Helvetica-Bold').text("NOW MENS HEALTH.CARE", 10, 10);
        }

        // Clinic Info / Provider Top Right
        doc.fontSize(6).font('Helvetica-Bold')
            .text(providerName, 115, 10, { width: 91, align: 'right' });
        if (providerDea) {
            doc.fontSize(5).font('Helvetica')
                .text(providerDea, 115, 17, { width: 91, align: 'right' });
        }
        doc.fontSize(5).font('Helvetica')
            .text("215 N McCormick St", 115, providerDea ? 25 : 18, { width: 91, align: 'right' })
            .text("Prescott, AZ 86301", 115, providerDea ? 31 : 24, { width: 91, align: 'right' });

        // Middle: Patient Info
        doc.fontSize(9).font('Helvetica-Bold')
            .text("Patient Name ", 10, 52, { continued: true })
            .font('Helvetica').text(patientName);

        doc.fontSize(9).font('Helvetica-Bold')
            .text("Patient DOB ", 10, 67, { continued: true })
            .font('Helvetica').text(patientDob);

        // Medication Info
        doc.fontSize(9).font('Helvetica-Bold').text(medication || "Testosterone Cypionate 200mg/ml", 10, 85);
        doc.fontSize(7).font('Helvetica').text(dosage, 10, 97);

        // Footer: Vial, Lot, Exp, Dispensed
        doc.fontSize(6).font('Helvetica')
            .text(`Vial #: ${vialNumber}`, 10, 106)
            .text(`Lot: ${lotNumber}`, 10, 114);

        doc.text(`Dispensed: ${amountDispensed} ml`, 80, 106)
            .text(`Exp: ${expDate}`, 80, 114);

        doc.text(`Date: ${dateDispensed}`, 150, 110, { align: 'right', width: 56 });

        doc.fontSize(4.5).font('Helvetica-Bold')
            .text("* CONTROLLED SUBSTANCE - RX ONLY *", 10, 124, { align: 'center', width: 196 });

    } else {
        // --- ABXTAC PEPTIDE LABEL ---

        // Map peptide instructions (Dose, Frequency, How to inject)
        let peptideInstructions = dosage || "Use as directed";
        const medLower = medication.toLowerCase();

        // Auto-generate instruction string if standard dosage wasn't provided or needs augmenting
        if (medLower.includes("tesamorelin") && medLower.includes("ipamorelin")) {
            peptideInstructions = "Inject 5 to 15 units SUBQ 5 days on, 2 days off.\nNotes: Inject Fasted - 45 mins before & after.";
        } else if (medLower.includes("bpc-157")) {
            peptideInstructions = "Inject 10 to 20 units SUBQ daily.\nNotes: Can inject locally near injury.";
        } else if (medLower.includes("cjc") || medLower.includes("ipamorelin") || medLower.includes("sermorelin")) {
            peptideInstructions = "Inject 10 to 15 units SUBQ 5 days on, 2 days off.\nNotes: Inject Fasted - 45 mins before & after.";
        } else if (medLower.includes("hcg") || medLower.includes("tb-500")) {
            peptideInstructions = "Inject 10 to 50 units SUBQ 2 times per week.";
        } else if (medLower.includes("pt-141")) {
            peptideInstructions = "Inject 10 to 20 units SUBQ as needed.\nNotes: Use 2-4 hours before activity.";
        } else if (medLower.includes("retatrutide") || medLower.includes("semaglutide") || medLower.includes("tirzepatide")) {
            peptideInstructions = "Inject SUBQ once weekly as directed by provider.";
        }

        // --- TOP LEFT: Logo (constrain height to prevent overflow) ---
        const logoPath = "/home/ec2-user/gmhdashboard/public/abxtac_logo.png";
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, 10, 8, { height: 28 });
        } else {
            doc.fontSize(12).font('Helvetica-Bold').text("ABXTAC", 10, 12);
        }

        // --- TOP RIGHT: Issuer Info ---
        doc.fontSize(6).font('Helvetica-Bold')
            .text("ISSUED BY: ABXTAC", 120, 8, { width: 86, align: 'right' });
        doc.fontSize(5).font('Helvetica')
            .text("212 S Montezuma STE 3", 120, 16, { width: 86, align: 'right' })
            .text("Prescott, AZ 86303", 120, 22, { width: 86, align: 'right' });

        // --- Divider line ---
        doc.moveTo(10, 38).lineTo(206, 38).lineWidth(0.5).stroke();

        // --- Patient Info ---
        doc.fontSize(7).font('Helvetica-Bold')
            .text("Patient: ", 10, 42, { continued: true })
            .font('Helvetica').text(patientName, { width: 130 });

        doc.fontSize(7).font('Helvetica-Bold')
            .text("DOB: ", 10, 53, { continued: true })
            .font('Helvetica').text(patientDob);

        // --- Divider line ---
        doc.moveTo(10, 63).lineTo(206, 63).lineWidth(0.5).stroke();

        // --- MEDICATION (use smaller font for long compound names) ---
        const medFontSize = medication.length > 40 ? 6 : 7;
        doc.fontSize(medFontSize).font('Helvetica-Bold')
            .text(medication, 10, 67, { width: 196 });

        // --- INSTRUCTIONS (compact, always readable) ---
        doc.fontSize(5.5).font('Helvetica')
            .text(peptideInstructions, 10, 80, { width: 196, lineGap: 1.5 });

        // --- Divider line ---
        doc.moveTo(10, 108).lineTo(206, 108).lineWidth(0.5).stroke();

        // --- FOOTER: Date & Warning ---
        doc.fontSize(5.5).font('Helvetica')
            .text(`Date: ${dateDispensed}`, 10, 111);

        doc.fontSize(4).font('Helvetica-Bold')
            .text("* NOT FDA Approved; Requires Medical Direction *", 10, 120, { align: 'center', width: 196 });
    }

    doc.end();
    return await pdfEnded;
}
