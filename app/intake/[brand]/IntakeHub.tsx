'use client';

import { useEffect, useState } from 'react';

/**
 * Smart-link hub + multi-form wizard.
 *
 * On mobile (iOS/Android), the hero is "Open in app / Get the app". The app is
 * the primary surface and these patients should land there. We still render the
 * wizard below as a fallback for the rare "no, I'll just do it in the browser"
 * path, but it's intentionally de-emphasized.
 *
 * On desktop, the smart-link section collapses and the wizard takes center stage.
 *
 * Each wizard step submits to /api/intake/[brand]/[slug] atomically — if the
 * patient bails after step 3 of 7, the first three submissions are durably in
 * `intake_submissions` and the patient can resume later by hitting the same link
 * (resume-by-email is a follow-up; today it just starts fresh).
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

interface FormSummary {
    slug: string;
    name: string;
    description: string | null;
    field_count: number;
}

interface Field {
    field_key: string;
    label: string;
    mod_type: string;
    required: boolean;
    options: string[] | null;
    description: string | null;
}

type Identity = {
    applicant_name: string;
    applicant_email: string;
    applicant_phone: string;
    date_of_birth: string;
};

interface Props {
    brand: string;
    forms: FormSummary[];
    platform: { isIOS: boolean; isAndroid: boolean; isMobile: boolean };
    appDeepLink: string;
}

/** Look up forms already completed by this email/phone on this brand. POST so
 * email doesn't end up in nginx access logs. Returns [] on any failure. */
