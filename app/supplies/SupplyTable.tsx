'use client';

import { useState, useCallback } from 'react';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SupplyItem {
    id: number;
    name: string;
    category: string;
    unit: string;
    par_level: number | null;
    reorder_qty: number | null;
    notes: string | null;
    qty_on_hand: number;
    status: 'ok' | 'low' | 'reorder' | 'out';
    counted_at: string | null;
}

interface SupplyLocation {
    id: string;
    name: string;
    address: string | null;
}

interface Patient {
    value: string;
    label: string;
}

interface Props {
    initialItems: SupplyItem[];
    categories: string[];
    locations: SupplyLocation[];
    defaultLocation: string;
    patients: Patient[];
    userEmail: string;
}

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
    ok: { bg: '#dcfce7', color: '#166534', label: '✓ OK' },
    low: { bg: '#fef9c3', color: '#854d0e', label: '⚠ Low' },
    reorder: { bg: '#fee2e2', color: '#991b1b', label: '⬇ Reorder' },
    out: { bg: '#fecaca', color: '#7f1d1d', label: '✕ Out' },
};

export default function SupplyTable({ initialItems, categories, locations, defaultLocation, patients, userEmail }: Props) {
    const [items, setItems] = useState(initialItems);
    const [search, setSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const [activeLocation, setActiveLocation] = useState(defaultLocation);
    const [showUseModal, setShowUseModal] = useState(false);
    const [showCountModal, setShowCountModal] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');

    // Use form state
    const [useEntries, setUseEntries] = useState<{ item_id: number; qty_used: number }[]>([]);
    const [usePatientId, setUsePatientId] = useState('');
    const [usePatientName, setUsePatientName] = useState('');
    const [useNotes, setUseNotes] = useState('');

    // Count form state
    const [countEntries, setCountEntries] = useState<Record<number, string>>({});

    const refreshItems = useCallback(async (loc?: string) => {
        try {
            const res = await fetch(`${basePath}/api/supplies?location=${loc ?? activeLocation}`);
            const data = await res.json();
            if (data.items) setItems(data.items);
        } catch { }
    }, [activeLocation]);

    async function switchLocation(locId: string) {
        setActiveLocation(locId);
        setActiveCategory(null);
        setSearch('');
        try {
            const res = await fetch(`${basePath}/api/supplies?location=${locId}`);
            const data = await res.json();
            if (data.items) setItems(data.items);
        } catch { }
    }

    const filtered = items.filter(i => {
        if (activeCategory && i.category !== activeCategory) return false;
        if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    // Group by category for display
    const grouped = filtered.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
    }, {} as Record<string, SupplyItem[]>);

    async function handleUseSubmit() {
        const entries = useEntries.filter(e => e.qty_used > 0);
        if (entries.length === 0) return;
        setSaving(true);
        try {
            const res = await fetch(`${basePath}/api/supplies/use`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: entries.map(e => ({
                        ...e,
                        location: activeLocation,
                        healthie_patient_id: usePatientId || undefined,
                        healthie_patient_name: usePatientName || undefined,
                        notes: useNotes || undefined,
                    })),
                    recorded_by: userEmail,
                }),
            });
            if (!res.ok) throw new Error('Failed to record usage');
            setMessage(`✅ Recorded ${entries.length} supply usage(s)`);
            setShowUseModal(false);
            setUseEntries([]);
            setUsePatientId('');
            setUsePatientName('');
            setUseNotes('');
            await refreshItems();
        } catch (err: any) {
            setMessage(`❌ ${err.message}`);
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(''), 4000);
        }
    }

    async function handleCountSubmit() {
        const entries = Object.entries(countEntries)
            .filter(([_, v]) => v !== '' && v !== undefined)
            .map(([id, qty]) => ({ item_id: Number(id), qty: Number(qty), location: activeLocation }));

        if (entries.length === 0) return;
        setSaving(true);
        try {
            const res = await fetch(`${basePath}/api/supplies/count`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entries, recorded_by: userEmail }),
            });
            if (!res.ok) throw new Error('Failed to submit count');
            setMessage(`✅ Updated ${entries.length} item counts`);
            setShowCountModal(false);
            setCountEntries({});
            await refreshItems();
        } catch (err: any) {
            setMessage(`❌ ${err.message}`);
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(''), 4000);
        }
    }

    function toggleUseItem(itemId: number) {
        setUseEntries(prev => {
            const exists = prev.find(e => e.item_id === itemId);
            if (exists) return prev.filter(e => e.item_id !== itemId);
            return [...prev, { item_id: itemId, qty_used: 1 }];
        });
    }

    function updateUseQty(itemId: number, qty: number) {
        setUseEntries(prev => prev.map(e => e.item_id === itemId ? { ...e, qty_used: qty } : e));
    }

    const activeLocObj = locations.find(l => l.id === activeLocation);

    const cardStyle: React.CSSProperties = {
        background: '#fff',
        border: '1px solid rgba(148,163,184,0.22)',
        borderRadius: '0.75rem',
        boxShadow: '0 12px 28px rgba(15,23,42,0.06)',
    };

    return (
        <div>
            {/* Message toast */}
            {message && (
                <div style={{
                    position: 'fixed', top: '1rem', right: '1rem', zIndex: 1000,
                    padding: '1rem 1.5rem', borderRadius: '0.75rem',
                    background: message.startsWith('✅') ? '#dcfce7' : '#fee2e2',
                    color: message.startsWith('✅') ? '#166534' : '#991b1b',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.15)', fontWeight: 600,
                }}>
                    {message}
                </div>
            )}

            {/* Location Selector */}
            <div style={{
                display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.5rem',
                padding: '0.75rem', background: '#f8fafc', borderRadius: '0.75rem',
                border: '1px solid #e2e8f0',
            }}>
                <span style={{ fontWeight: 600, color: '#475569', alignSelf: 'center', fontSize: '0.85rem' }}>📍 Location:</span>
                {locations.map(loc => (
                    <button
                        key={loc.id}
                        onClick={() => switchLocation(loc.id)}
                        style={{
                            padding: '0.5rem 1rem', borderRadius: '0.5rem', border: 'none',
                            background: activeLocation === loc.id
                                ? 'linear-gradient(135deg, #0ea5e9, #0284c7)'
                                : '#ffffff',
                            color: activeLocation === loc.id ? '#fff' : '#334155',
                            fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
                            boxShadow: activeLocation === loc.id
                                ? '0 2px 8px rgba(14,165,233,0.3)'
                                : '0 1px 3px rgba(0,0,0,0.08)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        {loc.name}
                        {loc.address && (
                            <span style={{
                                display: 'block', fontSize: '0.7rem', fontWeight: 400,
                                opacity: activeLocation === loc.id ? 0.85 : 0.6,
                                marginTop: '0.15rem',
                            }}>
                                {loc.address}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'center' }}>
                <input
                    type="text"
                    placeholder={`Search supplies at ${activeLocObj?.name ?? 'location'}...`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        padding: '0.6rem 1rem', borderRadius: '0.5rem',
                        border: '1px solid #cbd5e1', fontSize: '0.9rem', flex: '1 1 200px',
                    }}
                />
                <button
                    onClick={() => { setShowUseModal(true); setUseEntries([]); }}
                    style={{
                        padding: '0.6rem 1.2rem', borderRadius: '0.5rem',
                        background: '#0ea5e9', color: '#fff', border: 'none',
                        fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
                    }}
                >
                    📋 Use Supplies
                </button>
                <button
                    onClick={() => { setShowCountModal(true); setCountEntries({}); }}
                    style={{
                        padding: '0.6rem 1.2rem', borderRadius: '0.5rem',
                        background: '#8b5cf6', color: '#fff', border: 'none',
                        fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem',
                    }}
                >
                    📊 Record Count
                </button>
            </div>

            {/* Category Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                <button
                    onClick={() => setActiveCategory(null)}
                    style={{
                        padding: '0.4rem 0.9rem', borderRadius: '999px', border: 'none',
                        background: !activeCategory ? '#0f172a' : '#f1f5f9',
                        color: !activeCategory ? '#fff' : '#475569',
                        fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                    }}
                >
                    All ({items.length})
                </button>
                {categories.map(cat => {
                    const catCount = items.filter(i => i.category === cat).length;
                    return (
                        <button
                            key={cat}
                            onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
                            style={{
                                padding: '0.4rem 0.9rem', borderRadius: '999px', border: 'none',
                                background: activeCategory === cat ? '#0f172a' : '#f1f5f9',
                                color: activeCategory === cat ? '#fff' : '#475569',
                                fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem',
                            }}
                        >
                            {cat} ({catCount})
                        </button>
                    );
                })}
            </div>

            {/* Items Table */}
            <div style={{ ...cardStyle, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                            <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 600 }}>Item</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontWeight: 600 }}>Category</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontWeight: 600, textAlign: 'right' }}>On Hand</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontWeight: 600, textAlign: 'right' }}>PAR Level</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontWeight: 600, textAlign: 'center' }}>Status</th>
                            <th style={{ padding: '0.75rem 0.5rem', color: '#64748b', fontWeight: 600 }}>Last Counted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {Object.entries(grouped).map(([category, categoryItems]) => (
                            categoryItems.map((item) => {
                                const badge = STATUS_BADGE[item.status];
                                return (
                                    <tr
                                        key={item.id}
                                        style={{
                                            borderBottom: '1px solid #f1f5f9',
                                            background: item.status === 'out' ? '#fef2f2' : item.status === 'reorder' ? '#fefce8' : 'transparent',
                                        }}
                                    >
                                        <td style={{ padding: '0.6rem 1rem', fontWeight: 500 }}>{item.name}</td>
                                        <td style={{ padding: '0.6rem 0.5rem', color: '#64748b', fontSize: '0.8rem' }}>{item.category}</td>
                                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                            {item.qty_on_hand}
                                        </td>
                                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', color: '#94a3b8' }}>
                                            {item.par_level ?? '—'}
                                        </td>
                                        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'center' }}>
                                            <span style={{
                                                display: 'inline-block', padding: '0.2rem 0.6rem',
                                                borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
                                                background: badge.bg, color: badge.color,
                                            }}>
                                                {badge.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.6rem 0.5rem', color: '#94a3b8', fontSize: '0.8rem' }}>
                                            {item.counted_at ? new Date(item.counted_at).toLocaleDateString() : '—'}
                                        </td>
                                    </tr>
                                );
                            })
                        ))}
                        {filtered.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                                    No supplies found at this location
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* ── USE SUPPLIES MODAL ── */}
            {showUseModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{ ...cardStyle, width: '600px', maxHeight: '80vh', overflow: 'auto', padding: '1.5rem' }}>
                        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem' }}>📋 Use Supplies</h3>
                        <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1rem' }}>
                            📍 {activeLocObj?.name} — {activeLocObj?.address}
                        </p>

                        {/* Patient selector */}
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.3rem', fontSize: '0.85rem' }}>
                                Patient (optional)
                            </label>
                            <select
                                value={usePatientId}
                                onChange={(e) => {
                                    setUsePatientId(e.target.value);
                                    const p = patients.find(p => p.value === e.target.value);
                                    setUsePatientName(p?.label ?? '');
                                }}
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}
                            >
                                <option value="">— No patient —</option>
                                {patients.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Notes */}
                        <div style={{ marginBottom: '1rem' }}>
                            <input
                                type="text"
                                placeholder="Notes (optional)"
                                value={useNotes}
                                onChange={(e) => setUseNotes(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1' }}
                            />
                        </div>

                        {/* Item checkboxes */}
                        <div style={{ maxHeight: '40vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}>
                            {items.filter(i => i.qty_on_hand > 0).map(item => {
                                const selected = useEntries.find(e => e.item_id === item.id);
                                return (
                                    <div
                                        key={item.id}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                                            padding: '0.5rem 0.75rem', borderBottom: '1px solid #f1f5f9',
                                            background: selected ? '#eff6ff' : 'transparent',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={!!selected}
                                            onChange={() => toggleUseItem(item.id)}
                                        />
                                        <span style={{ flex: 1, fontSize: '0.85rem' }}>
                                            {item.name}
                                            <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>({item.qty_on_hand} on hand)</span>
                                        </span>
                                        {selected && (
                                            <input
                                                type="number"
                                                min={1}
                                                max={item.qty_on_hand}
                                                value={selected.qty_used}
                                                onChange={(e) => updateUseQty(item.id, Math.max(1, Number(e.target.value)))}
                                                style={{ width: '60px', padding: '0.3rem', borderRadius: '0.3rem', border: '1px solid #cbd5e1', textAlign: 'center' }}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowUseModal(false)}
                                style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUseSubmit}
                                disabled={saving || useEntries.filter(e => e.qty_used > 0).length === 0}
                                style={{
                                    padding: '0.5rem 1.2rem', borderRadius: '0.5rem', border: 'none',
                                    background: '#0ea5e9', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: saving ? 0.5 : 1,
                                }}
                            >
                                {saving ? 'Saving...' : `Submit (${useEntries.filter(e => e.qty_used > 0).length} items)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── RECORD COUNT MODAL ── */}
            {showCountModal && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{ ...cardStyle, width: '600px', maxHeight: '80vh', overflow: 'auto', padding: '1.5rem' }}>
                        <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.25rem' }}>📊 Record Inventory Count</h3>
                        <p style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '1rem' }}>
                            📍 {activeLocObj?.name} — Enter current quantities. Only items with values will be updated.
                        </p>

                        <div style={{ maxHeight: '50vh', overflow: 'auto', border: '1px solid #e2e8f0', borderRadius: '0.5rem' }}>
                            {Object.entries(grouped).map(([category, categoryItems]) => (
                                <div key={category}>
                                    <div style={{
                                        padding: '0.5rem 0.75rem', background: '#f8fafc',
                                        fontWeight: 700, fontSize: '0.8rem', color: '#475569',
                                        textTransform: 'uppercase', letterSpacing: '0.05em',
                                        borderBottom: '1px solid #e2e8f0',
                                    }}>
                                        {category}
                                    </div>
                                    {categoryItems.map(item => (
                                        <div
                                            key={item.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                                padding: '0.4rem 0.75rem', borderBottom: '1px solid #f1f5f9',
                                            }}
                                        >
                                            <span style={{ flex: 1, fontSize: '0.85rem' }}>
                                                {item.name}
                                                <span style={{ color: '#94a3b8', marginLeft: '0.5rem' }}>(was {item.qty_on_hand})</span>
                                            </span>
                                            <input
                                                type="number"
                                                min={0}
                                                placeholder={String(item.qty_on_hand)}
                                                value={countEntries[item.id] ?? ''}
                                                onChange={(e) => setCountEntries(prev => ({ ...prev, [item.id]: e.target.value }))}
                                                style={{
                                                    width: '70px', padding: '0.3rem', borderRadius: '0.3rem',
                                                    border: '1px solid #cbd5e1', textAlign: 'center',
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowCountModal(false)}
                                style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCountSubmit}
                                disabled={saving}
                                style={{
                                    padding: '0.5rem 1.2rem', borderRadius: '0.5rem', border: 'none',
                                    background: '#8b5cf6', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    opacity: saving ? 0.5 : 1,
                                }}
                            >
                                {saving ? 'Saving...' : 'Submit Count'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
