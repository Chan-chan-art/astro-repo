import type { APIRoute, AstroCookies } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

type ReminderInput = {
	title?: unknown;
	description?: unknown;
	date?: unknown;
	time?: unknown;
	completed?: unknown;
	noteId?: unknown;
};

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
		console.warn('Reminder API rejected a malformed session cookie.', error);
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

async function ownsReminder(reminderId: string, userId: number): Promise<boolean> {
	const [rows]: any = await pool.execute(
		'SELECT id FROM reminders WHERE id = ? AND user_id = ?',
		[reminderId, userId]
	);
	return rows.length === 1;
}

function validDate(date: unknown): date is string {
	if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
	const parsed = new Date(`${date}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function validTime(time: unknown): time is string {
	return typeof time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function validateReminder(payload: ReminderInput) {
	const title = typeof payload.title === 'string' ? payload.title.trim() : '';
	const description = typeof payload.description === 'string' ? payload.description.trim() : '';
	if (!title || title.length > 150) return { error: 'Enter a reminder title up to 150 characters.' };
	if (description.length > 2000) return { error: 'Reminder descriptions must be 2,000 characters or fewer.' };
	if (!validDate(payload.date) || !validTime(payload.time)) {
		return { error: 'Choose a valid reminder date and time.' };
	}
	return {
		title,
		description,
		scheduledAt: `${payload.date} ${payload.time}:00`
	};
}

export const GET: APIRoute = async ({ cookies, url }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		const fields = `r.id, r.note_id AS noteId, n.title AS noteTitle,
			r.title, r.description,
			DATE_FORMAT(r.scheduled_at, '%Y-%m-%d') AS date,
			TIME_FORMAT(r.scheduled_at, '%H:%i') AS time,
			r.is_completed AS completed,
			DATE_FORMAT(r.completed_at, '%Y-%m-%d %H:%i:%s') AS completedAt`;
		const joinClause = `FROM reminders r
			LEFT JOIN notes n ON r.note_id = n.id AND n.deleted_at IS NULL`;

		const rangeStart = url.searchParams.get('from');
		const rangeEnd = url.searchParams.get('to');

		if (rangeStart || rangeEnd) {
			if (!validDate(rangeStart) || !validDate(rangeEnd) || rangeStart > rangeEnd) {
				return jsonResponse({ success: false, message: 'Choose a valid calendar date range.' }, 400);
			}
			const [rows]: any = await pool.execute(
				`SELECT ${fields}
				 ${joinClause}
				 WHERE r.user_id = ? AND r.scheduled_at >= ? AND r.scheduled_at < DATE_ADD(?, INTERVAL 1 DAY)
				 ORDER BY r.scheduled_at ASC`,
				[userId, `${rangeStart} 00:00:00`, `${rangeEnd} 00:00:00`]
			);
			return jsonResponse({ success: true, reminders: rows });
		}

		if (url.searchParams.get('mode') === 'monitor') {
			const [rows]: any = await pool.execute(
				`SELECT ${fields}
				 ${joinClause}
				 WHERE r.user_id = ? AND r.is_completed = 0
				   AND r.scheduled_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
				   AND r.scheduled_at <= DATE_ADD(NOW(), INTERVAL 30 DAY)
				 ORDER BY r.scheduled_at ASC`,
				[userId]
			);
			return jsonResponse({ success: true, reminders: rows });
		}

		const [rows]: any = await pool.execute(
			`SELECT ${fields}
			 ${joinClause}
			 WHERE r.user_id = ?
			 ORDER BY r.is_completed ASC, r.scheduled_at DESC`,
			[userId]
		);
		return jsonResponse({ success: true, reminders: rows });
	} catch (error) {
		console.error('Reminder list error:', error);
		return jsonResponse({ success: false, message: 'Unable to load reminders.' }, 500);
	}
};

export const POST: APIRoute = async ({ cookies, request }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		let payload: ReminderInput;
		try {
			payload = await request.json() as ReminderInput;
		} catch {
			return jsonResponse({ success: false, message: 'Invalid reminder request.' }, 400);
		}
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			return jsonResponse({ success: false, message: 'Invalid reminder request.' }, 400);
		}

		const reminder = validateReminder(payload);
		if ('error' in reminder) return jsonResponse({ success: false, message: reminder.error }, 400);

		let noteId: string | null = null;
		if (payload.noteId !== undefined && payload.noteId !== null && payload.noteId !== '') {
			const submittedNoteId = payload.noteId;
			const parsedId = typeof submittedNoteId === 'string' || typeof submittedNoteId === 'number'
				? String(submittedNoteId)
				: '';
			if (!/^[1-9]\d{0,19}$/.test(parsedId) ||
				(typeof submittedNoteId === 'number' && !Number.isSafeInteger(submittedNoteId))) {
				return jsonResponse({ success: false, message: 'Invalid note reference.' }, 400);
			}
			const [noteRows]: any = await pool.execute(
				'SELECT id FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
				[parsedId, userId]
			);
			if (noteRows.length !== 1) {
				return jsonResponse({ success: false, message: 'Linked note not found.' }, 404);
			}
			noteId = parsedId;
		}

		await pool.execute(
			'INSERT INTO reminders (user_id, note_id, title, description, scheduled_at) VALUES (?, ?, ?, ?, ?)',
			[userId, noteId, reminder.title, reminder.description, reminder.scheduledAt]
		);
		return jsonResponse({ success: true });
	} catch (error) {
		console.error('Reminder creation error:', error);
		return jsonResponse({ success: false, message: 'Unable to create this reminder.' }, 500);
	}
};

export const PUT: APIRoute = async ({ cookies, request, url }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		const reminderId = url.searchParams.get('id');
		if (!reminderId || !/^[1-9]\d{0,19}$/.test(reminderId)) {
			return jsonResponse({ success: false, message: 'A valid reminder identifier is required.' }, 400);
		}

		let payload: ReminderInput;
		try {
			payload = await request.json() as ReminderInput;
		} catch {
			return jsonResponse({ success: false, message: 'Invalid reminder update request.' }, 400);
		}
		if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
			return jsonResponse({ success: false, message: 'Invalid reminder update request.' }, 400);
		}

		if (typeof payload.completed === 'boolean' &&
			payload.title === undefined && payload.description === undefined &&
			payload.date === undefined && payload.time === undefined) {
			const [result]: any = await pool.execute(
				`UPDATE reminders
				 SET is_completed = ?, completed_at = ${payload.completed ? 'CURRENT_TIMESTAMP' : 'NULL'}
				 WHERE id = ? AND user_id = ?`,
				[payload.completed ? 1 : 0, reminderId, userId]
			);
			if (result.affectedRows !== 1 && !await ownsReminder(reminderId, userId)) {
				return jsonResponse({ success: false, message: 'Reminder not found.' }, 404);
			}
			return jsonResponse({ success: true });
		}

		if (payload.completed !== undefined && typeof payload.completed !== 'boolean') {
			return jsonResponse({ success: false, message: 'Invalid reminder completion status.' }, 400);
		}
		const reminder = validateReminder(payload);
		if ('error' in reminder) return jsonResponse({ success: false, message: reminder.error }, 400);
		const completed = payload.completed === true;
		const [result]: any = await pool.execute(
			`UPDATE reminders
			 SET title = ?, description = ?, scheduled_at = ?, is_completed = ?,
			     completed_at = ${completed ? 'CURRENT_TIMESTAMP' : 'NULL'}
			 WHERE id = ? AND user_id = ?`,
			[reminder.title, reminder.description, reminder.scheduledAt, completed ? 1 : 0, reminderId, userId]
		);
		if (result.affectedRows !== 1 && !await ownsReminder(reminderId, userId)) {
			return jsonResponse({ success: false, message: 'Reminder not found.' }, 404);
		}
		return jsonResponse({ success: true });
	} catch (error) {
		console.error('Reminder update error:', error);
		return jsonResponse({ success: false, message: 'Unable to update this reminder.' }, 500);
	}
};

export const DELETE: APIRoute = async ({ cookies, url }) => {
	try {
		const userId = await getUserId(cookies);
		if (!userId) return jsonResponse({ success: false, message: 'Unauthorized session.' }, 401);

		const reminderId = url.searchParams.get('id');
		if (!reminderId || !/^[1-9]\d{0,19}$/.test(reminderId)) {
			return jsonResponse({ success: false, message: 'A valid reminder identifier is required.' }, 400);
		}

		const [result]: any = await pool.execute(
			'DELETE FROM reminders WHERE id = ? AND user_id = ?',
			[reminderId, userId]
		);
		if (result.affectedRows !== 1) {
			return jsonResponse({ success: false, message: 'Reminder not found.' }, 404);
		}
		return jsonResponse({ success: true });
	} catch (error) {
		console.error('Reminder deletion error:', error);
		return jsonResponse({ success: false, message: 'Unable to delete this reminder.' }, 500);
	}
};
