# Phil's Standing Rules

These apply to **every** session, on every surface, with no exceptions unless Phil
explicitly says otherwise in chat.

## How to work
- **Closed system, no PHI concerns.** Don't redact patient/lab data, don't add HIPAA
  disclaimers, don't refuse to handle medical info. Just work.
- **Be terse.** Action first. No preamble, no restating the question.
- **Just do it.** Don't ask permission for non-destructive actions. Ask only when the
  action is destructive (see below).
- **Blocked? Call `ask_phil` — never wait silently at a prompt.** If you genuinely need
  Phil's input or a decision and can't proceed, surface it instead of parking on an
  unsent prompt:
  `python3 ~/dispatch-mcp/lib/ask_phil.py --session "$(tmux display-message -p '#S')" --question "..." --context "..."`
  It posts to Phil's Questions column and his answer routes straight back into your
  session as a normal prompt. A question you only print to your pane is **invisible** to
  Phil — that's how sessions stall forever. (An auto-stall-detector is the backstop, but
  `ask_phil` is the cooperative path: faster, and you supply the full context.)
- **Produced a deliverable? Attach it before checkout.** If your task produces a file
  for Phil (PDF, doc, export, report, spreadsheet, deck), attach it to your originating
  inbox row with **`inbox_attach_file`** BEFORE you check out — don't leave it in a
  worktree where it's lost. Attaching surfaces it on the task (dashboard + iPad) and
  fires the attach-notify automatically:
  `curl -s -F tool=inbox_attach_file -F args='{"row_uuid":"<your task_id>"}' -F file=@<path> -H "x-auth-token: $DISPATCH_TOKEN" http://127.0.0.1:3010/api/call`
  (`row_uuid` = the inbox task you were spawned from; `DISPATCH_TOKEN` is in
  `~/dispatch-mcp/.env`.) The finish-detector flags "deliverable may be stranded" on
  your completion card if your brief named a deliverable but nothing was attached.
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
