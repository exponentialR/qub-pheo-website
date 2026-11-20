CREATE TABLE IF NOT EXISTS access_requests (
 id TEXT PRIMARY KEY,
 recipient_email TEXT NOT NULL,
 applicant_name TEXT NOT NULL,
 institution TEXT NOT NULL,
 intended_use TEXT NOT NULL,
 release_id TEXT NOT NULL,
 agreement_version TEXT NOT NULL,
 signature_reference TEXT NOT NULL,
 signature_sha256 TEXT,
 signature_bytes BLOB,
 receipt_hash TEXT UNIQUE,
 submission_key TEXT UNIQUE,
 agreement_sha256 TEXT,
 status TEXT NOT NULL CHECK(status IN ('pending','denied','approved','delivering','delivered','delivery_error')) DEFAULT 'pending',
 created_at TEXT NOT NULL,
 reviewed_at TEXT,
 reviewer_email TEXT,
 review_note TEXT,
 delivery_claim TEXT,
 delivery_started_at TEXT,
 permission_id TEXT,
 granted_folder_id TEXT,
 existing_permission INTEGER,
 delivery_error TEXT,
 delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS access_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id TEXT REFERENCES access_requests(id),
 event TEXT NOT NULL,
 actor TEXT NOT NULL,
 actor_kind TEXT NOT NULL DEFAULT 'reviewer',
 details_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS access_status_created ON access_requests(status,created_at);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON access_events BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON access_events BEGIN SELECT RAISE(ABORT,'Audit events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS request_identity_immutable BEFORE UPDATE ON access_requests
WHEN NEW.recipient_email != OLD.recipient_email OR NEW.release_id != OLD.release_id OR NEW.agreement_version != OLD.agreement_version OR NEW.signature_reference != OLD.signature_reference OR NEW.signature_bytes IS NOT OLD.signature_bytes OR NEW.signature_sha256 IS NOT OLD.signature_sha256 OR NEW.agreement_sha256 IS NOT OLD.agreement_sha256
BEGIN SELECT RAISE(ABORT,'Request identity and signed evidence are immutable'); END;
CREATE TABLE IF NOT EXISTS intake_rate_buckets (bucket TEXT PRIMARY KEY,day TEXT NOT NULL,count INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS release_delivery_locks (release_id TEXT PRIMARY KEY,claim TEXT NOT NULL,expires_at TEXT NOT NULL);
