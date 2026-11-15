-- Users in sibling families. Same definitions as schema.sql; test/schema.test.mjs keeps the two in step.
-- Adds the table to a database that already holds data:
--   npx wrangler d1 execute DB --remote --file=migrations/2026-11-15-sibling-users.sql

-- Users (Huynh trưởng) in a sibling family. StudentId is set for a graduate: the user made from that student takes the
-- student's place in the family, so the two are one person. FamilyId is NULL for a graduate without siblings.
CREATE TABLE IF NOT EXISTS SiblingUsers (
  UserId    INTEGER PRIMARY KEY REFERENCES Users (Id) ON DELETE CASCADE,
  StudentId INTEGER UNIQUE REFERENCES Students (Id) ON DELETE SET NULL,
  FamilyId  INTEGER
);
CREATE INDEX IF NOT EXISTS SiblingUsers_FamilyId ON SiblingUsers (FamilyId);
