'use client';

import { useState } from 'react';
import type { PeptideOrder } from '@/lib/peptideQueries';

interface OrderHistoryProps {
    orders: PeptideOrder[];
}

export default function OrderHistory({ orders }: OrderHistoryProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Group orders by PO number
    const ordersByPo: Record<string, PeptideOrder[]> = {};
    orders.forEach(order => {
        const key = order.po_number || 'No PO';
        if (!ordersByPo[key]) ordersByPo[key] = [];
        ordersByPo[key].push(order);
    });

    const displayOrders = isExpanded ? orders : orders.slice(0, 10);

    return (
        <div style={{ marginTop: '2rem' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem'
            }}>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Order History</h3>
                <span style={{ color: '#64748b', fontSize: '0.875rem' }}>
                    {orders.length} orders
                </span>
            </div>

            <div style={{
                background: '#fff',
                borderRadius: '0.75rem',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
                overflow: 'hidden',
            }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                    <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={headerStyle}>Date</th>
                            <th style={headerStyle}>PO Number</th>
                            <th style={headerStyle}>Peptide</th>
                            <th style={{ ...headerStyle, textAlign: 'right' }}>Qty</th>
                            <th style={headerStyle}>Created By</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayOrders.map((order) => (
                            <tr key={order.order_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={cellStyle}>
                                    {new Date(order.order_date).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                    })}
                                </td>
                                <td style={cellStyle}>
                                    <span style={{
                                        display: 'inline-block',
                                        padding: '0.25rem 0.5rem',
                                        background: order.po_number?.startsWith('ABM') ? '#dbeafe' : '#f1f5f9',
                                        borderRadius: '0.25rem',
                                        fontSize: '0.75rem',
                                        fontFamily: 'monospace',
                                    }}>
                                        {order.po_number || 'INITIAL'}
                                    </span>
                                </td>
                                <td style={cellStyle}>{order.peptide_name}</td>
                                <td style={{ ...cellStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                                    {order.quantity}
                                </td>
                                <td style={{ ...cellStyle, color: '#64748b' }}>
                                    {order.created_by || 'Import'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {orders.length > 10 && (
                    <div style={{ padding: '1rem', textAlign: 'center', borderTop: '1px solid #f1f5f9' }}>
                        <button
                            onClick={() => setIsExpanded(!isExpanded)}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#0ea5e9',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '0.875rem',
                            }}
                        >
                            {isExpanded ? 'Show Less ▲' : `Show All ${orders.length} Orders ▼`}
                        </button>
                    </div>
                )}

                {orders.length === 0 && (
                    <p style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No order history yet.
                    </p>
                )}
            </div>
        </div>
    );
}

const headerStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: 600,
    color: '#374151',
};

const cellStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
};
