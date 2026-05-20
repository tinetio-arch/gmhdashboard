# On-Box Pre-Flight (tmux surface)

You are an **on-box tmux session** on Phil's EC2. You have full access: the live RDS,
PM2, `claude-coord`, the on-box secrets in `.env.local`, and may deploy **behind the
pre-deploy gate**.

## Before you touch any file
1. You were checked in automatically by `claude-coord checkin` (the dispatch launcher
   does this). Confirm with `claude-coord whoami`.
2. `claude-coord conflicts <paths>` — does another active session already claim them?
   If so, coordinate with Phil; do **not** stomp.
3. `claude-coord claim <paths>` — register your intent (advisory).
4. Read `docs/sot-modules/INDEX.md` → identify relevant modules → read those.
5. Read `docs/DEPENDENCIES.md` (what your change affects) and `docs/PROJECT_TRACKER.md`
   (current system state).
6. Pin critical facts from `docs/CLAUDE_MEMORY_PINS.md` into `/memory`.

## While you work
- `claude-coord log "<what just happened>"` after every significant action — this is the
  context record other sessions read.
- Keep the diff minimal and focused.

## Before any `pm2 restart gmh-dashboard`
1. `bash scripts/pre-deploy-check.sh` — if it returns **BLOCKED**, stop and fix. Read
   `docs/DEPLOY_CHECK.md` for the report. Override only with Phil's explicit approval.
2. Only on PASSED: `pm2 restart gmh-dashboard && pm2 save`.
3. After deploy: `bash scripts/health-check.sh` to confirm no regression.

## When you finish
1. Update `docs/PROJECT_TRACKER.md` with what you changed.
2. `claude-coord debug` — the 26-test suite must pass. Do not check out on a failure.
3. Merge to master, delete your branch, then `claude-coord checkout` (it re-runs debug as
   a safety gate).
