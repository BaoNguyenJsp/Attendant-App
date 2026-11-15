-- Sổ Thiếu Nhi — D1 schema. Re-runnable: drops everything first.
-- Dates are TEXT 'YYYY-MM-DD'; WeekOf is always a Sunday. Timestamps are UTC ISO text.
-- A database made before the warehouse: run migrations/2026-11-09-inventory.sql instead (keeps the data).
-- A database made before the sibling users: run migrations/2026-11-15-sibling-users.sql (keeps the data).
DROP TABLE IF EXISTS RequestPhotos;
DROP TABLE IF EXISTS RequestLines;
DROP TABLE IF EXISTS Requests;
DROP TABLE IF EXISTS Items;
DROP TABLE IF EXISTS Locations;
DROP TABLE IF EXISTS LessonTeachers;
DROP TABLE IF EXISTS LessonFiles;
DROP TABLE IF EXISTS Lessons;
DROP TABLE IF EXISTS AcademicYear;
DROP TABLE IF EXISTS Scores;
DROP TABLE IF EXISTS TeacherAttendance;
DROP TABLE IF EXISTS Attendance;
DROP TABLE IF EXISTS SiblingUsers;
DROP TABLE IF EXISTS SiblingMembers;
DROP TABLE IF EXISTS StudentPhotos;
DROP TABLE IF EXISTS Students;
DROP TABLE IF EXISTS Holidays;
DROP TABLE IF EXISTS ConfigHistory;
DROP TABLE IF EXISTS Config;
DROP TABLE IF EXISTS Memberships;
DROP TABLE IF EXISTS GroupClasses;
DROP TABLE IF EXISTS Groups;
DROP TABLE IF EXISTS Classes;
DROP TABLE IF EXISTS Users;
DROP TABLE IF EXISTS DriveFolders;
DROP TABLE IF EXISTS DriveTrash;
DROP TABLE IF EXISTS Secrets;

CREATE TABLE Users (
  Id          INTEGER PRIMARY KEY,
  Email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  SaintName   TEXT,
  FullName    TEXT NOT NULL,
  FirstName   TEXT NOT NULL,
  Status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (Status IN ('ACTIVE', 'INACTIVE')),
  Phone       TEXT,
  AuthVersion INTEGER NOT NULL DEFAULT 1,
  CreatedAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedAt   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy   INTEGER
);

CREATE TABLE Classes (
  Id        INTEGER PRIMARY KEY,
  Name      TEXT NOT NULL UNIQUE,
  Grade     TEXT,
  SortOrder INTEGER NOT NULL
);

CREATE TABLE Groups (
  Id            INTEGER PRIMARY KEY,
  Name          TEXT NOT NULL UNIQUE,
  Type          TEXT NOT NULL CHECK (Type IN ('CLASS', 'SECTOR', 'SECTOR_ADMIN', 'ADMIN')),
  SectorGroupId INTEGER REFERENCES Groups (Id),
  Description   TEXT
);

CREATE TABLE GroupClasses (
  GroupId INTEGER NOT NULL REFERENCES Groups (Id) ON DELETE CASCADE,
  ClassId INTEGER NOT NULL REFERENCES Classes (Id),
  PRIMARY KEY (GroupId, ClassId)
) WITHOUT ROWID;

CREATE TABLE Memberships (
  GroupId INTEGER NOT NULL REFERENCES Groups (Id),
  UserId  INTEGER NOT NULL REFERENCES Users (Id) ON DELETE CASCADE,
  PRIMARY KEY (GroupId, UserId)
) WITHOUT ROWID;
CREATE INDEX Memberships_UserId ON Memberships (UserId);

