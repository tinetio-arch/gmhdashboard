'use client';

import { useState, useEffect } from 'react';
import { formatCurrency, formatDate } from '@/lib/utils';

interface Transaction {
    transactionId: string;
    patientId: string;
    patientName: string;
    patientEmail: string;
    healthieClientId: string;
    amount: number;
    description: string;
    stripeAccount: string;
    healthieBillingItemId: string;
    stripeChargeId: string;
    status: string;
    receiptNumber: string;
    healthieDocumentId: string;
    createdAt: string;
    hasReceipt: boolean;
}

interface ReceiptsViewerProps {
    patientId?: string;
    showOnlyWithReceipts?: boolean;
    title?: string;
}

export default function ReceiptsViewer({
    patientId,
    showOnlyWithReceipts = false,
    title = 'Payment Receipts'
}: ReceiptsViewerProps) {
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pagination, setPagination] = useState({
        total: 0,
        limit: 50,
        offset: 0,
        hasMore: false
    });

    useEffect(() => {
        fetchTransactions();
    }, [patientId, showOnlyWithReceipts]);

    const fetchTransactions = async () => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (patientId) params.append('patient_id', patientId);
            if (showOnlyWithReceipts) params.append('has_receipt', 'true');
            params.append('limit', '50');
            params.append('offset', '0');

            const response = await fetch(`/api/receipts?${params}`);
            if (!response.ok) throw new Error('Failed to fetch transactions');

            const data = await response.json();
            setTransactions(data.transactions);
            setPagination(data.pagination);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    const openHealthieDocument = (documentId: string, clientId: string) => {
        // Open Healthie document in new tab
        const healthieUrl = `https://secure.gethealthie.com/client_portal/clients/${clientId}/documents/${documentId}`;
        window.open(healthieUrl, '_blank');
    };

    const getStatusBadge = (status: string) => {
        const statusColors: Record<string, string> = {
            'succeeded': 'bg-green-100 text-green-800',
            'pending': 'bg-yellow-100 text-yellow-800',
            'failed': 'bg-red-100 text-red-800',
            'refunded': 'bg-gray-100 text-gray-800'
        };

        return (
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
                {status}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="animate-pulse">
                <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-200 rounded"></div>
                    ))}
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-600">Error: {error}</p>
                <button
                    onClick={fetchTransactions}
                    className="mt-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                    Retry
                </button>
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="bg-gray-50 rounded-lg p-6 text-center">
                <p className="text-gray-600">
                    {showOnlyWithReceipts ? 'No receipts found' : 'No payment transactions found'}
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">{title}</h2>
                <div className="text-sm text-gray-600">
                    Showing {transactions.length} of {pagination.total} transactions
                </div>
            </div>

            <div className="bg-white shadow-sm rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Date
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Patient
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Description
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Amount
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Status
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Receipt
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {transactions.map((transaction) => (
                            <tr key={transaction.transactionId} className="hover:bg-gray-50">
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {formatDate(new Date(transaction.createdAt))}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    <div className="text-sm text-gray-900">{transaction.patientName}</div>
                                    <div className="text-xs text-gray-500">{transaction.patientEmail}</div>
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900">
                                    {transaction.description}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                    {formatCurrency(transaction.amount)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap">
                                    {getStatusBadge(transaction.status)}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                    {transaction.receiptNumber || '—'}
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm">
                                    {transaction.hasReceipt && transaction.healthieDocumentId && (
                                        <button
                                            onClick={() => openHealthieDocument(
                                                transaction.healthieDocumentId,
                                                transaction.healthieClientId
                                            )}
                                            className="inline-flex items-center px-3 py-1 border border-gray-300 text-sm leading-5 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                                        >
                                            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            View Receipt
                                        </button>
                                    )}
                                    {transaction.stripeChargeId && (
                                        <a
                                            href={`https://dashboard.stripe.com/payments/${transaction.stripeChargeId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ml-2 text-indigo-600 hover:text-indigo-900"
                                        >
                                            Stripe
                                        </a>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {pagination.hasMore && (
                <div className="flex justify-center mt-4">
                    <button
                        onClick={() => {
                            // Implement load more functionality
                            console.log('Load more...');
                        }}
                        className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                        Load More
                    </button>
                </div>
            )}
        </div>
    );
}