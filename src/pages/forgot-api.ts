// src/pages/forgot-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.formData();
    const email = data.get("email")?.toString().trim();

    if (!email) {
      return new Response(JSON.stringify({ success: false, message: "Please enter your email address." }), { status: 400 });
    }

    // 1. Check if the user email exists in MySQL
    const [rows]: any = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      // For security, don't explicitly say "email doesn't exist" to prevent user enumeration
      return new Response(JSON.stringify({ success: true, message: "If that email exists, a reset link has been generated." }), { status: 200 });
    }

    // 2. Generate a random, cryptographically secure reset token
    const { randomBytes } = await import('crypto');
    const token = randomBytes(20).toString('hex');

    // 3. Set expiration timestamp to 1 hour from now
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);
    
    // Format date for MySQL compatibility (YYYY-MM-DD HH:MM:SS)
    const mysqlExpires = expires.toISOString().slice(0, 19).replace('T', ' ');

    // 4. Update the user row in the database
    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?',
      [token, mysqlExpires, email]
    );

    // 🌟 DEVELOPER LOG: Because we don't have an email server, we print the link here!
    console.log("\n🔑 [PASSWORD RESET LINK GENERATED] 🔑");
    console.log(`Copy and paste this link to test your reset form:\n`);
    console.log(`http://localhost:4321/reset-password?token=${token}\n`);

    return new Response(JSON.stringify({ 
      success: true, 
      message: "A password reset link has been successfully generated! Check your VS Code terminal console to click it." 
    }), { status: 200 });

  } catch (error) {
    console.error("Forgot Password Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server error occurred." }), { status: 500 });
  }
};
