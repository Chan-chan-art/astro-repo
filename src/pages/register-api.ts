import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.formData();
    const username = data.get("username");
    const email = data.get("email");
    const password = data.get("password")?.toString();


    // 1. Core Fields Validation
    if (!username || !email || !password) {
      return new Response(JSON.stringify({ success: false, message: "Please fill out all fields." }), { status: 400 });
    }

    // 2. Check if username or email already exists to avoid SQL duplicate crashes
    const [existingUsers]: any = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return new Response(JSON.stringify({ success: false, message: "Username or Email is already taken." }), { status: 400 });
    }

    // 3. Encrypt the password safely using Node's standard Crypto module
    // Storing plain text passwords in an ecosystem can be highly vulnerable!
    const { createHash } = await import('crypto');
    const hashedPassword = createHash('sha256').update(password).digest('hex');

    // 4. Insert new account into the MySQL table safely
    await pool.execute(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    return new Response(JSON.stringify({ success: true, message: "Account created successfully! You can now log in." }), { status: 201 });

  } catch (error) {
    console.error("Registration Database Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A database error occurred during sign up." }), { status: 500 });
  }
};
