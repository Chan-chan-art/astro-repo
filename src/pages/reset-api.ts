// src/pages/reset-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.formData();
    const token = data.get("token")?.toString();
    const password = data.get("password")?.toString();

    if (!token || !password) {
      return new Response(JSON.stringify({ success: false, message: "Missing reset data parameters." }), { status: 400 });
    }

    // 1. Double check that the token is still valid before saving the change
    const [rows]: any = await pool.execute(
      'SELECT id FROM users WHERE reset_token = ?',
      [token]
    );

    if (rows.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "This link is expired or invalid." }), { status: 400 });
    }

    // 2. Hash the brand new password using SHA-256 to match your registration ecosystem
    const { createHash } = await import('crypto');
    const newHash = createHash('sha256').update(password).digest('hex');

    // 3. Update the password row AND nullify the token parameters so they are destroyed
    await pool.execute(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ?',
      [newHash, token]
    );

    return new Response(JSON.stringify({ success: true, message: "Your password has been reset successfully! You can now log in." }), { status: 200 });

  } catch (error) {
    console.error("Password Update Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server database error occurred." }), { status: 500 });
  }
};
