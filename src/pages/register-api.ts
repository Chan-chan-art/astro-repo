import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import crypto from 'node:crypto'; // Native, built-in Node.js module

export const prerender = false;

// Secure hashing helper using native Node.js crypto
function hashPasswordNative(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const formData = await request.formData();
    
    const displayName = formData.get("displayName")?.toString().trim();
    const username = formData.get("username")?.toString().trim();
    const password = formData.get("password")?.toString();

    // 1. Validation Check
    if (!displayName || !username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: "Please fill out all fields." }), 
        { status: 400 }
      );
    }

    // 2. Look for existing identical usernames
    const [existingUsers]: any = await pool.execute(
      'SELECT id FROM users WHERE BINARY username = ?',
      [username]
    );

    if (existingUsers.length > 0) {
      return new Response(
        JSON.stringify({ success: false, message: "Username is already taken." }), 
        { status: 409 }
      );
    }

    // 3. Hash securely using native scrypt
    const secureHashedPassword = hashPasswordNative(password);

    // 4. Generate a unique placeholder email to bypass the database constraint
    const placeholderEmail = `${username}_${Date.now()}@local.dev`;

    // 5. Save into Database including the placeholder email field
    await pool.execute(
      'INSERT INTO users (username, display_name, password, email) VALUES (?, ?, ?, ?)',
      [username, displayName, secureHashedPassword, placeholderEmail]
    );

    // 6. Create login session cookie
    cookies.set("user_session", JSON.stringify({ username }), {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, 
    });

    return new Response(JSON.stringify({ success: true }), { status: 201 });

  } catch (error) {
    console.error("Registration Processing Failure:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server processing error." }), 
      { status: 500 }
    );
  }
};
