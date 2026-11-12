CREATE TABLE note_comment_attachments ENGINE=InnoDB AS
SELECT id AS comment_id, note_id
FROM note_comments
WHERE 1 = 0;

ALTER TABLE note_comment_attachments
  ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
  ADD PRIMARY KEY (id),
  ADD COLUMN attachment_type ENUM('file', 'photo', 'camera', 'location') NOT NULL,
  ADD COLUMN stored_filename VARCHAR(255) NULL,
  ADD COLUMN original_name VARCHAR(255) NULL,
  ADD COLUMN mime_type VARCHAR(127) NULL,
  ADD COLUMN file_size BIGINT UNSIGNED NULL,
  ADD COLUMN latitude DECIMAL(10, 7) NULL,
  ADD COLUMN longitude DECIMAL(10, 7) NULL,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT fk_note_comment_attachments_comment
    FOREIGN KEY (comment_id) REFERENCES note_comments (id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_note_comment_attachments_note
    FOREIGN KEY (note_id) REFERENCES notes (id) ON DELETE CASCADE,
  ADD INDEX idx_note_comment_attachments_comment (comment_id),
  ADD UNIQUE INDEX uq_note_comment_attachments_stored_filename (stored_filename);
