CREATE TABLE reminders ENGINE=InnoDB AS
SELECT id AS user_id
FROM users
WHERE 1 = 0;

ALTER TABLE reminders
  ADD COLUMN id INT NOT NULL AUTO_INCREMENT FIRST,
  ADD COLUMN title VARCHAR(150) NOT NULL,
  ADD COLUMN description TEXT NOT NULL,
  ADD COLUMN scheduled_at DATETIME NOT NULL,
  ADD COLUMN is_completed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN completed_at DATETIME NULL,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  ADD PRIMARY KEY (id),
  ADD CONSTRAINT fk_reminders_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  ADD INDEX idx_reminders_user_schedule (user_id, scheduled_at),
  ADD INDEX idx_reminders_user_status_schedule (user_id, is_completed, scheduled_at);
