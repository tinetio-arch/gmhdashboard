'use client';

import { useEffect, useState } from 'react';

type Row = {
    tracking_id: string;
    payment_id: string;
    patient_name: string | null;
    channel: 'woo' | 'inhouse';
    stage: string;
    wc_order_id: number | null;
    wc_order_number: string | null;
    wc_status: string | null;
    tracking_number: string | null;
    tracking_carrier: string | null;
    tracking_url: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    dispense_ids: string[] | null;
    education_complete: boolean | null;
    received_date: string | null;
    stuck_reason: string | null;
    age_hours: number;
    last_synced_at: string;
    amount: string;
    description: string | null;
    stripe_charge_id: string | null;
    created_at: string;
};

type Bucket = {
    summary: { total: number; stuck: number; in_progress: number; completed: number; refunded: number };
    stuck: Row[];
    in_progress: Row[];
    completed: Row[];
    refunded: Row[];
};

type ApiResponse = {
    success: boolean;
    days: number;
    last_synced: string | null;
    woo: Bucket;
    inhouse: Bucket;
};

const STUCK_LABELS: Record<string, string> = {
    no_wc_order_24h: 'Charged but no WC order',
    wc_processing_48h: 'WC stuck in processing',
    no_tracking_72h: 'Shipped but no tracking',
    no_dispense_3d: 'Charged but not dispensed',
};

export default function PeptidePipelinePanel() {
    const [data, setData] = useState<ApiResponse | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/ops/api/ipad/ceo/peptide-pipeline/')
            .then(r => {
                if (r.status === 403) throw new Error('CEO access required');
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(setData)
            .catch(e => setError(e.message));
    }, []);

    if (error) return null;
    if (!data) return <div style={{ padding: '1rem', color: '#64748b' }}>Loading peptide pipeline…</div>;

    return (
        <div style={{ marginTop: '2rem' }}>
            <h3 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Peptide Order Pipeline</h3>
            <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.9rem' }}>
                Last synced: {data.last_synced ? new Date(data.last_synced).toLocaleString() : 'never'} · 30-day window
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem' }}>
                <ChannelCard title="📦 WooCommerce (dropship)" bucket={data.woo} channel="woo" />
                <ChannelCard title="💉 In-House (clinic)" bucket={data.inhouse} channel="inhouse" />
            </div>
        </div>
    );
}

function ChannelCard({ title, bucket, channel }: { title: string; bucket: Bucket; channel: 'woo' | 'inhouse' }) {
    const s = bucket.summary;
    return (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem', background: 'white' }}>
            <h4 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>{title}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <Stat label="Stuck" value={s.stuck} color={s.stuck > 0 ? '#dc2626' : '#0f172a'} bg={s.stuck > 0 ? '#fef2f2' : '#f8fafc'} />
                <Stat label="In Progress" value={s.in_progress} color="#d97706" />
                <Stat label={channel === 'woo' ? 'Shipped' : 'Picked Up'} value={s.completed} color="#059669" />
                <Stat label="Total" value={s.total} color="#0f172a" />
            </div>

            {bucket.stuck.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem', marginBottom: '0.75rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        ⚠ Needs attention
                    </div>
                    {bucket.stuck.map(r => <RowItem key={r.tracking_id} r={r} highlight />)}
                </div>
            )}

            {bucket.completed.slice(0, 5).length > 0 && (
                <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                        Recent {channel === 'woo' ? 'shipments' : 'pickups'}
                    </div>
                    {bucket.completed.slice(0, 5).map(r => <RowItem key={r.tracking_id} r={r} />)}
                </div>
            )}
        </div>
    );
}

function Stat({ label, value, color, bg }: { label: string; value: number; color: string; bg?: string }) {
    return (
        <div style={{ background: bg || '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '0.5rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase' }}>{label}</div>
        </div>
    );
}

function RowItem({ r, highlight = false }: { r: Row; highlight?: boolean }) {
    const reason = r.stuck_reason ? STUCK_LABELS[r.stuck_reason] || r.stuck_reason : null;
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid #f1f5f9', gap: '0.5rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.patient_name || 'Unknown'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>${Number(r.amount).toFixed(2)}</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: highlight ? '#b91c1c' : '#64748b' }}>
                    {reason ? `${reason} · ` : ''}{r.age_hours}h ago
                    {r.tracking_number && (
                        <> · {r.tracking_url
                            ? <a href={r.tracking_url} target="_blank" rel="noreferrer" style={{ color: '#0891b2' }}>📮 {r.tracking_number}</a>
                            : <>📮 {r.tracking_number}</>}</>
                    )}
                    {r.wc_order_id && !r.tracking_number && (
                        <> · <a href={`https://abxtac.com/wp-admin/post.php?post=${r.wc_order_id}&action=edit`} target="_blank" rel="noreferrer" style={{ color: '#0891b2' }}>WC #{r.wc_order_number || r.wc_order_id}</a> ({r.wc_status})</>
                    )}
                </div>
            </div>
        </div>
    );
}
