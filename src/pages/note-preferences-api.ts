import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const PUT: APIRoute = async ({ request, url, cookies }) => {
  try {
    const sessionCookie = cookies.get('user_session');
    if (!sessionCookie || !sessionCookie.value.trim()) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized session.' }), { status: 401 });
    }

    let sessionData: unknown;
    try {
      sessionData = sessionCookie.json();
    } catch (error) {
      console.warn('Note preference API rejected a malformed session cookie.', error);
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized session.' }), { status: 401 });
    }

    if (!sessionData || typeof sessionData !== 'object' ||
        typeof (sessionData as Record<string, unknown>).username !== 'string') {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized session.' }), { status: 401 });
    }

    const username = (sessionData as Record<string, string>).username;
    const [userRows]: any = await pool.execute(
      'SELECT id FROM users WHERE BINARY username = ?',
      [username]
    );
    if (userRows.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: 'Unauthorized session.' }), { status: 401 });
    }
    const userId = userRows[0].id;

    const noteId = url.searchParams.get('noteId');
    if (!noteId || !/^[1-9]\d{0,19}$/.test(noteId)) {
      return new Response(JSON.stringify({ success: false, message: 'A valid note identifier is required.' }), { status: 400 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, message: 'Invalid preference update request.' }), { status: 400 });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return new Response(JSON.stringify({ success: false, message: 'Invalid preference update request.' }), { status: 400 });
    }

    const preference = (payload as Record<string, unknown>).preference;
    const enabled = (payload as Record<string, unknown>).enabled;
    if ((preference !== 'pinned' && preference !== 'favorite') || typeof enabled !== 'boolean') {
      return new Response(JSON.stringify({ success: false, message: 'A valid preference and status are required.' }), { status: 400 });
    }

    const [accessRows]: any = await pool.execute(
      `SELECT n.id
       FROM notes n
       WHERE n.id = ?
         AND n.deleted_at IS NULL
         AND (
           n.user_id = ?
           OR EXISTS (
             SELECT 1 FROM note_shares ns
             WHERE ns.note_id = n.id
               AND ns.shared_with_user_id = ?
           )
         )
       LIMIT 1`,
      [noteId, userId, userId]
    );
    if (accessRows.length !== 1) {
      return new Response(JSON.stringify({ success: false, message: 'You do not have access to this note.' }), { status: 404 });
    }

    const column = preference === 'pinned' ? 'is_pinned' : 'is_favorite';
    const status = enabled ? 1 : 0;
    await pool.execute(
      `INSERT INTO note_preferences (note_id, user_id, ${column})
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE ${column} = VALUES(${column})`,
      [noteId, userId, status]
    );

    return new Response(JSON.stringify({ success: true, preference, enabled }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Note preference update error:', error);
    return new Response(JSON.stringify({ success: false, message: 'Unable to save this note preference.' }), { status: 500 });
  }
};
