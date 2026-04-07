## 🎯 DEVELOPMENT GUIDELINES

### Code Style
- **Imports**: Use `@/` path alias (e.g., `@/lib/db`)
- **TypeScript**: Strict mode enabled, use types (but `ignoreBuildErrors: true` for now)
- **Components**: Prefer server components unless state/effects needed
- **API**: Use `lib/db.ts` `query()` helper, never open new pools
- **Auth**: Use `requireUser(role)` server-side, `userHasRole(user, role)` client-side

### Commit Messages
- Start with category: `[fix]`, `[feat]`, `[refactor]`, `[docs]`, `[deploy]`
- Be specific: `[fix] QuickBooks OAuth callback redirect to localhost`
- Include context: `[feat] AI Scribe Telegram approval workflow`

### Testing Before Deploy
1. **Local dev test**: `npm run dev` → Test at `http://localhost:3000/ops/` (dev uses port 3000; production uses 3011)
2. **Build test**: `npm run build` → Check for `Exit code: 0`
3. **Type check**: `npm run lint` (optional, we ignore TS errors in build)
4. **Env check**: Verify `.env.local` has all required vars
5. **Disk check**: `df -h /` → >2GB free

### Deployment Checklist
- [ ] Changes tested locally (`npm run dev`)
- [ ] Build succeeds (`npm run build`)
- [ ] No secrets in code (only in `.env.local`)
- [ ] PM2 working directory correct (`/home/ec2-user/gmhdashboard`)
- [ ] Disk space sufficient (`df -h /` → >2GB)
- [ ] Environment vars match production needs
- [ ] PM2 restarted (`pm2 restart gmh-dashboard`)
- [ ] Logs checked (`pm2 logs gmh-dashboard`)
- [ ] Public URL tested (`https://nowoptimal.com/ops/`)

---

