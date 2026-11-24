import type { APIRoute, AstroCookies } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

type BulkAction = 'pin' | 'favorite' | 'reminder' | 'trash';

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
		console.warn('Bulk note API rejected a malformed session cookie.', error);
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

function parseNoteId(value: unknown): string | null {
	const id = typeof value === 'string'
		? value
		: typeof value === 'number' && Number.isSafeInteger(value)
			? String(value)
			: '';
	return /^[1-9]\d{0,19}$/.test(id) ? id : null;
}

function validDate(date: unknown): date is string {
	if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validTime(time: unknown): time is string {
	return typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export const POST: APIRoute = async ({ cookies, request }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		let payload: unknown;
		try {
			payload = await request.json();
		} catch {
			return jsonResponse({ success: false, message: 'Invalid bulk note request.' }, 400);
		}
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			return jsonResponse({ success: false, message: 'Invalid bulk note request.' }, 400);
		}

		const body = payload as Record<string, unknown>;
		const action = body.action;
		if (action !== 'pin' && action !== 'favorite' && action !== 'reminder' && action !== 'trash') {
			return jsonResponse({ success: false, message: 'Choose a valid bulk action.' }, 400);
		}
		if (!Array.isArray(body.ids) || body.ids.length < 2 || body.ids.length > 100) {
			return jsonResponse({ success: false, message: 'Select between 2 and 100 notes.' }, 400);
		}

		const noteIds: string[] = [];
		const uniqueNoteIds = new Set<string>();
		for (const value of body.ids) {
			const id = parseNoteId(value);
			if (!id || uniqueNoteIds.has(id)) {
				return jsonResponse({ success: false, message: 'Choose valid, unique notes.' }, 400);
			}
			noteIds.push(id);
			uniqueNoteIds.add(id);
		}

		let scheduledAt = '';
		if (action === 'reminder') {
			if (!validDate(body.date) || !validTime(body.time)) {
				return jsonResponse({ success: false, message: 'Choose a valid reminder date and time.' }, 400);
			}
			scheduledAt = `${body.date} ${body.time}:00`;
		}

		const connection = await pool.getConnection();
		try {
			await connection.beginTransaction();
			const placeholders = noteIds.map(() => '?').join(', ');
			const [notes]: any = await connection.execute(
				`SELECT n.id, n.user_id, n.title
				 FROM notes n
				 WHERE n.id IN (${placeholders})
				   AND n.deleted_at IS NULL
				   AND (
				     n.user_id = ?
				     OR EXISTS (
				       SELECT 1 FROM note_shares ns
				       WHERE ns.note_id = n.id AND ns.shared_with_user_id = ?
				     )
				   )
				 FOR UPDATE`,
				[...noteIds, userId, userId]
			);
			if (notes.length !== noteIds.length) {
				await connection.rollback();
				return jsonResponse({ success: false, message: 'One or more selected notes are unavailable.' }, 404);
			}

			if ((action === 'reminder' || action === 'trash') &&
				notes.some((note: { user_id: number | string }) => Number(note.user_id) !== userId)) {
				await connection.rollback();
				return jsonResponse({
					success: false,
					message: action === 'reminder'
						? 'Bulk reminders can only be set for notes you own.'
						: 'Only notes you own can be moved to Trash.'
				}, 403);
			}

			if (action === 'pin' || action === 'favorite') {
				const column = action === 'pin' ? 'is_pinned' : 'is_favorite';
				const values = noteIds.map(() => '(?, ?, 1)').join(', ');
				await connection.execute(
					`INSERT INTO note_preferences (note_id, user_id, ${column})
					 VALUES ${values}
					 ON DUPLICATE KEY UPDATE ${column} = VALUES(${column})`,
					noteIds.flatMap((noteId) => [noteId, userId])
				);
			} else if (action === 'reminder') {
				const values = notes.map(() => '(?, ?, ?, ?, ?)').join(', ');
				await connection.execute(
					`INSERT INTO reminders (user_id, note_id, title, description, scheduled_at)
					 VALUES ${values}`,
					notes.flatMap((note: { id: number | string; title: string }) => [
						userId,
						note.id,
						note.title,
						'',
						scheduledAt
					])
				);
			} else {
				const [result]: any = await connection.execute(
					`UPDATE notes
					 SET deleted_at = NOW()
					 WHERE user_id = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
					[userId, ...noteIds]
				);
				if (result.affectedRows !== noteIds.length) {
					await connection.rollback();
					return jsonResponse({ success: false, message: 'One or more selected notes could not be moved to Trash.' }, 409);
				}
				await connection.execute(
					`UPDATE note_preferences SET is_pinned = 0 WHERE note_id IN (${placeholders})`,
					noteIds
				);
			}

			await connection.commit();
			return jsonResponse({ success: true, action, affectedCount: noteIds.length });
		} catch (error) {
			try {
				await connection.rollback();
			} catch (rollbackError) {
				console.error('Bulk note transaction rollback error:', rollbackError);
			}
			throw error;
		} finally {
			connection.release();
		}
	} catch (error) {
		console.error('Bulk note action error:', error);
		return jsonResponse({ success: false, message: 'Unable to apply this action to the selected notes.' }, 500);
	}
};
