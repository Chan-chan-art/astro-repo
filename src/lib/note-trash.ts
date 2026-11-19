import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db';

const attachmentDirectory = path.join(process.cwd(), 'uploads', 'note-attachments');

async function permanentlyDeleteTrashedNotes(
  userId: number,
  filter: 'expired' | 'all' | 'id',
  noteId?: string
): Promise<{ deletedCount: number; cleanupFailed: boolean }> {
  const connection = await pool.getConnection();
  let storedFilenames: string[] = [];

  try {
    await connection.beginTransaction();
    const filterSql = filter === 'expired'
      ? 'AND n.deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)'
      : filter === 'id'
        ? 'AND n.id = ?'
        : '';
    const filterParameters = filter === 'id' ? [userId, noteId] : [userId];
    const [noteRows]: any = await connection.execute(
      `SELECT n.id
       FROM notes n
       WHERE n.user_id = ?
         AND n.deleted_at IS NOT NULL
         ${filterSql}
       FOR UPDATE`,
      filterParameters
    );
    const noteIds = noteRows.map((note: { id: number }) => note.id);
    if (noteIds.length === 0) {
      await connection.commit();
      return { deletedCount: 0, cleanupFailed: false };
    }

    const placeholders = noteIds.map(() => '?').join(', ');
    const [attachmentRows]: any = await connection.execute(
      `SELECT stored_filename
       FROM note_attachments
       WHERE note_id IN (${placeholders})
         AND stored_filename IS NOT NULL`,
      noteIds
    );
    storedFilenames = attachmentRows.map((attachment: { stored_filename: string }) => attachment.stored_filename);
    await connection.execute(
      `DELETE FROM notes WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...noteIds]
    );
    await connection.commit();

    let cleanupFailed = false;
    for (const filename of storedFilenames) {
      try {
        await fs.unlink(path.join(attachmentDirectory, filename));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          cleanupFailed = true;
          console.error('Failed to remove a permanently deleted note attachment:', error);
        }
      }
    }
    return { deletedCount: noteIds.length, cleanupFailed };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('Trash deletion transaction rollback error:', rollbackError);
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function purgeExpiredTrashedNotes(userId: number) {
  return permanentlyDeleteTrashedNotes(userId, 'expired');
}

export async function permanentlyDeleteTrashedNote(userId: number, noteId: string) {
  return permanentlyDeleteTrashedNotes(userId, 'id', noteId);
}

export async function emptyTrash(userId: number) {
  return permanentlyDeleteTrashedNotes(userId, 'all');
}
