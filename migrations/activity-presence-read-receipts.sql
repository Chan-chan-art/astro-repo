CREATE TABLE user_presence ENGINE=InnoDB AS
SELECT id AS user_id
FROM users
WHERE 1 = 0;

ALTER TABLE user_presence
  ADD PRIMARY KEY (user_id),
  ADD COLUMN last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT fk_user_presence_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

CREATE TABLE note_views ENGINE=InnoDB AS
SELECT notes.id AS note_id, users.id AS viewer_user_id
FROM notes
CROSS JOIN users
WHERE 1 = 0;

ALTER TABLE note_views
  ADD PRIMARY KEY (note_id, viewer_user_id),
  ADD COLUMN last_viewed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT fk_note_views_note
    FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_note_views_viewer
    FOREIGN KEY (viewer_user_id) REFERENCES users (id) ON DELETE CASCADE,
  ADD INDEX idx_note_views_viewer (viewer_user_id);
