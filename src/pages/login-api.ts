import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import { verifyPassword } from '../lib/password';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const formData = await request.formData();
    const username = formData.get("username")?.toString().trim();
    const password = formData.get("password")?.toString();

    // 1. Basic validation mapping
    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: "Please fill out all fields." }), 
        { status: 400 }
      );
    }

    // 2. Query for the corresponding user identity payload
    const [userRows]: any = await pool.execute(
      'SELECT username, password FROM users WHERE BINARY username = ?',
      [username]
    );

    if (userRows.length !== 1) {
      // Security Best Practice: Use a generic error message so bots can't guess valid usernames
      return new Response(
        JSON.stringify({ success: false, message: "Invalid username or password credentials." }), 
        { status: 401 }
      );
    }

    const storedPasswordHash = userRows[0].password;

    // 3. Cryptographically verify input against our scrypt signature
    const isPasswordValid = verifyPassword(password, storedPasswordHash);

    if (!isPasswordValid) {
      return new Response(
        JSON.stringify({ success: false, message: "Invalid username or password credentials." }), 
        { status: 401 }
      );
    }

    // 4. Verification passing! Create a fresh cookie tracking session mapping
    cookies.set("user_session", JSON.stringify({ username }), {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 7, // 1 Week
    });

    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (error) {
    console.error("Login processing error instance:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server authentication error." }), 
      { status: 500 }
    );
  }
};
