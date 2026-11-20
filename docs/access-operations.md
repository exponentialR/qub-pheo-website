# Access workflow: deployment and operations

## Current status
Implemented and locally verified; **not live-activated**. Existing email handling
remains the fallback. Do not claim unattended delivery until an actual approved
pilot confirms reviewer sign-in, the correct Drive ACL and notification.

```mermaid
flowchart LR
    A[Signed PDF request] --> B[Private D1 record and PDF hash]
    B --> C[Admin dashboard]
    D[Cloudflare Access: two approved identities] --> C
    C -->|Human approval| E[Named-user Drive reader grant]
    E --> F[Google sharing email and private receipt link]
    C --> G[Append-only audit events]
    E --> G
    E -->|Unconfirmed outcome| H[Reconcile permission and retry]
```

Applicants upload their existing signed PDF; a checkbox is not a signature.
Institutional email eligibility and the agreement are manually reviewed by an
administrator. There is no automatic identity/eligibility decision. Public request
rate limits and Turnstile protect storage; no applicant email provider is needed.
New requests are reviewed in the dashboard. Drive sends its sharing notification
on new grants; an existing grant is preserved without re-sending that invitation.
The private receipt supplies the actual approved folder link after delivery.

## Resources and credentials

Use the existing Cloudflare Pages project. Bind one private D1 database as
`ACCESS_DB`, applying `migrations/0001_access.sql` to a **new, empty** database.
For an existing database, inspect schema and take a backup before migration; do
not drop/recreate records or audit tables.

Protect production `/admin*` and `/api/review/*` with the **same** Cloudflare Access
application/audience and an exact two-address allowlist for Sam and Seán. Include
the clean `/admin` route: Pages can canonicalise `.html` URLs. Existing Preview
Access settings alone do not protect production. Access's own email OTP/approved
identity provider supplies sign-in; no app passwords or frontend admin flags.

Create a dedicated Google service account with Drive API enabled, no billing
upgrade and **no project-wide Drive delegation**. It must be given sharing-capable
access only to the approved release folder. For a personal Drive folder this
requires a write-capable role, which also permits content edits: obtain explicit
owner approval for that boundary. The application itself only lists metadata and
creates named-user reader permissions. Do not share the raw archive or a personal
Drive root with this identity. Store its key only in Cloudflare Secrets. Never
paste credentials into Git, deployment ZIPs, chat, screenshots or command flags.

Confirm the configured folder is the intended consented split-video/landmark
release. Sharing a folder includes current/future children; maintain that folder
as a controlled release. `RELEASE_ID` labels the reviewed scope; the application
does not turn a mutable folder into an immutable snapshot.

## Runtime configuration

| Binding/variable | Purpose |
| --- | --- |
| `ACCESS_DB` | Private D1 binding with the migration applied |
| `PUBLIC_ORIGIN` | Exact production origin, without trailing slash |
| `ACCESS_ISSUER` | `https://<team>.cloudflareaccess.com` |
| `ACCESS_AUDIENCE` | Audience of the private admin application |
| `APPROVER_EMAILS` | Exact comma-separated Sam/Seán addresses, server-side only |
| `RELEASE_ID` | Approved release version label |
| `DRIVE_FOLDER_ID` | Only the approved consented release folder |
| `GOOGLE_CLIENT_EMAIL` | Restricted Google service identity |
| `GOOGLE_PRIVATE_KEY` | Secret PKCS8 private key, not source configuration |
| `TURNSTILE_SITE_KEY` | Production widget restricted to the website hostname |
| `TURNSTILE_SECRET_KEY` | Secret for server-side Siteverify |
| `INTAKE_RATE_SECRET` | Secret random 32+ bytes, used for receipt/rate protection |
| `SCOPE_CONFIRMED` | `true` only after the owner checks release scope |
| `DELIVERY_ENABLED` | `false` until real credentials and sharing scope verified |
| `REQUESTS_ENABLED` | `false` until private review and delivery are ready |

All activation flags default closed. No real applicant data is accepted while
prerequisites are missing. The 20 public examples remain independent of these
flags and cannot grant Drive access.

The unsigned official EULA snapshot is public, byte-for-byte preserved, pinned in
`config/agreement.json`. Uploaded signed copies are private database BLOBs with
separate SHA-256. To change the official version, import the authorised new PDF,
update version/hash/URL and rebuild. Old-version approvals stop under the new
policy. Do not silently edit terms or claim to verify signatures automatically.

## Build and package

```bash
npm ci
npm test
npm run build:worker
python scripts/package_public_portal.py --source /path/to/verified-web-v1 --out dist
```

The Worker build is bundled once; deployment has no Node/npm runtime dependency.
The package verifies the bundle and every source input hash before including it.
Only declared public files, blank EULA and the 20 approved sample payloads are
packaged. No private request records, signed PDFs, migrations, fixtures or keys.

## Verification and activation order

1. Apply the private database schema; configure Access and bot protection.
2. Enter secrets directly in the service. Keep both activation flags false.
3. Sign into the admin page as each real authorised identity. Confirm that an
   anonymous caller and another signed identity cannot list requests or PDFs.
4. Confirm the service account can share only the intended release scope. Do not
   test by making the dataset public or inviting a fake external email.
5. Enable delivery and requests deliberately; run one genuine owner-approved
   pilot. The human reviewer must check its signed PDF and institutional identity.
6. Verify Google permission ID, recipient, reader role, expected folder, sharing
   notification and private receipt. Record pilot evidence without exposing data.

Creation of a Google permission is confirmed; inbox receipt is not guaranteed by
an HTTP success. A failed or ambiguous operation is recorded for reconciliation.
Changing a recipient requires a new reviewed request; there is no edit-and-switch
path after approval. Approved deliveries are serialised per release. An expired
claim can be recovered after five minutes; external calls have shorter deadlines.

## Audit, privacy and recovery

Audit records capture claimed applicant vs authenticated administrator identity,
UTC time, signed-file and agreement hashes, review note/checks, release, attempts,
permission ID, preserved existing grants, failures, retries and document/export
access. SQL triggers reject audit edits/deletes and changes to request identity or
evidence. The audit export paginates a fixed ID snapshot; no silent history cutoff.
Database/account owners can still change infrastructure, so this is **not** WORM
storage or a claim of tamper-proof non-repudiation. Keep controlled external audit
backups as required by the institution; no copies belong in this public repository.

Signed PDFs are served only to authenticated administrators as no-store attachment
downloads and checked against stored hashes. Receipt tokens expose status and,
only after delivery, the approved Drive link; actual access still requires the
recipient's Google identity. No raw IP is stored; daily rate buckets use a secret
salt. The initial cap is 250 stored requests / 1 MB each, not an unlimited archive.
Plan retention and export privately before raising that cap.

Pausing intake does not revoke existing Drive grants. Removing a Drive permission
must be a separate explicitly authorised operation; this workflow never deletes
or downgrades pre-existing access. Already-downloaded data cannot be recalled.

## Safe local demonstration

```bash
npm run dev:access
```

Open http://127.0.0.1:8770/request.html and `/admin.html`. The loopback-only helper
uses in-memory SQLite, ephemeral fixture keys and simulated external responses.
It never calls Google or sends emails and is not bundled/deployed. Use fixture
identities/documents only. It deliberately auto-authenticates a **local fixture**
administrator to exercise the UI; production has no such bypass.
