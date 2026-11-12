CREATE TABLE note_preferences ENGINE=InnoDB AS
SELECT id AS note_id, user_id
FROM notes
WHERE 1 = 0;

ALTER TABLE note_preferences
  ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0,
  ADD PRIMARY KEY (note_id, user_id),
  ADD CONSTRAINT fk_note_preferences_note
    FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_note_preferences_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  ADD INDEX idx_note_preferences_user (user_id);
