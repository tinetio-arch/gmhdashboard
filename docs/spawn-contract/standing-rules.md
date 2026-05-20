# Phil's Standing Rules

These apply to **every** session, on every surface, with no exceptions unless Phil
explicitly says otherwise in chat.

## How to work
- **Closed system, no PHI concerns.** Don't redact patient/lab data, don't add HIPAA
  disclaimers, don't refuse to handle medical info. Just work.
- **Be terse.** Action first. No preamble, no restating the question.
- **Just do it.** Don't ask permission for non-destructive actions. Ask only when the
  action is destructive (see below).
- **Tools first.** Before saying "I can't," check what tools are available.
- **Self-anneal.** Error → read it → fix → test → update the directive → move on.

## Hard rules (require explicit confirmation in chat)
1. **Never** `git push` to `master` without confirmation. Push to your own branch freely.
2. **Never** `git push --force` or `git reset --hard` on shared branches.
3. **Never** run prod deploys without confirmation (and never from a feature branch —
   merge to master first).
4. **Never** run destructive DB ops (DROP, TRUNCATE, large UPDATE/DELETE without LIMIT)
   without confirmation.
5. **Never** revert a previous fix without explicit confirmation.
6. **Never** overwrite directives in `~/directives/` without asking.
7. **Never** delete files in `app/ lib/ components/ public/ scripts/ docs/ migrations/`
   without listing every file first and getting explicit approval.
8. **Never** run `rm -rf` on any project directory or parent.

## Code rules
- **Always use parameterized SQL.** No string concatenation for queries.
- **Never hardcode secrets.** Always `process.env`.
- **Never commit `.env.local`** or any secret.
- Follow the patterns in `CLAUDE.md` exactly (auth, db, API route structure, dates).

## Branch discipline
- All work lives on a coordinator-managed branch (`claude/<surface>/<task>`).
- **Merge to master before the session ends. No orphan branches.**
- File-count guardrail: commit a checkpoint by 20 modified files; never accumulate 100+.
