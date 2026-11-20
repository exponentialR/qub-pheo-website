# EULA request and approved Drive delivery

## Goal
Automate request intake and scoped, named-user Drive delivery, retaining an explicit authorised administrator's
approval for every request (Seán and Sam, per Sam's correction). Preserve the existing official agreement and public
20-sample explorer. Complete implementation and verification, then configure and
pilot live delivery only with genuine backend identity and reviewer authentication.

## Context and sources
Website is Cloudflare Pages with a closed /api/* Worker; Git repo contains code
only. Full release on restricted Drive. Official agreement is the existing PDF at
https://drive.google.com/file/d/15ciZPOGSz2PM0Bd3rrlV8ZRb3WikVSV2/view . It names
Microsoft Forms signing and institutional email. Sam confirmed there is no Microsoft Forms flow: completed signed PDFs have
been handled by email. Preserve that signed-PDF process and the original document;
do not introduce a replacement click-to-sign agreement.
Drive metadata confirms current connected identity canShare the release folder.
That connector/browser session is NOT an unattended website service credential.
Current full-release folder contains video and landmark modalities: owner must
confirm the exact scope before a backend is allowed to grant its root.

Primary implementation contracts checked 20 November 2026:
- https://developers.google.com/workspace/drive/api/reference/rest/v3/permissions/create
- https://developers.google.com/workspace/drive/api/guides/manage-sharing
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Assumptions / external dependencies
Signed-PDF intake is confirmed by Sam. Institutional identity and signature
must be checked before approval; a frontend checkbox is not signature evidence.
Both Seán and Sam's nominated IEEE identity are authorised approvers, verified through a signed Access JWT
with pinned issuer and application audience, not a client-supplied email header.
A restricted Google service identity needs reader-list/share capability on only
the approved release folder(s). Its private key goes into Cloudflare Secrets,
never source or browser. No credential creation/permission expansion is assumed
complete. Existing user-specific Drive grants must be preserved.

## Acceptance criteria
- No submission, unsigned request, forged header, GET request, public sample grant,
  retry, failed delivery or anonymous caller can bypass an authorised administrator's approval.
- Approval records the reviewer, timestamp, immutable recipient, release version
  and actual agreement/signature evidence. Delivery only targets server-allowlisted
  folder IDs and uses type=user, role=reader (never anyone/domain).
- Concurrent approvals/retries converge on one request/grant; existing matching
  read access is detected; unrelated or broader grants are not downgraded/revoked.
- Drive API timeout or failure yields a recoverable delivery state, not a false
  success. Reconciliation reads permission state before reissuing a grant.
- Applicants receive only the approved release. Drive's sharing notification is
  the initial delivery email; no unrelated mail-provider dependency is introduced.
- Request documents/PII remain private; public sample assets and Git contain none.
- Production intake remains disabled until signing mode, reviewer auth, bot
  protection, storage ownership and Drive credentials/scope are configured.
- A real live request -> Sam/Seán approval -> correct named-user grant -> notification
  is required before claiming live automation complete.

## Architecture / initial execution path
Keep one small Cloudflare Worker backend and a private D1 ledger. Use platform
Web Crypto and fetch (no framework). Scope and agreement are server configuration.
Implement authenticated review and Drive service adapter first, independent of
signing UX. Then adapt intake to the confirmed existing signing mechanism.
Use private D1 BLOB storage for small uploaded signed PDFs for the confirmed signed-PDF process; avoid a separate object-store service at low volume. Bound PDF <=1MB,
well under D1's 2MB row limit. Intake requires server-validated Turnstile and exact
origin. An opaque receipt token permits minimal request status without exposing
other applicants. It is not an access grant. Never collect production records
while prerequisites are missing.

## Non-goals
Automatic eligibility/approval, public Drive links, changed EULA, moving the full
dataset, raw-archive distribution, applicant subscription, paid e-signature or
email provider. No real requests/emails/grants used as fixtures.

## Verification strategy
Use generated RSA keys to test JWT signature/issuer/audience/expiry/reviewer
checks. Run actual SQLite schema/state integration tests using Node's SQLite
runtime where available. Fake only external Drive HTTP boundaries: exercise
create, existing access, failure, retry/reconcile, pagination and concurrency.
Keep original viewer tests passing. Browser-test request/review UI only after
backend contracts exist; verify unconfigured endpoints fail closed. Later live
pilot is explicitly dependent on owner-provided credentials and an authorised administrator’s review.

## Self-critique and refinement
Initial weakness: a form plus automatic sharing could falsely treat submission
or a checkbox as a signed agreement and silently grant a mutable folder root.
Revision: signing mode is a required source of evidence, approval is a separate
authenticated transition and release scope is configured/verified before activation.
Second weakness: retries after unknown Drive outcome can duplicate grants or
claim success too soon. Reconcile existing permission and use atomic request
state transitions, with explicit delivery errors and audit events. Keep initial
notifications on Drive rather than add an unconfigured paid mail service.
Remaining dependencies: private Access setup, restricted Google service credentials
and activation/pilot verification. Signing mode and both administrator roles are confirmed.
Scores /10: correctness 9, alignment 9, completeness 8, architecture 9,
simplicity 8, feasibility 8 (external setup pending), testability 9,
observability 9, security 9, reversibility 8, dependency risk 8, feedback speed 9.
Implementation can proceed; live activation cannot be asserted yet.

## Progress / re-plan checkpoints / decisions / final state
- [x] Existing source, official EULA and Drive sharing capability inspected.
- [x] Approval/Drive backend, append-only audit and 38 passing tests.
- [x] Signed-PDF intake and admin UI browser-tested using fixture-only services.
- [x] Sam approved the scoped setup.
- [x] Private D1/schema/binding, two-person Access policy and Google identity/folder grant configured.
- [x] Disabled backend deployed; anonymous admin/API gates and public fallback verified.
- [ ] Google private key, Turnstile and rate secret configured; runtime verified.
- [ ] Live pilot approved by an authorised administrator and verified.
Not complete: no real application records collected or applicant permissions granted. The approved delivery identity now has the explicitly authorised Editor role on the release folder.

## Implementation and verification checkpoint
User clarified signed PDFs are the current process and explicitly gave Sam the
same approval/admin rights as Seán. Actual identities are supplied privately at
activation; fixtures and examples do not hard-code their addresses. The official
unsigned PDF is preserved byte-for-byte, SHA-256 in config/agreement.json. Its
legacy Forms wording is not silently edited; the operational flow follows Sam's
confirmed existing PDF process.

Implemented public request/receipt UI, private review dashboard, signed-PDF
download/hash, both-admin JWT checks, approval-to-Drive delivery, scoped retries,
append-only audit triggers and stable paginated audit export. Recipient/release/
agreement/evidence hashes immutable after submission. Existing individual Drive
permissions preserved; no anyone/domain grants. Submission idempotency and a
release delivery lease prevent duplicate/concurrent in-app mutations. Unknown
Google outcomes are reconciled by listing permissions before another create.

One build-only esbuild dependency bundles the Worker; no runtime framework or
mail provider. Source-hash manifest prevents deploying a stale Worker. Node 24
SQLite integration tests exercise actual schema, triggers and transactions; only
external Google/Turnstile/JWKS boundaries are fixtures. Browser simulation confirms
pending -> checked approval -> simulated grant, PDF download and audit export;
mobile dashboard has no horizontal overflow. No real request, permission or mail
was used as a fixture.

Cloudflare inspection: existing Pages project has no backend variables/bindings.
D1 account reports ~659 kB used against 5 GB storage and $0 billable D1 usage.
Initial request cap is 250 stored requests, PDFs <=1 MB; maintain free storage
headroom and review retention/export before raising it. Scoped setup was subsequently approved and private resources created. See the
20 November setup checkpoint in access-operations.md for the exact remaining work.

Anti-bloat review: reuse Pages, platform fetch/Web Crypto, D1 for private small
PDFs, Drive's own sharing email and the current EULA. No R2, e-signature vendor,
new email service, auto-approval engine or full dataset migration. Dashboard
requires human signature/identity review. Audit is append-only through the app
and SQL triggers, not tamper-proof against infrastructure owners. Public sample
playback remains static and unchanged.

### Live verification refinement
The saved private key cannot be read back from Cloudflare. To verify it without
creating a test applicant or granting data access, add a private, same-origin
POST connection check. It authenticates to Google, reads only the configured
folder and its ACL, reports broad-sharing/service-role metadata and records the
check in the existing ledger. The dashboard exposes a single explicit check
button. No test grant, credential echo or public diagnostics endpoint.
Criticism resolved: saved-secret presence alone does not establish valid Google
authentication or actual sharing capability. Remaining uncertainty: real pilot
delivery and Seán’s own sign-in. Correctness/alignment/security 9/10, simplicity
and verification 8/10; reuses existing auth, Drive adapter and audit store.

### Real sign-in regression and runtime fix
Sam completed the Access OTP. The edge gate admitted him, but the application
returned an authentication error. Safe stage diagnostics isolated `AUTH_KEY_FETCH`.
Current Cloudflare runtime documentation confirms `redirect: 'error'` is not
implemented and throws a TypeError before the request is sent. Node/mock tests
had accepted it, exposing a gap in runtime-contract coverage.

Replace that mode with `manual` for JWKS, Google OAuth/Drive and Turnstile calls;
existing response checks reject redirects. Do not follow credential-bearing
redirects, accept unverified identity headers or weaken JWT validation. Preserve
bounded diagnostic codes without exposing tokens/claims/secrets. Added regression
coverage verifies the supported request mode and rejection of redirect responses.
43 tests pass. Live sign-in/connection verification follows deployment.
Source: https://developers.cloudflare.com/workers/runtime-apis/request/
