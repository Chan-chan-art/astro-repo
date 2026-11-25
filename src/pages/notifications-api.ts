import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

type SessionCookies = Parameters<APIRoute>[0]['cookies'];

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function getUserId(cookies: SessionCookies): Promise<number | string | null> {
  const sessionCookie = cookies.get('user_session');
  if (!sessionCookie?.value.trim()) return null;

  let sessionData: unknown;
  try {
    sessionData = sessionCookie.json();
  } catch (error) {
    console.warn('Notifications API rejected a malformed session cookie.', error);
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

function isValidNotificationId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);
}

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    const [notifications]: any = await pool.execute(
      `SELECT notification.id, notification.note_id, notification.type,
              notification.message, notification.is_read,
              DATE_FORMAT(notification.created_at, "%b %d, %Y %h:%i %p") AS created_at
       FROM notifications AS notification
       JOIN notes AS note ON note.id = notification.note_id
       WHERE notification.recipient_id = ?
         AND note.deleted_at IS NULL
         AND (
           note.user_id = ?
           OR EXISTS (
             SELECT 1
             FROM note_shares AS note_share
             WHERE note_share.note_id = note.id
               AND note_share.shared_with_user_id = ?
           )
         )
       ORDER BY notification.created_at DESC, notification.id DESC
       LIMIT 10`,
      [userId, userId, userId]
    );
    const [unreadRows]: any = await pool.execute(
      `SELECT COUNT(*) AS unread_count
       FROM notifications AS notification
       JOIN notes AS note ON note.id = notification.note_id
       WHERE notification.recipient_id = ?
         AND notification.is_read = 0
         AND note.deleted_at IS NULL
         AND (
           note.user_id = ?
           OR EXISTS (
             SELECT 1
             FROM note_shares AS note_share
             WHERE note_share.note_id = note.id
               AND note_share.shared_with_user_id = ?
           )
         )`,
      [userId, userId, userId]
    );

    return jsonResponse({
      success: true,
      notifications,
      unreadCount: Number(unreadRows[0]?.unread_count || 0)
    });
  } catch (error) {
    console.error('Notifications API failed to load notifications.', error);
    return jsonResponse({ success: false, message: 'Unable to load notifications right now.' }, 500);
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
      console.warn('Notifications API rejected an invalid request body.', error);
      return jsonResponse({ success: false, message: 'Invalid request body.' }, 400);
    }

    const notificationId = payload && typeof payload === 'object' && 'notificationId' in payload
      ? payload.notificationId
      : null;
    if (!isValidNotificationId(notificationId)) {
      return jsonResponse({ success: false, message: 'A valid notification ID is required.' }, 400);
    }

    const [notificationRows]: any = await pool.execute(
      'SELECT id FROM notifications WHERE id = ? AND recipient_id = ? LIMIT 1',
      [notificationId, userId]
    );
    if (notificationRows.length !== 1) {
      return jsonResponse({ success: false, message: 'Notification not found.' }, 404);
    }

    await pool.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?',
      [notificationId, userId]
    );
    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Notifications API failed to mark a notification as read.', error);
    return jsonResponse({ success: false, message: 'Unable to update this notification right now.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ url, cookies }) => {
  try {
    const userId = await getUserId(cookies);
    if (!userId) return jsonResponse({ success: false, message: 'Unauthorized.' }, 401);

    const notificationId = url.searchParams.get('notificationId');
    if (!isValidNotificationId(notificationId)) {
      return jsonResponse({ success: false, message: 'A valid notification ID is required.' }, 400);
    }

    const [deleteResult]: any = await pool.execute(
      'DELETE FROM notifications WHERE id = ? AND recipient_id = ?',
      [notificationId, userId]
    );
    if (deleteResult.affectedRows !== 1) {
      return jsonResponse({ success: false, message: 'Notification not found.' }, 404);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('Notifications API failed to delete a notification.', error);
    return jsonResponse({ success: false, message: 'Unable to delete this notification right now.' }, 500);
  }
};
