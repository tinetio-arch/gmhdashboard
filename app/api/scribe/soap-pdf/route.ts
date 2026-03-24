import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateSoapPdf } from '@/lib/pdf/soapPdfGenerator';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scribe/soap-pdf/?session_id=xxx
 * Generate and return a professional SOAP note PDF for a given session.
 */
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    const sessionId = request.nextUrl.searchParams.get('session_id');
    if (!sessionId) {
        return NextResponse.json({ success: false, error: 'session_id required' }, { status: 400 });
    }

    try {
        // Fetch session + note + patient data
        const [row] = await query<any>(`
            SELECT
                ss.session_id, ss.visit_type, ss.created_at as session_date,
                p.full_name as patient_name, p.dob as patient_dob,
                p.phone_primary as patient_phone, p.email as patient_email,
                p.address_line1, p.city, p.state, p.postal_code, p.clinic as patient_clinic,
                sn.soap_subjective, sn.soap_objective, sn.soap_assessment, sn.soap_plan,
                sn.icd10_codes, sn.cpt_codes, sn.full_note_text, sn.evidence_citations
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id::text = p.patient_id::text
            LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
            WHERE ss.session_id = $1
        `, [sessionId]);

        if (!row) {
            return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
        }

        if (!row.soap_subjective && !row.full_note_text) {
            return NextResponse.json({ success: false, error: 'No SOAP note generated yet' }, { status: 400 });
        }

        // Parse ICD/CPT codes (stored as JSON arrays or strings, may be objects like {code, description})
        let icd10: string[] = [];
        let cpt: string[] = [];
        try {
            if (row.icd10_codes) {
                const raw = typeof row.icd10_codes === 'string' ? JSON.parse(row.icd10_codes) : row.icd10_codes;
                icd10 = raw.map((c: any) => {
                    if (typeof c === 'string') return c;
                    return c.description ? `${c.code} - ${c.description}` : c.code;
                });
            }
            if (row.cpt_codes) {
                const raw = typeof row.cpt_codes === 'string' ? JSON.parse(row.cpt_codes) : row.cpt_codes;
                cpt = raw.map((c: any) => {
                    if (typeof c === 'string') return c;
                    return c.description ? `${c.code} - ${c.description}` : c.code;
                });
            }
        } catch { /* ignore parse errors */ }

        const visitDate = row.session_date
            ? new Date(row.session_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
            : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        // Build patient address string
        const addressParts = [row.address_line1, row.city, row.state, row.postal_code].filter(Boolean);
        const patientAddress = addressParts.length > 0 ? addressParts.join(', ') : null;

        const pdfBuffer = await generateSoapPdf({
            patientName: row.patient_name || 'Unknown Patient',
            patientDob: row.patient_dob ? new Date(row.patient_dob).toLocaleDateString() : null,
            visitDate,
            visitType: row.visit_type || 'follow_up',
            provider: 'Phil Schafer, NP',
            subjective: row.soap_subjective || '',
            objective: row.soap_objective || '',
            assessment: row.soap_assessment || '',
            plan: row.soap_plan || '',
            icd10Codes: icd10,
            cptCodes: cpt,
            fullNoteText: row.full_note_text || '',
            patientPhone: row.patient_phone || null,
            patientEmail: row.patient_email || null,
            patientAddress,
            patientClinic: row.patient_clinic || null,
            evidenceCitations: row.evidence_citations ? (typeof row.evidence_citations === 'string' ? JSON.parse(row.evidence_citations) : row.evidence_citations) : [],
        });

        return new NextResponse(pdfBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="SOAP_${(row.patient_name || 'patient').replace(/\s+/g, '_')}_${visitDate.replace(/\s+/g, '_')}.pdf"`,
            },
        });
    } catch (error) {
        console.error('[Scribe:SoapPdf] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'PDF generation failed' },
            { status: 500 }
        );
    }
}
