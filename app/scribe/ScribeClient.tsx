'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ==================== TYPES ====================
interface ScribeSession {
    session_id: string;
    patient_id: string;
    patient_name: string | null;
    healthie_client_id: string | null;
    visit_type: string;
    status: string;
    transcript: string | null;
    transcript_source: string | null;
    audio_s3_key: string | null;
    created_at: string;
    note_id: string | null;
    soap_subjective: string | null;
    soap_objective: string | null;
    soap_assessment: string | null;
    soap_plan: string | null;
    healthie_status: string | null;
    healthie_note_id: string | null;
    icd10_codes: any[];
    cpt_codes: any[];
    supplementary_docs: Record<string, any>;
    full_note_text: string | null;
}

interface Patient {
    patient_id: string;
    full_name: string;
    healthie_client_id: string | null;
    dob: string | null;
}

type View = 'list' | 'new' | 'detail' | 'edit';
type DocType = 'work_note' | 'school_note' | 'discharge_instructions' | 'care_plan';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
    recording: { bg: '#fef2f2', text: '#dc2626', label: '🔴 Recording' },
    transcribing: { bg: '#fef9c3', text: '#ca8a04', label: '⏳ Transcribing' },
    transcribed: { bg: '#ecfdf5', text: '#059669', label: '✅ Transcribed' },
    generating: { bg: '#eff6ff', text: '#2563eb', label: '🤖 Generating' },
    draft: { bg: '#f5f3ff', text: '#7c3aed', label: '📝 Draft' },
    review: { bg: '#fff7ed', text: '#ea580c', label: '👁️ Review' },
    submitted: { bg: '#ecfdf5', text: '#059669', label: '📤 Submitted' },
    error: { bg: '#fef2f2', text: '#dc2626', label: '❌ Error' },
};

const basePath = '/ops';

