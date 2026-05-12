'use client';

import { useEffect, useState, FormEvent } from 'react';
import type { BioscopeAuthorizedPatient } from '@/lib/bioscope-auth';

type Status =
  | { type: 'idle'; message: string | null }
  | { type: 'loading'; message: string | null }
  | { type: 'error'; message: string }
  | { type: 'success'; message: string };

type AddForm = {
  healthie_patient_id: string;
  notes: string;
};

const emptyForm: AddForm = { healthie_patient_id: '', notes: '' };

export default function BioscopeAdminClient() {
  const [rows, setRows] = useState<BioscopeAuthorizedPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ type: 'idle', message: null });
  const [form, setForm] = useState<AddForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/ops/api/admin/bioscope');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load (${res.status})`);
      }
      setRows(Array.isArray(data.patients) ? data.patients : []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setStatus({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ type: 'idle', message: null });

    const healthieId = form.healthie_patient_id.trim();
    if (!healthieId) {
      setStatus({ type: 'error', message: 'Healthie patient ID is required.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/ops/api/admin/bioscope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          healthie_patient_id: healthieId,
          notes: form.notes.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to add (${res.status})`);
      }
      setStatus({ type: 'success', message: `Added patient ${healthieId} to BioSCOPE allowlist.` });
      setForm(emptyForm);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add';
      setStatus({ type: 'error', message: msg });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: number, label: string) {
    if (!confirm(`Revoke BioSCOPE access for ${label}? They will immediately lose API access.`)) {
      return;
    }
    setStatus({ type: 'idle', message: null });
    try {
      const res = await fetch(`/ops/api/admin/bioscope?id=${id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to revoke (${res.status})`);
      }
      setStatus({ type: 'success', message: `Revoked access for ${label}.` });
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke';
      setStatus({ type: 'error', message: msg });
    }
  }

  const active = rows.filter((r) => !r.revoked_at);
  const revoked = rows.filter((r) => r.revoked_at);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">BioSCOPE Patient Allowlist</h1>
        <p className="text-sm text-gray-600 mt-1">
          BioSCOPE&apos;s API token can only access patients on this list. Active rows are
          authorized; revoked rows are kept for audit history.
        </p>
      </header>

      {status.type === 'error' && (
        <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {status.message}
        </div>
      )}
      {status.type === 'success' && (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {status.message}
        </div>
      )}

      <section className="border rounded p-4 bg-white">
        <h2 className="text-lg font-medium mb-3">Add Patient</h2>
        <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Healthie Patient ID
            </label>
            <input
              type="text"
              value={form.healthie_patient_id}
              onChange={(e) => setForm({ ...form, healthie_patient_id: e.target.value })}
              placeholder="e.g. 12743455"
              className="w-full border rounded px-3 py-2 text-sm"
              disabled={submitting}
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Pilot patient"
              className="w-full border rounded px-3 py-2 text-sm"
              disabled={submitting}
            />
          </div>
          <div className="md:col-span-1">
            <button
              type="submit"
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded disabled:opacity-50"
            >
              {submitting ? 'Adding...' : 'Add to allowlist'}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium mb-3">Active ({active.length})</h2>
        {loading ? (
          <div className="text-sm text-gray-500">Loading...</div>
        ) : active.length === 0 ? (
          <div className="text-sm text-gray-500">No patients authorized.</div>
        ) : (
          <table className="w-full border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 border-b">Healthie ID</th>
                <th className="px-3 py-2 border-b">Patient Name</th>
                <th className="px-3 py-2 border-b">Added By</th>
                <th className="px-3 py-2 border-b">Added At</th>
                <th className="px-3 py-2 border-b">Notes</th>
                <th className="px-3 py-2 border-b"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="px-3 py-2 font-mono">{row.healthie_patient_id}</td>
                  <td className="px-3 py-2">{row.patient_name ?? '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{row.added_by}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {new Date(row.added_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{row.notes ?? ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        handleRevoke(
                          row.id,
                          row.patient_name ?? `patient ${row.healthie_patient_id}`
                        )
                      }
                      className="text-red-600 hover:text-red-800 text-xs font-medium"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {revoked.length > 0 && (
        <section>
          <h2 className="text-lg font-medium mb-3 text-gray-600">
            Revoked ({revoked.length})
          </h2>
          <table className="w-full border text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-3 py-2 border-b">Healthie ID</th>
                <th className="px-3 py-2 border-b">Patient Name</th>
                <th className="px-3 py-2 border-b">Revoked By</th>
                <th className="px-3 py-2 border-b">Revoked At</th>
              </tr>
            </thead>
            <tbody>
              {revoked.map((row) => (
                <tr key={row.id} className="border-b text-gray-500">
                  <td className="px-3 py-2 font-mono">{row.healthie_patient_id}</td>
                  <td className="px-3 py-2">{row.patient_name ?? '—'}</td>
                  <td className="px-3 py-2">{row.revoked_by ?? '—'}</td>
                  <td className="px-3 py-2">
                    {row.revoked_at ? new Date(row.revoked_at).toLocaleString() : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
