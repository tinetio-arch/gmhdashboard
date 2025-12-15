'use client';

import { useState, useEffect } from 'react';

type MigrationPreview = {
  patientId: string;
  patientName: string;
  email?: string;
  phone?: string;
  qbCustomerId?: string;
  qbCustomerName?: string;
  recurringTransactions: Array<{
    id: string;
    name: string;
    amount: number;
    frequency: string;
    nextChargeDate?: string;
  }>;
  existingHealthieClient?: {
    id: string;
    email?: string;
    phone?: string;
  };
  conflicts: string[];
};

type MigrationStatus = {
  statistics: {
    total_patients: number;
    migrated_patients: number;
    total_subscriptions: number;
    active_subscriptions: number;
    total_packages: number;
    recent_migrations: number;
  };
  recentErrors: number;
};

export default function HealthieMigrationClient() {
  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    loading: boolean;
    error?: string;
  }>({ connected: false, loading: true });

  const [previews, setPreviews] = useState<MigrationPreview[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const [selectedPatients, setSelectedPatients] = useState<Set<string>>(new Set());
  const [migrating, setMigrating] = useState(false);
  const [migrationResults, setMigrationResults] = useState<any>(null);
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<any>(null);
  const [sendingInvoices, setSendingInvoices] = useState(false);
  const [invoiceResults, setInvoiceResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'migration' | 'invoices' | 'payment-status'>('migration');

  // Test connection on mount
  useEffect(() => {
    testConnection();
    loadStatus();
    if (activeTab === 'payment-status') {
      loadPaymentStatus();
    }
  }, [activeTab]);

  const testConnection = async () => {
    setConnectionStatus({ connected: false, loading: true });
    try {
      const response = await fetch('/api/admin/healthie/test-connection');
      const data = await response.json();
      setConnectionStatus({
        connected: data.connected,
        loading: false,
        error: data.error,
      });
    } catch (error) {
      setConnectionStatus({
        connected: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Connection test failed',
      });
    }
  };

  const loadStatus = async () => {
    try {
      const response = await fetch('/api/admin/healthie/status');
      const data = await response.json();
      if (data.success) {
        setStatus(data);
      }
    } catch (error) {
      console.error('Failed to load status:', error);
    }
  };

  const loadPreviews = async () => {
    setLoadingPreviews(true);
    try {
      const response = await fetch('/api/admin/healthie/preview');
      const data = await response.json();
      if (data.success) {
        setPreviews(data.previews || []);
      } else {
        alert(`Failed to load previews: ${data.error}`);
      }
    } catch (error) {
      alert(`Error loading previews: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingPreviews(false);
    }
  };

  const handleSelectPatient = (patientId: string) => {
    const newSelected = new Set(selectedPatients);
    if (newSelected.has(patientId)) {
      newSelected.delete(patientId);
    } else {
      newSelected.add(patientId);
    }
    setSelectedPatients(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedPatients.size === previews.length) {
      setSelectedPatients(new Set());
    } else {
      setSelectedPatients(new Set(previews.map(p => p.patientId)));
    }
  };

  const loadPaymentStatus = async () => {
    try {
      const response = await fetch('/api/admin/healthie/invoices/payment-status');
      const data = await response.json();
      if (data.success) {
        setPaymentStatus(data);
      }
    } catch (error) {
      console.error('Failed to load payment status:', error);
    }
  };

  const sendInvoices = async (usePackageAmount: boolean = true) => {
    if (!confirm('Send invoices to all migrated patients? This will prompt them to add payment methods when they pay.')) {
      return;
    }

    setSendingInvoices(true);
    setInvoiceResults(null);

    try {
      const response = await fetch('/api/admin/healthie/invoices/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          createForAll: true,
          options: {
            usePackageAmount,
            sendEmail: true,
          },
        }),
      });

      const data = await response.json();
      setInvoiceResults(data);

      if (data.success) {
        alert(`Invoices sent! ${data.successful} invoice(s) created successfully.`);
        loadStatus();
        loadPaymentStatus();
      } else {
        alert(`Invoices sent with some errors. ${data.successful} successful, ${data.failed} failed.`);
      }
    } catch (error) {
      alert(`Failed to send invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setSendingInvoices(false);
    }
  };

  const executeMigration = async () => {
    if (selectedPatients.size === 0) {
      alert('Please select at least one patient to migrate');
      return;
    }

    if (!confirm(`Migrate ${selectedPatients.size} patient(s) to Healthie?`)) {
      return;
    }

    setMigrating(true);
    setMigrationResults(null);

    try {
      const response = await fetch('/api/admin/healthie/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientIds: Array.from(selectedPatients),
          options: {
            skipExisting: false,
            createPackages: true,
          },
        }),
      });

      const data = await response.json();
      setMigrationResults(data);

      if (data.success) {
        alert(`Migration completed! ${data.successful || 1} patient(s) migrated successfully.`);
        // Reload previews and status
        loadPreviews();
        loadStatus();
        setSelectedPatients(new Set());
      } else {
        alert(`Migration completed with errors. Check the results below.`);
      }
    } catch (error) {
      alert(`Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Healthie Migration</h1>
      <p style={{ color: '#666', marginBottom: '2rem' }}>
        Migrate QuickBooks patients to Healthie EMR and set up recurring payments
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem', borderBottom: '2px solid #dee2e6' }}>
        <button
          onClick={() => setActiveTab('migration')}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: activeTab === 'migration' ? '#007bff' : 'transparent',
            color: activeTab === 'migration' ? 'white' : '#007bff',
            border: 'none',
            borderBottom: activeTab === 'migration' ? '3px solid #007bff' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'migration' ? 'bold' : 'normal',
          }}
        >
          Migration
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: activeTab === 'invoices' ? '#007bff' : 'transparent',
            color: activeTab === 'invoices' ? 'white' : '#007bff',
            border: 'none',
            borderBottom: activeTab === 'invoices' ? '3px solid #007bff' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'invoices' ? 'bold' : 'normal',
          }}
        >
          Send Invoices
        </button>
        <button
          onClick={() => {
            setActiveTab('payment-status');
            loadPaymentStatus();
          }}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: activeTab === 'payment-status' ? '#007bff' : 'transparent',
            color: activeTab === 'payment-status' ? 'white' : '#007bff',
            border: 'none',
            borderBottom: activeTab === 'payment-status' ? '3px solid #007bff' : '3px solid transparent',
            cursor: 'pointer',
            fontWeight: activeTab === 'payment-status' ? 'bold' : 'normal',
          }}
        >
          Payment Status
        </button>
      </div>

      {/* Connection Status */}
      <div
        style={{
          padding: '1rem',
          marginBottom: '2rem',
          borderRadius: '8px',
          backgroundColor: connectionStatus.connected ? '#d4edda' : '#f8d7da',
          border: `1px solid ${connectionStatus.connected ? '#c3e6cb' : '#f5c6cb'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontWeight: 'bold' }}>Healthie API Connection:</span>
          {connectionStatus.loading ? (
            <span>Testing...</span>
          ) : connectionStatus.connected ? (
            <span style={{ color: '#155724' }}>✓ Connected</span>
          ) : (
            <span style={{ color: '#721c24' }}>✗ Not Connected</span>
          )}
          <button
            onClick={testConnection}
            style={{
              marginLeft: 'auto',
              padding: '0.5rem 1rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Test Connection
          </button>
        </div>
        {connectionStatus.error && (
          <div style={{ marginTop: '0.5rem', color: '#721c24' }}>
            {connectionStatus.error}
          </div>
        )}
      </div>

      {/* Migration Status */}
      {status && (
        <div
          style={{
            padding: '1rem',
            marginBottom: '2rem',
            borderRadius: '8px',
            backgroundColor: '#f8f9fa',
            border: '1px solid #dee2e6',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Migration Status</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>Total Patients</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                {status.statistics.total_patients}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>Migrated</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
                {status.statistics.migrated_patients}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>Active Subscriptions</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#007bff' }}>
                {status.statistics.active_subscriptions}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>Packages Created</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                {status.statistics.total_packages}
              </div>
            </div>
            {status.recentErrors > 0 && (
              <div>
                <div style={{ fontSize: '0.875rem', color: '#666' }}>Recent Errors (24h)</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#dc3545' }}>
                  {status.recentErrors}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Migration Tab Content */}
      {activeTab === 'migration' && (
        <>
      {/* Actions */}
      <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem' }}>
        <button
          onClick={loadPreviews}
          disabled={loadingPreviews || !connectionStatus.connected}
          style={{
            padding: '0.75rem 1.5rem',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loadingPreviews ? 'not-allowed' : 'pointer',
            opacity: loadingPreviews || !connectionStatus.connected ? 0.6 : 1,
          }}
        >
          {loadingPreviews ? 'Loading...' : 'Load Migration Preview'}
        </button>
        {previews.length > 0 && (
          <button
            onClick={executeMigration}
            disabled={migrating || selectedPatients.size === 0}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: migrating || selectedPatients.size === 0 ? 'not-allowed' : 'pointer',
              opacity: migrating || selectedPatients.size === 0 ? 0.6 : 1,
            }}
          >
            {migrating
              ? 'Migrating...'
              : `Migrate ${selectedPatients.size} Selected Patient(s)`}
          </button>
        )}
      </div>

      {/* Invoice Tab */}
      {activeTab === 'invoices' && (
        <div>
          <div style={{ padding: '1rem', marginBottom: '2rem', backgroundColor: '#e7f3ff', borderRadius: '8px' }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Send Invoices to Collect Payment Methods</h2>
            <p style={{ color: '#666', marginBottom: '1rem' }}>
              When patients pay invoices in Healthie, their payment methods are automatically saved for future recurring charges.
              This is the secure way to collect payment information without transferring credit card data.
            </p>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button
                onClick={() => sendInvoices(true)}
                disabled={sendingInvoices || !connectionStatus.connected}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: sendingInvoices || !connectionStatus.connected ? 'not-allowed' : 'pointer',
                  opacity: sendingInvoices || !connectionStatus.connected ? 0.6 : 1,
                }}
              >
                {sendingInvoices ? 'Sending...' : 'Send Invoices (Use Package Amounts)'}
              </button>
            </div>
          </div>

          {invoiceResults && (
            <div
              style={{
                padding: '1rem',
                marginTop: '2rem',
                borderRadius: '8px',
                backgroundColor: invoiceResults.success ? '#d4edda' : '#f8d7da',
                border: `1px solid ${invoiceResults.success ? '#c3e6cb' : '#f5c6cb'}`,
              }}
            >
              <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Invoice Results</h2>
              <div style={{ marginBottom: '1rem' }}>
                <strong>Total:</strong> {invoiceResults.totalProcessed || 0} |{' '}
                <strong style={{ color: '#28a745' }}>Success:</strong> {invoiceResults.successful || 0} |{' '}
                <strong style={{ color: '#dc3545' }}>Failed:</strong> {invoiceResults.failed || 0}
              </div>
              {invoiceResults.errors && invoiceResults.errors.length > 0 && (
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  <strong>Errors:</strong>
                  <ul style={{ marginTop: '0.5rem' }}>
                    {invoiceResults.errors.map((error: string, idx: number) => (
                      <li key={idx} style={{ color: '#721c24', marginBottom: '0.25rem' }}>
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Payment Status Tab */}
      {activeTab === 'payment-status' && (
        <div>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Payment Method Status</h2>
          {paymentStatus ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <div style={{ padding: '1rem', backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>Total Patients</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{paymentStatus.summary.total}</div>
                </div>
                <div style={{ padding: '1rem', backgroundColor: '#d4edda', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>With Payment Method</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
                    {paymentStatus.summary.withPaymentMethod}
                  </div>
                </div>
                <div style={{ padding: '1rem', backgroundColor: '#fff3cd', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>Need Payment Method</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#ffc107' }}>
                    {paymentStatus.summary.withoutPaymentMethod}
                  </div>
                </div>
                <div style={{ padding: '1rem', backgroundColor: '#d1ecf1', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>Invoices Sent</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#17a2b8' }}>
                    {paymentStatus.summary.withInvoices}
                  </div>
                </div>
                <div style={{ padding: '1rem', backgroundColor: '#d4edda', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.875rem', color: '#666' }}>Paid Invoices</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#28a745' }}>
                    {paymentStatus.summary.withPaidInvoices}
                  </div>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8f9fa' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Patient</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Payment Method</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Invoices</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentStatus.details.map((detail: any, idx: number) => (
                      <tr key={idx}>
                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>{detail.patientName}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                          {detail.hasPaymentMethod ? (
                            <span style={{ color: '#28a745' }}>✓ Saved</span>
                          ) : (
                            <span style={{ color: '#dc3545' }}>✗ Not Set</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>{detail.invoiceCount}</td>
                        <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>{detail.paidInvoiceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div>Loading payment status...</div>
          )}
        </div>
      )}

      {/* Migration Preview Table */}
      {activeTab === 'migration' && previews.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>
              Migration Preview ({previews.length} patients)
            </h2>
            <button
              onClick={handleSelectAll}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              {selectedPatients.size === previews.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: 'white' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa' }}>
                  <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>
                    <input
                      type="checkbox"
                      checked={selectedPatients.size === previews.length && previews.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Patient</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Contact</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Recurring Payments</th>
                  <th style={{ padding: '0.75rem', textAlign: 'left', border: '1px solid #dee2e6' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {previews.map((preview) => (
                  <tr
                    key={preview.patientId}
                    style={{
                      backgroundColor: selectedPatients.has(preview.patientId) ? '#e7f3ff' : 'white',
                    }}
                  >
                    <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                      <input
                        type="checkbox"
                        checked={selectedPatients.has(preview.patientId)}
                        onChange={() => handleSelectPatient(preview.patientId)}
                      />
                    </td>
                    <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                      <div style={{ fontWeight: 'bold' }}>{preview.patientName}</div>
                      {preview.qbCustomerName && (
                        <div style={{ fontSize: '0.875rem', color: '#666' }}>
                          QB: {preview.qbCustomerName}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                      {preview.email && <div>{preview.email}</div>}
                      {preview.phone && <div>{preview.phone}</div>}
                    </td>
                    <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                      {preview.recurringTransactions.map((rt, idx) => (
                        <div key={idx} style={{ marginBottom: '0.5rem' }}>
                          <div style={{ fontWeight: 'bold' }}>{rt.name}</div>
                          <div style={{ fontSize: '0.875rem', color: '#666' }}>
                            ${rt.amount.toFixed(2)} / {rt.frequency}
                            {rt.nextChargeDate && ` (Next: ${new Date(rt.nextChargeDate).toLocaleDateString()})`}
                          </div>
                        </div>
                      ))}
                    </td>
                    <td style={{ padding: '0.75rem', border: '1px solid #dee2e6' }}>
                      {preview.existingHealthieClient ? (
                        <div style={{ color: '#ffc107' }}>
                          ⚠ Existing client in Healthie
                        </div>
                      ) : (
                        <div style={{ color: '#28a745' }}>✓ Ready to migrate</div>
                      )}
                      {preview.conflicts.length > 0 && (
                        <div style={{ fontSize: '0.875rem', color: '#dc3545', marginTop: '0.25rem' }}>
                          {preview.conflicts.join(', ')}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Migration Results */}
      {migrationResults && (
        <div
          style={{
            padding: '1rem',
            marginTop: '2rem',
            borderRadius: '8px',
            backgroundColor: migrationResults.success ? '#d4edda' : '#f8d7da',
            border: `1px solid ${migrationResults.success ? '#c3e6cb' : '#f5c6cb'}`,
          }}
        >
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Migration Results</h2>
          {migrationResults.results && Array.isArray(migrationResults.results) ? (
            <div>
              <div style={{ marginBottom: '1rem' }}>
                <strong>Total:</strong> {migrationResults.totalProcessed || migrationResults.results.length} |{' '}
                <strong style={{ color: '#28a745' }}>Success:</strong> {migrationResults.successful || 0} |{' '}
                <strong style={{ color: '#dc3545' }}>Failed:</strong> {migrationResults.failed || 0}
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {migrationResults.results.map((result: any, idx: number) => (
                  <div
                    key={idx}
                    style={{
                      padding: '0.75rem',
                      marginBottom: '0.5rem',
                      backgroundColor: result.success ? '#d4edda' : '#f8d7da',
                      borderRadius: '4px',
                    }}
                  >
                    <div style={{ fontWeight: 'bold' }}>{result.patientName}</div>
                    {result.success ? (
                      <div style={{ fontSize: '0.875rem', color: '#155724' }}>
                        ✓ Migrated successfully ({result.subscriptionsCreated} subscriptions created)
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.875rem', color: '#721c24' }}>
                        ✗ Failed: {result.errors?.join(', ') || 'Unknown error'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              {migrationResults.success ? (
                <div style={{ color: '#155724' }}>
                  ✓ Migration completed successfully
                  {migrationResults.subscriptionsCreated > 0 && (
                    <div>Created {migrationResults.subscriptionsCreated} subscription(s)</div>
                  )}
                </div>
              ) : (
                <div style={{ color: '#721c24' }}>
                  ✗ Migration failed: {migrationResults.error || 'Unknown error'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
        </>
      )}
    </div>
  );
}

