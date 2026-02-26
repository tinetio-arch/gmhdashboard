'use client';

import { useState } from 'react';
import type { PeptideProduct } from '@/lib/peptideQueries';

interface InStockListProps {
    inventory: PeptideProduct[];
}

export default function InStockList({ inventory }: InStockListProps) {
    const [expanded, setExpanded] = useState(false);

    // Only show items that are in stock (current_stock > 0)
    const inStockItems = inventory
        .filter(p => p.current_stock > 0)
        .sort((a, b) => b.current_stock - a.current_stock);

    const displayItems = expanded ? inStockItems : inStockItems.slice(0, 10);

    return (
        <div style={{
            background: '#fff',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '0.75rem',
            padding: '1rem 1.25rem',
            minWidth: '280px',
            maxWidth: '350px',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
        }}>
            <h4 style={{
                margin: '0 0 0.75rem',
                fontSize: '0.9rem',
                color: '#059669',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
            }}>
                ✅ In Stock ({inStockItems.length})
            </h4>

            <div style={{
                maxHeight: expanded ? '400px' : '220px',
                overflowY: 'auto',
                fontSize: '0.8rem',
            }}>
                {displayItems.map((p) => (
                    <div
                        key={p.product_id}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.4rem 0',
                            borderBottom: '1px solid #f1f5f9',
                        }}
                    >
                        <span style={{
                            color: '#374151',
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            paddingRight: '0.5rem',
                        }}>
                            {p.name}
                        </span>
                        <span style={{
                            fontWeight: 600,
                            fontFamily: 'monospace',
                            color: p.status === 'Reorder' ? '#f59e0b' : '#059669',
                            background: p.status === 'Reorder' ? '#fef3c7' : '#ecfdf5',
                            padding: '0.15rem 0.5rem',
                            borderRadius: '0.25rem',
                            fontSize: '0.75rem',
                            minWidth: '32px',
                            textAlign: 'center',
                        }}>
                            {p.current_stock}
                        </span>
                    </div>
                ))}
            </div>

            {inStockItems.length > 10 && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    style={{
                        marginTop: '0.5rem',
                        background: 'none',
                        border: 'none',
                        color: '#0ea5e9',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        padding: 0,
                        fontWeight: 500,
                    }}
                >
                    {expanded ? 'Show Less ▲' : `Show All ${inStockItems.length} ▼`}
                </button>
            )}

            {inStockItems.length === 0 && (
                <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>
                    No peptides in stock
                </p>
            )}
        </div>
    );
}
