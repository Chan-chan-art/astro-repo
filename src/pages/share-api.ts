import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const sessionCookie = cookies.get("user_session");
    if (!sessionCookie || !sessionCookie.value.trim()) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session" }), { status: 401 });
    }

    let sessionData;
    try {
      sessionData = sessionCookie.json();
    } catch (error) {
      console.warn("Share API rejected a malformed session cookie.", error);
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session" }), { status: 401 });
    }

    if (!sessionData || typeof sessionData.username !== "string") {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session" }), { status: 401 });
    }

    const [ownerRows]: any = await pool.execute(
      'SELECT id, username, display_name FROM users WHERE BINARY username = ?',
      [sessionData.username]
    );
    if (ownerRows.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session" }), { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, message: "Invalid request body" }), { status: 400 });
    }

    const noteId = String(payload?.noteId ?? "");
    const friendUsername = typeof payload?.username === "string" ? payload.username.trim() : "";
    if (!/^[1-9]\d{0,19}$/.test(noteId) || !friendUsername || friendUsername.length > 100) {
      return new Response(JSON.stringify({ success: false, message: "A valid note and username are required." }), { status: 400 });
    }

    const ownerId = ownerRows[0].id;
    const [ownedNotes]: any = await pool.execute(
      'SELECT id, title FROM notes WHERE id = ? AND user_id = ?',
      [noteId, ownerId]
    );
    if (ownedNotes.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: "You can only share notes you own." }), { status: 403 });
    }

    const [friendRows]: any = await pool.execute(
      'SELECT id FROM users WHERE BINARY username = ?',
      [friendUsername]
    );
    if (friendRows.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: "No user found with that exact username." }), { status: 404 });
    }

    const friendId = friendRows[0].id;
    if (String(friendId) === String(ownerId)) {
      return new Response(JSON.stringify({ success: false, message: "You cannot share a note with yourself." }), { status: 400 });
    }

    const [existingShares]: any = await pool.execute(
      'SELECT note_id FROM note_shares WHERE note_id = ? AND shared_with_user_id = ?',
      [noteId, friendId]
    );
    if (existingShares.length > 0) {
      return new Response(JSON.stringify({ success: false, message: "This note is already shared with that user." }), { status: 409 });
    }

    const permissionLevel = 'view';
    const permissionLabel = permissionLevel === 'edit' ? 'Editor' : 'Viewer';
    const ownerName = ownerRows[0].display_name || ownerRows[0].username;
    const notificationMessage =
      `${ownerName} shared '${ownedNotes[0].title}' with you (${permissionLabel}).`;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'INSERT INTO note_shares (note_id, shared_with_user_id, permission_level) VALUES (?, ?, ?)',
        [noteId, friendId, permissionLevel]
      );
      await connection.execute(
        `INSERT INTO notifications
           (recipient_id, actor_id, note_id, type, message, is_read)
         VALUES (?, ?, ?, 'shared', ?, 0)`,
        [friendId, ownerId, noteId, notificationMessage]
      );
      await connection.commit();
    } catch (error) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Share API transaction rollback failed.", rollbackError);
      }
      throw error;
    } finally {
      connection.release();
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Share API Error:", error);
    return new Response(JSON.stringify({ success: false, message: "Unable to share this note right now." }), { status: 500 });
  }
};