// ==================== MAIN CLIENT ====================
export default function ScribeClient({ sessions: initialSessions, patients }: {
    sessions: ScribeSession[];
    patients: Patient[];
}) {
    const [sessions, setSessions] = useState(initialSessions);
    const [view, setView] = useState<View>('list');
    const [selectedSession, setSelectedSession] = useState<ScribeSession | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const clearMessages = () => { setError(null); setSuccess(null); };

    const openSession = (s: ScribeSession) => {
        setSelectedSession(s);
        setView('detail');
        clearMessages();
    };

    return (
        <div>
            {/* Alert Messages */}
            {error && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '0.5rem', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>❌ {error}</span>
                    <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                </div>
            )}
            {success && (
                <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', borderRadius: '0.5rem', backgroundColor: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>✅ {success}</span>
                    <button onClick={() => setSuccess(null)} style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                </div>
            )}

            {/* View Router */}
            {view === 'list' && (
                <SessionList
                    sessions={sessions}
                    onSelect={openSession}
                    onNewSession={() => { setView('new'); clearMessages(); }}
                />
            )}
            {view === 'new' && (
                <NewSession
                    patients={patients}
                    onCreated={(s) => {
                        setSessions(prev => [s, ...prev]);
                        setSelectedSession(s);
                        setView('detail');
                        setSuccess('Session created!');
                    }}
                    onBack={() => setView('list')}
                    setError={setError}
                    setLoading={setLoading}
                    loading={loading}
                />
            )}
            {view === 'detail' && selectedSession && (
                <SessionDetail
                    session={selectedSession}
                    setSession={(s) => {
                        setSelectedSession(s);
                        setSessions(prev => prev.map(x => x.session_id === s.session_id ? s : x));
                    }}
                    onBack={() => { setView('list'); clearMessages(); }}
                    setError={setError}
                    setSuccess={setSuccess}
                    setLoading={setLoading}
                    loading={loading}
                    patients={patients}
                />
            )}

            {/* Loading Overlay */}
            {loading && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
                    <div style={{ backgroundColor: '#fff', padding: '2rem 3rem', borderRadius: '1rem', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', textAlign: 'center' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
                        <p style={{ color: '#475569', margin: 0, fontWeight: 600 }}>Processing...</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ==================== SESSION LIST ====================
function SessionList({ sessions, onSelect, onNewSession }: {
    sessions: ScribeSession[];
    onSelect: (s: ScribeSession) => void;
    onNewSession: () => void;
}) {
    const [filter, setFilter] = useState<string>('all');
    const filtered = filter === 'all' ? sessions : sessions.filter(s => s.status === filter);

    return (
        <div>
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {['all', 'draft', 'transcribed', 'review', 'submitted'].map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            style={{
                                padding: '0.4rem 0.8rem', borderRadius: '2rem', border: '1px solid',
                                borderColor: filter === f ? '#0ea5e9' : '#e2e8f0',
                                backgroundColor: filter === f ? '#0ea5e9' : '#fff',
                                color: filter === f ? '#fff' : '#475569',
                                fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                                textTransform: 'capitalize',
                            }}
                        >
                            {f} {f !== 'all' && `(${sessions.filter(s => s.status === f).length})`}
                        </button>
                    ))}
                </div>
                <button
                    onClick={onNewSession}
                    style={{
                        padding: '0.6rem 1.2rem', borderRadius: '0.5rem', border: 'none',
                        backgroundColor: '#059669', color: '#fff', fontWeight: 700,
                        fontSize: '0.9rem', cursor: 'pointer',
                    }}
                >
                    + New Session
                </button>
            </div>

            {/* Sessions Grid */}
            {filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                    <p style={{ fontSize: '1.2rem' }}>No sessions found. Start a new one!</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {filtered.map(s => {
                        const statusInfo = STATUS_COLORS[s.status] || STATUS_COLORS.draft;
                        return (
                            <div
                                key={s.session_id}
                                onClick={() => onSelect(s)}
                                style={{
                                    padding: '1rem 1.25rem', backgroundColor: '#fff', borderRadius: '0.75rem',
                                    border: '1px solid #e2e8f0', cursor: 'pointer',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    transition: 'box-shadow 0.15s',
                                }}
                                onMouseOver={e => (e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)')}
                                onMouseOut={e => (e.currentTarget.style.boxShadow = 'none')}
                            >
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '1rem' }}>
                                            {s.patient_name || 'Unknown Patient'}
                                        </div>
                                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '0.15rem' }}>
                                            {s.visit_type?.replace(/_/g, ' ')} • {new Date(s.created_at).toLocaleDateString()} {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    {s.healthie_note_id && (
                                        <span style={{ fontSize: '0.75rem', color: '#059669', fontWeight: 600 }}>🏥 Healthie</span>
                                    )}
                                    <span style={{
                                        padding: '0.25rem 0.6rem', borderRadius: '2rem',
                                        backgroundColor: statusInfo.bg, color: statusInfo.text,
                                        fontSize: '0.75rem', fontWeight: 600,
                                    }}>
                                        {statusInfo.label}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ==================== NEW SESSION ====================
function NewSession({ patients, onCreated, onBack, setError, setLoading, loading }: {
    patients: Patient[];
    onCreated: (s: ScribeSession) => void;
    onBack: () => void;
    setError: (e: string | null) => void;
    setLoading: (l: boolean) => void;
    loading: boolean;
}) {
    const [search, setSearch] = useState('');
    const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
    const [visitType, setVisitType] = useState('follow_up');
    const [inputMode, setInputMode] = useState<'audio' | 'text'>('audio');
    const [transcript, setTranscript] = useState('');
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    const filteredPatients = search.length >= 2
        ? patients.filter(p => p.full_name?.toLowerCase().includes(search.toLowerCase())).slice(0, 15)
        : [];

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
            chunksRef.current = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
            recorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' });
                setAudioFile(file);
                stream.getTracks().forEach(t => t.stop());
            };
            mediaRecorderRef.current = recorder;
            recorder.start(1000);
            setIsRecording(true);
        } catch (err) {
            setError('Microphone access denied. Please allow microphone access in your browser settings.');
        }
    };

    const stopRecording = () => {
        mediaRecorderRef.current?.stop();
        setIsRecording(false);
    };

    const handleSubmit = async () => {
        if (!selectedPatient) { setError('Please select a patient'); return; }
        if (inputMode === 'text' && !transcript.trim()) { setError('Please enter transcript text'); return; }
        if (inputMode === 'audio' && !audioFile) { setError('Please record or upload audio'); return; }

        setLoading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('patient_id', selectedPatient.patient_id);
            formData.append('patient_name', selectedPatient.full_name);
            formData.append('visit_type', visitType);

            if (inputMode === 'text') {
                formData.append('transcript', transcript);
            } else if (audioFile) {
                formData.append('audio', audioFile);
            }

            const res = await fetch(`${basePath}/api/scribe/transcribe`, { method: 'POST', body: formData });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to create session');

            // Convert to session-like object for the list
            const newSession: ScribeSession = {
                session_id: data.data.session_id,
                patient_id: selectedPatient.patient_id,
                patient_name: selectedPatient.full_name,
                healthie_client_id: selectedPatient.healthie_client_id,
                visit_type: visitType,
                status: data.data.status,
                transcript: inputMode === 'text' ? transcript : null,
                transcript_source: data.data.transcript_source,
                audio_s3_key: null,
                created_at: new Date().toISOString(),
                note_id: null,
                soap_subjective: null,
                soap_objective: null,
                soap_assessment: null,
                soap_plan: null,
                healthie_status: null,
                healthie_note_id: null,
                icd10_codes: [],
                cpt_codes: [],
                supplementary_docs: {},
                full_note_text: null,
            };

            onCreated(newSession);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const visitTypes = [
        { value: 'follow_up', label: 'Follow-Up' },
        { value: 'sick_visit', label: 'Sick Visit' },
        { value: 'new_patient', label: 'New Patient' },
        { value: 'lab_review', label: 'Lab Review' },
        { value: 'trt_check', label: 'TRT Check' },
        { value: 'weight_loss', label: 'Weight Loss' },
        { value: 'telehealth', label: 'Telehealth' },
    ];

    return (
        <div>
            <button onClick={onBack} style={{ marginBottom: '1rem', background: 'none', border: 'none', color: '#0ea5e9', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>
                ← Back to Sessions
            </button>

            <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem', border: '1px solid #e2e8f0', maxWidth: '48rem' }}>
                <h2 style={{ fontSize: '1.3rem', marginBottom: '1.25rem', color: '#0f172a' }}>New Scribe Session</h2>

                {/* Patient Search */}
                <label style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Patient</label>
                {selectedPatient ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', backgroundColor: '#ecfdf5', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                        <span style={{ fontWeight: 700, color: '#059669' }}>{selectedPatient.full_name}</span>
                        {selectedPatient.healthie_client_id && <span style={{ fontSize: '0.7rem', color: '#059669' }}>✅ Healthie</span>}
                        <button onClick={() => setSelectedPatient(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>×</button>
                    </div>
                ) : (
                    <div style={{ position: 'relative', marginBottom: '1rem' }}>
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search patients by name..."
                            style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', fontSize: '0.9rem', boxSizing: 'border-box' }}
                        />
                        {filteredPatients.length > 0 && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '0 0 0.5rem 0.5rem', maxHeight: '200px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                                {filteredPatients.map(p => (
                                    <div
                                        key={p.patient_id}
                                        onClick={() => { setSelectedPatient(p); setSearch(''); }}
                                        style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between' }}
                                        onMouseOver={e => (e.currentTarget.style.backgroundColor = '#f0f9ff')}
                                        onMouseOut={e => (e.currentTarget.style.backgroundColor = '#fff')}
                                    >
                                        <span style={{ fontWeight: 600 }}>{p.full_name}</span>
                                        <span style={{ fontSize: '0.75rem', color: p.healthie_client_id ? '#059669' : '#94a3b8' }}>
                                            {p.healthie_client_id ? '✅ Healthie' : '❌ No Healthie'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Visit Type */}
                <label style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Visit Type</label>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    {visitTypes.map(vt => (
                        <button
                            key={vt.value}
                            onClick={() => setVisitType(vt.value)}
                            style={{
                                padding: '0.35rem 0.7rem', borderRadius: '2rem', border: '1px solid',
                                borderColor: visitType === vt.value ? '#7c3aed' : '#e2e8f0',
                                backgroundColor: visitType === vt.value ? '#7c3aed' : '#fff',
                                color: visitType === vt.value ? '#fff' : '#475569',
                                fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                            }}
                        >
                            {vt.label}
                        </button>
                    ))}
                </div>

                {/* Input Mode Toggle */}
                <label style={{ fontWeight: 600, color: '#334155', fontSize: '0.85rem', display: 'block', marginBottom: '0.3rem' }}>Input</label>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <button
                        onClick={() => setInputMode('audio')}
                        style={{
                            flex: 1, padding: '0.6rem', borderRadius: '0.5rem', border: '2px solid',
                            borderColor: inputMode === 'audio' ? '#0ea5e9' : '#e2e8f0',
                            backgroundColor: inputMode === 'audio' ? '#f0f9ff' : '#fff',
                            fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
                        }}
                    >
                        🎙️ Record Audio
                    </button>
                    <button
                        onClick={() => setInputMode('text')}
                        style={{
                            flex: 1, padding: '0.6rem', borderRadius: '0.5rem', border: '2px solid',
                            borderColor: inputMode === 'text' ? '#0ea5e9' : '#e2e8f0',
                            backgroundColor: inputMode === 'text' ? '#f0f9ff' : '#fff',
                            fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
                        }}
                    >
                        ⌨️ Paste Transcript
                    </button>
                </div>

                {/* Audio Recording */}
                {inputMode === 'audio' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                            {!isRecording ? (
                                <button onClick={startRecording} style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', backgroundColor: '#dc2626', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '1rem' }}>
                                    🎙️ Start Recording
                                </button>
                            ) : (
                                <button onClick={stopRecording} style={{ padding: '0.6rem 1.2rem', borderRadius: '0.5rem', backgroundColor: '#475569', color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer', fontSize: '1rem', animation: 'pulse 1.5s infinite' }}>
                                    ⬛ Stop Recording
                                </button>
                            )}
                            {audioFile && <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.85rem' }}>✅ {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(1)}MB)</span>}
                        </div>
                        <input
                            type="file"
                            accept="audio/*"
                            onChange={e => { if (e.target.files?.[0]) setAudioFile(e.target.files[0]); }}
                            style={{ fontSize: '0.8rem', color: '#94a3b8' }}
                        />
                    </div>
                )}

                {/* Text Input */}
                {inputMode === 'text' && (
                    <textarea
                        value={transcript}
                        onChange={e => setTranscript(e.target.value)}
                        placeholder="Paste the visit transcript here..."
                        rows={8}
                        style={{ width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', fontSize: '0.9rem', fontFamily: 'inherit', resize: 'vertical', marginBottom: '1rem', boxSizing: 'border-box' }}
                    />
                )}

                {/* Submit */}
                <button
                    onClick={handleSubmit}
                    disabled={loading || !selectedPatient}
                    style={{
                        width: '100%', padding: '0.75rem', borderRadius: '0.5rem', border: 'none',
                        backgroundColor: !selectedPatient ? '#94a3b8' : '#059669',
                        color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: selectedPatient ? 'pointer' : 'not-allowed',
                    }}
                >
                    {loading ? 'Creating...' : 'Create Session & Transcribe'}
                </button>
            </div>
        </div>
    );
}

// ==================== SESSION DETAIL ====================
function SessionDetail({ session, setSession, onBack, setError, setSuccess, setLoading, loading, patients }: {
    session: ScribeSession;
    setSession: (s: ScribeSession) => void;
    onBack: () => void;
    setError: (e: string | null) => void;
    setSuccess: (s: string | null) => void;
    setLoading: (l: boolean) => void;
    loading: boolean;
    patients: Patient[];
}) {
    const [activeTab, setActiveTab] = useState<'soap' | 'transcript' | 'docs'>('soap');
    const [editingSection, setEditingSection] = useState<string | null>(null);
    const [editText, setEditText] = useState('');
    const [aiEditInstruction, setAiEditInstruction] = useState('');
    const [showAiEdit, setShowAiEdit] = useState(false);
    const [pollingId, setPollingId] = useState<ReturnType<typeof setInterval> | null>(null);

    // Poll for transcription if status is 'transcribing'
    useEffect(() => {
        if (session.status === 'transcribing') {
            const id = setInterval(async () => {
                try {
                    const res = await fetch(`${basePath}/api/scribe/transcribe?session_id=${session.session_id}`);
                    const data = await res.json();
                    if (data.success && data.data.status === 'transcribed') {
                        setSession({ ...session, status: 'transcribed', transcript: data.data.transcript });
                        setSuccess('Transcription complete!');
                        clearInterval(id);
                    } else if (data.data?.status === 'error') {
                        setError('Transcription failed: ' + (data.data.error || 'Unknown error'));
                        clearInterval(id);
                    }
                } catch { /* ignore poll errors */ }
            }, 5000);
            setPollingId(id);
            return () => clearInterval(id);
        }
    }, [session.status, session.session_id]);

    // Generate SOAP Note
    const generateNote = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${basePath}/api/scribe/generate-note`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session.session_id, visit_type: session.visit_type }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setSession({
                ...session,
                status: 'draft',
                note_id: data.data.note_id,
                soap_subjective: data.data.soap_subjective,
                soap_objective: data.data.soap_objective,
                soap_assessment: data.data.soap_assessment,
                soap_plan: data.data.soap_plan,
                full_note_text: data.data.full_note_text,
                icd10_codes: data.data.icd10_codes || [],
            });
            setSuccess('SOAP note generated!');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Save direct edit
    const saveEdit = async (section: string) => {
        if (!session.note_id) return;
        setLoading(true);
        try {
            const res = await fetch(`${basePath}/api/scribe/notes/${session.note_id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [section]: editText }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setSession({ ...session, [section]: editText });
            setEditingSection(null);
            setSuccess('Saved!');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // AI Edit
    const runAiEdit = async (section?: string) => {
        if (!session.note_id || !aiEditInstruction.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(`${basePath}/api/scribe/notes/${session.note_id}/edit-ai`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ edit_instruction: aiEditInstruction, section }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            const n = data.data.updated_note;
            setSession({
                ...session,
                soap_subjective: n.soap_subjective,
                soap_objective: n.soap_objective,
                soap_assessment: n.soap_assessment,
                soap_plan: n.soap_plan,
                full_note_text: n.full_note_text,
            });
            setAiEditInstruction('');
            setShowAiEdit(false);
            setSuccess('AI edit applied!');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Generate supplementary doc
    const generateDoc = async (docType: DocType) => {
        setLoading(true);
        try {
            const res = await fetch(`${basePath}/api/scribe/generate-doc`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: session.session_id, doc_type: docType }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setSession({
                ...session,
                supplementary_docs: { ...session.supplementary_docs, [docType]: { content: data.data.content, generated_at: new Date().toISOString() } },
            });
            setSuccess(`${data.data.label} generated!`);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    // Submit to Healthie
    const submitToHealthie = async () => {
        if (!session.note_id) { setError('No note to submit'); return; }
        if (!confirm('Submit this SOAP note to Healthie? This will create/update the patient\'s clinical record.')) return;
        setLoading(true);
        try {
            const res = await fetch(`${basePath}/api/scribe/submit-to-healthie`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ note_id: session.note_id }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error);
            setSession({
                ...session,
                status: 'submitted',
                healthie_status: data.data.healthie_status,
                healthie_note_id: data.data.healthie_note_id,
            });
            setSuccess(`Submitted to Healthie! ID: ${data.data.healthie_note_id}`);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const soapSections = [
        { key: 'soap_subjective', label: 'Subjective', icon: '💬' },
        { key: 'soap_objective', label: 'Objective', icon: '🔬' },
        { key: 'soap_assessment', label: 'Assessment', icon: '📋' },
        { key: 'soap_plan', label: 'Plan', icon: '📝' },
    ];

    const docTypes: { key: DocType; label: string; icon: string }[] = [
        { key: 'work_note', label: 'Work Note', icon: '🏢' },
        { key: 'school_note', label: 'School Note', icon: '🏫' },
        { key: 'discharge_instructions', label: 'Discharge Instructions', icon: '📄' },
        { key: 'care_plan', label: 'Care Plan', icon: '💊' },
    ];

    const statusInfo = STATUS_COLORS[session.status] || STATUS_COLORS.draft;

    return (
        <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#0ea5e9', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}>← Back</button>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <span style={{ padding: '0.25rem 0.6rem', borderRadius: '2rem', backgroundColor: statusInfo.bg, color: statusInfo.text, fontSize: '0.8rem', fontWeight: 600 }}>
                        {statusInfo.label}
                    </span>
                    {session.healthie_note_id && (
                        <span style={{ padding: '0.25rem 0.6rem', borderRadius: '2rem', backgroundColor: '#ecfdf5', color: '#059669', fontSize: '0.8rem', fontWeight: 600 }}>
                            🏥 Healthie: {session.healthie_note_id}
                        </span>
                    )}
                </div>
            </div>

            {/* Patient Info + Actions */}
            <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1rem 1.25rem', border: '1px solid #e2e8f0', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', margin: 0, color: '#0f172a' }}>{session.patient_name || 'Unknown'}</h2>
                        <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                            {session.visit_type?.replace(/_/g, ' ')} • {new Date(session.created_at).toLocaleString()}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                        {session.status === 'transcribed' && !session.note_id && (
                            <button onClick={generateNote} disabled={loading} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: 'none', backgroundColor: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                                🤖 Generate SOAP Note
                            </button>
                        )}
                        {session.note_id && (
                            <>
                                <button onClick={() => setShowAiEdit(!showAiEdit)} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #7c3aed', backgroundColor: showAiEdit ? '#7c3aed' : '#fff', color: showAiEdit ? '#fff' : '#7c3aed', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                                    ✨ AI Edit
                                </button>
                                <button onClick={submitToHealthie} disabled={loading} style={{ padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: 'none', backgroundColor: '#059669', color: '#fff', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
                                    📤 Submit to Healthie
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* AI Edit Bar */}
            {showAiEdit && (
                <div style={{ backgroundColor: '#f5f3ff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #ddd6fe', marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                    <input
                        value={aiEditInstruction}
                        onChange={e => setAiEditInstruction(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') runAiEdit(); }}
                        placeholder="Tell AI what to change (e.g., 'add allergy to penicillin', 'change dose to 500mg')..."
                        style={{ flex: 1, padding: '0.6rem 0.75rem', borderRadius: '0.5rem', border: '1px solid #ddd6fe', fontSize: '0.9rem' }}
                    />
                    <button onClick={() => runAiEdit()} disabled={loading || !aiEditInstruction.trim()} style={{ padding: '0.6rem 1rem', borderRadius: '0.5rem', border: 'none', backgroundColor: '#7c3aed', color: '#fff', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        Apply Edit
                    </button>
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '0.75rem' }}>
                {(['soap', 'transcript', 'docs'] as const).map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            flex: 1, padding: '0.6rem', border: 'none', borderBottom: `3px solid ${activeTab === tab ? '#0ea5e9' : '#e2e8f0'}`,
                            backgroundColor: activeTab === tab ? '#f0f9ff' : '#fff',
                            color: activeTab === tab ? '#0ea5e9' : '#475569',
                            fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', textTransform: 'capitalize',
                        }}
                    >
                        {tab === 'soap' ? '📋 SOAP Note' : tab === 'transcript' ? '🎙️ Transcript' : '📄 Documents'}
                    </button>
                ))}
            </div>

            {/* SOAP Tab */}
            {activeTab === 'soap' && (
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                    {session.note_id ? soapSections.map(({ key, label, icon }) => {
                        const content = (session as any)[key] || '';
                        const isEditing = editingSection === key;
                        return (
                            <div key={key} style={{ backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #e2e8f0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '0.95rem', color: '#0f172a' }}>{icon} {label}</h3>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                                            <button onClick={() => saveEdit(key)} style={{ padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: 'none', backgroundColor: '#059669', color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>Save</button>
                                            <button onClick={() => setEditingSection(null)} style={{ padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #e2e8f0', backgroundColor: '#fff', fontSize: '0.75rem', cursor: 'pointer' }}>Cancel</button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => { setEditingSection(key); setEditText(content); }}
                                            style={{ padding: '0.25rem 0.5rem', borderRadius: '0.3rem', border: '1px solid #e2e8f0', backgroundColor: '#fff', fontSize: '0.75rem', cursor: 'pointer', color: '#0ea5e9', fontWeight: 600 }}
                                        >
                                            ✏️ Edit
                                        </button>
                                    )}
                                </div>
                                {isEditing ? (
                                    <textarea
                                        value={editText}
                                        onChange={e => setEditText(e.target.value)}
                                        rows={8}
                                        style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0', fontSize: '0.85rem', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                                    />
                                ) : (
                                    <pre style={{ margin: 0, fontSize: '0.85rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                                        {content || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No content</span>}
                                    </pre>
                                )}
                            </div>
                        );
                    }) : (
                        <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                            {session.status === 'transcribing' ? (
                                <p style={{ color: '#ca8a04', fontWeight: 600 }}>⏳ Transcription in progress... Polling every 5 seconds.</p>
                            ) : session.status === 'transcribed' ? (
                                <div>
                                    <p style={{ color: '#475569', marginBottom: '0.75rem' }}>Transcript ready! Generate a SOAP note.</p>
                                    <button onClick={generateNote} disabled={loading} style={{ padding: '0.6rem 1.5rem', borderRadius: '0.5rem', border: 'none', backgroundColor: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' }}>
                                        🤖 Generate SOAP Note
                                    </button>
                                </div>
                            ) : (
                                <p style={{ color: '#94a3b8' }}>Waiting for transcript...</p>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Transcript Tab */}
            {activeTab === 'transcript' && (
                <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: '#0f172a' }}>🎙️ Visit Transcript</h3>
                    <pre style={{ margin: 0, fontSize: '0.85rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit', maxHeight: '500px', overflowY: 'auto' }}>
                        {session.transcript || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No transcript available</span>}
                    </pre>
                </div>
            )}

            {/* Documents Tab */}
            {activeTab === 'docs' && (
                <div>
                    {/* Generate Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                        {docTypes.map(dt => {
                            const exists = !!session.supplementary_docs?.[dt.key];
                            return (
                                <button
                                    key={dt.key}
                                    onClick={() => generateDoc(dt.key)}
                                    disabled={loading || !session.note_id}
                                    style={{
                                        padding: '0.75rem', borderRadius: '0.5rem',
                                        border: `1px solid ${exists ? '#a7f3d0' : '#e2e8f0'}`,
                                        backgroundColor: exists ? '#ecfdf5' : '#fff',
                                        color: '#334155', fontWeight: 600, fontSize: '0.85rem', cursor: session.note_id ? 'pointer' : 'not-allowed',
                                        textAlign: 'left',
                                    }}
                                >
                                    {dt.icon} {dt.label} {exists ? '✅' : ''}
                                </button>
                            );
                        })}
                    </div>

                    {/* Show Generated Docs */}
                    {Object.entries(session.supplementary_docs || {}).map(([key, doc]: [string, any]) => {
                        const label = docTypes.find(d => d.key === key)?.label || key;
                        return (
                            <div key={key} style={{ backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1rem', border: '1px solid #e2e8f0', marginBottom: '0.5rem' }}>
                                <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: '#0f172a' }}>{label}</h3>
                                <pre style={{ margin: 0, fontSize: '0.85rem', color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                                    {doc.content}
                                </pre>
                            </div>
                        );
                    })}

                    {Object.keys(session.supplementary_docs || {}).length === 0 && (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e2e8f0' }}>
                            <p>No documents generated yet. Click a button above to generate one.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
