import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../lib/db';

export const prerender = false;

type SessionCookies = Parameters<APIRoute>[0]['cookies'];

const attachmentDirectory = path.join(process.cwd(), 'uploads', 'note-attachments');
const maxAttachmentSize = 10 * 1024 * 1024;
const maxTotalAttachmentSize = 20 * 1024 * 1024;
const maxAttachmentCount = 5;
const allowedAttachmentTypes: Record<string, { mimeTypes: string[]; image: boolean }> = {
  '.pdf': { mimeTypes: ['application/pdf'], image: false },
  '.txt': { mimeTypes: ['text/plain'], image: false },
  '.csv': { mimeTypes: ['text/csv', 'application/vnd.ms-excel'], image: false },
  '.doc': { mimeTypes: ['application/msword'], image: false },
  '.docx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], image: false },
  '.xls': { mimeTypes: ['application/vnd.ms-excel'], image: false },
  '.xlsx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], image: false },
  '.ppt': { mimeTypes: ['application/vnd.ms-powerpoint'], image: false },
  '.pptx': { mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], image: false },
  '.jpg': { mimeTypes: ['image/jpeg'], image: true },
  '.jpeg': { mimeTypes: ['image/jpeg'], image: true },
  '.png': { mimeTypes: ['image/png'], image: true },
  '.gif': { mimeTypes: ['image/gif'], image: true },
  '.webp': { mimeTypes: ['image/webp'], image: true },
  '.heic': { mimeTypes: ['image/heic'], image: true },
  '.heif': { mimeTypes: ['image/heif'], image: true }
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

async function getUserId(cookies: SessionCookies): Promise<number | string | null> {
  const sessionCookie = cookies.get('user_session');
  if (!sessionCookie?.value.trim()) return null;

  let sessionData: unknown;
  try {
    sessionData = sessionCookie.json();
  } catch (error) {
    console.warn('Comments API rejected a malformed session cookie.', error);
    return null;
  }

  if (!sessionData || typeof sessionData !== 'object' || !('username' in sessionData)
    || typeof sessionData.username !== 'string' || !sessionData.username) {
    return null;
  }

  const [userRows]: any = await pool.execute(
    'SELECT id FROM users WHERE BINARY username = ?',
    [sessionData.username]
  );
  return userRows.length === 1 ? userRows[0].id : null;
}

async function userCanAccessNote(noteId: string, userId: number | string): Promise<boolean> {
  const [notes]: any = await pool.execute(
    `SELECT n.id
     FROM notes n
     LEFT JOIN note_shares ns
       ON ns.note_id = n.id AND ns.shared_with_user_id = ?
     WHERE n.id = ? AND (n.user_id = ? OR ns.shared_with_user_id = ?)
     LIMIT 1`,
    [userId, noteId, userId, userId]
  );
  return notes.length === 1;
}

function isValidNoteId(noteId: string | null): noteId is string {
  return Boolean(noteId && /^[1-9]\d{0,19}$/.test(noteId));
}

