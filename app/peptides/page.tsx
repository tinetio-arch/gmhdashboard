export const dynamic = 'force-dynamic';

import { fetchPeptideInventory, fetchPeptideInventorySummary, fetchPeptideOrders, fetchPeptideDispenses, fetchPeptideProductOptions } from '@/lib/peptideQueries';
import { fetchTirzepatideOrders, fetchFarmakaioOrders } from '@/lib/specialtyOrderQueries';
import { requireUser } from '@/lib/auth';
import PeptideTable from './PeptideTable';
import DispenseForm from './DispenseForm';
import DispenseHistory from './DispenseHistory';
import ReceiveShipmentForm from './ReceiveShipmentForm';
import OrderHistory from './OrderHistory';
import InStockList from './InStockList';
import SpecialtyOrderTabs from './SpecialtyOrderTabs';

export default async function PeptidesPage() {
    const user = await requireUser('read');
    const [inventory, summary, orders, dispenses, productOptions, tirzepatideOrders, farmakaioOrders] = await Promise.all([
        fetchPeptideInventory(true),
        fetchPeptideInventorySummary(),
        fetchPeptideOrders(50),
        fetchPeptideDispenses(100),
        fetchPeptideProductOptions(),
        fetchTirzepatideOrders(),
        fetchFarmakaioOrders(),
    ]);

    const lowStockItems = inventory.filter(p => p.status === 'Reorder');
    const pendingDispenses = dispenses.filter(d => d.status === 'Pending' || !d.education_complete);

    return (
        <section>
            <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Peptide Inventory</h2>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                Dispense peptides to patients, receive shipments, and monitor stock levels.
            </p>

            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
                <SummaryCard label="Products" value={summary.total_products} />
                <SummaryCard label="Current Stock" value={summary.total_stock} />
                <SummaryCard
                    label="Low Stock"
                    value={summary.low_stock_count}
                    highlight={summary.low_stock_count > 0}
                    color="warning"
                />
                <SummaryCard label="Dispensed" value={summary.total_dispensed} color="success" />
                <SummaryCard
                    label="Pending"
                    value={summary.pending_dispenses}
                    highlight={summary.pending_dispenses > 0}
                    color="info"
                />
                <SummaryCard label="Orders" value={summary.total_orders} />
            </div>

            {/* Low Stock Alert */}
            {lowStockItems.length > 0 && (
                <div style={{
                    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
                    border: '1px solid #f59e0b',
                    borderRadius: '0.75rem',
                    padding: '1rem 1.5rem',
                    marginBottom: '1.5rem',
                }}>
                    <h4 style={{ margin: '0 0 0.5rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        ⚠️ Reorder Alert
                    </h4>
                    <p style={{ margin: 0, color: '#78350f' }}>
                        {lowStockItems.length} peptide{lowStockItems.length > 1 ? 's' : ''} need{lowStockItems.length === 1 ? 's' : ''} to be reordered:{' '}
                        <strong>{lowStockItems.slice(0, 5).map(p => p.name).join(', ')}{lowStockItems.length > 5 ? ` +${lowStockItems.length - 5} more` : ''}</strong>
                    </p>
                </div>
            )}

            {/* Action Section: Dispense Form + In Stock List */}
            {user.role !== 'readonly' && (
                <div style={{
                    display: 'flex',
                    gap: '1.5rem',
                    marginBottom: '1.5rem',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                }}>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <DispenseForm productOptions={productOptions} />
                        <ReceiveShipmentForm productOptions={productOptions} />
                    </div>
                    <InStockList inventory={inventory} />
                </div>
            )}

            {/* Patient Dispense History - Most Important! */}
            <DispenseHistory dispenses={dispenses} />

            {/* Inventory Table */}
            <div style={{ marginTop: '2rem' }}>
                <PeptideTable inventory={inventory} />
            </div>

            {/* Order History */}
            <OrderHistory orders={orders} />

            {/* Tirzepatide & Farmakaio Orders */}
            <SpecialtyOrderTabs tirzepatideOrders={tirzepatideOrders} farmakaioOrders={farmakaioOrders} />
        </section>
    );
}

function SummaryCard({
    label,
    value,
    highlight = false,
    color = 'default'
}: {
    label: string;
    value: number | string;
    highlight?: boolean;
    color?: 'default' | 'success' | 'warning' | 'info';
}) {
    const colors = {
        default: { bg: '#ffffff', border: 'rgba(148, 163, 184, 0.22)', labelColor: '#64748b', valueColor: '#0f172a' },
        success: { bg: '#ecfdf5', border: '#10b981', labelColor: '#047857', valueColor: '#047857' },
        warning: { bg: '#fffbeb', border: '#f59e0b', labelColor: '#92400e', valueColor: '#92400e' },
        info: { bg: '#eff6ff', border: '#3b82f6', labelColor: '#1d4ed8', valueColor: '#1d4ed8' },
    };

    const c = highlight ? colors[color] : colors.default;

    return (
        <article
            style={{
                padding: '1rem 1.25rem',
                borderRadius: '0.75rem',
                minWidth: '130px',
                background: c.bg,
                border: `1px solid ${c.border}`,
                boxShadow: highlight ? '0 4px 12px rgba(0,0,0,0.08)' : '0 2px 8px rgba(15, 23, 42, 0.04)',
            }}
        >
            <h3 style={{
                margin: '0 0 0.25rem',
                color: c.labelColor,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
            }}>
                {label}
            </h3>
            <p style={{
                margin: 0,
                fontSize: '1.5rem',
                fontWeight: 600,
                color: c.valueColor
            }}>
                {value}
            </p>
        </article>
    );
}
