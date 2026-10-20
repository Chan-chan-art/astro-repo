// src/pages/register-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.formData();
    const username = data.get("username")?.toString().trim();
    const email = data.get("email")?.toString().trim();
    const password = data.get("password")?.toString();

    if (!username || !email || !password) {
      return new Response(JSON.stringify({ success: false, message: "Please fill out all fields." }), { status: 400 });
    }

    // 1. Check if username or email already exists
    const [existingUsers]: any = await pool.execute(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUsers.length > 0) {
      return new Response(JSON.stringify({ success: false, message: "Username or Email is already taken." }), { status: 400 });
    }

    // 2. Encrypt the password using SHA-256
    const { createHash, randomBytes } = await import('crypto');
    const hashedPassword = createHash('sha256').update(password).digest('hex');

    // 3. 🌟 GENERATE VERIFICATION TOKEN
    const verificationToken = randomBytes(20).toString('hex');

    // 4. Insert user as UNVERIFIED (is_verified = 0) with the token
    await pool.execute(
      'INSERT INTO users (username, email, password, is_verified, verification_token) VALUES (?, ?, ?, 0, ?)',
      [username, email, hashedPassword, verificationToken]
    );

    // 🌟 DEVELOPER LOG: Print the link directly to your terminal for local testing
    console.log("\n✉️ [EMAIL VERIFICATION LINK GENERATED] ✉️");
    console.log(`Click this link to verify the new account:\n`);
    console.log(`http://localhost:4321/verify-email?token=${verificationToken}\n`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Registration successful! Please check your VS Code terminal console to click the verification link." 
    }), { status: 201 });

  } catch (error) {
    console.error("Registration Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A database error occurred." }), { status: 500 });
  }
};