export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    if (url.searchParams.get('mode') === 'unread') {
      const [unreadNotes]: any = await pool.execute(
        `SELECT n.id AS note_id, n.title, COUNT(c.id) AS unread_count
         FROM notes n
         LEFT JOIN note_shares ns
           ON ns.note_id = n.id AND ns.shared_with_user_id = ?
         LEFT JOIN note_comment_reads r
           ON r.note_id = n.id AND r.user_id = ?
         LEFT JOIN note_comments c
           ON c.note_id = n.id
          AND c.user_id <> ?
          AND c.id > COALESCE(r.last_read_comment_id, 0)
         WHERE n.user_id = ? OR ns.shared_with_user_id = ?
         GROUP BY n.id, n.title
         HAVING COUNT(c.id) > 0
         ORDER BY MAX(c.created_at) DESC`,
        [userId, userId, userId, userId, userId]
      );
      return jsonResponse({ success: true, unreadNotes });
    }

    const noteId = url.searchParams.get('noteId');
    if (!isValidNoteId(noteId)) {
      return jsonResponse({ success: false, message: 'A valid note ID is required.' }, 400);
    }

    if (!await userCanAccessNote(noteId, userId)) {
      return jsonResponse({ success: false, message: 'You do not have access to this note.' }, 403);
    }

    const [comments]: any = await pool.execute(
      `SELECT c.id, c.comment_text AS text,
              DATE_FORMAT(c.created_at, "%b %d, %Y %h:%i %p") AS time,
              COALESCE(NULLIF(u.display_name, ''), u.username) AS author
       FROM note_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.note_id = ?
       ORDER BY c.id ASC`,
      [noteId]
    );

    if (comments.length > 0) {
      const [attachmentRows]: any = await pool.execute(
        `SELECT a.id, a.comment_id, a.attachment_type, a.original_name, a.mime_type,
                a.latitude, a.longitude
         FROM note_comment_attachments a
         JOIN note_comments c ON c.id = a.comment_id
         WHERE c.note_id = ?
         ORDER BY a.id ASC`,
        [noteId]
      );
      const attachmentsByComment = new Map<string, any[]>();
      for (const attachment of attachmentRows) {
        const key = String(attachment.comment_id);
        const attachments = attachmentsByComment.get(key) || [];
        attachments.push(attachment);
        attachmentsByComment.set(key, attachments);
      }
      for (const comment of comments) {
        comment.attachments = attachmentsByComment.get(String(comment.id)) || [];
      }
    }

    return jsonResponse({ success: true, comments });
  } catch (error) {
    console.error('Comments API failed to load comments.', error);
    return jsonResponse({ success: false, message: 'Unable to load comments right now.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const savedFilePaths: string[] = [];
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    let noteId: string | null = null;
    let commentText = '';
    let formData: FormData | null = null;
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json') &&
        Number(request.headers.get('content-length') || 0) > maxTotalAttachmentSize + 1024 * 1024) {
      return jsonResponse({ success: false, message: 'Attachments exceed the 20 MB total upload limit.' }, 413);
    }

    try {
      if (contentType.includes('application/json')) {
        const payload = await request.json();
        if (payload?.action === 'read') {
          noteId = typeof payload.noteId === 'string' ? payload.noteId : null;
        } else {
          return jsonResponse({ success: false, message: 'A valid comment action is required.' }, 400);
        }
      } else {
        formData = await request.formData();
        noteId = formData.get('noteId')?.toString() || null;
        commentText = formData.get('text')?.toString().trim() || '';
      }
    } catch (error) {
      console.warn('Comments API rejected an invalid request body.', error);
      return jsonResponse({ success: false, message: 'Invalid request body.' }, 400);
    }

    if (!isValidNoteId(noteId)) {
      return jsonResponse({ success: false, message: 'A valid note ID is required.' }, 400);
    }

    if (contentType.includes('application/json')) {
      if (!await userCanAccessNote(noteId, userId)) {
        return jsonResponse({ success: false, message: 'You do not have access to this note.' }, 403);
      }

      await pool.execute(
        `INSERT INTO note_comment_reads (note_id, user_id, last_read_comment_id)
         SELECT ?, ?, COALESCE(MAX(id), 0)
         FROM note_comments
         WHERE note_id = ?
         ON DUPLICATE KEY UPDATE last_read_comment_id = VALUES(last_read_comment_id)`,
        [noteId, userId, noteId]
      );
      return jsonResponse({ success: true });
    }

    if (commentText.length > 1000) {
      return jsonResponse({ success: false, message: 'Comments must be 1000 characters or fewer.' }, 400);
    }

    if (!await userCanAccessNote(noteId, userId)) {
      return jsonResponse({ success: false, message: 'You do not have access to this note.' }, 403);
    }

    if (!formData) {
      return jsonResponse({ success: false, message: 'Invalid comment request.' }, 400);
    }

    const uploads: Array<{ file: File; type: 'file' | 'photo' | 'camera'; filename: string; mimeType: string; originalName: string }> = [];
    const attachmentSources = [
      { field: 'fileAttachments', type: 'file' },
      { field: 'photoAttachments', type: 'photo' },
      { field: 'cameraAttachment', type: 'camera' }
    ] as const;
    for (const source of attachmentSources) {
      for (const entry of formData.getAll(source.field)) {
        if (!(entry instanceof File)) {
          if (String(entry).trim()) {
            return jsonResponse({ success: false, message: 'Invalid attachment upload.' }, 400);
          }
          continue;
        }
        if (!entry.name) continue;
        if (entry.size === 0) {
          return jsonResponse({ success: false, message: 'Empty files cannot be attached.' }, 400);
        }

        const originalName = entry.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'attachment';
        const extension = path.extname(originalName).toLowerCase();
        const allowedType = allowedAttachmentTypes[extension];
        const mimeType = entry.type.toLowerCase();
        if (!allowedType || (mimeType && mimeType !== 'application/octet-stream' && !allowedType.mimeTypes.includes(mimeType))) {
          return jsonResponse({ success: false, message: `File type is not allowed: ${originalName}` }, 400);
        }
        if (source.type !== 'file' && !allowedType.image) {
          return jsonResponse({ success: false, message: 'Photos and camera captures must be supported image files.' }, 400);
        }
        if (entry.size > maxAttachmentSize) {
          return jsonResponse({ success: false, message: 'Each attachment must be 10 MB or smaller.' }, 413);
        }
        uploads.push({
          file: entry,
          type: source.type,
          filename: `${randomUUID()}${extension}`,
          mimeType: allowedType.mimeTypes[0],
          originalName
        });
      }
    }

    if (uploads.length > maxAttachmentCount) {
      return jsonResponse({ success: false, message: 'You can attach up to 5 files to a comment.' }, 400);
    }
    if (uploads.reduce((total, upload) => total + upload.file.size, 0) > maxTotalAttachmentSize) {
      return jsonResponse({ success: false, message: 'Attachments exceed the 20 MB total upload limit.' }, 413);
    }

    const latitudeValue = formData.get('latitude')?.toString().trim() || '';
    const longitudeValue = formData.get('longitude')?.toString().trim() || '';
    let location: { latitude: number; longitude: number } | null = null;
    if (latitudeValue || longitudeValue) {
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);
      if (!latitudeValue || !longitudeValue || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return jsonResponse({ success: false, message: 'The selected location is invalid.' }, 400);
      }
      location = { latitude, longitude };
    }

    if (!commentText && uploads.length === 0 && !location) {
      return jsonResponse({ success: false, message: 'Write a comment or attach a file, photo, camera image, or location.' }, 400);
    }

    await fs.mkdir(attachmentDirectory, { recursive: true });
    for (const upload of uploads) {
      const filePath = path.join(attachmentDirectory, upload.filename);
      const fileHandle = await fs.open(filePath, 'wx');
      savedFilePaths.push(filePath);
      try {
        await fileHandle.writeFile(Buffer.from(await upload.file.arrayBuffer()));
      } finally {
        await fileHandle.close();
      }
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [commentResult]: any = await connection.execute(
        'INSERT INTO note_comments (note_id, user_id, comment_text) VALUES (?, ?, ?)',
        [noteId, userId, commentText]
      );
      const commentId = commentResult.insertId;

      for (const upload of uploads) {
        await connection.execute(
          `INSERT INTO note_comment_attachments
             (note_id, comment_id, attachment_type, stored_filename, original_name, mime_type, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [noteId, commentId, upload.type, upload.filename, upload.originalName, upload.mimeType, upload.file.size]
        );
      }

      if (location) {
        await connection.execute(
          `INSERT INTO note_comment_attachments
             (note_id, comment_id, attachment_type, latitude, longitude)
           VALUES (?, ?, 'location', ?, ?)`,
          [noteId, commentId, location.latitude, location.longitude]
        );
      }
      await connection.commit();
      savedFilePaths.length = 0;
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Comments API transaction rollback failed.', rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }

    return jsonResponse({ success: true }, 201);
  } catch (error) {
    for (const filePath of savedFilePaths) {
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        console.error('Comments API failed to remove an uncommitted attachment.', cleanupError);
      }
    }
    console.error('Comments API failed to save a comment.', error);
    return jsonResponse({ success: false, message: 'Unable to post your comment right now.' }, 500);
  }
};
