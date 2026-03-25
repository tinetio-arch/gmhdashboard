/**
 * ABXTac Order Management Dashboard
 *
 * Manages WooCommerce orders for research peptides following YPB requirements:
 * - Order processing and fulfillment
 * - USPS shipping label generation
 * - SKU validation (YPB.### format)
 * - Age verification tracking
 * - Inventory management
 */

'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Package,
  Clock,
  AlertCircle,
  CheckCircle,
  XCircle,
  Truck,
  RefreshCw,
  Download,
  User,
  Calendar,
  DollarSign,
  Box,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { format } from 'date-fns';

interface Order {
  id: number;
  customer_email: string;
  status: string;
  total: string;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    price: number;
  }>;
  shipping_address?: {
    name: string;
    address_1: string;
    city: string;
    state: string;
    postcode: string;
  };
  shipping_method?: string;
  tracking_number?: string;
  created_at: string;
  updated_at: string;
}

interface FulfillmentStats {
  readyToShip: number;
  awaitingVerification: number;
  onHold: number;
  inventoryIssues: number;
  shippedToday: number;
  totalRevenue: number;
}

interface InventoryAlert {
  type: 'low_stock' | 'expiring_soon' | 'expired';
  sku: string;
  product_name: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export default function ABXTacOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<FulfillmentStats>({
    readyToShip: 0,
    awaitingVerification: 0,
    onHold: 0,
    inventoryIssues: 0,
    shippedToday: 0,
    totalRevenue: 0,
  });
  const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
  const [selectedTab, setSelectedTab] = useState('processing');
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);

  useEffect(() => {
    loadOrders();
    loadStats();
    loadAlerts();
  }, [selectedTab]);

  const loadOrders = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/abxtac/orders?status=${selectedTab}`);
      const data = await response.json();
      setOrders(data.orders || []);
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/abxtac/stats');
      const data = await response.json();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadAlerts = async () => {
    try {
      const response = await fetch('/api/abxtac/inventory/alerts');
      const data = await response.json();
      setAlerts(data.alerts || []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    }
  };

  const syncWithWooCommerce = async () => {
    setIsSyncing(true);
    try {
      const response = await fetch('/api/abxtac/sync', { method: 'POST' });
      const result = await response.json();

      if (result.success) {
        await loadOrders();
        await loadStats();
        await loadAlerts();
      }
    } catch (error) {
      console.error('Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  const processOrder = async (orderId: number) => {
    try {
      const response = await fetch(`/api/abxtac/orders/${orderId}/fulfill`, {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        await loadOrders();
        await loadStats();
      } else {
        alert(`Fulfillment failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Failed to process order:', error);
    }
  };

  const processBatchOrders = async () => {
    setIsProcessingBatch(true);
    try {
      const response = await fetch('/api/abxtac/orders/batch-fulfill', {
        method: 'POST',
      });
      const result = await response.json();

      alert(
        `Batch processing complete:\n` +
        `✓ Successful: ${result.successful}\n` +
        `✗ Failed: ${result.failed}\n` +
        `Total processed: ${result.processed}`
      );

      await loadOrders();
      await loadStats();
    } catch (error) {
      console.error('Batch processing failed:', error);
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: any; icon: any }> = {
      'ready_for_fulfillment': { variant: 'default', icon: Package },
      'pending_age_verification': { variant: 'warning', icon: User },
      'on_hold': { variant: 'secondary', icon: Clock },
      'shipped': { variant: 'success', icon: CheckCircle },
      'cancelled': { variant: 'destructive', icon: XCircle },
    };

    const config = statusConfig[status] || { variant: 'outline', icon: AlertCircle };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {status.replace(/_/g, ' ').toUpperCase()}
      </Badge>
    );
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-50';
      case 'high':
        return 'text-orange-600 bg-orange-50';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50';
      default:
        return 'text-blue-600 bg-blue-50';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">ABXTac Order Management</h1>
          <p className="text-gray-600">Research peptide fulfillment via YourPeptideBrand</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={syncWithWooCommerce}
            disabled={isSyncing}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? 'animate-spin' : ''}`} />
            Sync WooCommerce
          </Button>
          <Button
            onClick={processBatchOrders}
            disabled={isProcessingBatch || stats.readyToShip === 0}
          >
            <Truck className="h-4 w-4 mr-2" />
            Process All ({stats.readyToShip})
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Ready to Ship</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{stats.readyToShip}</span>
              <Package className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Age Verification</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{stats.awaitingVerification}</span>
              <User className="h-8 w-8 text-yellow-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">On Hold</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{stats.onHold}</span>
              <Clock className="h-8 w-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inventory Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{stats.inventoryIssues}</span>
              <Box className="h-8 w-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Shipped Today</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{stats.shippedToday}</span>
              <CheckCircle className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Today&apos;s Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">${stats.totalRevenue.toFixed(2)}</span>
              <DollarSign className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inventory Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Inventory Alerts
          </h3>
          {alerts.map((alert, index) => (
            <Alert
              key={index}
              className={getSeverityColor(alert.severity)}
            >
              <AlertDescription className="flex items-center justify-between">
                <span>
                  <strong>{alert.product_name}</strong> - {alert.message}
                </span>
                <Badge variant="outline">{alert.type.replace(/_/g, ' ').toUpperCase()}</Badge>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Orders Table */}
      <Card>
        <CardHeader>
          <CardTitle>Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedTab} onValueChange={setSelectedTab}>
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="processing">Processing</TabsTrigger>
              <TabsTrigger value="on-hold">On Hold</TabsTrigger>
              <TabsTrigger value="age-verification">Age Verification</TabsTrigger>
              <TabsTrigger value="shipped">Shipped</TabsTrigger>
              <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedTab} className="mt-4">
              {isLoading ? (
                <div className="text-center py-8">Loading orders...</div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No orders in this status
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Products</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Shipping</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-medium">#{order.id}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            <div>{order.customer_email}</div>
                            {order.shipping_address && (
                              <div className="text-gray-500">
                                {order.shipping_address.city}, {order.shipping_address.state}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm space-y-1">
                            {order.items.map((item, idx) => (
                              <div key={idx}>
                                {item.quantity}x {item.name}
                                <span className="text-gray-500 ml-1">({item.sku})</span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>${order.total}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {order.shipping_method?.replace(/_/g, ' ').toUpperCase() || 'N/A'}
                            {order.tracking_number && (
                              <div className="text-blue-600 mt-1">
                                Track: {order.tracking_number}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {format(new Date(order.created_at), 'MMM dd, yyyy')}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {order.status === 'ready_for_fulfillment' && (
                              <Button
                                size="sm"
                                onClick={() => processOrder(order.id)}
                              >
                                <Truck className="h-3 w-3 mr-1" />
                                Ship
                              </Button>
                            )}
                            {order.tracking_number && (
                              <Button size="sm" variant="outline">
                                <FileText className="h-3 w-3 mr-1" />
                                Label
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Critical Notes */}
      <Card className="border-yellow-500 bg-yellow-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            YourPeptideBrand Integration Requirements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            <li>• All SKUs must follow YPB.### format exactly</li>
            <li>• Product weight must be set to 1 oz standard</li>
            <li>• Only USPS shipping methods allowed (First-Class, Priority, Priority Express)</li>
            <li>• Bundles must be pre-mapped before creation</li>
            <li>• Age verification required (18+ only)</li>
            <li>• All products marked &quot;For Research Use Only&quot;</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}