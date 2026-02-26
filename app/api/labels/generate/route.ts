import { NextRequest, NextResponse } from "next/server";
import { generateLabelPdf, LabelParams } from "@/lib/pdf/labelGenerator";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);

    const type = (searchParams.get("type") as "peptide" | "testosterone") || "peptide";

    // Common fields
    const patientName = searchParams.get("patientName") || "John Doe";
    const patientDob = searchParams.get("patientDob") || "01/01/1980";
    const lotNumber = searchParams.get("lotNumber") || "";

    // Specific fields
    const medication = searchParams.get("medication") || "";
    const volume = searchParams.get("volume") || "";
    const vialNumber = searchParams.get("vialNumber") || "";
    const amountDispensed = searchParams.get("amountDispensed") || "";
    const provider = searchParams.get("provider") || "Phil Schafer, NP";
    const dateDispensed = searchParams.get("dateDispensed") || new Date().toLocaleDateString();
    const expDate = searchParams.get("expDate") || "";
    const dosage = searchParams.get("dosage") || "";

    const params: LabelParams = {
        type,
        patientName,
        patientDob,
        medication,
        dosage,
        lotNumber,
        volume,
        vialNumber,
        amountDispensed,
        provider,
        dateDispensed,
        expDate
    };

    try {
        const pdfBuffer = await generateLabelPdf(params);

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="label-${type}-${patientName.replace(/\s+/g, '-')}.pdf"`,
            },
        });

    } catch (err: any) {
        console.error("PDF generation error:", err);
        return NextResponse.json({ error: "Failed to generate label", details: err.message }, { status: 500 });
    }
}
