// src/pages/change-password-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // 1. Identify which user is logged in via their cookie session status
    const sessionCookie = cookies.get("user_session");
    if (!sessionCookie) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session state." }), { status: 401 });
    }
    const username = sessionCookie.value;

    const data = await request.formData();
    const currentPassword = data.get("currentPassword")?.toString();
    const newPassword = data.get("newPassword")?.toString();

    if (!currentPassword || !newPassword) {
      return new Response(JSON.stringify({ success: false, message: "All input fields are required." }), { status: 400 });
    }

    if (newPassword.length < 6) {
      return new Response(JSON.stringify({ success: false, message: "New password must be at least 6 characters." }), { status: 400 });
    }

    // 2. Query the user record row using exact binary matching checks
    const [rows]: any = await pool.execute(
      'SELECT password FROM users WHERE BINARY username = ?',
      [username]
    );

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "User account context trace lost." }), { status: 404 });
    }

    const dbUser = rows[0];

    // 3. Encrypt the typed CURRENT password to verify authority ownership
    const { createHash } = await import('crypto');
    const currentInputHash = createHash('sha256').update(currentPassword).digest('hex');

    if (dbUser.password !== currentInputHash) {
      return new Response(JSON.stringify({ success: false, message: "Current password input is incorrect." }), { status: 401 });
    }

    // 4. Encrypt and save the newly selected password string choice securely
    const newPasswordHash = createHash('sha256').update(newPassword).digest('hex');

    await pool.execute(
      'UPDATE users SET password = ? WHERE BINARY username = ?',
      [newPasswordHash, username]
    );

    return new Response(JSON.stringify({ success: true, message: "Your password has been changed successfully!" }), { status: 200 });

  } catch (error) {
    console.error("Change Password Backend Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server database error occurred." }), { status: 500 });
  }
};
