# GraphQL Setup Guide for AWS + Next.js

## What You're Getting

A GraphQL API that runs **inside your existing Next.js app** - no separate server needed!

## Architecture

```
Your AWS EC2 Server (port 3400)
├── Next.js App
│   ├── /api/graphql          ← NEW: GraphQL endpoint
│   ├── /api/patients         ← Keep existing REST
│   ├── /api/inventory        ← Keep existing REST
│   └── All your pages
└── PM2 manages everything (no changes needed!)
```

## Why This Approach?

✅ **No separate server** - GraphQL runs in Next.js API routes  
✅ **Same deployment** - Just deploy like normal  
✅ **Same PM2 setup** - No changes needed  
✅ **Same Nginx config** - Works automatically  
✅ **Type-safe** - Full TypeScript support  
✅ **Simple** - Easier than Apollo Server  

## Installation

```bash
npm install graphql
# That's it! No Apollo Server, no separate packages
```

## How It Works

### 1. Define Your Schema
`lib/graphql/schema.ts` - Defines what data you can query

### 2. Create Resolvers
Resolvers fetch data from:
- Your PostgreSQL database
- Healthie API
- Stripe API
- Anywhere else

### 3. Query from Frontend
```typescript
const query = `
  query {
    patientComplete(id: "123") {
      patient {
        name
        email
      }
      payments {
        amount
        date
      }
      subscriptions {
        packageName
        nextChargeDate
      }
    }
  }
`;

const response = await fetch('/api/graphql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
```

## Comparison: This vs Apollo Server

| Feature | Next.js GraphQL (Recommended) | Apollo Server |
|--------|-------------------------------|---------------|
| Separate Server | ❌ No | ✅ Yes |
| Deployment Complexity | ✅ Simple | ❌ More complex |
| AWS Setup | ✅ No changes | ❌ Need new server |
| PM2 Config | ✅ No changes | ❌ Need new process |
| Learning Curve | ✅ Easy | ❌ Steeper |
| Features | ✅ All you need | ✅ More features |

## Next Steps

1. **Install GraphQL**: `npm install graphql`
2. **Build your schema** (I can help with this)
3. **Create resolvers** that call Healthie, Stripe, and your DB
4. **Update frontend** to use GraphQL queries
5. **Deploy** - same as always!

## Example: Complete Patient Query

Instead of 4 REST calls:
```typescript
// OLD WAY (4 separate calls)
const patient = await fetch('/api/patients/123');
const payments = await fetch('/api/patients/123/payments');
const subscriptions = await fetch('/api/patients/123/subscriptions');
const memberships = await fetch('/api/patients/123/memberships');
```

Now 1 GraphQL call:
```typescript
// NEW WAY (1 call gets everything)
const { data } = await fetch('/api/graphql', {
  method: 'POST',
  body: JSON.stringify({
    query: `
      query {
        patientComplete(id: "123") {
          patient { name email phone }
          payments { amount date status }
          subscriptions { packageName nextChargeDate }
          memberships { plan status }
        }
      }
    `
  })
});
```

## Benefits for Your Migration

1. **Healthie Integration**: Healthie uses GraphQL - perfect match!
2. **Stripe Integration**: Stripe has GraphQL support
3. **Fewer API Calls**: Get everything in one request
4. **Type Safety**: GraphQL + TypeScript = fewer bugs
5. **Future-Proof**: Easy to add new data sources

## Deployment

**No changes needed!** Just:
1. Add GraphQL files to your codebase
2. `npm install graphql`
3. `npm run build`
4. `pm2 restart gmh-dashboard`

That's it! Your GraphQL endpoint will be at:
`https://nowoptimal.com/ops/api/graphql`


