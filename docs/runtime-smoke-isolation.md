# Browser smoke isolation

PR30's automatic frontend smoke runs on matching pull requests and main pushes.
It has no Supabase/GitHub credential environment, uses a literal local URL and
placeholder anonymous key, and rejects Next runtime environment files before
installation/build. Dependency and public font downloads remain online; these
steps do not receive provider credentials. This is an offline **runtime test**,
not an air-gapped package installation or build.

The production-built Next server and existing Playwright smoke run together in a
new Linux network namespace (`unshare --net`). Only loopback is enabled. Browser,
service worker, DNS and server-side requests cannot leave that namespace. The
runner refuses other interfaces or non-placeholder Supabase configuration; it
stops its child server on success, failure or interruption. The workflow fails if
namespace isolation is unavailable: there is no network-enabled fallback.

The existing nine routes and desktop/mobile checks remain unchanged. A fresh
unauthenticated browser may correctly reach the owner login page. This qualifies
page rendering/auth redirects and layout, not authenticated portfolios, financial
numbers, live data, or Production operation. No fabricated market/portfolio data
are passed off as live results.

The original connected job is retained only for `workflow_dispatch` with
`allow_real_runtime=true`. The default is false (offline), and enabling that
choice requires separate runtime authority. This change does not dispatch it,
change secrets/protections, deploy, or grant source/transaction authority.

Validation: workflow guard tests and runner fail-closed/lifecycle tests are offline.
The namespace integration runs in Ubuntu CI; macOS cannot execute Linux unshare.
A local macOS network-denied smoke can qualify the unchanged browser assertions,
but is not evidence of the Linux namespace execution.
