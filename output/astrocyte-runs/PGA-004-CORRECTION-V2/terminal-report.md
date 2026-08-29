# PGA-004-CORRECTION-V2 — terminal report

All commands below ran from the isolated `fa44/Portfolio-Project` worktree or the indicated subdirectory. No `.env*` file existed in the repository/frontend root when the fail-closed smoke was run.

| Gate | Exact command | Result |
|---|---|---|
| Base | `git fetch --prune origin main codex/portfolio-astrocyte-pga-004-correction-v1` | PASS: `origin/main=3828d6d7851958f6e832896ce908c60097f67f90` |
| Rebase | `git rebase origin/main` | PASS, no conflict |
| PostgreSQL | `backend/tests/sql/run_pga004_pg15.sh` | PASS on PostgreSQL 15.19: clean, 16 legacy, guarded rollback, contaminated atomic rollback |
| Backend | `cd backend && python3.11 -m pytest -q` | PASS: 146 tests |
| Backend compile | `cd backend && python3.11 -m py_compile api.py family_office/*.py` | PASS |
| Frontend install | `cd frontend && npm install --ignore-scripts` | PASS; package lock updated for React mounted-test dependency |
| Frontend lint | `cd frontend && npm run lint` | PASS |
| Frontend types | `cd frontend && npx tsc --noEmit` | PASS |
| Frontend tests | `cd frontend && npm run test:frontend` | PASS: 9 groups, including mounted owner transition |
| Frontend budgets | `cd frontend && npm run perf:budget` | PASS: 8 budgets |
| Frontend contract | `cd frontend && npm run contract-check` | PASS |
| Frontend build | `cd frontend && npm run build` | PASS, 20 routes compiled |
| Local Supabase smoke | `env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SMOKE_KEY -u SUPABASE_SERVICE_KEY npm run smoke:supabase -- --output=/tmp/pga004-smoke-fail-closed.json` | expected FAIL-CLOSED, exit 2, no network call |
| Workflow inventory | `python3 .github/scripts/check_workflow_parity.py` | PASS: 10 workflow files |
| Workflow tests | `python3 -m unittest discover -s .github/tests -p 'test_*.py'` | PASS: 30 tests |
| Actionlint | `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck= -pyflakes= .github/workflows/*.yml` | PASS |
| Diff hygiene | `git diff --check` | PASS |
| Code-head CI | Frontend CI `33255177385`, Workflow Parity `33255177392`, Trident validate `33255177399` | PASS at `3b1d9d75cca4e8880809f047ef5313b5edb0e96c`; Production mutation skipped |

The final artifact-bearing PR head is intentionally recorded after its push in the PR description, because a tracked handoff cannot self-contain the SHA of the commit that contains itself. The independent reviewer must bind the final head from GitHub metadata before trusting this packet.
