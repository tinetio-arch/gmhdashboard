# docs/archive/ — Completed-work archive

This directory holds **completed** project sections from `docs/PROJECT_TRACKER.md`. The main tracker shows active work only; everything that is done lives here, grouped by month.

## The rule

When a project, phase, or task in `PROJECT_TRACKER.md` is **DONE**:

1. Cut the section (header + body) out of `PROJECT_TRACKER.md`.
2. Append it to `docs/archive/completed-YYYY-MM.md` for the month it was completed in. Create the file if it doesn't exist.
3. At the top of the moved section, add a "Completed: YYYY-MM-DD — `<short reason or commit ref>`" line so future readers can trace it.
4. Commit both the deletion and the archive append in the same commit (`docs(archive): YYYY-MM <section name>`).

A section is "DONE" when:
- All listed phases are complete AND there are no pending pre-deployment steps AND the code is merged to master AND it has been observed running in production for at least one cron cycle (or one acceptance-test pass) without regression.
- OR the project has been formally cancelled / superseded (note which other project supersedes it).

## Why archive, not delete

- Preserves history for postmortems, audits, and "why did we do X" questions.
- Keeps `PROJECT_TRACKER.md` small enough to be useful (auto-refresh script keeps the live snapshot but doesn't prune manual sections — that's the human's job).
- Lets us grep across months: `grep -r "BioSCOPE" docs/archive/`.

## File-naming convention

`completed-YYYY-MM.md` — one file per calendar month. Newest at the top of the file.

## What does **not** belong here

- Live status snapshots (they live in `PROJECT_TRACKER.md` between the AUTOGEN markers).
- Drafts of in-progress work (keep them in the main tracker until they ship).
- The SOT modules (`docs/sot-modules/`) — those are reference, not tracker entries.
- Bug postmortems unconnected to a tracker section — put those in the SOT recent-changes module (`06-recent-changes.md`) or the changelog.
