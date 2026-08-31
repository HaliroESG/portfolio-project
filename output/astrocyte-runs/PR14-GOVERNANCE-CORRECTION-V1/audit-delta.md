# ASTROCYTE PR14 governance correction — audit delta

Generated: `2026-08-31T11:39:35Z`

## Authority and immutable subjects

- Controller thread: `01a048fb-6d82-7363-be6a-781ed87229b0`
- Workstream: `portfolio-astrocyte-pr14-governance-correction-v1-01a04e52`
- Required base and PR14 squash merge: `a3d07b1d9184a0a7f4ee4f750d2e43b5f8a3bd2f`
- PR14 final head: `bd1bd27330031fa990993f8537865c2e2e3bfb43`
- PR14 final tree: `074b71dffbc508bb32efb6699c663006d9bbbd00`
- Correction code commit: `333e24a0f01deaf811031afc5a3318c1a8df382e`
- Correction code tree: `48e408b1544c445bfe0c7d1463063ad8deee00c4`
- Governance-Preview correction commit: `e6b93e53b9a0769ee276784cf937daf31517de55`
- Governance-Preview correction tree: `de5ac2c397afdf1f48d2230d232759fd0959b938`
- Independent review: `FAIL / FIX_FIRST`; review SHA-256 `2100a8a73ce9bade8e2c69d2880731853ae85286a8d52847f159c16a17b8abdd`; handoff SHA-256 `9c960380525f963ee5c507f507ebebb5e814579c1a95bcce0a51cf2c1d15850a`.

## Expected and actual impact

- Backend writes: none. No backend source or runtime write changed.
- Supabase schema/data: none. No migration, SQL execution, provider call, project configuration, or credential access.
- Frontend typed reads/UI: none. No frontend source or type changed.
- Repository governance: an exact PR14 release hold, stable all-PR validation contexts, a trusted default-branch independent-review status emitter, full-history scheduled validation, adversarial tests, and versioned desired branch-protection contract.

## Corrective delta

1. Bind an ACTIVE Family Office release hold to the exact PR14 head/tree/merge and sealed `FAIL / FIX_FIRST` review. The Production job and direct mutation verifier stop on that hold before authorization; the workflow still ends at explicit HTTP 503 and contains no provider command.
2. Run `Family Office / validate`, `Family Office / prepare`, and `Trident / validate` on every PR. Prepare always materializes and fails when validate did not pass, avoiding a missing/skipped downstream required context.
3. Emit `ASTROCYTE Independent Review` from a `pull_request_target` verifier loaded only from the trusted default branch. It accepts only a current exact-head native approval by a human OWNER/MEMBER/COLLABORATOR distinct from the author; stale, self, bot, outsider, label, comment, and current changes-requested cases fail closed.
4. Version the desired main-protection contract without applying GitHub configuration. Required contexts must be source-bound to the GitHub Actions app; its numeric app ID remains a separate controller resolution.
5. Fix the scheduled heartbeat checkout to `fetch-depth: 0`, closing the reproducible PR12 pinned-object failures observed after PR14 merge.
6. Preserve the bootstrap boundary: the new default-branch verifier cannot attest its own introducing PR. This draft requires separate manual independent review at its exact final head.
7. Correct the Vercel evidence boundary: the initial PR head triggered automatic `frontend` and `quant-terminal-ui` Preview deployments. Static Git configuration at the repository root and `frontend/` disables deployments only for `codex/*governance*` branches; all unspecified branches retain the Vercel default.

## Explicit non-delta

- No PR12 modification or merge.
- No branch-protection, environment, secret, variable, Supabase, or Production configuration.
- No workflow dispatch, provider runtime access, Preview URL access, migration, Production deployment, activation, rollback, or merge.
- Two automatic Vercel Preview deployments on the prior PR head are explicitly recorded. No agent called Vercel to create, promote, inspect, or open either Preview. The only Vercel change in this correction is the branch-bounded static Git configuration committed in this repository.
- No claim that repository contracts are already required on `main`.
