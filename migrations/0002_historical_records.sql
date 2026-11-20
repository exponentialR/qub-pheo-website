CREATE TABLE historical_records (
 id TEXT PRIMARY KEY,
 applicant_name TEXT NOT NULL,
 recipient_email TEXT,
 institution TEXT,
 document_date TEXT,
 approved_by TEXT NOT NULL,
 approval_date TEXT,
 shared_by TEXT NOT NULL,
 sharing_date TEXT,
 source_reference TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 original_filename TEXT NOT NULL,
 signature_sha256 TEXT NOT NULL UNIQUE,
 signature_bytes BLOB NOT NULL,
 imported_by TEXT NOT NULL,
 imported_at TEXT NOT NULL
);
CREATE TRIGGER historical_no_update BEFORE UPDATE ON historical_records
BEGIN SELECT RAISE(ABORT,'Historical records are immutable; corrections need new evidence'); END;
CREATE TRIGGER historical_no_delete BEFORE DELETE ON historical_records
BEGIN SELECT RAISE(ABORT,'Historical evidence cannot be deleted through the application'); END;
