// src/pages/reset-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import { hashPassword } from '../lib/password';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.formData();
    const token = data.get("token")?.toString();
    const password = data.get("password")?.toString();

    if (!token || !password) {
      return new Response(JSON.stringify({ success: false, message: "Missing reset data parameters." }), { status: 400 });
    }

    const newHash = hashPassword(password);
    const [result]: any = await pool.execute(
      'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE reset_token = ? AND reset_expires > NOW()',
      [newHash, token]
    );

    if (result.affectedRows !== 1) {
      return new Response(JSON.stringify({ success: false, message: "This link is expired or invalid." }), { status: 400 });
    }

    return new Response(JSON.stringify({ success: true, message: "Your password has been reset successfully! You can now log in." }), { status: 200 });

  } catch (error) {
    console.error("Password Update Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server database error occurred." }), { status: 500 });
  }
};
