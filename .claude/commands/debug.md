# Debug Command

Investigate a bug using the systematic DEBUG protocol.

## Usage
```
/debug [error message or description of the problem]
```

## Steps

1. **Search** for the error in the codebase using Grep
2. **Read** only the file(s) where the error originates
3. **State hypothesis** before writing any fix
4. **Apply minimal fix** — do not refactor unrelated code
5. **Verify** with build check and endpoint test
6. **Document** with a `// FIX(date): description` comment

## Rules
- Do NOT read ANTIGRAVITY_SOURCE_OF_TRUTH.md (213KB)
- Do NOT read snowflake.log (31MB)
- Do NOT refactor while debugging
- Fix ONE bug at a time
- Always run `npx next build` after fixing
