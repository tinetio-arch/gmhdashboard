'use client';

interface PeptideFinancialsProps {
    data: {
        revenue_today: number;
        revenue_7d: number;
        revenue_30d: number;
        top_sellers: Array<{ name: string; quantity: number; revenue: number }>;
    };
}

const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

export default function PeptideFinancials({ data }: PeptideFinancialsProps) {
    if (!data) return null;

    return (
        <div style={{
            background: '#fff',
            borderRadius: '12px',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '1.5rem'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem'
            }}>
                <h3 style={{ margin: 0, color: '#1e293b', fontSize: '1.25rem' }}>
                    💰 Revenue
                </h3>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    Based on 'Paid' Dispenses
                </div>
            </div>

            {/* Revenue Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '1rem',
                marginBottom: '1.5rem'
            }}>
                {/* Today */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #fdf4ff 0%, #fae8ff 100%)',
                    borderRadius: '12px',
                    border: '1px solid #f0abfc'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#86198f', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Today
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#a21caf', marginTop: '0.5rem' }}>
                        {formatCurrency(data.revenue_today)}
                    </div>
                </div>

                {/* 7 Days */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)',
                    borderRadius: '12px',
                    border: '1px solid #fda4af'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Last 7 Days
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#e11d48', marginTop: '0.5rem' }}>
                        {formatCurrency(data.revenue_7d)}
                    </div>
                </div>

                {/* 30 Days */}
                <div style={{
                    padding: '1.25rem',
                    background: 'linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%)',
                    borderRadius: '12px',
                    border: '1px solid #fdba74'
                }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Last 30 Days
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#ea580c', marginTop: '0.5rem' }}>
                        {formatCurrency(data.revenue_30d)}
                    </div>
                </div>
            </div>

            {/* Top Sellers */}
            <div>
                <h4 style={{ margin: '0 0 1rem 0', color: '#334155', fontSize: '1rem' }}>
                    🏆 Top Sellers (Last 30 Days)
                </h4>
                <div style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 100px 120px',
                        padding: '0.75rem 1rem',
                        background: '#f8fafc',
                        borderBottom: '1px solid #e2e8f0',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: '#64748b',
                        textTransform: 'uppercase'
                    }}>
                        <div>Product</div>
                        <div style={{ textAlign: 'right' }}>Units</div>
                        <div style={{ textAlign: 'right' }}>Revenue</div>
                    </div>

                    {data.top_sellers && data.top_sellers.length > 0 ? (
                        data.top_sellers.map((product, index) => (
                            <div key={index} style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 100px 120px',
                                padding: '0.75rem 1rem',
                                borderBottom: index === data.top_sellers.length - 1 ? 'none' : '1px solid #f1f5f9',
                                fontSize: '0.875rem'
                            }}>
                                <div style={{ fontWeight: 500, color: '#334155' }}>
                                    {index + 1}. {product.name}
                                </div>
                                <div style={{ textAlign: 'right', color: '#64748b' }}>
                                    {product.quantity}
                                </div>
                                <div style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>
                                    {formatCurrency(product.revenue)}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                            No sales data in this period
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
