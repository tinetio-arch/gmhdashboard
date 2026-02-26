'use client';

import { useState } from 'react';
import OrderLabModal from './OrderLabModal';

interface LabQueueItem {
    id: string;
    source?: 'access_labs_api' | 'email';
    accession?: string;
    patient_name: string;
    dob?: string;
    gender?: string;
    collection_date?: string;
    healthie_id?: string;
    match_confidence?: number;
    matched_name?: string;
    tests_found?: string[];
    status: 'pending_review' | 'approved' | 'rejected';
    created_at: string;
    uploaded_at?: string;
    healthie_document_id?: string;
    upload_status?: 'uploaded_hidden' | 'visible' | 'pending';
    severity?: number;
    critical_tests?: Array<{ name: string; value: string; units: string }>;
    pdf_path?: string;
    raw_result?: any;
    approved_by?: string;
    approved_at?: string;
}

interface OutboundOrder {
    id: string;
    healthie_lab_order_id?: string;
    patient: {
        healthie_id: string;
        first_name: string;
        last_name: string;
    };
    tests: string[];
    priority: 'ROUTINE' | 'STAT';
    status: 'pending' | 'submitted' | 'failed' | 'pending_approval';
    created_at: string;
    submitted_at?: string;
    error?: string;
    requisition_pdf_available?: boolean;
}

interface Props {
    reviewQueue: LabQueueItem[];
    ordersQueue: OutboundOrder[];
}

type TabType = 'review' | 'orders' | 'history';

