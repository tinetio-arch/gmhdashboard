'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PeptideProduct } from '@/lib/peptideQueries';
import { withBasePath } from '@/lib/basePath';

interface PeptideTableProps {
    inventory: PeptideProduct[];
}

const CATEGORIES = [
    'Growth Hormone',
    'Weight Management',
    'Wound Healing',
    'Sexual Health',
    'Cognitive',
    'Performance',
    'Anti-Aging',
    'Other',
];

export default function PeptideTable({ inventory }: PeptideTableProps) {
    const router = useRouter();
    const [filter, setFilter] = useState<'all' | 'reorder' | 'ok'>('all');
    const [search, setSearch] = useState('');
    const [showAddForm, setShowAddForm] = useState(false);
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [showInactive, setShowInactive] = useState(false);

    // Add form state
    const [newName, setNewName] = useState('');
    const [newCategory, setNewCategory] = useState('Growth Hormone');
    const [newSku, setNewSku] = useState('');
    const [newReorderPoint, setNewReorderPoint] = useState('5');
    const [newSupplier, setNewSupplier] = useState('');
    const [newUnitCost, setNewUnitCost] = useState('');
    const [newSellPrice, setNewSellPrice] = useState('');
    const [newDirections, setNewDirections] = useState('');

    const filteredInventory = inventory.filter(p => {
        const matchesFilter = filter === 'all' ||
            (filter === 'reorder' && p.status === 'Reorder') ||
            (filter === 'ok' && p.status === 'OK');
        const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
        return matchesFilter && matchesSearch;
    });

    const handleAddProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        setAdding(true);
        setAddError(null);

        try {
            const res = await fetch(withBasePath('/api/peptides'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: newName,
                    category: newCategory,
                    sku: newSku || undefined,
                    reorder_point: Number(newReorderPoint) || 5,
                    supplier: newSupplier || undefined,
                    unit_cost: newUnitCost ? Number(newUnitCost) : undefined,
                    sell_price: newSellPrice ? Number(newSellPrice) : undefined,
                    label_directions: newDirections || undefined,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to add product');
            }

            // Reset form
            setNewName('');
            setNewCategory('Growth Hormone');
            setNewSku('');
            setNewReorderPoint('5');
            setNewSupplier('');
            setNewUnitCost('');
            setNewSellPrice('');
            setNewDirections('');
            setShowAddForm(false);
            router.refresh();
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setAdding(false);
        }
    };

    const handleToggleActive = async (product: PeptideProduct) => {
        const action = product.active ? 'deactivate' : 'reactivate';
        if (product.active && !confirm(`Mark "${product.name}" as inactive? It will be hidden but historical data is preserved.`)) return;
        setTogglingId(product.product_id);
        setAddError(null);
        try {
            if (product.active) {
                const res = await fetch(withBasePath(`/api/peptides?id=${product.product_id}`), { method: 'DELETE' });
                if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Failed'); }
            } else {
                const res = await fetch(withBasePath('/api/peptides'), {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: product.product_id, reactivate: true }),
                });
                if (!res.ok) { const data = await res.json(); throw new Error(data.error || 'Failed'); }
            }
            router.refresh();
        } catch (err) {
            setAddError(err instanceof Error ? err.message : `${action} failed`);
        } finally {
            setTogglingId(null);
        }
    };

    // --- Inline editing ---
    const [editCell, setEditCell] = useState<{ id: string; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');

    const startEdit = (productId: string, field: string, currentValue: string) => {
        setEditCell({ id: productId, field });
        setEditValue(currentValue);
    };

    const saveEdit = async () => {
        if (!editCell) return;
        const { id, field } = editCell;
        setEditCell(null);
        try {
            let payload: Record<string, any> = { product_id: id };
            if (field === 'unit_cost' || field === 'sell_price') {
                payload[field] = editValue ? Number(editValue) : null;
            } else if (field === 'reorder_point') {
                payload[field] = Number(editValue) || 5;
            } else {
                payload[field] = editValue || null;
            }
            const res = await fetch(withBasePath('/api/peptides'), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Save failed');
            }
            router.refresh();
        } catch (err) {
            setAddError(err instanceof Error ? err.message : 'Save failed');
        }
    };

    const EditableTd = ({ productId, field, value, style, align }: {
        productId: string; field: string; value: string; style?: React.CSSProperties; align?: string;
    }) => {
        const isEditing = editCell?.id === productId && editCell?.field === field;
        return (
            <td
                style={{ ...tdStyle, cursor: 'pointer', ...style }}
                onDoubleClick={() => startEdit(productId, field, value)}
                title="Double-click to edit"
            >
                {isEditing ? (
                    <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={saveEdit}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null); }}
                        style={{ ...inputStyle, width: '100%', padding: '0.3rem', fontSize: '0.85rem' }}
                    />
                ) : (
                    <span>{value || '—'}</span>
                )}
            </td>
        );
    };

    return (
        <div style={{ marginBottom: '2rem' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
                flexWrap: 'wrap',
                gap: '1rem',
            }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Inventory Summary</h3>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Search */}
                    <input
                        type="text"
                        placeholder="Search peptides..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #d1d5db',
                            fontSize: '0.875rem',
                            minWidth: '200px',
                        }}
                    />

                    {/* Filter Buttons */}
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {(['all', 'reorder', 'ok'] as const).map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                style={{
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: '0.375rem',
                                    border: 'none',
                                    background: filter === f ? '#0ea5e9' : '#e5e7eb',
                                    color: filter === f ? '#fff' : '#374151',
                                    fontSize: '0.875rem',
                                    cursor: 'pointer',
                                    textTransform: 'capitalize',
                                }}
                            >
                                {f === 'all' ? 'All' : f === 'reorder' ? '⚠️ Reorder' : '✅ OK'}
                            </button>
                        ))}
                    </div>

                    {/* Add Peptide Button */}
                    <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '0.375rem',
                            border: 'none',
                            background: showAddForm ? '#ef4444' : '#8b5cf6',
                            color: '#fff',
                            fontSize: '0.875rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        {showAddForm ? '✕ Cancel' : '+ Add Peptide'}
                    </button>

                    {/* Show Inactive Toggle */}
                    <button
                        onClick={() => setShowInactive(!showInactive)}
                        style={{
                            padding: '0.5rem 0.75rem',
                            borderRadius: '0.375rem',
                            border: 'none',
                            background: showInactive ? '#f59e0b' : '#e5e7eb',
                            color: showInactive ? '#fff' : '#374151',
                            fontSize: '0.875rem',
                            cursor: 'pointer',
                        }}
                    >
                        {showInactive ? '👁️ Showing Inactive' : '👁️ Show Inactive'}
                    </button>
                </div>
            </div>

            {/* Add Peptide Form */}
            {showAddForm && (
                <div style={{
                    background: '#faf5ff',
                    border: '2px solid #8b5cf6',
                    borderRadius: '0.75rem',
                    padding: '1.25rem',
                    marginBottom: '1rem',
                }}>
                    <h4 style={{ margin: '0 0 1rem', color: '#7c3aed' }}>+ Add New Peptide Product</h4>

                    {addError && (
                        <div style={{
                            background: '#fee2e2',
                            border: '1px solid #ef4444',
                            borderRadius: '0.5rem',
                            padding: '0.5rem 0.75rem',
                            marginBottom: '0.75rem',
                            color: '#dc2626',
                            fontSize: '0.85rem',
                        }}>
                            {addError}
                        </div>
                    )}

                    <form onSubmit={handleAddProduct}>
                        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                            <div>
                                <label style={labelStyle}>Name *</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    required
                                    style={inputStyle}
                                    placeholder="e.g., Oxytocin 10mg"
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Category *</label>
                                <select
                                    value={newCategory}
                                    onChange={(e) => setNewCategory(e.target.value)}
                                    style={inputStyle}
                                >
                                    {CATEGORIES.map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>SKU</label>
                                <input
                                    type="text"
                                    value={newSku}
                                    onChange={(e) => setNewSku(e.target.value)}
                                    style={inputStyle}
                                    placeholder="e.g., OXY-10"
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Reorder Point</label>
                                <input
                                    type="number"
                                    value={newReorderPoint}
                                    onChange={(e) => setNewReorderPoint(e.target.value)}
                                    min="0"
                                    style={inputStyle}
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Supplier</label>
                                <input
                                    type="text"
                                    value={newSupplier}
                                    onChange={(e) => setNewSupplier(e.target.value)}
                                    style={inputStyle}
                                    placeholder="e.g., Alpha BioMed"
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Unit Cost ($)</label>
                                <input
                                    type="number"
                                    value={newUnitCost}
                                    onChange={(e) => setNewUnitCost(e.target.value)}
                                    step="0.01"
                                    min="0"
                                    style={inputStyle}
                                    placeholder="Our cost"
                                />
                            </div>
                            <div>
                                <label style={labelStyle}>Sell Price ($)</label>
                                <input
                                    type="number"
                                    value={newSellPrice}
                                    onChange={(e) => setNewSellPrice(e.target.value)}
                                    step="0.01"
                                    min="0"
                                    style={inputStyle}
                                    placeholder="Patient charge"
                                />
                            </div>
                            <div style={{ gridColumn: 'span 2' }}>
                                <label style={labelStyle}>Label Directions</label>
                                <textarea
                                    value={newDirections}
                                    onChange={(e) => setNewDirections(e.target.value)}
                                    style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
                                    placeholder="e.g., Inject 10 units SUBQ daily. Inject fasted."
                                />
                            </div>
                        </div>
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                            <button
                                type="submit"
                                disabled={adding}
                                style={{
                                    padding: '0.6rem 1.25rem',
                                    background: adding ? '#94a3b8' : '#8b5cf6',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    cursor: adding ? 'not-allowed' : 'pointer',
                                }}
                            >
                                {adding ? 'Adding...' : '✅ Add Product'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Table */}
            <div style={{
                overflowX: 'auto',
                background: '#fff',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={thStyle}>Peptide Name</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>Category</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>SKU</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Total Ordered</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Total Dispensed</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Current Stock</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>Reorder Pt.</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>Re-Order Alert</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Unit Cost</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Sell Price</th>
                            <th style={{ ...thStyle, textAlign: 'right' }}>Margin</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Directions</th>
                            <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredInventory.filter(p => showInactive || p.active).map((p) => {
                            const margin = (p.unit_cost && p.sell_price)
                                ? ((p.sell_price - p.unit_cost) / p.sell_price * 100).toFixed(0)
                                : null;

                            return (
                                <tr key={p.product_id} style={{ borderBottom: '1px solid #f1f5f9', opacity: p.active ? 1 : 0.45 }}>
                                    <EditableTd productId={p.product_id} field="name" value={p.name} />
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.2rem 0.5rem',
                                            borderRadius: '0.25rem',
                                            fontSize: '0.7rem',
                                            fontWeight: 500,
                                            ...getCategoryStyle(p.category),
                                        }}>
                                            {p.category}
                                        </span>
                                    </td>
                                    <EditableTd productId={p.product_id} field="sku" value={p.sku || ''} style={{ fontFamily: 'monospace', color: '#64748b', fontSize: '0.8rem' }} />
                                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{p.total_ordered}</td>
                                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>{p.total_dispensed}</td>
                                    <td style={{
                                        ...tdStyle,
                                        textAlign: 'right',
                                        fontFamily: 'monospace',
                                        fontWeight: 600,
                                        color: p.current_stock <= p.reorder_point ? '#dc2626' : '#059669',
                                    }}>
                                        {p.current_stock}
                                    </td>
                                    <EditableTd productId={p.product_id} field="reorder_point" value={String(p.reorder_point)} style={{ textAlign: 'center', color: '#64748b' }} />
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '0.25rem 0.75rem',
                                            borderRadius: '9999px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: p.status === 'Reorder' ? '#fef3c7' : '#d1fae5',
                                            color: p.status === 'Reorder' ? '#92400e' : '#065f46',
                                        }}>
                                            {p.status === 'Reorder' ? '⚠️ Reorder' : '✅ OK'}
                                        </span>
                                    </td>
                                    <EditableTd productId={p.product_id} field="unit_cost" value={p.unit_cost ? String(p.unit_cost) : ''} style={{ textAlign: 'right', fontFamily: 'monospace' }} />
                                    <EditableTd productId={p.product_id} field="sell_price" value={p.sell_price ? String(p.sell_price) : ''} style={{ textAlign: 'right', fontFamily: 'monospace' }} />
                                    <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                                        {margin ? (
                                            <span style={{
                                                color: Number(margin) >= 50 ? '#059669' : Number(margin) >= 30 ? '#d97706' : '#dc2626',
                                                fontWeight: 600,
                                            }}>
                                                {margin}%
                                            </span>
                                        ) : (
                                            <span style={{ color: '#cbd5e1' }}>—</span>
                                        )}
                                    </td>
                                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                                        <button
                                            onClick={() => handleToggleActive(p)}
                                            disabled={togglingId === p.product_id}
                                            title={p.active ? 'Mark as inactive' : 'Reactivate'}
                                            style={{
                                                background: 'none',
                                                border: `1px solid ${p.active ? '#fca5a5' : '#86efac'}`,
                                                borderRadius: '0.375rem',
                                                padding: '0.3rem 0.5rem',
                                                cursor: togglingId === p.product_id ? 'wait' : 'pointer',
                                                fontSize: '0.85rem',
                                                color: p.active ? '#dc2626' : '#16a34a',
                                                opacity: togglingId === p.product_id ? 0.5 : 1,
                                            }}
                                        >
                                            {p.active ? '⊘' : '♻️'}
                                        </button>
                                    </td>
                                    <EditableTd productId={p.product_id} field="label_directions" value={p.label_directions || ''} style={{ fontSize: '0.75rem', color: '#64748b', maxWidth: '180px' }} />
                                </tr>
                            );
                        })}
                    </tbody>
                </table>

                {filteredInventory.length === 0 && (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No peptides found matching your criteria.
                    </p>
                )}
            </div>
        </div>
    );
}

function getCategoryStyle(category: string): { background: string; color: string } {
    const styles: Record<string, { background: string; color: string }> = {
        'Growth Hormone': { background: '#dbeafe', color: '#1e40af' },
        'Weight Management': { background: '#fef3c7', color: '#92400e' },
        'Wound Healing': { background: '#d1fae5', color: '#065f46' },
        'Sexual Health': { background: '#fce7f3', color: '#9d174d' },
        'Cognitive': { background: '#e0e7ff', color: '#3730a3' },
        'Performance': { background: '#fef3c7', color: '#78350f' },
        'Anti-Aging': { background: '#f3e8ff', color: '#6b21a8' },
    };
    return styles[category] || { background: '#f1f5f9', color: '#475569' };
}

const thStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
};

const tdStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: '0.25rem',
    fontSize: '0.8rem',
    fontWeight: 500,
    color: '#374151',
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.6rem',
    borderRadius: '0.375rem',
    border: '1px solid #d1d5db',
    fontSize: '0.85rem',
    boxSizing: 'border-box',
};
