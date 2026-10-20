// src/pages/login-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

// Lightweight in-memory cache to store IP attempt counts for rate limiting
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  try {
    const ip = clientAddress || "unknown_ip";
    const currentTime = Date.now();
    
    // 1. Rate Limiting Check
    if (!rateLimitCache.has(ip)) {
      rateLimitCache.set(ip, { count: 1, resetTime: currentTime + 60 * 1000 });
    } else {
      const record = rateLimitCache.get(ip)!;
      if (currentTime > record.resetTime) {
        record.count = 1;
        record.resetTime = currentTime + 60 * 1000;
      } else {
        record.count += 1;
      }

      if (record.count > 5) {
        const secondsLeft = Math.ceil((record.resetTime - currentTime) / 1000);
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Too many login attempts. Please wait ${secondsLeft} seconds before trying again.` 
        }), { status: 429 });
      }
    }

    // 2. Extract FormData Parameters securely
    const data = await request.formData();
    const username = data.get("username")?.toString().trim();
    const password = data.get("password")?.toString();
    const rememberMe = data.get("rememberMe")?.toString() === "on";

    if (!username || !password) {
      return new Response(JSON.stringify({ success: false, message: "Please enter both username and password." }), { status: 400 });
    }

    // Update your SELECT query to pull the is_verified status
    const [rows]: any = await pool.execute(
      'SELECT id, username, password, is_verified FROM users WHERE BINARY username = ?',
      [username]
    );

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "Username does not exist." }), { status: 401 });
    }

    const dbUser = rows[0];

    // 🛑 🌟 SECURITY BLOCK: If the account is not verified, stop them right here!
    if (dbUser.is_verified === 0) {
      return new Response(JSON.stringify({ success: false, message: "Your email address is unverified. Please verify your email first." }), { status: 403 });
    }
 // 4. Encrypt the input password with SHA-256 to match Registration ecosystem
    const { createHash } = await import('crypto');
    const inputHash = createHash('sha256').update(password).digest('hex');

    // 5. Compare Credentials
    if (dbUser.password === inputHash) {
      // Establish dynamic session lifespan based on Remember Me parameters
      const cookieAge = rememberMe ? 60 * 60 * 24 * 30 : undefined;


    // ... your password checking logic follows exactly as before ...

      cookies.set('user_session', dbUser.username, {
        path: '/',
        httpOnly: true,
        secure: true,
        maxAge: cookieAge
      });

      return new Response(JSON.stringify({ success: true, message: "Login successful!" }), { status: 200 });
    } else {
      return new Response(JSON.stringify({ success: false, message: "Incorrect password selection." }), { status: 401 });
    }

  } catch (error) {
    console.error("Login Server Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server database error occurred." }), { status: 500 });
  }
};
