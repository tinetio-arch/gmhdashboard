export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { getPool } from '@/lib/db';
import ScribeClient from './ScribeClient';

export const metadata: Metadata = {
    title: 'AI Scribe - GMH Dashboard',
    description: 'AI-powered medical scribe for visit documentation',
};

async function loadScribeData() {
    try {
        const pool = getPool();

        // Load recent sessions with notes
        const sessionsRes = await pool.query(`
            SELECT 
                ss.session_id, ss.patient_id, ss.appointment_id,
                ss.visit_type, ss.status, ss.transcript,
                ss.audio_s3_key, ss.transcript_source,
                ss.created_at, ss.updated_at,
                p.full_name as patient_name, p.healthie_client_id,
                sn.note_id, sn.soap_subjective, sn.soap_objective,
                sn.soap_assessment, sn.soap_plan,
                sn.healthie_status, sn.healthie_note_id,
                sn.icd10_codes, sn.cpt_codes,
                sn.supplementary_docs, sn.full_note_text
            FROM scribe_sessions ss
            LEFT JOIN patients p ON ss.patient_id = p.patient_id
            LEFT JOIN scribe_notes sn ON ss.session_id = sn.session_id
            ORDER BY ss.created_at DESC
            LIMIT 50
        `);

        // Load patient list for search
        const patientsRes = await pool.query(`
            SELECT patient_id, full_name, healthie_client_id, dob
            FROM patients 
            WHERE full_name IS NOT NULL 
            ORDER BY full_name ASC
            LIMIT 500
        `);

        return {
            sessions: sessionsRes.rows.map(r => ({
                ...r,
                created_at: r.created_at?.toISOString(),
                updated_at: r.updated_at?.toISOString(),
                icd10_codes: r.icd10_codes || [],
                cpt_codes: r.cpt_codes || [],
                supplementary_docs: r.supplementary_docs || {},
            })),
            patients: patientsRes.rows.map(r => ({
                patient_id: r.patient_id,
                full_name: r.full_name,
                healthie_client_id: r.healthie_client_id,
                dob: r.dob,
            })),
        };
    } catch (e) {
        console.error('[Scribe Page] Failed to load data:', e);
        return { sessions: [], patients: [] };
    }
}

export default async function ScribePage() {
    await requireUser('write');
    const { sessions, patients } = await loadScribeData();

    return (
        <section style={{ padding: '1.5rem', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div>
                        <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem', color: '#0f172a', fontWeight: 700 }}>
                            🎙️ AI Scribe
                        </h1>
                        <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                            Record visits, generate SOAP notes, edit with AI, submit to Healthie.
                        </p>
                    </div>
                    <Link
                        href="/"
                        style={{
                            color: '#0ea5e9', textDecoration: 'none', fontSize: '0.9rem',
                            fontWeight: 600, padding: '0.5rem 1rem', borderRadius: '0.5rem',
                            border: '1px solid #0ea5e9'
                        }}
                    >
                        ← Dashboard
                    </Link>
                </div>
            </div>

            <ScribeClient sessions={sessions} patients={patients} />
        </section>
    );
}
