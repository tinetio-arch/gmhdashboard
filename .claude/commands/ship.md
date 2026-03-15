# Ship Command

Build, verify, commit, and push in one step.

## Usage
```
/ship [commit message]
```

## Steps

1. Run `npx next build` — STOP if it fails
2. Run `git diff --stat` — show what's changed
3. Check that `.env.local` is NOT staged
4. Check that no secrets are in the diff (`grep -i "secret\|password\|token\|key=" diff output`)
5. Stage all changes: `git add -A`
6. Commit with the provided message (or auto-generate one from changes)
7. Push to origin: `git push origin main` (or current branch)
8. Report success with commit hash

## Safety Checks
- Build MUST pass before committing
- No secrets in the diff
- No .env files staged
- Commit message follows conventional format (fix:, feat:, refactor:, chore:)
