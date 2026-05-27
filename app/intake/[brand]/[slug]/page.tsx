'use client';

import { useEffect, useState, use } from 'react';

/**
 * Public, "Google-facing" self-serve intake form. No login — a prospective
 * patient lands here (e.g. from a GHL link) and completes account setup. The
 * answers are captured in our Postgres and pushed to Healthie. The exact same
 * form structure is consumed by the iPhone/iPad app via the JSON API, so the
 * questions stay in sync across surfaces.
 *
 * URL: /ops/intake/[brand]/[slug]  (e.g. /ops/intake/abxtac/services-agreement)
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface Field {
    field_key: string;
    label: string;
    mod_type: string;
    required: boolean;
    options: string[] | null;
    description: string | null;
}
interface FormShape {
    name: string;
    description: string | null;
    fields: Field[];
}

export default function IntakePage({ params }: { params: Promise<{ brand: string; slug: string }> }) {
    const { brand, slug } = use(params);
    const [form, setForm] = useState<FormShape | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [dob, setDob] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [done, setDone] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    useEffect(() => {
        fetch(`${BASE}/api/intake/${brand}/${slug}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
            .then((d) => setForm(d.form))
            .catch(() => setLoadError('This form is not available.'));
    }, [brand, slug]);

    function setAnswer(key: string, value: string) {
        setAnswers((prev) => ({ ...prev, [key]: value }));
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setErrors([]);
        setSubmitting(true);
        try {
            const token = new URLSearchParams(window.location.search).get('token') || '';
            // Trailing slash before `?token=` to avoid Next.js 308 body-drop.
            const res = await fetch(`${BASE}/api/intake/${brand}/${slug}/${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    applicant_name: name,
                    applicant_email: email || null,
                    applicant_phone: phone || null,
                    date_of_birth: dob || null,
                    answers,
                    source: 'web',
                }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                setErrors(data.details || [data.error || 'Something went wrong. Please try again.']);
                return;
            }
            setDone(true);
        } catch {
            setErrors(['Network error. Please try again.']);
        } finally {
            setSubmitting(false);
        }
    }

    if (loadError) {
        return <main className="mx-auto max-w-2xl p-8 text-center text-gray-700">{loadError}</main>;
    }
    if (!form) {
        return <main className="mx-auto max-w-2xl p-8 text-center text-gray-500">Loading…</main>;
    }
    if (done) {
        return (
            <main className="mx-auto max-w-2xl p-8 text-center">
                <h1 className="mb-3 text-2xl font-semibold text-gray-900">You&apos;re all set</h1>
                <p className="text-gray-600">
                    Thank you. Your account is being set up and your provider has your information. We&apos;ll be in touch shortly.
                </p>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-2xl p-6">
            <h1 className="mb-1 text-2xl font-semibold text-gray-900">{form.name}</h1>
            {form.description && <p className="mb-6 text-sm text-gray-500">{form.description}</p>}

            <form onSubmit={handleSubmit} className="space-y-6">
                <fieldset className="space-y-4 rounded-lg border border-gray-200 p-4">
                    <legend className="px-1 text-sm font-medium text-gray-700">Your information</legend>
                    <Labeled label="Full name" required>
                        <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
                    </Labeled>
                    <Labeled label="Email">
                        <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Labeled>
                    <Labeled label="Phone">
                        <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Labeled>
                    <Labeled label="Date of birth">
                        <input type="date" className="input" value={dob} onChange={(e) => setDob(e.target.value)} />
                    </Labeled>
                    <p className="text-xs text-gray-400">An email or phone number is required to create your account.</p>
                </fieldset>

                <div className="space-y-5">
                    {form.fields.map((field) => (
                        <FieldInput key={field.field_key} field={field} value={answers[field.field_key] || ''} onChange={(v) => setAnswer(field.field_key, v)} />
                    ))}
                </div>

                {errors.length > 0 && (
                    <ul className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {errors.map((err, i) => (<li key={i}>{err}</li>))}
                    </ul>
                )}

                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-50"
                >
                    {submitting ? 'Submitting…' : 'Complete account setup'}
                </button>
            </form>

            <style jsx global>{`
                .input { width: 100%; border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.95rem; }
                .input:focus { outline: 2px solid #111827; outline-offset: 1px; }
            `}</style>
        </main>
    );
}

function Labeled({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
                {label}{required && <span className="text-red-500"> *</span>}
            </span>
            {children}
        </label>
    );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
    const labelEl = (
        <span className="mb-1 block text-sm font-medium text-gray-800">
            {field.label}{field.required && <span className="text-red-500"> *</span>}
        </span>
    );
    const desc = field.description && <span className="mb-1 block text-xs text-gray-500">{field.description}</span>;

    switch (field.mod_type) {
        case 'textarea':
            return (
                <label className="block">{labelEl}{desc}
                    <textarea className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />
                </label>
            );
        case 'radio':
            return (
                <div>{labelEl}{desc}
                    <div className="space-y-1">
                        {(field.options || []).map((opt) => (
                            <label key={opt} className="flex items-center gap-2 text-sm text-gray-700">
                                <input type="radio" name={field.field_key} value={opt} checked={value === opt} onChange={() => onChange(opt)} required={field.required} />
                                {opt}
                            </label>
                        ))}
                    </div>
                </div>
            );
        case 'checkbox':
            return (
                <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} required={field.required} />
                    <span>{field.label}{field.required && <span className="text-red-500"> *</span>}{field.description && <span className="block text-xs text-gray-500">{field.description}</span>}</span>
                </label>
            );
        case 'signature':
            // Minimal typed-signature capture for the web slice; the iPad app uses
            // its native canvas signature pad and posts the data URL.
            return (
                <label className="block">{labelEl}{desc}
                    <input className="input" placeholder="Type your full name to sign" value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />
                    <span className="mt-1 block text-xs text-gray-400">By typing your name you are signing this agreement electronically.</span>
                </label>
            );
        default:
            return (
                <label className="block">{labelEl}{desc}
                    <input className="input" type={field.mod_type === 'email' ? 'email' : field.mod_type === 'phone' ? 'tel' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} />
                </label>
            );
    }
}
