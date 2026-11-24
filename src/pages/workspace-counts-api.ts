import type { APIRoute, AstroCookies } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

function jsonResponse(data: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store'
		}
	});
}

async function getUserId(cookies: AstroCookies): Promise<number | null> {
	const sessionCookie = cookies.get('user_session');
	if (!sessionCookie?.value.trim()) return null;

	let sessionData: unknown;
	try {
		sessionData = sessionCookie.json();
	} catch (error) {
		console.warn('Workspace counts API rejected a malformed session cookie.', error);
		return null;
	}

	if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) return null;
	const username = (sessionData as Record<string, unknown>).username;
	if (typeof username !== 'string' || !username.trim()) return null;

	const [rows]: any = await pool.execute(
		'SELECT id FROM users WHERE BINARY username = ?',
		[username]
	);
	return rows.length === 1 ? Number(rows[0].id) : null;
}

export const GET: APIRoute = async ({ cookies, url }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		const today = url.searchParams.get('today');
		const parsedToday = today && /^\d{4}-\d{2}-\d{2}$/.test(today)
			? new Date(`${today}T00:00:00Z`)
			: null;
		if (!today || !parsedToday || Number.isNaN(parsedToday.getTime()) ||
			parsedToday.toISOString().slice(0, 10) !== today) {
			return jsonResponse({ success: false, message: 'A valid local date is required.' }, 400);
		}

		const [rows]: any = await pool.execute(
			`SELECT
				(SELECT COUNT(*)
				 FROM note_preferences np
				 JOIN notes n ON n.id = np.note_id
				 WHERE np.user_id = ? AND np.is_favorite = 1 AND n.deleted_at IS NULL) AS favorites,
				(SELECT COUNT(*)
				 FROM note_preferences np
				 JOIN notes n ON n.id = np.note_id
				 WHERE np.user_id = ? AND np.is_pinned = 1 AND n.deleted_at IS NULL) AS pinned,
				(SELECT COUNT(*)
				 FROM reminders r
				 WHERE r.user_id = ? AND r.is_completed = 0
				   AND r.scheduled_at >= ? AND r.scheduled_at < DATE_ADD(?, INTERVAL 1 DAY)) AS remindersToday`,
			[userId, userId, userId, `${today} 00:00:00`, `${today} 00:00:00`]
		);

		return jsonResponse({
			success: true,
			counts: {
				favorites: Number(rows[0].favorites),
				pinned: Number(rows[0].pinned),
				remindersToday: Number(rows[0].remindersToday)
			}
		});
	} catch (error) {
		console.error('Workspace counts error:', error);
		return jsonResponse({ success: false, message: 'Unable to load workspace counts.' }, 500);
	}
};
