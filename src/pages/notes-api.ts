import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../lib/db';

export const prerender = false;

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

// Helper to capture verified operational User ID from session data context safely
async function getUserIdFromSession(cookies: any): Promise<number | null> {
  const sessionCookie = cookies.get("user_session");
  
  if (!sessionCookie || !sessionCookie.value || sessionCookie.value.trim() === "") {
    console.warn("⚠️ Notes API Blocked (401): No active 'user_session' cookie was found in the request headers.");
    return null;
  }

  let sessionData = null;
  try {
    sessionData = sessionCookie.json();
  } catch (e) {
    console.error("⚠️ Notes API Blocked (401): The session cookie exists but contains broken/malformed JSON text.");
    return null;
  }

  if (!sessionData || !sessionData.username) {
    console.warn("⚠️ Notes API Blocked (401): Cookie JSON parsed successfully, but the 'username' key is missing.");
    return null;
  }

  // Exact case-sensitive match query lookup
  const [rows]: any = await pool.execute('SELECT id FROM users WHERE BINARY username = ?', [sessionData.username]);
  
  if (rows.length === 1) {
    return rows[0].id; // 🌟 Crucial fix: Make sure to explicitly map the array index row element object!
  } else {
    console.warn(`⚠️ Notes API Blocked (401): Username '${sessionData.username}' exists in cookie, but zero matching rows were returned by MySQL.`);
    return null;
  }
}


