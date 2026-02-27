import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Deepgram transcription can take time

export async function POST(request: NextRequest) {
    let user;
    try { user = await requireApiUser(request, 'write'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const formData = await request.formData();
        const audioFile = formData.get('audio') as File | null;
        const patientId = formData.get('patient_id') as string;
        const appointmentId = formData.get('appointment_id') as string | null;
        const visitType = (formData.get('visit_type') as string) || 'follow_up';
        const preTranscribed = formData.get('transcript') as string | null;

        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
        }

        // Verify patient exists
        const [patient] = await query<any>(
            'SELECT patient_id, full_name FROM patients WHERE patient_id = $1',
            [patientId]
        );
        if (!patient) {
            return NextResponse.json({ success: false, error: 'Patient not found' }, { status: 404 });
        }

        let transcript = preTranscribed;
        let audioS3Key: string | null = null;

        // Upload audio to S3 if provided
        if (audioFile && !preTranscribed) {
            const buffer = Buffer.from(await audioFile.arrayBuffer());
            const s3Key = `scribe/audio/${patientId}/${Date.now()}.webm`;

            const s3Region = process.env.AWS_SES_REGION ?? process.env.AWS_REGION ?? 'us-east-2';
            const s3Bucket = process.env.SCRIBE_S3_BUCKET ?? 'gmh-clinical-data-lake';

            const s3 = new S3Client({ region: s3Region });
            await s3.send(new PutObjectCommand({
                Bucket: s3Bucket,
                Key: s3Key,
                Body: buffer,
                ContentType: audioFile.type || 'audio/webm',
            }));
            audioS3Key = s3Key;

            // Send to Deepgram for transcription
            const dgApiKey = process.env.DEEPGRAM_API_KEY;
            if (!dgApiKey) {
                return NextResponse.json(
                    { success: false, error: 'DEEPGRAM_API_KEY not configured' }, { status: 500 }
                );
            }

            const dgResponse = await fetch(
                'https://api.deepgram.com/v1/listen?model=nova-2-medical&smart_format=true&punctuate=true&diarize=true&paragraphs=true',
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${dgApiKey}`,
                        'Content-Type': audioFile.type || 'audio/webm',
                    },
                    body: buffer,
                }
            );

            if (!dgResponse.ok) {
                const errBody = await dgResponse.text();
                console.error('[Scribe:Transcribe] Deepgram error:', dgResponse.status, errBody);
                return NextResponse.json(
                    { success: false, error: `Deepgram transcription failed: ${dgResponse.status}` },
                    { status: 502 }
                );
            }

            const dgResult = await dgResponse.json();
            transcript = dgResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

            if (!transcript) {
                console.warn('[Scribe:Transcribe] Deepgram returned empty transcript');
            }
        }

        if (!audioFile && !preTranscribed) {
            return NextResponse.json(
                { success: false, error: 'Either audio file or pre-transcribed text is required' },
                { status: 400 }
            );
        }

        // Create scribe session
        const [session] = await query<any>(`
      INSERT INTO scribe_sessions
        (patient_id, appointment_id, visit_type, audio_s3_key,
         transcript, transcript_source, status, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
            patientId,
            appointmentId,
            visitType,
            audioS3Key,
            transcript,
            preTranscribed ? 'manual' : 'deepgram',
            transcript ? 'transcribed' : 'recording',
            user.user_id,
        ]);

        return NextResponse.json({
            success: true,
            data: {
                session_id: session.session_id,
                status: session.status,
                transcript_length: transcript?.length ?? 0,
                transcript_source: session.transcript_source,
                audio_stored: !!audioS3Key,
            },
        });
    } catch (error) {
        console.error('[Scribe:Transcribe] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
