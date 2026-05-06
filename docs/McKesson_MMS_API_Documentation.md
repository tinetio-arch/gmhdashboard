# McKesson MMS API Documentation

> **Portal:** https://gateway.mms.mckesson.com/documentation  
> **Support:**  
> - Sandbox customers: apionboarding@mckesson.com  
> - Production customers: apisupport@mckesson.com  

Whether you're a new customer utilizing the Sandbox or a live customer utilizing the Production environment, the documentation provides example API calls and responses in each environment to support you.

---

## Base URLs

| Environment | Base URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox` |
| Production | `https://api-gateway.mms.mckesson.com` |

---

## Authentication

All endpoints require authentication. Responses include:
- `401` — Authentication required or credentials invalid
- `403` — Forbidden – You do not have permission to access this resource

---

## Table of Contents

1. [Order Endpoint](#order-endpoint)
   - [POST Submit Order](#post-submit-order)
   - [GET Get Order Details](#get-get-order-details)
   - [GET Get Order Status](#get-get-order-status)
   - [GET Get Order Status Summaries By Date Range](#get-get-order-status-summaries-by-date-range)
   - [GET Get Order Tracking By Date Range](#get-get-order-tracking-by-date-range)
   - [GET Get Order Tracking Details](#get-get-order-tracking-details)
2. [Invoice Endpoint](#invoice-endpoint)
   - [GET Retrieve Invoice IDs](#get-retrieve-invoice-ids)
   - [GET Get Invoice by ID](#get-get-invoice-by-id)
3. [Patient Endpoint](#patient-endpoint)
   - [PUT Update Patient](#put-update-patient)
   - [POST Add Patient](#post-add-patient)
4. [Product Endpoint](#product-endpoint)
   - [POST Retrieve Item Availability](#post-retrieve-item-availability)

---

# Order Endpoint

Operations related to order management.

---

## POST Submit Order

Create the order based on a given request.

**Endpoint:**
```
POST /v1/orders/{accountId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/{accountId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/{accountId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) | ✅ Yes | Account ID |

### Request Body

Content-Type: `application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| patientId | string | No | Patient ID |
| purchaseOrderNumber | string | No | Purchase order number |
| shipTo | object (ShipTo) | ✅ Yes | Ship-to information |
| items | array of objects (Item) | No | List of items to order |

**ShipTo Object:**

| Field | Type | Description |
|---|---|---|
| accountId | string | Ship-to account ID |

**Item Object:**

| Field | Type | Description |
|---|---|---|
| itemId | string | Item identifier |
| quantity | integer | Quantity to order |
| unitOfMeasure | string | Unit of measure |

**Request Sample:**
```json
{
  "patientId": "string",
  "purchaseOrderNumber": "string",
  "shipTo": {
    "accountId": "string"
  },
  "items": [
    {
      "itemId": "string",
      "quantity": 1,
      "unitOfMeasure": "string"
    }
  ]
}
```

### Responses

| Status | Description |
|---|---|
| 200 | Submit order response |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 422 | Unprocessable Entity |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "accepted": true,
  "orderId": "string",
  "message": "string",
  "validation": {
    "valid": true,
    "messages": [
      {
        "lineNumber": 0,
        "itemId": "string",
        "message": "string",
        "type": "string",
        "purchasable": true,
        "tags": ["string"],
        "lineLevel": true
      }
    ]
  }
}
```

---

## GET Get Order Details

Retrieve order details for a given accountId and orderId.

**Endpoint:**
```
GET /v1/orders/{accountId}/{orderId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/{accountId}/{orderId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/{accountId}/{orderId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) >= 1 | ✅ Yes | Account ID of the Order |
| orderId | string | ✅ Yes | Order ID of the Order |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve Order details |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Order not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "submittedBy": {
    "id": "string"
  },
  "account": {
    "id": 0,
    "name": "string",
    "addressLine1": "string",
    "addressLine2": "string",
    "addressLine3": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  },
  "shipTo": {
    "id": 0,
    "name": "string",
    "addressLine1": "string",
    "addressLine2": "string",
    "addressLine3": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  },
  "trackingLines": [
    {
      "accountId": "string",
      "orderId": "string",
      "trackingId": "string",
      "line": "string",
      "unitOfMeasure": "string",
      "quantity": "string",
      "carrier": "string"
    }
  ],
  "subTotal": 0.1,
  "productTotal": 0.1,
  "numberOfLinesOpen": 0,
  "linesBackOrdered": 0,
  "linesShipped": 0,
  "linesCancelled": 0,
  "linesTotal": 0,
  "orderId": "string",
  "purchaseOrderNumber": "string",
  "submittedDate": "string",
  "orderStatus": "string",
  "lines": [
    {
      "price": 0.1,
      "lineNumber": "string",
      "itemId": "string",
      "unitOfMeasure": "string",
      "description": "string",
      "manufacturerId": "string",
      "productTotal": "string",
      "freightTotal": "string",
      "taxTotal": 0.1,
      "netTotal": 0.1,
      "quantityOrdered": "string",
      "quantityOpen": 0,
      "quantityBackorder": 0,
      "quantityShipped": 0,
      "quantityCancelled": 0
    }
  ]
}
```

---

## GET Get Order Status

Retrieve order status for a given accountId and orderId.

**Endpoint:**
```
GET /v1/orders/{accountId}/{orderId}/status
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/{accountId}/{orderId}/status` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/{accountId}/{orderId}/status` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) >= 1 | ✅ Yes | Account ID of the Order |
| orderId | string | ✅ Yes | Order ID of the Order |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve Order status |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Order not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "orderId": "string",
  "status": "string",
  "submittedDate": "string"
}
```

---

## GET Get Order Status Summaries By Date Range

Retrieve order status summaries for a given accountId and date range.

**Endpoint:**
```
GET /v1/orders/{accountId}/fulfillment
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/{accountId}/fulfillment` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/{accountId}/fulfillment` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) | ✅ Yes | Account ID |

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| request | object (InvoiceOrderRequest) | ✅ Yes | Date range request object |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve Order Status Summaries by date range |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Order not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "orderStatusList": [
    {
      "orderId": "string",
      "status": "string",
      "submittedDate": "string"
    }
  ],
  "hasNextPage": true,
  "hasPrevPage": true,
  "totalCount": 0
}
```

---

## GET Get Order Tracking By Date Range

Retrieve order tracking details for a given date range.

**Endpoint:**
```
GET /v1/orders/tracking
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/tracking` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/tracking` |

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| request | object (InvoiceOrderRequest) | ✅ Yes | Date range request object |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve Order Tracking by date range |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Order Tracking Details not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "trackingResponse": [
    {
      "orderId": "string",
      "trackingDetails": [
        {
          "trackingId": "string",
          "carrierName": "string"
        }
      ]
    }
  ],
  "hasNextPage": true,
  "hasPrevPage": true,
  "totalElements": 0
}
```

---

## GET Get Order Tracking Details

Retrieve order tracking details for a given accountId and orderId.

**Endpoint:**
```
GET /v1/orders/tracking/{accountId}/{orderId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/orders/tracking/{accountId}/{orderId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/orders/tracking/{accountId}/{orderId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) >= 1 | ✅ Yes | Account ID of the Order |
| orderId | string | ✅ Yes | Order ID of the Order |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve Order Tracking details |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Order Tracking details not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "orderId": "string",
  "trackingDetails": [
    {
      "trackingId": "string",
      "carrierName": "string"
    }
  ]
}
```

---

# Invoice Endpoint

Operations related to invoice management.

---

## GET Retrieve Invoice IDs

Returns invoice IDs for a 31-day period.

**Endpoint:**
```
GET /v1/invoices
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/invoices` |
| Production | `https://api-gateway.mms.mckesson.com/v1/invoices` |

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| invoiceRequestDTO | object (InvoiceOrderRequest) | ✅ Yes | Invoice request with date range |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve invoice response |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Invoice IDs not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "invoiceId": ["string"],
  "hasNextPage": true,
  "hasPrevPage": true,
  "totalElements": 0
}
```

---

## GET Get Invoice by ID

Returns invoice details for the given invoice ID.

**Endpoint:**
```
GET /v1/invoices/{accountId}/{orderId}/{invoiceId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/invoices/{accountId}/{orderId}/{invoiceId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/invoices/{accountId}/{orderId}/{invoiceId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) >= 1 | ✅ Yes | Account ID of the invoice |
| orderId | string | ✅ Yes | Order ID of the invoice |
| invoiceId | integer (int64) >= 1 | ✅ Yes | Invoice ID of the invoice |

### Responses

| Status | Description |
|---|---|
| 200 | Retrieve invoice response |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Invoice not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "accountId": 0,
  "orderId": "string",
  "invoiceId": 0,
  "invoiceDate": "string",
  "invoiceDueDate": "string",
  "orderDate": "string",
  "status": "string",
  "account": {
    "id": 0,
    "name": "string",
    "addressLine1": "string",
    "addressLine2": "string",
    "addressLine3": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  },
  "lines": [
    {
      "invoiceId": 0,
      "invoiceDate": "string",
      "manufacturer": "string",
      "price": 0,
      "freight": 0,
      "lineNumber": 0,
      "productId": "string",
      "productDescription": "string",
      "unitOfMeasure": "string",
      "lineStatus": "string",
      "quantityOrdered": 0,
      "quantityShipped": 0,
      "taxTotal": 0,
      "subTotal": 0,
      "netTotal": 0,
      "discountTotal": 0
    }
  ],
  "purchaseOrderNumber": "string",
  "taxTotal": 0,
  "netTotal": 0,
  "subTotal": 0,
  "discountTotal": 0,
  "shipTo": {
    "id": 0,
    "name": "string",
    "addressLine1": "string",
    "addressLine2": "string",
    "addressLine3": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  }
}
```

---

# Patient Endpoint

Operations related to patient management.

---

## PUT Update Patient

Update patient details based on a given request.

**Endpoint:**
```
PUT /v1/patients/{patientId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/patients/{patientId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/patients/{patientId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| patientId | string | ✅ Yes | Patient ID of the patient |

### Request Body

Content-Type: `application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) | ✅ Yes | Account ID |
| firstName | string [1..25 chars] | ✅ Yes | Patient first name |
| lastName | string [1..25 chars] | ✅ Yes | Patient last name |
| address | object (AddressRequest) | ✅ Yes | Patient address |

**AddressRequest Object:**

| Field | Type | Description |
|---|---|---|
| city | string | City |
| state | string | State |
| type | string (enum) | Address type (e.g., HOME) |
| addressLine1 | string | Address line 1 |
| postalCode | string | Postal code |

**Request Sample:**
```json
{
  "accountId": 0,
  "firstName": "string",
  "lastName": "string",
  "address": {
    "city": "string",
    "state": "string",
    "type": "HOME",
    "addressLine1": "string",
    "postalCode": "string"
  }
}
```

### Responses

| Status | Description |
|---|---|
| 200 | Update Patient response |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Patient details not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "accountId": "string",
  "patientId": "string",
  "firstName": "string",
  "lastName": "string",
  "address": {
    "externalShipToId": "string",
    "name": "string",
    "addressLine1": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  }
}
```

---

## POST Add Patient

Add patient details based on a given request.

**Endpoint:**
```
POST /v1/patients
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/patients` |
| Production | `https://api-gateway.mms.mckesson.com/v1/patients` |

### Request Body

Content-Type: `application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) | ✅ Yes | Account ID |
| firstName | string [1..25 chars] | ✅ Yes | Patient first name |
| lastName | string [1..25 chars] | ✅ Yes | Patient last name |
| address | object (AddressRequest) | ✅ Yes | Patient address |
| patientId | string | ✅ Yes | Patient ID |

**AddressRequest Object:**

| Field | Type | Description |
|---|---|---|
| city | string | City |
| state | string | State |
| type | string (enum) | Address type (e.g., HOME) |
| addressLine1 | string | Address line 1 |
| postalCode | string | Postal code |

**Request Sample:**
```json
{
  "accountId": 0,
  "firstName": "string",
  "lastName": "string",
  "address": {
    "city": "string",
    "state": "string",
    "type": "HOME",
    "addressLine1": "string",
    "postalCode": "string"
  },
  "patientId": "string"
}
```

### Responses

| Status | Description |
|---|---|
| 200 | Add Patient response |
| 400 | Bad Request |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Patient details not found |
| 500 | Internal server error |

**Response Sample (200):**
```json
{
  "accountId": "string",
  "patientId": "string",
  "firstName": "string",
  "lastName": "string",
  "address": {
    "externalShipToId": "string",
    "name": "string",
    "addressLine1": "string",
    "city": "string",
    "state": "string",
    "postalCode": "string",
    "type": "string"
  }
}
```

---

# Product Endpoint

Operations related to product management.

---

## POST Retrieve Item Availability

Returns item availability information for requested items.

**Endpoint:**
```
POST /v1/products/availability/{accountId}
```

| Environment | URL |
|---|---|
| Sandbox | `https://api-gateway.mms.mckesson.com/sandbox/v1/products/availability/{accountId}` |
| Production | `https://api-gateway.mms.mckesson.com/v1/products/availability/{accountId}` |

### Path Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| accountId | integer (int64) | ✅ Yes | Account ID |

### Request Body

Content-Type: `application/json`

| Field | Type | Required | Description |
|---|---|---|---|
| items | array of objects (ItemRequest) [1..2147483647] | ✅ Yes | List of items to check availability |
| shipto | object (ShipTo) | No | Ship-to information |

**ItemRequest Object:**

| Field | Type | Description |
|---|---|---|
| itemId | integer | Item identifier |
| quantity | integer | Quantity |
| unitOfMeasure | string | Unit of measure (e.g., CA) |

**ShipTo Object:**

| Field | Type | Description |
|---|---|---|
| accountId | integer | Ship-to account ID |

**Request Sample:**
```json
{
  "items": [
    {
      "quantity": 5,
      "unitOfMeasure": "CA",
      "itemId": 123456
    }
  ],
  "shipto": {
    "accountId": 1
  }
}
```

### Responses

| Status | Description |
|---|---|
| 200 | Item availability retrieved successfully |
| 400 | Bad Request – Invalid input provided |
| 401 | Authentication required or credentials invalid |
| 403 | Forbidden – You do not have permission to access this resource |
| 404 | Item availability data not found |
| 500 | Internal server error |
| 503 | Service Unavailable |

**Response Sample (200):**
```json
[
  {
    "itemId": "string",
    "stock": {
      "name": "string",
      "description": "string"
    },
    "status": {
      "reason": "string",
      "detail": "string",
      "purchasable": true
    },
    "formulary": {
      "description": "string"
    },
    "replacement": {
      "type": "string",
      "replacementId": "string",
      "source": "string",
      "allowBypass": true,
      "reason": "string"
    },
    "returnable": true,
    "storageRequirement": "string",
    "unitOfMeasures": [
      {
        "type": "string",
        "unitOfMeasure": "string",
        "eaches": 0,
        "weight": {
          "weight": 0.1,
          "units": "string"
        },
        "atomicUnits": "string",
        "pills": [
          {
            "description": "string"
          }
        ],
        "lastPurchaseDate": "string"
      }
    ]
  }
]
```

---

## Shared Schema Objects

### InvoiceOrderRequest (Query Parameter Object)

Used by: Retrieve Invoice IDs, Get Order Status Summaries By Date Range, Get Order Tracking By Date Range.

This object defines the date range for queries. Specific field names are not explicitly listed in the portal UI but are passed as query parameters.

### AddressRequest Object

| Field | Type | Required | Description |
|---|---|---|---|
| city | string | ✅ Yes | City |
| state | string | ✅ Yes | State code |
| type | string (enum) | ✅ Yes | Address type (e.g., `HOME`) |
| addressLine1 | string | ✅ Yes | Street address line 1 |
| postalCode | string | ✅ Yes | ZIP / Postal code |

### Address Response Object

| Field | Type | Description |
|---|---|---|
| externalShipToId | string | External ship-to identifier |
| name | string | Name on the address |
| addressLine1 | string | Street address line 1 |
| city | string | City |
| state | string | State code |
| postalCode | string | ZIP / Postal code |
| type | string | Address type |

### ShipTo Object (Order / Product)

| Field | Type | Description |
|---|---|---|
| accountId | string/integer | Ship-to account ID |

---

*Documentation scraped from the McKesson MMS API Portal on 4/22/2026.*
