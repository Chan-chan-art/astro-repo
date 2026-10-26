import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

// Helpers to quickly capture verified operational User ID from session data context
async function getUserIdFromSession(cookies: any): Promise<number | null> {
  const sessionCookie = cookies.get("user_session");
  const sessionData = sessionCookie ? sessionCookie.json() : null;
  if (!sessionData || !sessionData.username) return null;

  const [rows]: any = await pool.execute('SELECT id FROM users WHERE BINARY username = ?', [sessionData.username]);
  return rows.length === 1 ? rows[0].id : null;
}

// POST - Append New Notes
export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const userId = await getUserIdFromSession(cookies);
    if (!userId) return new Response(JSON.stringify({ success: false, message: "Unauthorized" }), { status: 401 });

    const formData = await request.formData();
    const title = formData.get("title")?.toString() || "";
    const content = formData.get("content")?.toString() || "";

    if (!title || !content) {
      return new Response(JSON.stringify({ success: false, message: "Title and body contexts are required fields" }), { status: 400 });
    }

    await pool.execute('INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)', [userId, title, content]);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: "Database creation fault" }), { status: 500 });
  }
};

