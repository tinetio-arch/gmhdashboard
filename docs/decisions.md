
## 2026-05-19 — PINS doc sync-gate text patched; Cowork user_preferences still needs manual edit

Commit `64b3c31` patched `docs/CLAUDE_MEMORY_PINS.md` to reflect the actual final state of the Healthie sync gate after commit `9797915` removed the allowlist. Phils Cowork user_preferences (his Mac-side user prefs in Claude desktop) still has the equivalent stale paragraph and must be updated manually by Phil — it cannot be edited from the EC2 box.

The user_preferences paragraph to update is the one mentioning "NowMensHealth.Care + NowPrimary.Care reach ensureHealthieClientId" — replace with the same Phase 6 final-state language now in PINS.
