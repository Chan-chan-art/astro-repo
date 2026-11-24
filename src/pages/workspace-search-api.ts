import type { APIRoute } from 'astro';
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

export const GET: APIRoute = async ({ cookies, url }) => {
	try {
		const sessionCookie = cookies.get('user_session');
		if (!sessionCookie?.value.trim()) {
			return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);
		}

		let sessionData: unknown;
		try {
			sessionData = sessionCookie.json();
		} catch (error) {
			console.warn('Workspace search API rejected a malformed session cookie.', error);
			return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);
		}

		if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) {
			return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);
		}
		const username = (sessionData as Record<string, unknown>).username;
		if (typeof username !== 'string' || !username.trim()) {
			return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);
		}

		const [userRows]: any = await pool.execute(
			'SELECT id FROM users WHERE BINARY username = ?',
			[username]
		);
		if (userRows.length !== 1) {
			return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);
		}

		const query = url.searchParams.get('q')?.trim() || '';
		if (!query || query.length > 80) {
			return jsonResponse({ success: false, message: 'Enter a title search up to 80 characters.' }, 400);
		}

		const userId = Number(userRows[0].id);
		const [notes]: any = await pool.execute(
			`SELECT n.id, n.title, COALESCE(n.category, 'General') AS category
			 FROM notes n
			 WHERE n.deleted_at IS NULL
			   AND (
			     n.user_id = ?
			     OR EXISTS (
			       SELECT 1 FROM note_shares ns
			       WHERE ns.note_id = n.id AND ns.shared_with_user_id = ?
			     )
			   )
			   AND INSTR(LOWER(n.title), LOWER(?)) > 0
			 ORDER BY n.id DESC
			 LIMIT 8`,
			[userId, userId, query]
		);

		return jsonResponse({ success: true, notes });
	} catch (error) {
		console.error('Workspace title search error:', error);
		return jsonResponse({ success: false, message: 'Unable to search workspace notes.' }, 500);
	}
};
