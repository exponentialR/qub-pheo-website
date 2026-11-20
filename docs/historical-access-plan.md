# Historical EULA records

## Goal
Import the four signed forms selected by Sam into the private dashboard, preserving
original bytes/filenames and document dates. Record Sam’s explicit statement that
Seán approved them and Sam shared the data. Never issue new access invitations.

## Context and assumptions
The live Pages Worker uses Access JWT authentication, private D1 PDF storage and
an append-only access_events ledger. Current intake/delivery remain live. Four
original email attachments were downloaded from the exact Outlook message Sam
selected; the connector cannot find that message. This is a forwarded bundle dated
20 November 2026, not evidence of original approval/sharing timestamps. Names and
form dates are readable; the supplied forms contain no email or institution.
Signed files and extracted data stay outside Git and public deployment assets.

## Acceptance criteria
- Four distinct historical records, each with byte-identical downloadable PDF,
  original filename/hash, name and document date.
- Seán as reported historical approver; Samuel as reported historical sharer.
  Dates unsupported by evidence remain null and display “Unknown”.
- Actual importer identity/time are separate, authenticated and audited. Import
  never manufactures an old authenticated approval event or a Drive permission.
- Both admins can read the records; anonymous callers cannot. Reimports cannot
  duplicate or silently overwrite records. No public receipt token is created.
- New request/approval/Drive paths retain existing behaviour and security.

## Non-goals
Guessing emails/institutions, deriving grant dates from PDF metadata, changing
signed PDFs, historical reapproval, new invitations, or unrelated mailbox search.

## Execution and verification
Use an additive historical_records table with nullable missing contact fields,
immutable PDF/metadata and hash uniqueness; reuse the current audit ledger with
historicalId in event details. Avoid rebuilding the live request schema/status
constraint or representing these as newly delivered requests. Add private bounded
upload/list/detail/evidence routes and a dashboard import form/history section.
Use the existing combined 250-document capacity budget and 1 MB PDF limit.
Apply migration to the real database without modifying existing rows, deploy the
verified full public package, import four forms through Sam’s authenticated UI,
and verify list/detail/download hashes and audit export. Test actual SQLite,
duplicate/concurrent imports, private evidence, missing dates, capacity and the
absence of any Google call. Browser-check the real dashboard and public form.

## Critique and refinement
Strongest criticism: fitting historical records into live request rows would
force invented emails and make attested past sharing look like a new automated
permission grant. Revision: a distinct additive archive table with nullable
contact fields, while reusing auth/storage/audit/UI conventions. Second criticism:
forwarding and import dates could be mistaken for original approval dates.
Revision: document/source/import/approval/sharing dates are separate and null
unless evidenced; approver/sharer assertions explicitly attributed to Sam.
Remaining uncertainty: original email contacts and approval/sharing timestamps
are unavailable in the supplied forms. This does not block an honest archive.
Scores /10: correctness 9, alignment 9, completeness 9, architecture 9,
simplicity 8, feasibility 9, testability 9, observability 9, security 9,
reversibility 8 (additive schema; immutable records), dependency risk 9,
feedback speed 9. No new service or dependency.

## Progress and final state
- [x] Exact source message and four original PDFs retrieved privately.
- [x] Form names/dates visually inspected; missing contact fields identified.
- [x] Additive schema, private APIs and dashboard implemented; 52 tests pass.
- [x] Fixture-only local browser import verifies unknown fields, attribution and no delivery actions.
- [x] Production additive table and both immutability triggers installed/read back.
- [ ] Production migration/deployment and four-record import verified.
- [ ] Download hashes, audit provenance, source exclusions and live flow checked.

One supplied PDF emits two flate-stream warnings during text extraction. Its original
is preserved and the name/date page is visually readable; retain this note rather
than silently rewriting the signed evidence. No automatic signature-validity or
legal approval claim is made.
