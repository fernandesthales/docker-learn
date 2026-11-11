CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  email TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email)) AND length(email) BETWEEN 3 AND 254),
  password_hash TEXT NOT NULL,
  age SMALLINT CHECK (age BETWEEN 0 AND 150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Legacy shared tasks remain unassigned and invisible to account-scoped queries.
-- Ownership can be assigned later by an administrator after verifying the owner.
ALTER TABLE tasks ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX tasks_user_created_idx ON tasks (user_id, created_at, id);