async function fetchPriorCompleted(brand: string, id: Identity): Promise<string[]> {
    if (!id.applicant_email && !id.applicant_phone) return [];
    try {
        const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : '';
        const r = await fetch(`${BASE}/api/intake/${brand}/progress${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ applicant_email: id.applicant_email, applicant_phone: id.applicant_phone }),
        });
        if (!r.ok) return [];
        const d = await r.json();
        return Array.isArray(d.completed) ? d.completed : [];
    } catch {
        return [];
    }
}

export default function IntakeHub({ brand, forms, platform, appDeepLink }: Props) {
    const [continueInBrowser, setContinueInBrowser] = useState(!platform.isMobile);
    const [step, setStep] = useState(0); // 0 = identity, 1..N = forms, N+1 = done
    const [identity, setIdentity] = useState<Identity>({
        applicant_name: '',
        applicant_email: '',
        applicant_phone: '',
        date_of_birth: '',
    });
    const [completed, setCompleted] = useState<Set<string>>(new Set());

    // ─── Mobile smart-link hero ─────────────────────────────────────────────
    if (platform.isMobile && !continueInBrowser) {
        return (
            <main className="mx-auto max-w-md p-6">
                <p className="mb-2 text-xs uppercase tracking-widest text-gray-500">{brand.toUpperCase()}</p>
                <h1 className="mb-3 text-2xl font-semibold text-gray-900">Open in the app to complete your intake</h1>
                <p className="mb-6 text-gray-600">
                    The app is faster, lets you sign on screen, and reminds you with a push when your forms are due. Tap to open or install.
                </p>

                <a
                    href={appDeepLink}
                    className="mb-3 block w-full rounded-lg bg-gray-900 px-4 py-3 text-center font-medium text-white"
                >
                    Open in the app
                </a>

                {platform.isIOS && (
                    <a
                        href="https://apps.apple.com/app/idPLACEHOLDER"
                        className="mb-3 block w-full rounded-lg border border-gray-900 px-4 py-3 text-center font-medium text-gray-900"
                    >
                        Get it on the App Store
                    </a>
                )}
                {platform.isAndroid && (
                    <a
                        href="https://play.google.com/store/apps/details?id=com.nowoptimal.PLACEHOLDER"
                        className="mb-3 block w-full rounded-lg border border-gray-900 px-4 py-3 text-center font-medium text-gray-900"
                    >
                        Get it on Google Play
                    </a>
                )}

                <button
                    onClick={() => setContinueInBrowser(true)}
                    className="mt-4 block w-full text-sm text-gray-500 underline underline-offset-2"
                >
                    or continue in this browser
                </button>
            </main>
        );
    }

    // ─── Wizard ─────────────────────────────────────────────────────────────
    return (
        <main className="mx-auto max-w-2xl p-6">
            <Header brand={brand} step={step} totalSteps={forms.length + 1} />

            {step === 0 && (
                <IdentityStep
                    identity={identity}
                    onChange={setIdentity}
                    onNext={async () => {
                        // Resume-by-email: if this email/phone has prior completed
                        // submissions for this brand, skip past them and land on the
                        // first incomplete form. Best-effort — failure falls back to step 1.
                        const prior = await fetchPriorCompleted(brand, identity);
                        if (prior.length > 0) setCompleted(new Set(prior));
                        const firstIncomplete = forms.findIndex((f) => !prior.includes(f.slug));
                        setStep(firstIncomplete >= 0 ? firstIncomplete + 1 : forms.length + 1);
                    }}
                />
            )}

            {forms.map((f, i) => {
                const stepNum = i + 1;
                if (step !== stepNum) return null;
                return (
                    <FormStep
                        key={f.slug}
                        brand={brand}
                        form={f}
                        identity={identity}
                        onSubmitted={() => {
                            setCompleted((prev) => new Set(prev).add(f.slug));
                            setStep(stepNum + 1);
                        }}
                        onBack={stepNum > 1 ? () => setStep(stepNum - 1) : undefined}
                    />
                );
            })}

            {step === forms.length + 1 && (
                <DoneStep brand={brand} completed={completed} />
            )}
        </main>
    );
}

function Header({ brand, step, totalSteps }: { brand: string; step: number; totalSteps: number }) {
    const pct = Math.round((step / totalSteps) * 100);
    return (
        <header className="mb-6">
            <p className="mb-2 text-xs uppercase tracking-widest text-gray-500">{brand.toUpperCase()}</p>
            <h1 className="mb-3 text-2xl font-semibold text-gray-900">
                {step === 0 ? 'Welcome — let’s get you set up' : step > totalSteps - 1 ? 'You’re all set' : 'Complete your intake'}
            </h1>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div className="h-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-gray-500">Step {step + 1} of {totalSteps + 1}</p>
        </header>
    );
}

function IdentityStep({ identity, onChange, onNext }: { identity: Identity; onChange: (i: Identity) => void; onNext: () => void }) {
    const canProceed = identity.applicant_name.trim() && (identity.applicant_email.trim() || identity.applicant_phone.trim());
    return (
        <section className="space-y-4 rounded-lg border border-gray-200 p-5">
            <p className="text-sm text-gray-600">Confirm your contact info so your provider can reach you and pre-load your chart.</p>
            <Labeled label="Full name" required>
                <input className="input" value={identity.applicant_name} onChange={(e) => onChange({ ...identity, applicant_name: e.target.value })} required />
            </Labeled>
            <Labeled label="Email">
                <input type="email" className="input" value={identity.applicant_email} onChange={(e) => onChange({ ...identity, applicant_email: e.target.value })} />
            </Labeled>
            <Labeled label="Phone">
                <input type="tel" className="input" value={identity.applicant_phone} onChange={(e) => onChange({ ...identity, applicant_phone: e.target.value })} />
            </Labeled>
            <Labeled label="Date of birth">
                <input type="date" className="input" value={identity.date_of_birth} onChange={(e) => onChange({ ...identity, date_of_birth: e.target.value })} />
            </Labeled>
            <p className="text-xs text-gray-400">An email or phone is required so we can create your account.</p>
            <button
                disabled={!canProceed}
                onClick={onNext}
                className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-50"
            >
                Continue
            </button>
            <style jsx global>{`
                .input { width: 100%; border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.95rem; }
                .input:focus { outline: 2px solid #111827; outline-offset: 1px; }
            `}</style>
        </section>
    );
}

function FormStep({ brand, form, identity, onSubmitted, onBack }: { brand: string; form: FormSummary; identity: Identity; onSubmitted: () => void; onBack?: () => void }) {
    const [fields, setFields] = useState<Field[] | null>(null);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [errors, setErrors] = useState<string[]>([]);

    useEffect(() => {
        setFields(null);
        setAnswers({});
        setErrors([]);
        fetch(`${BASE}/api/intake/${brand}/${form.slug}`)
            .then((r) => r.ok ? r.json() : Promise.reject())
            .then((d) => setFields(d.form.fields))
            .catch(() => setErrors(['Could not load this form. Try refreshing.']));
    }, [brand, form.slug]);

    async function submit() {
        setErrors([]);
        setSubmitting(true);
        try {
            const token = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('token') || '' : '';
            const r = await fetch(`${BASE}/api/intake/${brand}/${form.slug}${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...identity,
                    answers,
                    source: 'web',
                }),
            });
            const d = await r.json();
            if (!r.ok || !d.success) {
                setErrors(d.details || [d.error || 'Submission failed. Please try again.']);
                return;
            }
            onSubmitted();
        } catch {
            setErrors(['Network error. Please try again.']);
        } finally {
            setSubmitting(false);
        }
    }

    if (!fields && errors.length === 0) {
        return <p className="p-6 text-center text-gray-500">Loading {form.name}…</p>;
    }

    return (
        <section className="space-y-5">
            <div>
                <h2 className="text-lg font-semibold text-gray-900">{form.name}</h2>
                {form.description && <p className="text-sm text-gray-500">{form.description}</p>}
            </div>

            {fields && fields.map((field) => (
                <FieldInput
                    key={field.field_key}
                    field={field}
                    value={answers[field.field_key] || ''}
                    onChange={(v) => setAnswers((prev) => ({ ...prev, [field.field_key]: v }))}
                />
            ))}

            {errors.length > 0 && (
                <ul className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
            )}

            <div className="flex gap-3">
                {onBack && (
                    <button onClick={onBack} className="rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700">
                        Back
                    </button>
                )}
                <button
                    onClick={submit}
                    disabled={submitting || !fields}
                    className="flex-1 rounded-lg bg-gray-900 px-4 py-3 font-medium text-white disabled:opacity-50"
                >
                    {submitting ? 'Saving…' : 'Continue'}
                </button>
            </div>
        </section>
    );
}

