# tmux vs Cowork — Capability Matrix

The two spawn surfaces have **different capabilities**. Know which one you are (the
injected preamble tells you) and stay inside its column.

| Capability                         | tmux (on-box) | Cowork (cloud) |
|------------------------------------|:-------------:|:--------------:|
| Read/edit the repo                 | ✅            | ✅             |
| `claude-coord` (checkin/claim/log) | ✅ required   | ❌ unavailable |
| Live RDS via `psql`                | ✅            | ❌             |
| PM2 / service restart              | ✅ behind gate| ❌             |
| Deploy to prod                     | ✅ behind gate| ❌ never       |
| On-box secrets (`.env.local`)      | ✅            | ❌             |
| `pre-deploy-check.sh` / health     | ✅ runs them  | ❌             |
| Finish by                          | merge→debug→checkout | open a PR |

**Rule of thumb:** if it touches the live box (DB, services, deploy, coordinator),
it's tmux-only. A Cowork session's deliverable is a **reviewable PR**, never a deploy.
