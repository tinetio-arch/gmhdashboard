# Cloud Pre-Flight (Cowork surface)

You are a **Cowork cloud session** running in an isolated sandbox with the repo checked
out. You do **NOT** have on-box access. Acting as if you do will fail or, worse, give a
false sense that work is deployed when it is not.

## PROHIBITED on this surface
- ❌ `claude-coord` — not installed in the cloud sandbox. Do not call it.
- ❌ `pm2` / service restarts / **any deploy**. You cannot and must not deploy.
- ❌ `psql` to the live RDS / any live DB write. There is no live DB here.
- ❌ Reading `~/.claude/coord/*` or on-box secrets — they don't exist in the sandbox.
- ❌ `bash scripts/pre-deploy-check.sh` / `health-check.sh` — these are on-box gates run
  by an on-box session, not you.

## Before you touch any file
1. Read `docs/sot-modules/INDEX.md` → identify relevant modules → read those.
2. **Read `docs/CODE_ROUTER.md`** → topic-to-source-file lookup. Grep it for the keywords in your task to find the canonical files BEFORE writing code. If the topic isn't in the table, read the relevant files first, then add a row before opening your PR — auto-add rules are in the file.
2. Read `docs/DEPENDENCIES.md` and `docs/PROJECT_TRACKER.md`.
3. Read `docs/CLAUDE_MEMORY_PINS.md` for mandatory context.
4. Read the **Learned Patterns** snapshot embedded in this contract — it carries Phil's
   latest corrections that you can't fetch from the box.

## While you work
- Make minimal, focused changes. Follow the code patterns in `CLAUDE.md` exactly.
- `npm run typecheck` must pass. Use parameterized SQL; never hardcode secrets.
- Keep changes to your branch.

## When you finish
- **Do NOT deploy.** End by **opening a PR against `master`**.
- In the PR description, summarize what changed and spell out what an on-box session must
  verify before deploy: run `claude-coord debug` (26-test suite), `pre-deploy-check.sh`,
  and `health-check.sh`. Migrations and `pm2 restart` happen on-box, not here.