function DoneStep({ brand, completed }: { brand: string; completed: Set<string> }) {
    return (
        <section className="rounded-lg border border-gray-200 p-6 text-center">
            <h2 className="mb-2 text-xl font-semibold text-gray-900">All set, thank you.</h2>
            <p className="text-gray-600">
                We received your {completed.size} form{completed.size === 1 ? '' : 's'} and your provider has your info.
                We&apos;ll be in touch shortly.
            </p>
            <p className="mt-4 text-xs text-gray-400">Brand: {brand}</p>
        </section>
    );
}

function Labeled({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{label}{required && <span className="text-red-500"> *</span>}</span>
            {children}
        </label>
    );
}

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
    const labelEl = <span className="mb-1 block text-sm font-medium text-gray-800">{field.label}{field.required && <span className="text-red-500"> *</span>}</span>;
    const desc = field.description && <span className="mb-1 block text-xs text-gray-500">{field.description}</span>;
    switch (field.mod_type) {
        case 'textarea':
            return <label className="block">{labelEl}{desc}<textarea className="input" rows={3} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} /></label>;
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
            return <label className="block">{labelEl}{desc}<input className="input" placeholder="Type your full name to sign" value={value} onChange={(e) => onChange(e.target.value)} required={field.required} /><span className="mt-1 block text-xs text-gray-400">Typing your name is your electronic signature.</span></label>;
        case 'date':
            return <label className="block">{labelEl}{desc}<input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required} /></label>;
        case 'number':
            return <label className="block">{labelEl}{desc}<input type="number" className="input" value={value} onChange={(e) => onChange(e.target.value)} required={field.required} /></label>;
        default:
            return <label className="block">{labelEl}{desc}<input className="input" type={field.mod_type === 'email' ? 'email' : field.mod_type === 'phone' ? 'tel' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} required={field.required} /></label>;
    }
}