CREATE TABLE Config (
  Key   TEXT PRIMARY KEY,
  Value TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

CREATE TABLE ConfigHistory (
  Id        INTEGER PRIMARY KEY,
  Key       TEXT NOT NULL,
  Value     TEXT,
  Action    TEXT NOT NULL CHECK (Action IN ('ADDED', 'UPDATED', 'DELETED')),
  ChangedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ChangedBy INTEGER
);

CREATE TABLE Holidays (
  WeekOf  TEXT NOT NULL,
  Session TEXT NOT NULL CHECK (Session IN ('SUNDAY_MASS', 'CATECHISM', 'ADORATION', 'THURSDAY_MASS', 'TEACHER_MEETING')),
  Reason  TEXT,
  PRIMARY KEY (WeekOf, Session)
) WITHOUT ROWID;

CREATE TABLE Students (
  Id           INTEGER PRIMARY KEY,
  IdNumber     TEXT NOT NULL,
  IdKey        TEXT NOT NULL UNIQUE,
  SaintName    TEXT,
  FullName     TEXT NOT NULL,
  FirstName    TEXT NOT NULL,
  DateOfBirth  TEXT,
  Gender       TEXT CHECK (Gender IN ('F', 'M')),
  Father       TEXT,
  Mother       TEXT,
  Address      TEXT,
  Phone        TEXT,
  ClassId      INTEGER NOT NULL REFERENCES Classes (Id),
  EnrollYear   INTEGER,
  Status       TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (Status IN ('ACTIVE', 'INACTIVE', 'GRADUATED')),
  PhotoVersion INTEGER NOT NULL DEFAULT 0,
  CreatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy    INTEGER
);
CREATE INDEX Students_ClassId ON Students (ClassId);

CREATE TABLE SiblingMembers (
  StudentId INTEGER PRIMARY KEY REFERENCES Students (Id) ON DELETE CASCADE,
  FamilyId  INTEGER NOT NULL
);
CREATE INDEX SiblingMembers_FamilyId ON SiblingMembers (FamilyId);

-- Users (Huynh trưởng) in a sibling family. StudentId is set for a graduate: the user made from that student takes the
-- student's place in the family, so the two are one person. FamilyId is NULL for a graduate without siblings.
CREATE TABLE SiblingUsers (
  UserId    INTEGER PRIMARY KEY REFERENCES Users (Id) ON DELETE CASCADE,
  StudentId INTEGER UNIQUE REFERENCES Students (Id) ON DELETE SET NULL,
  FamilyId  INTEGER
);
CREATE INDEX SiblingUsers_FamilyId ON SiblingUsers (FamilyId);

-- Photo bytes while R2 is not used (see src/http/photos.js). Always read one row by StudentId, never the whole table.
CREATE TABLE StudentPhotos (
  StudentId   INTEGER PRIMARY KEY REFERENCES Students (Id) ON DELETE CASCADE,
  ContentType TEXT NOT NULL,
  Bytes       BLOB NOT NULL
);

CREATE TABLE Attendance (
  StudentId    INTEGER NOT NULL REFERENCES Students (Id) ON DELETE CASCADE,
  WeekOf       TEXT NOT NULL,
  ClassId      INTEGER NOT NULL REFERENCES Classes (Id),
  SundayMass   INTEGER NOT NULL DEFAULT 0 CHECK (SundayMass BETWEEN 0 AND 3),
  Catechism    INTEGER NOT NULL DEFAULT 0 CHECK (Catechism BETWEEN 0 AND 3),
  Adoration    INTEGER NOT NULL DEFAULT 0 CHECK (Adoration BETWEEN 0 AND 3),
  ThursdayMass INTEGER NOT NULL DEFAULT 0 CHECK (ThursdayMass BETWEEN 0 AND 3),
  UpdatedAt    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy    INTEGER,
  PRIMARY KEY (StudentId, WeekOf)
) WITHOUT ROWID;
CREATE INDEX Attendance_ClassId_WeekOf ON Attendance (ClassId, WeekOf);

CREATE TABLE TeacherAttendance (
  UserId         INTEGER NOT NULL REFERENCES Users (Id) ON DELETE CASCADE,
  WeekOf         TEXT NOT NULL,
  SundayMass     INTEGER NOT NULL DEFAULT 0 CHECK (SundayMass BETWEEN 0 AND 3),
  Catechism      INTEGER NOT NULL DEFAULT 0 CHECK (Catechism BETWEEN 0 AND 3),
  Adoration      INTEGER NOT NULL DEFAULT 0 CHECK (Adoration BETWEEN 0 AND 3),
  ThursdayMass   INTEGER NOT NULL DEFAULT 0 CHECK (ThursdayMass BETWEEN 0 AND 3),
  TeacherMeeting INTEGER NOT NULL DEFAULT 0 CHECK (TeacherMeeting BETWEEN 0 AND 3),
  UpdatedAt      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy      INTEGER,
  PRIMARY KEY (UserId, WeekOf)
) WITHOUT ROWID;
CREATE INDEX TeacherAttendance_WeekOf ON TeacherAttendance (WeekOf);

CREATE TABLE Scores (
  StudentId INTEGER PRIMARY KEY REFERENCES Students (Id) ON DELETE CASCADE,
  ClassId   INTEGER NOT NULL REFERENCES Classes (Id),
  QuizS1    REAL CHECK (QuizS1 BETWEEN 0 AND 10),
  ExamS1    REAL CHECK (ExamS1 BETWEEN 0 AND 10),
  QuizS2    REAL CHECK (QuizS2 BETWEEN 0 AND 10),
  ExamS2    REAL CHECK (ExamS2 BETWEEN 0 AND 10),
  UpdatedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy INTEGER
);
CREATE INDEX Scores_ClassId ON Scores (ClassId);

CREATE TABLE AcademicYear (
  SchoolYear    TEXT NOT NULL,
  StudentId     INTEGER NOT NULL REFERENCES Students (Id) ON DELETE CASCADE,
  ClassName     TEXT NOT NULL,
  Semester1Avg  REAL,
  Semester2Avg  REAL,
  YearAvg       REAL,
  AttendancePct INTEGER,
  Rating        TEXT CHECK (Rating IN ('EXCELLENT', 'GOOD', 'AVERAGE')),
  PRIMARY KEY (SchoolYear, StudentId)
) WITHOUT ROWID;
CREATE INDEX AcademicYear_StudentId ON AcademicYear (StudentId);

CREATE TABLE Lessons (
  Id         INTEGER PRIMARY KEY,
  SchoolYear TEXT NOT NULL,
  WeekOf     TEXT NOT NULL,
  ClassId    INTEGER NOT NULL REFERENCES Classes (Id),
  TeacherId  INTEGER NOT NULL REFERENCES Users (Id),
  Content    TEXT NOT NULL DEFAULT '',
  Location   TEXT NOT NULL DEFAULT 'Trong lớp',
  CreatedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedAt  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UpdatedBy  INTEGER,
  UNIQUE (SchoolYear, WeekOf, ClassId)
);

CREATE TABLE LessonFiles (
  LessonId    INTEGER NOT NULL REFERENCES Lessons (Id) ON DELETE CASCADE,
  Slot        TEXT NOT NULL CHECK (Slot IN ('PLAN', 'REVISED')),
  Position    INTEGER NOT NULL,
  Url         TEXT NOT NULL,
  Name        TEXT NOT NULL DEFAULT '',
  Type        TEXT NOT NULL CHECK (Type IN ('FILE', 'LINK')),
  DriveFileId TEXT,
  PRIMARY KEY (LessonId, Slot, Position)
) WITHOUT ROWID;

-- Teachers who helped with a lesson besides its teacher.
CREATE TABLE LessonTeachers (
  LessonId INTEGER NOT NULL REFERENCES Lessons (Id) ON DELETE CASCADE,
  UserId   INTEGER NOT NULL REFERENCES Users (Id) ON DELETE CASCADE,
  PRIMARY KEY (LessonId, UserId)
) WITHOUT ROWID;
CREATE INDEX LessonTeachers_UserId ON LessonTeachers (UserId);

CREATE TABLE DriveFolders (
  PathKey  TEXT PRIMARY KEY,
  FolderId TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE DriveTrash (
  FileId TEXT PRIMARY KEY
) WITHOUT ROWID;

CREATE TABLE Secrets (
  Key   TEXT PRIMARY KEY,
  Value TEXT NOT NULL
) WITHOUT ROWID;

-- RETURNABLE: Total = units owned, Total - Available = units out on loan.
-- CONSUMABLE: Available = what is left, Total = the highest stock level reached, for the percent left.
-- Codes are made from the kind: MT-001 (mượn - trả), HP-001 (hao phí). Photos live in Google Drive under
-- <DriveFolderId>/Warehouse/<Code>; PhotoFileId is the Drive file id.
CREATE TABLE Locations (
  Id   INTEGER PRIMARY KEY,
  Name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE Items (
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
CREATE TABLE Requests (
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
CREATE INDEX Requests_UserId ON Requests (UserId);

CREATE TABLE RequestLines (
  RequestId INTEGER NOT NULL REFERENCES Requests (Id) ON DELETE CASCADE,
  ItemId    INTEGER NOT NULL REFERENCES Items (Id) ON DELETE CASCADE,
  Quantity  INTEGER NOT NULL CHECK (Quantity > 0),
  PRIMARY KEY (RequestId, ItemId)
) WITHOUT ROWID;

-- Evidence photos in Google Drive: SUBMIT (sent with the request), APPROVE (hand-over), RETURN.
CREATE TABLE RequestPhotos (
  FileId    TEXT PRIMARY KEY,
  RequestId INTEGER NOT NULL REFERENCES Requests (Id) ON DELETE CASCADE,
  Stage     TEXT NOT NULL CHECK (Stage IN ('SUBMIT', 'APPROVE', 'RETURN')),
  At        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ByName    TEXT
) WITHOUT ROWID;
CREATE INDEX RequestPhotos_RequestId ON RequestPhotos (RequestId);
