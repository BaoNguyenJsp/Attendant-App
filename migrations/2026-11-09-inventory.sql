-- Warehouse (Kho) tables. Same definitions as schema.sql; test/schema.test.mjs keeps the two in step.
-- Adds the tables to a database that already holds data:
--   npx wrangler d1 execute DB --remote --file=migrations/2026-11-09-inventory.sql
-- Users are named by text (ByName) and not by a foreign key: a user may be deleted or re-imported.

-- RETURNABLE: Total = units owned, Total - Available = units out on loan.
-- CONSUMABLE: Available = what is left, Total = the highest stock level reached, for the percent left.
-- Codes are made from the kind: MT-001 (mượn - trả), HP-001 (hao phí). Photos live in Google Drive under
-- <DriveFolderId>/Warehouse/<Code>; PhotoFileId is the Drive file id.
CREATE TABLE IF NOT EXISTS Locations (
  Id   INTEGER PRIMARY KEY,
  Name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS Items (
  Id          INTEGER PRIMARY KEY,
  Code        TEXT NOT NULL UNIQUE,
  Name        TEXT NOT NULL,
  Kind        TEXT NOT NULL CHECK (Kind IN ('RETURNABLE', 'CONSUMABLE')),
  LocationId  INTEGER REFERENCES Locations (Id) ON DELETE SET NULL,
  Note        TEXT,
  Total       INTEGER NOT NULL DEFAULT 0 CHECK (Total >= 0),
  Available   INTEGER NOT NULL DEFAULT 0 CHECK (Available >= 0 AND Available <= Total),
  PhotoFileId TEXT,
  CreatedAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy   INTEGER
);

-- A request (phiếu mượn / xuất) of one or more items. PENDING -> ON_LOAN (approved, returnable items out)
-- -> CLOSED (returned). Approved with consumables only goes straight to CLOSED. REJECTED = refused or cancelled.
-- Stock changes only at approval and at return. Closed and rejected requests are deleted a week after (weekly job);
-- AUTOINCREMENT so a deleted number is never given again (its Drive folder YC-<Id> goes to the trash).
CREATE TABLE IF NOT EXISTS Requests (
  Id         INTEGER PRIMARY KEY AUTOINCREMENT,
  UserId     INTEGER NOT NULL,
  ByName     TEXT,
  Borrower   TEXT NOT NULL,
  Phone      TEXT NOT NULL,
  Team       TEXT NOT NULL,
  DueDate    TEXT,
  Note       TEXT,
  Status     TEXT NOT NULL DEFAULT 'PENDING' CHECK (Status IN ('PENDING', 'ON_LOAN', 'CLOSED', 'REJECTED')),
  CreatedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  DecidedAt  TEXT,
  DecidedBy  TEXT,
  ReturnedAt TEXT,
  ReturnedBy TEXT
);
CREATE INDEX IF NOT EXISTS Requests_UserId ON Requests (UserId);

CREATE TABLE IF NOT EXISTS RequestLines (
  RequestId INTEGER NOT NULL REFERENCES Requests (Id) ON DELETE CASCADE,
  ItemId    INTEGER NOT NULL REFERENCES Items (Id) ON DELETE CASCADE,
  Quantity  INTEGER NOT NULL CHECK (Quantity > 0),
  PRIMARY KEY (RequestId, ItemId)
) WITHOUT ROWID;

-- Evidence photos in Google Drive: SUBMIT (sent with the request), APPROVE (hand-over), RETURN.
CREATE TABLE IF NOT EXISTS RequestPhotos (
  FileId    TEXT PRIMARY KEY,
  RequestId INTEGER NOT NULL REFERENCES Requests (Id) ON DELETE CASCADE,
  Stage     TEXT NOT NULL CHECK (Stage IN ('SUBMIT', 'APPROVE', 'RETURN')),
  At        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ByName    TEXT
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS RequestPhotos_RequestId ON RequestPhotos (RequestId);
