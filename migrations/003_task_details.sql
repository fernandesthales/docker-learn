-- Defaults preserve existing tasks and clients that only send a title.
ALTER TABLE tasks
  ADD COLUMN due_date DATE CHECK (due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
  ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  ADD COLUMN description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000);
