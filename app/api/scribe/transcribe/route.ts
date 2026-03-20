import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser, UnauthorizedError } from '@/lib/auth';
import { query } from '@/lib/db';
import { denoiseAudioBuffer } from '@/lib/audio-denoise';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
    TranscribeClient,
    StartMedicalTranscriptionJobCommand,
    GetMedicalTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-2';
const S3_BUCKET = process.env.SCRIBE_S3_BUCKET ?? 'gmh-clinical-data-lake';

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
        const patientName = formData.get('patient_name') as string | null;
        const encounterDate = formData.get('encounter_date') as string | null;

        if (!patientId) {
            return NextResponse.json({ success: false, error: 'patient_id is required' }, { status: 400 });
        }

        // Resolve patient from local DB
        // Check if patientId is a UUID before querying the uuid column
        let patient: any = null;
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(patientId);
        if (isUuid) {
            const [byId] = await query<any>(
                'SELECT patient_id, full_name FROM patients WHERE patient_id = $1::uuid',
                [patientId]
            );
            if (byId) patient = byId;
        }
        if (!patient) {
            const [byHealthie] = await query<any>(
                'SELECT patient_id, full_name FROM patients WHERE healthie_client_id = $1',
                [patientId]
            );
            if (byHealthie) patient = byHealthie;
        }
        const resolvedPatientId = patient?.patient_id || patientId;
        const resolvedPatientName = patient?.full_name || patientName || 'Unknown Patient';

        let transcript = preTranscribed;
        let audioS3Key: string | null = null;
        let transcribeJobName: string | null = null;

        // ==================== AUDIO → S3 → AWS TRANSCRIBE MEDICAL ====================
        if (audioFile && !preTranscribed) {
            const buffer = Buffer.from(await audioFile.arrayBuffer());

            // Validate size (max 2 hours ≈ ~100MB for webm)
            if (buffer.byteLength > 200 * 1024 * 1024) {
                return NextResponse.json(
                    { success: false, error: 'Audio file too large (max 200MB)' },
                    { status: 400 }
                );
            }

            // Determine file extension from MIME type
            const mimeType = audioFile.type || 'audio/webm';
            const extMap: Record<string, string> = {
                'audio/webm': 'webm',
                'audio/mp4': 'mp4',
                'audio/mpeg': 'mp3',
                'audio/wav': 'wav',
                'audio/x-wav': 'wav',
                'audio/ogg': 'ogg',
                'audio/flac': 'flac',
                'audio/m4a': 'm4a',
                'audio/x-m4a': 'm4a',
            };
            const ext = extMap[mimeType] || 'webm';

            // ==================== DENOISE AUDIO ====================
            // RNNoise + ffmpeg noise reduction before uploading to S3
            // Falls back to raw audio if denoise fails (never blocks the flow)
            let processedBuffer = buffer;
            let uploadExt = ext;
            let uploadMimeType = mimeType;

            if (process.env.SCRIBE_DENOISE_ENABLED !== 'false') {
                try {
                    const denoised = await denoiseAudioBuffer(buffer, ext);
                    processedBuffer = denoised.buffer;
                    uploadExt = denoised.format; // 'wav'
                    uploadMimeType = 'audio/wav';
                    console.log(`[Scribe] Audio denoised: ${ext} → ${uploadExt} in ${denoised.durationMs}ms (${(buffer.length/1024).toFixed(0)}KB → ${(processedBuffer.length/1024).toFixed(0)}KB)`);
                } catch (denoiseErr: any) {
                    console.warn('[Scribe] Denoise failed, using original audio:', denoiseErr?.message);
                }
            }

            const timestamp = Date.now();
            const s3Key = `scribe/audio/${resolvedPatientId}/${timestamp}.${uploadExt}`;

            // Upload to S3
            const s3 = new S3Client({ region: AWS_REGION });
            await s3.send(new PutObjectCommand({
                Bucket: S3_BUCKET,
                Key: s3Key,
                Body: processedBuffer,
                ContentType: uploadMimeType,
            }));
            audioS3Key = s3Key;

            // Start AWS Transcribe Medical job
            // Matching Python scribe: Specialty=PRIMARYCARE, Type=CONVERSATION, speaker labels
            transcribeJobName = `scribe-${resolvedPatientId}-${timestamp}`;
            const mediaUri = `s3://${S3_BUCKET}/${s3Key}`;

            // Map our extensions to AWS Transcribe media formats
            const awsFormatMap: Record<string, string> = {
                'webm': 'webm',
                'mp4': 'mp4',
                'mp3': 'mp3',
                'wav': 'wav',
                'ogg': 'ogg',
                'flac': 'flac',
                'm4a': 'mp4',
            };
            const mediaFormat = awsFormatMap[uploadExt] || 'webm';

            const transcribe = new TranscribeClient({ region: AWS_REGION });
            try {
                await transcribe.send(new StartMedicalTranscriptionJobCommand({
                    MedicalTranscriptionJobName: transcribeJobName,
                    LanguageCode: 'en-US',
                    Media: { MediaFileUri: mediaUri },
                    OutputBucketName: S3_BUCKET,
                    OutputKey: `scribe/transcripts/${transcribeJobName}.json`,
                    Specialty: 'PRIMARYCARE',
                    Type: 'CONVERSATION',
                    Settings: {
                        ShowSpeakerLabels: true,
                        MaxSpeakerLabels: 2,
                    },
                }));
                console.log(`[Scribe] Started AWS Transcribe Medical job: ${transcribeJobName}`);
            } catch (txErr: any) {
                console.error('[Scribe] Failed to start transcription:', txErr);
                return NextResponse.json(
                    { success: false, error: `Transcription start failed: ${txErr?.message || txErr}` },
                    { status: 502 }
                );
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
                 transcript, transcript_source, status, created_by, encounter_date)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [
            resolvedPatientId,
            appointmentId,
            visitType,
            audioS3Key,
            transcript,                                                    // null if async transcription
            preTranscribed ? 'manual' : 'aws_transcribe_medical',
            preTranscribed ? 'transcribed' : 'transcribing',               // new status for async
            user.user_id,
            encounterDate || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Phoenix' }),
        ]);

        return NextResponse.json({
            success: true,
            data: {
                session_id: session.session_id,
                status: session.status,
                transcript_length: transcript?.length ?? 0,
                transcript_source: session.transcript_source,
                audio_stored: !!audioS3Key,
                transcribe_job_name: transcribeJobName,                    // iPad polls with this
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

// ==================== GET: Poll transcription status ====================
// iPad calls this every few seconds until status is 'transcribed'
export async function GET(request: NextRequest) {
    try { await requireApiUser(request, 'read'); }
    catch (error) {
        if (error instanceof UnauthorizedError)
            return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
        throw error;
    }

    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('session_id');

        if (!sessionId) {
            return NextResponse.json({ success: false, error: 'session_id is required' }, { status: 400 });
        }

        const [session] = await query<any>(
            'SELECT * FROM scribe_sessions WHERE session_id = $1',
            [sessionId]
        );
        if (!session) {
            return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
        }

        // If already transcribed, return immediately
        if (session.transcript) {
            return NextResponse.json({
                success: true,
                data: {
                    session_id: session.session_id,
                    status: session.status,
                    transcript: session.transcript,
                    transcript_length: session.transcript.length,
                },
            });
        }

        // Check AWS Transcribe job status
        if (session.transcript_source === 'aws_transcribe_medical' && session.status === 'transcribing') {
            // Derive job name from audio_s3_key timestamp
            const timestamp = session.audio_s3_key?.match(/\/(\d+)\.\w+$/)?.[1] || '';
            const jobName = `scribe-${session.patient_id}-${timestamp}`;

            const transcribe = new TranscribeClient({ region: AWS_REGION });
            try {
                const jobResp = await transcribe.send(new GetMedicalTranscriptionJobCommand({
                    MedicalTranscriptionJobName: jobName,
                }));
                const jobStatus = jobResp.MedicalTranscriptionJob?.TranscriptionJobStatus;

                if (jobStatus === 'COMPLETED') {
                    // Fetch transcript from S3
                    const transcriptKey = `scribe/transcripts/${jobName}.json`;
                    const s3 = new S3Client({ region: AWS_REGION });

                    const s3Resp = await s3.send(new GetObjectCommand({
                        Bucket: S3_BUCKET,
                        Key: transcriptKey,
                    }));
                    const bodyStr = await s3Resp.Body?.transformToString();
                    if (!bodyStr) throw new Error('Empty transcript file from S3');

                    const transcriptData = JSON.parse(bodyStr);

                    // Extract speaker-labeled transcript (AWS Medical Transcribe format)
                    let transcript = '';

                    if (transcriptData.results?.speaker_labels?.segments) {
                        // Build transcript with speaker labels: "Speaker 0: Hello doctor\nSpeaker 1: How can I help?"
                        const segments = transcriptData.results.speaker_labels.segments;
                        const items = transcriptData.results.items || [];

                        transcript = segments.map((segment: any) => {
                            const speaker = segment.speaker_label || 'Unknown';
                            const startTime = parseFloat(segment.start_time || 0);
                            const endTime = parseFloat(segment.end_time || 0);

                            // Find all items within this segment's time range
                            const segmentWords = items
                                .filter((item: any) => {
                                    if (item.type !== 'pronunciation') return false;
                                    const itemTime = parseFloat(item.start_time || 0);
                                    return itemTime >= startTime && itemTime <= endTime;
                                })
                                .map((item: any) => item.alternatives?.[0]?.content || '')
                                .join(' ');

                            return `${speaker}: ${segmentWords}`;
                        }).join('\n\n');

                        console.log(`[Scribe] Built speaker-labeled transcript: ${segments.length} segments`);
                    } else {
                        // Fallback to plain transcript if speaker labels not available
                        transcript = transcriptData.results?.transcripts?.[0]?.transcript || '';
                        console.warn('[Scribe] No speaker labels found in transcript, using plain text');
                    }

                    // Update session with transcript
                    await query(
                        `UPDATE scribe_sessions SET transcript = $1, status = 'transcribed', updated_at = NOW() WHERE session_id = $2`,
                        [transcript, sessionId]
                    );

                    return NextResponse.json({
                        success: true,
                        data: {
                            session_id: session.session_id,
                            status: 'transcribed',
                            transcript,
                            transcript_length: transcript.length,
                        },
                    });
                } else if (jobStatus === 'FAILED') {
                    const failReason = jobResp.MedicalTranscriptionJob?.FailureReason || 'Unknown failure';
                    await query(
                        `UPDATE scribe_sessions SET status = 'error', updated_at = NOW() WHERE session_id = $1`,
                        [sessionId]
                    );
                    return NextResponse.json({
                        success: false,
                        data: { session_id: session.session_id, status: 'error', error: failReason },
                    }, { status: 502 });
                } else {
                    // Still processing (IN_PROGRESS or QUEUED)
                    return NextResponse.json({
                        success: true,
                        data: {
                            session_id: session.session_id,
                            status: 'transcribing',
                            aws_status: jobStatus,
                            message: 'Transcription in progress...',
                        },
                    });
                }
            } catch (pollErr: any) {
                console.error('[Scribe:Poll] Error polling transcription:', pollErr);
                return NextResponse.json({
                    success: true,
                    data: {
                        session_id: session.session_id,
                        status: 'transcribing',
                        message: 'Checking transcription status...',
                    },
                });
            }
        }

        // Unknown state — return current status
        return NextResponse.json({
            success: true,
            data: {
                session_id: session.session_id,
                status: session.status,
                transcript: session.transcript || null,
            },
        });
    } catch (error) {
        console.error('[Scribe:Transcribe:Poll] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
            { status: 500 }
        );
    }
}
