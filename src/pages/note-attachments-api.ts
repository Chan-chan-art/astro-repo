import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../lib/db';

export const prerender = false;

const attachmentDirectory = path.join(process.cwd(), 'uploads', 'note-attachments');
const supportedMimeTypes = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif'
]);

export const GET: APIRoute = async ({ url, cookies }) => {
  const sessionCookie = cookies.get('user_session');
  if (!sessionCookie?.value.trim()) {
    return new Response('Unauthorized', { status: 401 });
  }

  let sessionData: { username?: string } | null;
  try {
    sessionData = sessionCookie.json();
  } catch (error) {
    console.error('Invalid session cookie while downloading note attachment:', error);
    return new Response('Unauthorized', { status: 401 });
  }

  if (!sessionData?.username) {
    return new Response('Unauthorized', { status: 401 });
  }

  const commentAttachmentId = url.searchParams.get('commentAttachmentId');
  const attachmentId = commentAttachmentId || url.searchParams.get('id');
  if (!attachmentId || !/^\d+$/.test(attachmentId)) {
    return new Response('Invalid attachment identifier', { status: 400 });
  }

  try {
    const [userRows]: any = await pool.execute(
      'SELECT id FROM users WHERE BINARY username = ?',
      [sessionData.username]
    );
    if (userRows.length !== 1) {
      return new Response('Unauthorized', { status: 401 });
    }

    const userId = userRows[0].id;
    const [attachmentRows]: any = commentAttachmentId
      ? await pool.execute(
        `SELECT a.stored_filename, a.original_name, a.mime_type
         FROM note_comment_attachments a
         JOIN notes n ON n.id = a.note_id
         LEFT JOIN note_shares ns
           ON ns.note_id = n.id AND ns.shared_with_user_id = ?
         WHERE a.id = ?
           AND a.stored_filename IS NOT NULL
           AND (n.user_id = ? OR ns.shared_with_user_id = ?)
         LIMIT 1`,
        [userId, attachmentId, userId, userId]
      )
      : await pool.execute(
        `SELECT a.stored_filename, a.original_name, a.mime_type
         FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         LEFT JOIN note_shares ns
           ON ns.note_id = n.id AND ns.shared_with_user_id = ?
         WHERE a.id = ?
           AND a.stored_filename IS NOT NULL
           AND (n.user_id = ? OR ns.shared_with_user_id = ?)
         LIMIT 1`,
        [userId, attachmentId, userId, userId]
      );
    if (attachmentRows.length !== 1) {
      return new Response('Attachment not found', { status: 404 });
    }

    const attachment = attachmentRows[0];
    if (path.basename(attachment.stored_filename) !== attachment.stored_filename ||
        !supportedMimeTypes.has(attachment.mime_type)) {
      console.error('Invalid note attachment metadata encountered:', attachmentId);
      return new Response('Attachment unavailable', { status: 500 });
    }

    let fileBytes: Buffer;
    try {
      fileBytes = await fs.readFile(path.join(attachmentDirectory, attachment.stored_filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new Response('Attachment file not found', { status: 404 });
      }
      throw error;
    }

    const originalName = String(attachment.original_name || 'attachment')
      .replace(/[\u0000-\u001f\u007f"\\]/g, '_');
    const encodedName = encodeURIComponent(originalName).replace(/[!'()*]/g, character =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    const preview = url.searchParams.get('preview') === '1';
    if (preview && !attachment.mime_type.startsWith('image/')) {
      return new Response('Only image attachments can be previewed', { status: 415 });
    }
    return new Response(new Uint8Array(fileBytes), {
      status: 200,
      headers: {
        'Content-Type': attachment.mime_type,
        'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodedName}`,
        'Content-Length': String(fileBytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Note attachment download error:', error);
    return new Response('Unable to download attachment', { status: 500 });
  }
};