export default function LabsDashboardClient({ reviewQueue: initialQueue, ordersQueue: initialOrders }: Props) {
    const [activeTab, setActiveTab] = useState<TabType>('review');
    const [statusFilter, setStatusFilter] = useState<string>('pending_review');
    const [reviewQueue, setReviewQueue] = useState<LabQueueItem[]>(initialQueue);
    const [ordersQueue, setOrdersQueue] = useState<OutboundOrder[]>(initialOrders); // Manage local state for orders
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [showOrderModal, setShowOrderModal] = useState(false);

    // Patient search modal state for low-confidence matches
    const [showPatientModal, setShowPatientModal] = useState(false);
    const [selectedLabItem, setSelectedLabItem] = useState<LabQueueItem | null>(null);
    const [patientSearch, setPatientSearch] = useState('');
    const [patientResults, setPatientResults] = useState<Array<{ id: string; first_name: string; last_name: string; dob?: string; email?: string; healthie_id?: string }>>([]);
    const [searchingPatients, setSearchingPatients] = useState(false);
    const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

    const pendingReview = reviewQueue.filter(i => i.status === 'pending_review');
    const approvedItems = reviewQueue.filter(i => i.status === 'approved');
    const rejectedItems = reviewQueue.filter(i => i.status === 'rejected');
    const criticalResults = reviewQueue.filter(i => i.status === 'pending_review' && i.critical_tests && i.critical_tests.length > 0);

    const tabs = [
        { id: 'review' as TabType, label: 'Review Queue', count: pendingReview.length, color: '#f59e0b' },
        { id: 'orders' as TabType, label: 'Order Labs', count: ordersQueue.filter(o => o.status === 'pending' || o.status === 'pending_approval').length, color: '#3b82f6' },
        { id: 'history' as TabType, label: 'History', count: approvedItems.length, color: '#10b981' },
    ];

    const formatDate = (dateStr: string) => {
        try {
            return new Date(dateStr).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
        } catch {
            return dateStr;
        }
    };

    // Search for patients in the modal
    const searchForPatients = async (query: string) => {
        if (!query || query.length < 2) return;
        setSearchingPatients(true);
        try {
            const response = await fetch(`/ops/api/patients/search?q=${encodeURIComponent(query)}`);
            const result = await response.json();
            if (result.patients) {
                setPatientResults(result.patients.slice(0, 10));
            }
        } catch (error) {
            console.error('Patient search error:', error);
        } finally {
            setSearchingPatients(false);
        }
    };

    // Handle approve with confidence check
    const handleApprove = async (item: LabQueueItem) => {
        const confidence = item.match_confidence || 0;
        const CONFIDENCE_THRESHOLD = 0.8; // 80%

        // If high confidence match AND already uploaded (hidden), approve directly
        if (confidence >= CONFIDENCE_THRESHOLD && item.healthie_id && item.healthie_document_id) {
            // Direct approval - document already uploaded to correct patient
            await doApproval(item, item.healthie_id);
            return;
        }

        // Low confidence OR no match OR not yet uploaded - show patient selection modal
        setSelectedLabItem(item);
        // Pre-fill search with patient name from lab
        const searchName = item.patient_name.includes(',')
            ? item.patient_name.split(',').reverse().join(' ').trim()
            : item.patient_name;
        setPatientSearch(searchName);
        setPatientResults([]);
        setSelectedPatientId(item.healthie_id || null);
        setShowPatientModal(true);

        // Auto-search
        await searchForPatients(searchName);
    };

    // Perform the actual approval after patient is confirmed
    const doApproval = async (item: LabQueueItem, patientId: string) => {
        setLoadingId(item.id);
        setMessage(null);

        try {
            const response = await fetch('/ops/api/labs/review-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: item.id,
                    action: 'approve',
                    corrected_patient_id: patientId
                })
            });

            const result = await response.json();

            if (result.success) {
                setMessage({ type: 'success', text: `✅ Lab approved and visible to patient` });
                // Update local state
                setReviewQueue(prev => prev.map(i =>
                    i.id === item.id
                        ? { ...i, status: 'approved' as const, upload_status: 'visible' as const }
                        : i
                ));
            } else {
                setMessage({ type: 'error', text: result.error || 'Approval failed' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Network error - please try again' });
        } finally {
            setLoadingId(null);
        }
    };

    // Handle modal approval (after patient selection)
    const handleModalApprove = async () => {
        if (!selectedLabItem || !selectedPatientId) {
            setMessage({ type: 'error', text: 'Please select a patient before approving' });
            return;
        }

        // Find selected patient info for confirmation message
        const selectedPatient = patientResults.find(p => (p.healthie_id || p.id) === selectedPatientId);
        const patientName = selectedPatient
            ? `${selectedPatient.first_name} ${selectedPatient.last_name}`
            : selectedPatientId;
        const patientDob = selectedPatient?.dob || '';

        setShowPatientModal(false);
        setLoadingId(selectedLabItem.id);
        setMessage(null);

        try {
            const response = await fetch('/ops/api/labs/review-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: selectedLabItem.id,
                    action: 'approve',
                    corrected_patient_id: selectedPatientId
                })
            });

            const result = await response.json();

            if (result.success) {
                // Show detailed confirmation with patient info
                const dobMatch = selectedLabItem.dob && patientDob &&
                    selectedLabItem.dob.replace(/[/-]/g, '') === patientDob.replace(/[/-]/g, '');
                const confirmMsg = dobMatch
                    ? `✅ Lab approved for ${patientName} (DOB: ${patientDob} ✓ matches)`
                    : `✅ Lab approved for ${patientName}${patientDob ? ` (DOB: ${patientDob})` : ''} - ID: ${selectedPatientId}`;
                setMessage({ type: 'success', text: confirmMsg });

                // Update local state
                setReviewQueue(prev => prev.map(i =>
                    i.id === selectedLabItem.id
                        ? { ...i, status: 'approved' as const, upload_status: 'visible' as const }
                        : i
                ));
            } else {
                setMessage({ type: 'error', text: result.error || 'Approval failed' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Network error - please try again' });
        } finally {
            setLoadingId(null);
            setSelectedLabItem(null);
            setSelectedPatientId(null);
        }
    };

    const handleReject = async (item: LabQueueItem) => {
        // ... (existing logic kept same)
        const reason = prompt('Enter rejection reason:');
        if (!reason) return;

        setLoadingId(item.id);
        setMessage(null);

        try {
            const response = await fetch('/ops/api/labs/review-queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: item.id,
                    action: 'reject',
                    rejection_reason: reason
                })
            });

            const result = await response.json();

            if (result.success) {
                setMessage({ type: 'success', text: 'Lab result rejected' });
                setReviewQueue(prev => prev.map(i =>
                    i.id === item.id
                        ? { ...i, status: 'rejected' as const }
                        : i
                ));
            } else {
                setMessage({ type: 'error', text: result.error || 'Rejection failed' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Network error - please try again' });
        } finally {
            setLoadingId(null);
        }
    };

    const handleAdminApproveOrder = async (order: OutboundOrder) => {
        if (!confirm(`Are you sure you want to approve this restricted order for ${order.patient.first_name}?`)) return;

        setLoadingId(order.id);
        try {
            const response = await fetch(`/ops/api/labs/order/${order.id}/approve`, {
                method: 'POST'
            });
            const result = await response.json();

            if (result.success) {
                setMessage({ type: 'success', text: '✅ Order approved and submitted successfully' });
                // Update local state
                setOrdersQueue(prev => prev.map(o =>
                    o.id === order.id ? { ...o, status: 'submitted' } : o
                ));
            } else {
                setMessage({ type: 'error', text: result.error || 'Approval failed' });
                setOrdersQueue(prev => prev.map(o =>
                    o.id === order.id ? { ...o, status: 'failed', error: result.error } : o
                ));
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Network error approving order' });
        } finally {
            setLoadingId(null);
        }
    };

    const handleDeleteOrder = async (order: OutboundOrder) => {
        const confirmMsg = order.status === 'submitted'
            ? `Delete order for ${order.patient.first_name}?\n\n⚠️ This order was already sent to Access Labs. Contact them directly to cancel.`
            : `Delete order for ${order.patient.first_name}?`;

        if (!confirm(confirmMsg)) return;

        setLoadingId(order.id);
        try {
            const response = await fetch(`/ops/api/labs/orders/${order.id}`, {
                method: 'DELETE'
            });
            const result = await response.json();

            if (result.success) {
                setMessage({ type: 'success', text: '✅ Order deleted' });
                setOrdersQueue(prev => prev.filter(o => o.id !== order.id));
            } else {
                setMessage({ type: 'error', text: result.error || 'Delete failed' });
            }
        } catch (e) {
            setMessage({ type: 'error', text: 'Network error deleting order' });
        } finally {
            setLoadingId(null);
        }
    };

    const getSeverityBadge = (severity?: number) => {
        if (!severity || severity <= 2) return null;
        const colors = {
            5: { bg: '#fee2e2', text: '#dc2626', label: '🚨 CRITICAL' },
            4: { bg: '#fef3c7', text: '#92400e', label: '⚠️ URGENT' },
            3: { bg: '#e0f2fe', text: '#0369a1', label: '📊 Significant' }
        };
        const config = colors[severity as 3 | 4 | 5];
        if (!config) return null;
        return (
            <span style={{
                background: config.bg,
                color: config.text,
                padding: '0.15rem 0.5rem',
                borderRadius: '0.25rem',
                fontSize: '0.7rem',
                fontWeight: 600,
                marginLeft: '0.5rem'
            }}>
                {config.label}
            </span>
        );
    };



    // Calculate counts for stats bar
    const pendingOrdersCount = ordersQueue.filter(o => o.status === 'pending').length;
    const submittedOrdersCount = ordersQueue.filter(o => o.status === 'submitted').length;
    const approvedTodayCount = approvedItems.filter(i =>
        i.uploaded_at &&
        new Date(i.uploaded_at).toDateString() === new Date().toDateString()
    ).length;

    return (
        <div>
            {/* Modal */}
            {showOrderModal && (
                <OrderLabModal
                    onClose={() => setShowOrderModal(false)}
                    onSuccess={(newOrder) => {
                        setMessage({ type: 'success', text: `✅ Order created! Status: ${newOrder.status}` });
                        // Optimistically add to list (reloading page would get real data)
                        // Or fetch updated list here
                        window.location.reload(); // Simple refresh to show new order
                    }}
                />
            )}

            {/* Patient Search Modal for Low Confidence Matches */}
            {showPatientModal && selectedLabItem && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: '0.75rem',
                        padding: '1.5rem',
                        width: '90%',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflow: 'auto',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
                    }}>
                        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: 600, color: '#0f172a' }}>
                            🔍 Select Patient for Lab Results
                        </h3>

                        {/* Lab Info */}
                        <div style={{
                            background: '#fef3c7',
                            border: '1px solid #f59e0b',
                            borderRadius: '0.5rem',
                            padding: '0.75rem',
                            marginBottom: '1rem'
                        }}>
                            <div style={{ fontWeight: 600, color: '#92400e' }}>Lab Patient: {selectedLabItem.patient_name}</div>
                            {selectedLabItem.dob && <div style={{ fontSize: '0.9rem', color: '#78350f' }}>Lab DOB: {selectedLabItem.dob}</div>}
                            {(selectedLabItem.match_confidence || 0) < 0.8 && (
                                <div style={{ fontSize: '0.85rem', color: '#dc2626', marginTop: '0.25rem' }}>
                                    ⚠️ Low confidence match ({Math.round((selectedLabItem.match_confidence || 0) * 100)}%) - please verify correct patient
                                </div>
                            )}
                        </div>

                        {/* Search Input */}
                        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                            <input
                                type="text"
                                value={patientSearch}
                                onChange={(e) => setPatientSearch(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && searchForPatients(patientSearch)}
                                placeholder="Search patient name..."
                                style={{
                                    flex: 1,
                                    padding: '0.5rem 0.75rem',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '0.375rem',
                                    fontSize: '0.95rem'
                                }}
                            />
                            <button
                                onClick={() => searchForPatients(patientSearch)}
                                disabled={searchingPatients}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: '#3b82f6',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                {searchingPatients ? '...' : 'Search'}
                            </button>
                        </div>

                        {/* Results */}
                        <div style={{ marginBottom: '1rem', maxHeight: '300px', overflow: 'auto' }}>
                            {patientResults.length === 0 && !searchingPatients && (
                                <div style={{ color: '#64748b', textAlign: 'center', padding: '1rem' }}>
                                    No results. Try searching for the patient name.
                                </div>
                            )}
                            {patientResults.map((patient) => {
                                const patientId = patient.healthie_id || patient.id;
                                const isSelected = selectedPatientId === patientId;
                                // Check if DOB matches (case-insensitive, various formats)
                                const labDob = selectedLabItem.dob?.replace(/[/-]/g, '') || '';
                                const patientDob = patient.dob?.replace(/[/-]/g, '') || '';
                                const dobMatches = labDob && patientDob && labDob === patientDob;

                                return (
                                    <div
                                        key={patientId}
                                        onClick={() => setSelectedPatientId(patientId)}
                                        style={{
                                            padding: '0.75rem',
                                            border: isSelected ? '2px solid #10b981' : '1px solid #e2e8f0',
                                            borderRadius: '0.5rem',
                                            marginBottom: '0.5rem',
                                            cursor: 'pointer',
                                            background: isSelected ? '#ecfdf5' : '#fff',
                                            transition: 'all 0.1s'
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                            <div>
                                                <div style={{ fontWeight: 600, color: '#0f172a' }}>
                                                    {patient.first_name} {patient.last_name}
                                                    {isSelected && <span style={{ color: '#10b981', marginLeft: '0.5rem' }}>✓ Selected</span>}
                                                </div>
                                                <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                                    {patient.dob && (
                                                        <span style={{
                                                            background: dobMatches ? '#dcfce7' : '#f1f5f9',
                                                            color: dobMatches ? '#166534' : '#64748b',
                                                            padding: '0.1rem 0.4rem',
                                                            borderRadius: '0.25rem',
                                                            marginRight: '0.5rem'
                                                        }}>
                                                            DOB: {patient.dob} {dobMatches && '✓'}
                                                        </span>
                                                    )}
                                                    {patient.email && <span>{patient.email}</span>}
                                                </div>
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                                                ID: {patientId}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => {
                                    setShowPatientModal(false);
                                    setSelectedLabItem(null);
                                    setSelectedPatientId(null);
                                }}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: '#f1f5f9',
                                    color: '#64748b',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleModalApprove}
                                disabled={!selectedPatientId || loadingId === selectedLabItem.id}
                                style={{
                                    padding: '0.5rem 1rem',
                                    background: selectedPatientId ? '#10b981' : '#94a3b8',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    cursor: selectedPatientId ? 'pointer' : 'not-allowed',
                                    fontWeight: 600
                                }}
                            >
                                {loadingId === selectedLabItem.id ? 'Approving...' : '✓ Approve for Selected Patient'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <div style={{
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                marginBottom: '2rem'
            }}>
                <div
                    onClick={() => { setActiveTab('review'); setStatusFilter('pending_review'); }}
                    style={{
                        padding: '1rem',
                        borderRadius: '0.75rem',
                        background: 'linear-gradient(135deg, #fef3c7 0%, #fffbeb 100%)',
                        border: '1px solid #f59e0b',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#ea580c', marginBottom: '0.25rem' }}>
                        {pendingReview.length}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#92400e' }}>Pending Review</div>
                </div>

                <div
                    onClick={() => { setActiveTab('history'); }}
                    style={{
                        padding: '1rem',
                        borderRadius: '0.75rem',
                        background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                        border: '1px solid #10b981',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#059669', marginBottom: '0.25rem' }}>
                        {approvedTodayCount}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#065f46' }}>Approved Today</div>
                </div>

                <div
                    onClick={() => { setActiveTab('orders'); }}
                    style={{
                        padding: '1rem',
                        borderRadius: '0.75rem',
                        background: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%)',
                        border: '1px solid #0ea5e9',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#0369a1', marginBottom: '0.25rem' }}>
                        {pendingOrdersCount}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#075985' }}>Pending Orders</div>
                </div>

                <div
                    onClick={() => { setActiveTab('orders'); }}
                    style={{
                        padding: '1rem',
                        borderRadius: '0.75rem',
                        background: 'linear-gradient(135deg, #f3e8ff 0%, #faf5ff 100%)',
                        border: '1px solid #a855f7',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'transform 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: '#7e22ce', marginBottom: '0.25rem' }}>
                        {submittedOrdersCount}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#581c87' }}>Submitted to Lab</div>
                </div>

                {criticalResults.length > 0 && (
                    <div
                        onClick={() => { setActiveTab('review'); setStatusFilter('pending_review'); }}
                        style={{
                            padding: '1rem',
                            borderRadius: '0.75rem',
                            background: 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)',
                            border: '2px solid #ef4444',
                            textAlign: 'center',
                            animation: 'pulse 2s infinite',
                            cursor: 'pointer',
                        }}
                    >
                        <div style={{ fontSize: '2rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                            🚨 {criticalResults.length}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#991b1b' }}>Critical Alerts</div>
                    </div>
                )}
            </div>

            {/* Tab Navigation */}
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1.5rem',
                borderBottom: '2px solid #e2e8f0',
                paddingBottom: '0'
            }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '0.75rem 1.5rem',
                            border: 'none',
                            background: activeTab === tab.id ? '#fff' : 'transparent',
                            borderBottom: activeTab === tab.id ? `3px solid ${tab.color}` : '3px solid transparent',
                            cursor: 'pointer',
                            fontSize: '0.95rem',
                            fontWeight: activeTab === tab.id ? 600 : 400,
                            color: activeTab === tab.id ? '#0f172a' : '#64748b',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            marginBottom: '-2px'
                        }}
                    >
                        {tab.label}
                        {tab.count > 0 && (
                            <span style={{
                                background: tab.color,
                                color: '#fff',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '9999px',
                                fontSize: '0.75rem',
                                fontWeight: 600
                            }}>
                                {tab.count}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {/* Message display */}
            {message && (
                <div style={{
                    padding: '0.75rem 1rem',
                    marginBottom: '1rem',
                    borderRadius: '0.5rem',
                    background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: message.type === 'success' ? '#166534' : '#991b1b',
                    fontSize: '0.9rem'
                }}>
                    {message.text}
                </div>
            )}

            {/* Review Queue Tab */}
            {activeTab === 'review' && (
                <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0f172a' }}>
                            Pending Lab Results for Review
                        </h2>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '0.5rem',
                                border: '1px solid #e2e8f0',
                                fontSize: '0.9rem'
                            }}
                        >
                            <option value="pending_review">Pending Review ({pendingReview.length})</option>
                            <option value="approved">Approved ({approvedItems.length})</option>
                            <option value="rejected">Rejected ({rejectedItems.length})</option>
                            <option value="all">All ({reviewQueue.length})</option>
                        </select>
                    </div>

                    {pendingReview.length === 0 && statusFilter === 'pending_review' ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                            <div style={{ fontSize: '1.1rem' }}>No pending lab results to review</div>
                            <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>New results will appear here automatically</div>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Patient</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Accession</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>View Lab</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Match</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(statusFilter === 'all' ? reviewQueue : reviewQueue.filter(i => i.status === statusFilter))
                                    .slice(0, 50)
                                    .map((item, idx) => (
                                        <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ fontWeight: 500, color: '#0f172a' }}>
                                                    {item.patient_name}
                                                    {getSeverityBadge(item.severity)}
                                                </div>
                                                {item.dob && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>DOB: {item.dob}</div>}
                                                {item.upload_status === 'uploaded_hidden' && (
                                                    <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: '0.25rem' }}>
                                                        🙈 Hidden from patient
                                                    </div>
                                                )}
                                            </td>
                                            {/* ... (rest of columns same) */}
                                            <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
                                                {item.accession || 'N/A'}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <a
                                                    href={`/ops/api/labs/pdf/${item.id}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#0ea5e9', textDecoration: 'none', fontSize: '0.85rem', fontWeight: 500 }}
                                                >
                                                    📄 View Results
                                                    {(item.tests_found?.length || 0) > 0 && <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '0.1rem 0.4rem', borderRadius: '0.25rem', fontSize: '0.7rem', marginLeft: '0.25rem' }}>{item.tests_found?.length} tests</span>}
                                                </a>
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {item.match_confidence ? (
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.8rem', background: item.match_confidence >= 0.8 ? '#dcfce7' : item.match_confidence >= 0.5 ? '#fef3c7' : '#fee2e2', color: item.match_confidence >= 0.8 ? '#166534' : item.match_confidence >= 0.5 ? '#92400e' : '#991b1b' }}>{Math.round(item.match_confidence * 100)}%</div>
                                                ) : (
                                                    <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {item.status === 'pending_review' ? (
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <button onClick={() => handleApprove(item)} disabled={loadingId === item.id} style={{ padding: '0.4rem 0.75rem', borderRadius: '0.375rem', border: 'none', background: '#10b981', color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: loadingId === item.id ? 'wait' : 'pointer', opacity: loadingId === item.id ? 0.6 : 1 }}>
                                                            {loadingId === item.id ? '...' : '✓ Approve'}
                                                        </button>
                                                        <button onClick={() => handleReject(item)} disabled={loadingId === item.id} style={{ padding: '0.4rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '0.8rem', fontWeight: 500, cursor: loadingId === item.id ? 'wait' : 'pointer' }}>Reject</button>
                                                    </div>
                                                ) : (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 500, background: item.status === 'approved' ? '#dcfce7' : '#fee2e2', color: item.status === 'approved' ? '#166534' : '#991b1b' }}>
                                                        {item.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* Order Labs Tab */}
            {activeTab === 'orders' && (
                <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0f172a' }}>
                            Outbound Lab Orders
                        </h2>
                        <button
                            onClick={() => setShowOrderModal(true)}
                            style={{
                                padding: '0.5rem 1rem',
                                background: '#3b82f6',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '0.375rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontSize: '0.9rem'
                            }}>
                            + Order Lab
                        </button>
                    </div>

                    {ordersQueue.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
                            <div style={{ fontSize: '1.1rem' }}>No lab orders in queue</div>
                            <div style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                                Click "+ Order Lab" to initiate a new order
                            </div>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Order ID</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Patient</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Tests</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Priority</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Created</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Requisition</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Status</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ordersQueue.slice(0, 50).map((order, idx) => (
                                    <tr key={order.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                        <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
                                            {String(order.id)}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontWeight: 500, color: '#0f172a' }}>
                                                {order.patient.first_name} {order.patient.last_name}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                                {order.tests.slice(0, 4).map((test, i) => (
                                                    <span key={i} style={{ background: '#f3e8ff', color: '#7e22ce', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
                                                        {test}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <span style={{ padding: '0.2rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem', fontWeight: 600, background: order.priority === 'STAT' ? '#fee2e2' : '#f1f5f9', color: order.priority === 'STAT' ? '#dc2626' : '#64748b' }}>
                                                {order.priority}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#64748b' }}>
                                            {formatDate(order.created_at)}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {order.status === 'submitted' ? (
                                                <a
                                                    href={`/ops/api/labs/orders/${order.id}/requisition`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.25rem',
                                                        padding: '0.3rem 0.6rem',
                                                        background: '#dbeafe',
                                                        color: '#1d4ed8',
                                                        borderRadius: '0.375rem',
                                                        textDecoration: 'none',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 500
                                                    }}
                                                >
                                                    📄 Print
                                                </a>
                                            ) : (
                                                <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <span style={{
                                                padding: '0.25rem 0.75rem',
                                                borderRadius: '9999px',
                                                fontSize: '0.8rem',
                                                fontWeight: 500,
                                                background: order.status === 'submitted' ? '#dcfce7' :
                                                    order.status === 'failed' ? '#fee2e2' :
                                                        order.status === 'pending_approval' ? '#ffedd5' : '#fef3c7',
                                                color: order.status === 'submitted' ? '#166534' :
                                                    order.status === 'failed' ? '#991b1b' :
                                                        order.status === 'pending_approval' ? '#c2410c' : '#92400e'
                                            }}>
                                                {order.status === 'pending_approval' ? '⏳ Pending Approval' : order.status}
                                            </span>
                                            {order.status === 'pending_approval' && (
                                                <button onClick={() => handleAdminApproveOrder(order)} style={{ marginLeft: '0.5rem', border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.8rem', color: '#3b82f6', textDecoration: 'underline' }}>
                                                    Approve
                                                </button>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <button
                                                onClick={() => handleDeleteOrder(order)}
                                                disabled={loadingId === order.id}
                                                style={{
                                                    padding: '0.3rem 0.6rem',
                                                    background: '#fee2e2',
                                                    color: '#dc2626',
                                                    border: 'none',
                                                    borderRadius: '0.375rem',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 500,
                                                    cursor: loadingId === order.id ? 'wait' : 'pointer',
                                                    opacity: loadingId === order.id ? 0.6 : 1
                                                }}
                                            >
                                                🗑️ Delete
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}

            {/* History Tab */}
            {activeTab === 'history' && (
                <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    {/* ... (existing history logic) */}
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#0f172a', marginBottom: '1rem' }}>
                        Approved Lab Results History
                    </h2>
                    {approvedItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
                            <div style={{ fontSize: '1.1rem' }}>No approved results yet</div>
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            {/* ... same table as before */}
                            {/* I will copy/paste the loop to ensure it works */}
                            <thead>
                                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Patient</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Accession</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Tests</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Uploaded</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}>Healthie Doc</th>
                                </tr>
                            </thead>
                            <tbody>
                                {approvedItems.slice(0, 50).map((item, idx) => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontWeight: 500, color: '#0f172a' }}>{item.patient_name}</div>
                                        </td>
                                        <td style={{ padding: '0.75rem', fontFamily: 'monospace', fontSize: '0.85rem', color: '#64748b' }}>
                                            {item.accession || 'N/A'}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                                                {(item.tests_found || []).slice(0, 3).map((test, i) => (
                                                    <span key={i} style={{ background: '#dcfce7', color: '#166534', padding: '0.15rem 0.5rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
                                                        {test}
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td style={{ padding: '0.75rem', fontSize: '0.9rem', color: '#64748b' }}>
                                            {item.approved_at || item.uploaded_at ? (
                                                <div>
                                                    <div>{formatDate(item.approved_at || item.uploaded_at || '')}</div>
                                                    {item.approved_by && (
                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.15rem' }}>
                                                            by {item.approved_by}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {item.healthie_document_id ? (
                                                <a href={`https://securemyhealth.gethealthie.com/documents/${item.healthie_document_id}`} target="_blank" rel="noopener noreferrer" style={{ color: '#0ea5e9', textDecoration: 'none', fontSize: '0.85rem' }}>
                                                    View in Healthie →
                                                </a>
                                            ) : <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

