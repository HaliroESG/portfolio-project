# Independent review handoff

## Review object

- Branch: `codex/astrocyte-pr14-governance-correction-v1`
- Exact base: `a3d07b1d9184a0a7f4ee4f750d2e43b5f8a3bd2f`
- Governance code commit: `333e24a0f01deaf811031afc5a3318c1a8df382e`
- Governance code tree: `48e408b1544c445bfe0c7d1463063ad8deee00c4`
- Evidence commit: the later draft-PR head containing this sealed directory.
- PR14 subject: head `bd1bd27330031fa990993f8537865c2e2e3bfb43`, tree `074b71dffbc508bb32efb6699c663006d9bbbd00`, merge `a3d07b1d9184a0a7f4ee4f750d2e43b5f8a3bd2f`.
- PR14 review: `FAIL / FIX_FIRST`, hashes recorded in `receipts/pr14-ci-reseal.json`.

## Reviewer checks

1. Verify the PR base/head/tree and every changed path; confirm only two commits exist above the exact base.
2. Confirm the hold is exact, ACTIVE, immutable without a separate reviewed change, and runs before HMAC/anti-replay/provider prerequisites both in the workflow and direct Family Office verifier path.
3. Confirm Family Office validate/prepare and Trident validate run on every PR with stable names; prepare must fail, not disappear or pass, when validate fails.
4. Confirm the independent-review workflow is loaded from the default branch, never checks out or runs PR code, accepts only native exact-head independent human approval, blocks current exact-head changes requests, and ignores labels/comments/bots/self/stale reviews.
5. Confirm future required contexts must be GitHub-Actions-app-bound and that this change does not modify branch protection or auto-approve anything.
6. Confirm the bootstrap limitation: the new workflow cannot attest this introducing PR. Require separate manual review of the exact final head.
7. Verify PR14 exact-head/post-merge CI receipt and the disclosed scheduled shallow-checkout failures plus their bounded `fetch-depth: 0` correction.
8. Re-run Actionlint, all `.github` tests, backend/frontend applicable checks, hold refusal, and the security delta.

## Known honest limitations

- The draft PR's automatic independent-review context cannot exist until the trusted workflow is on `main`; absence on this introducing PR is expected, not PASS.
- Desired branch protection is versioned but remains `NOT_CONFIGURED_BY_THIS_CHANGE`.
- Canonical Turbopack build was blocked locally by the host's port-bind policy; the Webpack production build passed and GitHub CI must run the canonical build.
- The security workbench snapshot changed during remediation; the final code commit has a separately documented exact-code delta validation.

## Exact next action

Perform a fresh, read-only independent review of the draft PR at its exact final head. Do not merge, dispatch, configure GitHub/Production, access any provider, deploy, activate, or clear the release hold.
