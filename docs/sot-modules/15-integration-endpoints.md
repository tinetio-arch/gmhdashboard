## 📞 INTEGRATION ENDPOINTS

### Healthie
- **GraphQL**: `https://api.gethealthie.com/graphql`
- **Auth**: `Authorization: Basic <raw API key>` (NOT Base64 encoded)
- **Headers**: `AuthorizationSource: API`
- **Rate Limiter**: `lib/healthieRateLimiter.ts` (5 req/s, 429 backoff) — see Critical Code Patterns

### QuickBooks
- **OAuth**: `https://appcenter.intuit.com/connect/oauth2`
- **Token**: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- **API**: `https://quickbooks.api.intuit.com/v3/company/{realmId}/...`

### Snowflake
- **Account**: `KXWWLYZ-DZ83651`
- **Region**: `us-east-1`
- **Warehouse**: `GMH_WAREHOUSE`

### Telegram
- **API**: `https://api.telegram.org/bot{TOKEN}/...`
- **Webhook**: (not used, polling mode)

---

