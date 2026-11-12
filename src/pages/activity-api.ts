import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

type SessionCookies = Parameters<APIRoute>[0]['cookies'];

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
    console.warn('Activity API rejected a malformed session cookie.', error);
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

function isValidNoteId(noteId: unknown): noteId is string {
  return typeof noteId === 'string' && /^[1-9]\d{0,19}$/.test(noteId);
}

export const GET: APIRoute = async ({ url, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    const noteId = url.searchParams.get('noteId');
    if (!isValidNoteId(noteId)) {
      return jsonResponse({ success: false, message: 'A valid note ID is required.' }, 400);
    }

    const [ownedNotes]: any = await pool.execute(
      'SELECT id FROM notes WHERE id = ? AND user_id = ? LIMIT 1',
      [noteId, userId]
    );
    if (ownedNotes.length !== 1) {
      return jsonResponse({ success: false, message: 'Only the note owner can view recipient activity.' }, 403);
    }

    const [recipients]: any = await pool.execute(
      `SELECT u.username,
              (p.last_seen_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 2 MINUTE)) AS is_active,
              v.last_viewed_at
       FROM note_shares ns
       JOIN users u ON u.id = ns.shared_with_user_id
       LEFT JOIN user_presence p ON p.user_id = u.id
       LEFT JOIN note_views v
         ON v.note_id = ns.note_id AND v.viewer_user_id = ns.shared_with_user_id
       WHERE ns.note_id = ?
       ORDER BY u.username`,
      [noteId]
    );

    return jsonResponse({ success: true, recipients });
  } catch (error) {
    console.error('Activity API failed to load note activity.', error);
    return jsonResponse({ success: false, message: 'Unable to load activity right now.' }, 500);
  }
};

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch (error) {
      console.warn('Activity API rejected an invalid request body.', error);
      return jsonResponse({ success: false, message: 'Invalid request body.' }, 400);
    }

    if (!payload || typeof payload !== 'object' || !('action' in payload)) {
      return jsonResponse({ success: false, message: 'An activity action is required.' }, 400);
    }

    if (payload.action === 'heartbeat') {
      await pool.execute(
        `INSERT INTO user_presence (user_id, last_seen_at)
         VALUES (?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP`,
        [userId]
      );
      return jsonResponse({ success: true });
    }

    if (payload.action !== 'view' || !('noteId' in payload) || !isValidNoteId(payload.noteId)) {
      return jsonResponse({ success: false, message: 'A valid activity action and note ID are required.' }, 400);
    }

    const [shares]: any = await pool.execute(
      'SELECT note_id FROM note_shares WHERE note_id = ? AND shared_with_user_id = ? LIMIT 1',
      [payload.noteId, userId]
    );
    if (shares.length !== 1) {
      return jsonResponse({ success: false, message: 'You do not have access to this shared note.' }, 403);
    }

    await pool.execute(
      `INSERT INTO note_views (note_id, viewer_user_id, last_viewed_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE last_viewed_at = CURRENT_TIMESTAMP`,
      [payload.noteId, userId]
    );

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Activity API failed to update activity.', error);
    return jsonResponse({ success: false, message: 'Unable to update activity right now.' }, 500);
  }
};
