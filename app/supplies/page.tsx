export const dynamic = 'force-dynamic';

import { fetchSupplyItems, fetchSupplyCategories, fetchSupplyAlerts, fetchSupplyLocations } from '@/lib/supplyQueries';
import { fetchActivePatientOptions } from '@/lib/patientQueries';
import { requireUser } from '@/lib/auth';
import SupplyTable from './SupplyTable';

export default async function SuppliesPage() {
    const user = await requireUser('read');

    const [locations, categories, patientOptions] = await Promise.all([
        fetchSupplyLocations(),
        fetchSupplyCategories(),
        fetchActivePatientOptions(),
    ]);

    // Default to first location
    const defaultLocation = locations.length > 0 ? locations[0].id : 'mens_health';

    const [items, alerts] = await Promise.all([
        fetchSupplyItems(defaultLocation),
        fetchSupplyAlerts(defaultLocation),
    ]);

    const totalItems = items.length;
    const belowPar = alerts.length;
    const outOfStock = items.filter(i => i.status === 'out').length;

    return (
        <section style={{ padding: '0 1rem' }}>
            <h2 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Supply PAR Levels</h2>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                Track clinic supplies by location, set PAR levels for reorder alerts, and log usage per patient visit.
            </p>

            {/* Alert Banner */}
            {belowPar > 0 && (
                <div style={{
                    background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                    border: '1px solid #fca5a5',
                    borderRadius: '0.75rem',
                    padding: '1rem 1.5rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                }}>
                    <span style={{ fontSize: '1.5rem' }}>⚠️</span>
                    <div>
                        <strong style={{ color: '#b91c1c' }}>
                            {belowPar} item{belowPar > 1 ? 's' : ''} below PAR level
                        </strong>
                        {outOfStock > 0 && (
                            <span style={{ color: '#dc2626', marginLeft: '0.5rem' }}>
                                ({outOfStock} out of stock)
                            </span>
                        )}
                    </div>
                </div>
            )}

            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
                <SummaryCard label="Locations" value={locations.length} />
                <SummaryCard label="Total Items" value={totalItems} />
                <SummaryCard label="Below PAR" value={belowPar} color={belowPar > 0 ? '#dc2626' : '#16a34a'} />
                <SummaryCard label="Out of Stock" value={outOfStock} color={outOfStock > 0 ? '#dc2626' : '#16a34a'} />
            </div>

            <SupplyTable
                initialItems={items}
                categories={categories}
                locations={locations}
                defaultLocation={defaultLocation}
                patients={patientOptions}
                userEmail={user.email}
            />
        </section>
    );
}

function SummaryCard({
    label,
    value,
    color,
}: {
    label: string;
    value: number | string;
    color?: string;
}) {
    return (
        <article
            style={{
                padding: '1.25rem 1.5rem',
                borderRadius: '0.75rem',
                minWidth: '180px',
                background: '#ffffff',
                border: '1px solid rgba(148, 163, 184, 0.22)',
                boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
            }}
        >
            <h3
                style={{
                    margin: '0 0 0.4rem',
                    color: '#64748b',
                    fontSize: '0.8rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                }}
            >
                {label}
            </h3>
            <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: color || '#0f172a' }}>
                {value}
            </p>
        </article>
    );
}
