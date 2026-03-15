# Review Command

Self-review code changes before committing.

## Usage
```
/review [file path or "all" for staged changes]
```

## Steps

1. Check `git diff --staged` (or `git diff` for unstaged)
2. For each changed file, verify:
   - Auth pattern is correct (requireApiUser or cron secret)
   - SQL queries are parameterized (no string concatenation)
   - No hardcoded secrets or patient PII in logs
   - Error handling with try/catch and proper HTTP status codes
   - TypeScript types are defined for query results
3. Run `npx next build` and report result
4. Output a verdict: **APPROVE** or **NEEDS CHANGES** with specific items
