# Follow-up: Google Chat inbound messages pass auth but don't land in task `chat_thread`

**Filed:** 2026-05-26 by claude-secfix session — **separate from**, and downstream of, the wave3b security fix (commits `b2a6572` → `4df6481` + nginx trailing-slash workaround).

## Status of the security fix (closed)
- JWT verification (`lib/googleChatAuth.ts`) shipped and verified on prod.
- Forged/unsigned requests rejected with 401, confirmed live via direct curl.
- Real Google-signed tokens **do** pass: archived `gmh-dashboard-out__2026-05-20*.log` shows **5 successful `[chat-webhook] event type=MESSAGE`** lines on 2026-05-20 after the nginx trailing-slash fix landed, i.e. requests reached the handler past the auth gate.
- PHI redaction on the orphan log + chmod 0600 + logrotate config — all in place, log still 0 bytes.

## The remaining anomaly (this ticket)
The 5 messages that passed auth on 2026-05-20 **did not result in any `chat_thread` entry** with `from_surface='chat'` anywhere in `~/.claude/coord/inbox/*.json`. Yet:
- The orphan log (`~/.claude/coord/chat-orphan-messages.log`) is 0 bytes — so the handler did **not** take any `appendOrphan` exit (no "unknown sender", no "no task routing").
- Neither pm2 stream contains the `[chat-webhook] dispatch-mcp inbox_chat_append non-2xx` or `... fetch failed` lines that `fireDispatch` writes on a non-2xx or network failure.
- `[chat-webhook] DISPATCH_TOKEN not set` is absent (token IS configured in `.env.local`).
- `dispatch-mcp-out.log` has zero `inbox_chat_append` traces around that window.

So either `fireDispatch` succeeded (dispatch-mcp returned 2xx) but dispatch-mcp didn't actually append, OR something silently swallowed the error path. The handler logic between `console.log('[chat-webhook] event type=MESSAGE')` and `fireDispatch(...)` only logs through `appendOrphan` writes — none happened.

## Where to dig
1. **Add an info log before `fireDispatch`** in `app/api/chat/webhook/route.ts` — `console.log('[chat-webhook] dispatching inbox_chat_append row=... slug=... source=...')` — so the next inbound is fully traceable end-to-end.
2. **Audit `dispatch-mcp` `_h_inbox_chat_append`** (`/home/ec2-user/dispatch-mcp/tools/projects.py:2209`) for: (a) ack-without-write behavior (e.g. early return on a condition), (b) the `audit()` call's destination — does it write to the pm2 out log or only to a separate audit file? If the latter, that's where to look.
3. **Recheck staff resolution.** Confirm the `google_chat_id` values in `~/.claude/coord/staff.json` match the `users/<id>` Google actually sends. If the lookup silently maps to a slug that dispatch-mcp then rejects (e.g. unknown assignee), the dispatch call could be returning 4xx that fireDispatch's `console.error` should be catching — verify the error path isn't dropped by Next's edge runtime.
4. **The `chat-task-routing.json` cache** was rewritten by dispatch-mcp on 2026-05-21 17:46 (outbound posting works). Verify inbound webhook reads this same file at the right path / permissions.
5. **Test live with a fresh send** while tailing both pm2 streams **and** `dispatch-mcp-out.log` simultaneously — current logs are completely empty for the webhook on 2026-05-26, so either Google de-prioritized the endpoint after the May 20 308 thrashing or the test message hasn't propagated. May warrant a fresh "configure Chat app endpoint" round-trip in GCP console.

## What NOT to assume
- Not a JWT problem (auth gate works — proven).
- Not the trailing-slash redirect (fixed at nginx; verified `redirects=0` on no-slash POST).
- Not a missing `DISPATCH_TOKEN` (env var set, no "not set" log).
- Not UUID validation rejecting legitimate task_ids (allowlist accepts the real format).

## Reference commits
- `b2a6572` fix(security): authenticate Google Chat webhook, redact PHI, validate task UUID
- `19be73a` fix(security): correct chat-webhook task_id validation to real dispatch-mcp format
- `4df6481` merge(secfix) into master
- nginx exact-match block in `/etc/nginx/conf.d/nowoptimal.conf` (backup `.bak-trailingslash-20260520-150438`)
