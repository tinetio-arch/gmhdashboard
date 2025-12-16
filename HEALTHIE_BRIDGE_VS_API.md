# Bridge by Healthie vs Healthie GraphQL API

## Quick Answer: **Use the GraphQL API** (Not Bridge)

For your use case (migrating patients, managing subscriptions, processing payments), you need the **GraphQL API**, not Bridge.

---

## What is Bridge by Healthie?

**Bridge** is a **data warehouse tool** for bulk analytics and reporting.

### What Bridge Does:
- ✅ Delivers bulk data to **S3 buckets** or **Snowflake**
- ✅ Updates every **15 minutes** (not real-time)
- ✅ Best for: Analytics, reporting, data science, machine learning
- ✅ Format: Parquet files with change data capture (CDC)

### When to Use Bridge:
- You need to analyze historical data
- You're building data warehouses
- You need bulk exports for BI tools
- You're doing machine learning on patient data

### Bridge Limitations:
- ❌ **Not real-time** - 15 minute delay minimum
- ❌ **Read-only** - Can't create/update data
- ❌ **Bulk only** - Not for individual operations
- ❌ **Enterprise feature** - Requires special access/contract

---

## What is Healthie GraphQL API?

**GraphQL API** is the **real-time operational API** for building applications.

### What the API Does:
- ✅ **Real-time** operations (instant)
- ✅ **Create/Update/Delete** clients, packages, subscriptions
- ✅ **Manage invoices** and payments
- ✅ **Full CRUD** access to all Healthie features
- ✅ **GraphQL** - Flexible, efficient queries

### When to Use the API:
- ✅ **Your exact use case**: Migrating patients
- ✅ Creating subscriptions and packages
- ✅ Managing recurring payments
- ✅ Sending invoices
- ✅ Real-time patient management
- ✅ Building integrations

### API Features:
- ✅ **GraphQL** - Get exactly what you need
- ✅ **Real-time** - Instant updates
- ✅ **Full access** - Everything Healthie can do
- ✅ **Stripe integration** - Built-in payment processing

---

## Comparison Table

| Feature | Bridge by Healthie | GraphQL API |
|---------|------------------|-------------|
| **Purpose** | Analytics/Reporting | Operations/Integration |
| **Speed** | 15 min delay | Real-time |
| **Data Access** | Read-only bulk | Full CRUD |
| **Format** | Parquet files | GraphQL queries |
| **Use Case** | Data warehouse | Application building |
| **Your Needs** | ❌ Not needed | ✅ **Perfect fit** |

---

## Recommendation for Your System

### ✅ **Use: Healthie GraphQL API**

**Why:**
1. You need to **create** patients (migration)
2. You need to **assign** packages/subscriptions
3. You need **real-time** payment processing
4. You need to **send invoices**
5. You're building an **operational system**, not analytics

### ❌ **Don't Use: Bridge by Healthie**

**Why:**
1. Bridge is **read-only** - can't create patients
2. Bridge has **15-minute delay** - too slow for operations
3. Bridge is for **analytics**, not operations
4. Bridge requires **enterprise contract** - unnecessary cost

---

## How Healthie API Works

### Authentication
```typescript
// Healthie uses Basic auth with API key
headers: {
  'Authorization': 'Basic YOUR_API_KEY_HERE',
  'AuthorizationSource': 'API'
}
```

### GraphQL Endpoint
```
https://api.gethealthie.com/graphql
```

### Example: Create Client
```graphql
mutation CreateClient($input: createClientInput!) {
  createClient(input: $input) {
    client {
      id
      first_name
      last_name
      email
    }
  }
}
```

### Example: Assign Package (Subscription)
```graphql
mutation AssignPackage($input: assignPackageInput!) {
  assignPackage(input: $input) {
    subscription {
      id
      status
      next_charge_date
      amount
    }
  }
}
```

---

## What You Can Do with Healthie API

### ✅ Patient Management
- Create clients
- Update client info
- Search clients (by email, phone, name)
- Get client details

### ✅ Package & Subscription Management
- Create packages (recurring payment plans)
- Assign packages to clients
- Manage subscriptions (active, paused, cancelled)
- Track next charge dates

### ✅ Invoicing & Payments
- Create invoices
- Send invoices to clients
- Track payment status
- Check saved payment methods
- Process payments via Stripe (integrated)

### ✅ Full Feature Access
- Scheduling
- Messaging
- Forms
- Documents
- Telehealth
- Insurance billing
- EHR features

---

## Getting Started with Healthie API

### 1. Get API Access
1. Log into your Healthie account
2. Complete "Activate a Partner" form
3. Healthie support will email you an API key

### 2. Test Connection
```typescript
const healthie = createHealthieClient();
const connected = await healthie.testConnection();
```

### 3. Start Migrating
```typescript
// Create client
const client = await healthie.createClient({
  first_name: 'John',
  last_name: 'Doe',
  email: 'john@example.com'
});

// Create package
const package = await healthie.createPackage({
  name: 'Monthly Membership',
  price: 180.00,
  billing_frequency: 'monthly'
});

// Assign to client
const subscription = await healthie.assignPackageToClient({
  client_id: client.id,
  package_id: package.id
});
```

---

## Integration with Your GraphQL System

Since Healthie uses GraphQL, it's **perfect** for your GraphQL overhaul:

```typescript
// Your GraphQL resolver can call Healthie directly
const resolvers = {
  Query: {
    patient: async (parent, args, context) => {
      // Get from your database
      const dbPatient = await getPatientFromDB(args.id);
      
      // Get from Healthie
      const healthieClient = await healthie.getClient(dbPatient.healthie_client_id);
      
      // Combine and return
      return {
        ...dbPatient,
        healthie: healthieClient
      };
    }
  }
};
```

---

## Summary

**For your migration and operations:**
- ✅ **Use Healthie GraphQL API** - Real-time, full CRUD, perfect for your needs
- ❌ **Skip Bridge** - It's for analytics, not operations

**Your current Healthie client implementation is on the right track!** Just needs authentication fix (Basic auth instead of Bearer).

---

## Next Steps

1. ✅ Get Healthie API credentials (complete "Activate a Partner" form)
2. ✅ Fix authentication in your Healthie client (I'll update this)
3. ✅ Test API connection
4. ✅ Start migrating patients
5. ✅ Set up packages and subscriptions
6. ✅ Integrate with your GraphQL system

