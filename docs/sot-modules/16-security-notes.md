## 🔐 SECURITY NOTES

### Never Commit
- `.env.local` (secrets)
- PM2 config with env vars
- Database credentials
- API keys/tokens
- Session secrets

### Cookie Security
- Name: `gmh_session_v2`
- Flags: `httpOnly`, `secure` (prod), `sameSite: 'lax'`
- Path: `/ops/` (matches base path)
- Signing: HMAC with `SESSION_SECRET`

### OAuth Security
- State parameter (CSRF protection)
- Stored in httpOnly cookie
- Validated on callback
- 10-minute expiry

---