// 1. POST HANDLER - Append New Notes securely with Category support
export const POST: APIRoute = async ({ request, cookies }) => {
  const savedFilePaths: string[] = [];
  try {
    const userId = await getUserIdFromSession(cookies);
    if (!userId) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized account session parameters." }), { status: 401 });
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > maxTotalAttachmentSize + 1024 * 1024) {
      return new Response(JSON.stringify({ success: false, message: "Attachments exceed the 20 MB total upload limit." }), { status: 413 });
    }

    const formData = await request.formData();
    const title = formData.get("title")?.toString().trim() || "";
    const content = formData.get("content")?.toString().trim() || "";
    const category = formData.get("category")?.toString().trim() || "General";

    if (!title || !content) {
      return new Response(JSON.stringify({ success: false, message: "Title and body contexts are required fields" }), { status: 400 });
    }

    const attachmentSources = [
      { field: 'fileAttachments', type: 'file' },
      { field: 'photoAttachments', type: 'photo' },
      { field: 'cameraAttachment', type: 'camera' }
    ] as const;
    const uploads: Array<{ file: File; type: 'file' | 'photo' | 'camera'; filename: string; mimeType: string; originalName: string }> = [];
    for (const source of attachmentSources) {
      for (const entry of formData.getAll(source.field)) {
        if (!(entry instanceof File)) {
          if (String(entry).trim()) {
            return new Response(JSON.stringify({ success: false, message: "Invalid attachment upload." }), { status: 400 });
          }
          continue;
        }
        if (!entry.name) continue;
        if (entry.size === 0) {
          return new Response(JSON.stringify({ success: false, message: "Empty files cannot be attached." }), { status: 400 });
        }

        const originalName = entry.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'attachment';
        const extension = path.extname(originalName).toLowerCase();
        const allowedType = allowedAttachmentTypes[extension];
        const mimeType = entry.type.toLowerCase();
        if (!allowedType || (mimeType && mimeType !== 'application/octet-stream' && !allowedType.mimeTypes.includes(mimeType))) {
          return new Response(JSON.stringify({ success: false, message: `File type is not allowed: ${originalName}` }), { status: 400 });
        }
        if (source.type !== 'file' && !allowedType.image) {
          return new Response(JSON.stringify({ success: false, message: "Photos and camera captures must be supported image files." }), { status: 400 });
        }
        if (entry.size > maxAttachmentSize) {
          return new Response(JSON.stringify({ success: false, message: "Each attachment must be 10 MB or smaller." }), { status: 413 });
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
      return new Response(JSON.stringify({ success: false, message: "You can attach up to 5 files to a note." }), { status: 400 });
    }
    if (uploads.reduce((total, upload) => total + upload.file.size, 0) > maxTotalAttachmentSize) {
      return new Response(JSON.stringify({ success: false, message: "Attachments exceed the 20 MB total upload limit." }), { status: 413 });
    }

    const latitudeValue = formData.get('latitude')?.toString().trim() || '';
    const longitudeValue = formData.get('longitude')?.toString().trim() || '';
    let location: { latitude: number; longitude: number } | null = null;
    if (latitudeValue || longitudeValue) {
      const latitude = Number(latitudeValue);
      const longitude = Number(longitudeValue);
      if (!latitudeValue || !longitudeValue || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return new Response(JSON.stringify({ success: false, message: "The selected location is invalid." }), { status: 400 });
      }
      location = { latitude, longitude };
    }

    await fs.mkdir(attachmentDirectory, { recursive: true });
    for (const upload of uploads) {
      const filePath = path.join(attachmentDirectory, upload.filename);
      savedFilePaths.push(filePath);
      await fs.writeFile(filePath, Buffer.from(await upload.file.arrayBuffer()), { flag: 'wx' });
    }

    const connection = await pool.getConnection();
    let newInsertedId: number;
    const savedAttachments: Array<Record<string, unknown>> = [];
    try {
      await connection.beginTransaction();
      const [noteResult]: any = await connection.execute(
        'INSERT INTO notes (user_id, title, content, category) VALUES (?, ?, ?, ?)',
        [userId, title, content, category]
      );
      newInsertedId = noteResult.insertId;

      for (const upload of uploads) {
        const [attachmentResult]: any = await connection.execute(
          `INSERT INTO note_attachments
             (note_id, attachment_type, stored_filename, original_name, mime_type, file_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newInsertedId, upload.type, upload.filename, upload.originalName, upload.mimeType, upload.file.size]
        );
        savedAttachments.push({
          id: attachmentResult.insertId,
          attachment_type: upload.type,
          original_name: upload.originalName,
          mime_type: upload.mimeType
        });
      }

      if (location) {
        const [attachmentResult]: any = await connection.execute(
          `INSERT INTO note_attachments (note_id, attachment_type, latitude, longitude)
           VALUES (?, 'location', ?, ?)`,
          [newInsertedId, location.latitude, location.longitude]
        );
        savedAttachments.push({
          id: attachmentResult.insertId,
          attachment_type: 'location',
          latitude: location.latitude,
          longitude: location.longitude
        });
      }
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Note creation transaction rollback error:", rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }

    return new Response(JSON.stringify({
      success: true,
      id: newInsertedId,
      category,
      attachments: savedAttachments,
      date: "Just now"
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    for (const filePath of savedFilePaths) {
      try {
        await fs.unlink(filePath);
      } catch (cleanupError) {
        console.error("Failed to remove an uncommitted note attachment:", cleanupError);
      }
    }
    console.error("Database note creation fault:", err);
    return new Response(JSON.stringify({ success: false, message: "Database creation fault" }), { status: 500 });
  }
};

export const PUT: APIRoute = async ({ request, url, cookies }) => {
  try {
    const userId = await getUserIdFromSession(cookies);
    if (!userId) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session access parameters." }), { status: 401 });
    }

    const noteId = url.searchParams.get("id");
    if (!noteId || !/^\d+$/.test(noteId)) {
      return new Response(JSON.stringify({ success: false, message: "A valid note identifier is required." }), { status: 400 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, message: "Invalid note update request." }), { status: 400 });
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return new Response(JSON.stringify({ success: false, message: "Invalid note update request." }), { status: 400 });
    }

    const { title, content, category } = payload as Record<string, unknown>;
    if (typeof title !== "string" || typeof content !== "string" || typeof category !== "string") {
      return new Response(JSON.stringify({ success: false, message: "Title, content, and category are required." }), { status: 400 });
    }

    const cleanTitle = title.trim();
    const cleanContent = content.trim();
    const cleanCategory = category.trim();
    if (!cleanTitle || cleanTitle.length > 30 || !cleanContent || cleanContent.length > 120 ||
        !["General", "Work", "Personal", "Ideas"].includes(cleanCategory)) {
      return new Response(JSON.stringify({ success: false, message: "Check the note title, content, and category." }), { status: 400 });
    }

    const [accessRows]: any = await pool.execute(
      `SELECT n.id
       FROM notes n
       WHERE n.id = ?
         AND n.deleted_at IS NULL
         AND (
           n.user_id = ?
           OR EXISTS (
             SELECT 1 FROM note_shares
             WHERE note_shares.note_id = n.id
               AND note_shares.shared_with_user_id = ?
               AND note_shares.permission_level = 'edit'
           )
         )
       LIMIT 1`,
      [noteId, userId, userId]
    );
    if (accessRows.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: "You do not have permission to edit this note." }), { status: 403 });
    }

    await pool.execute(
      'UPDATE notes SET title = ?, content = ?, category = ? WHERE id = ? AND deleted_at IS NULL',
      [cleanTitle, cleanContent, cleanCategory, noteId]
    );
    return new Response(JSON.stringify({
      success: true,
      title: cleanTitle,
      content: cleanContent,
      category: cleanCategory
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("Database note update error:", error);
    return new Response(JSON.stringify({ success: false, message: "Unable to update note." }), { status: 500 });
  }
};

// 2. DELETE HANDLER - Move owned notes to Trash
export const DELETE: APIRoute = async ({ url, cookies }) => {
  try {
    const userId = await getUserIdFromSession(cookies);
    if (!userId) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session access parameters." }), { status: 401 });
    }

    const noteId = url.searchParams.get("id");
    if (!noteId || !/^[1-9]\d{0,19}$/.test(noteId)) {
      return new Response(JSON.stringify({ success: false, message: "A valid note identifier is required." }), { status: 400 });
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result]: any = await connection.execute(
        `UPDATE notes
         SET deleted_at = NOW()
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
        [noteId, userId]
      );
      if (result.affectedRows !== 1) {
        await connection.rollback();
        return new Response(JSON.stringify({ success: false, message: "You do not have permission to move this note to Trash." }), { status: 403 });
      }
      await connection.execute(
        'UPDATE note_preferences SET is_pinned = 0 WHERE note_id = ?',
        [noteId]
      );
      await connection.commit();
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Note trash transaction rollback error:", rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Database note trash error:", err);
    return new Response(JSON.stringify({ success: false, message: "Unable to move this note to Trash." }), { status: 500 });
  }
};
