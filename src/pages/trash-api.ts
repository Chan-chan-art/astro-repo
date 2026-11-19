import type { APIRoute } from 'astro';
import { emptyTrash, permanentlyDeleteTrashedNote, purgeExpiredTrashedNotes } from '../lib/note-trash';
import { pool } from '../lib/db';

export const prerender = false;

async function getUserId(cookies: Parameters<APIRoute>[0]['cookies']): Promise<number | null> {
  const sessionCookie = cookies.get('user_session');
  if (!sessionCookie || !sessionCookie.value.trim()) return null;

  let sessionData: unknown;
  try {
    sessionData = sessionCookie.json();
  } catch (error) {
    console.warn('Trash API rejected a malformed session cookie.', error);
    return null;
  }

  if (!sessionData || typeof sessionData !== 'object' ||
      typeof (sessionData as Record<string, unknown>).username !== 'string') {
    return null;
  }

  const [userRows]: any = await pool.execute(
    'SELECT id FROM users WHERE BINARY username = ?',
    [(sessionData as Record<string, string>).username]
  );
  return userRows.length === 1 ? userRows[0].id : null;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export const PUT: APIRoute = async ({ request, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ success: false, message: 'Invalid trash action.' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse({ success: false, message: 'Invalid trash action.' }, 400);
    }

    const { action, id } = payload as Record<string, unknown>;
    if (action !== 'restore' || typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id)) {
      return jsonResponse({ success: false, message: 'A valid note and restore action are required.' }, 400);
    }

    await purgeExpiredTrashedNotes(userId);
    const [result]: any = await pool.execute(
      `UPDATE notes
       SET deleted_at = NULL
       WHERE id = ?
         AND user_id = ?
         AND deleted_at IS NOT NULL
         AND deleted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`,
      [id, userId]
    );
    if (result.affectedRows !== 1) {
      return jsonResponse({ success: false, message: 'This trashed note was not found or has expired.' }, 404);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Note restore error:', error);
    return jsonResponse({ success: false, message: 'Unable to restore this note.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

    const noteId = url.searchParams.get('id');
    const empty = url.searchParams.get('all');
    if (noteId !== null && !/^[1-9]\d{0,19}$/.test(noteId)) {
      return jsonResponse({ success: false, message: 'A valid note identifier is required.' }, 400);
    }
    if ((noteId === null && empty !== 'true') || (noteId !== null && empty === 'true')) {
      return jsonResponse({ success: false, message: 'Choose a trashed note or the entire trash.' }, 400);
    }

    const result = noteId
      ? await permanentlyDeleteTrashedNote(userId, noteId)
      : await emptyTrash(userId);
    return jsonResponse({
      success: true,
      deletedCount: result.deletedCount,
      ...(result.cleanupFailed ? { warning: 'The note was deleted, but one or more attachment files could not be removed.' } : {})
    });
  } catch (error) {
    console.error('Permanent trash deletion error:', error);
    return jsonResponse({ success: false, message: 'Unable to permanently delete trashed notes.' }, 500);
  }
};
