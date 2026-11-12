CREATE TABLE note_comment_reads ENGINE=InnoDB AS
SELECT note_id, user_id
FROM note_comments
WHERE 1 = 0;

ALTER TABLE note_comment_reads
  ADD COLUMN last_read_comment_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD PRIMARY KEY (note_id, user_id),
  ADD CONSTRAINT fk_note_comment_reads_note
    FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_note_comment_reads_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  ADD INDEX idx_note_comment_reads_user (user_id);
