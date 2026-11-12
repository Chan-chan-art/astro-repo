import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const sessionCookie = cookies.get("user_session");
    const sessionData = sessionCookie ? sessionCookie.json() : null;
    if (!sessionData || !sessionData.username) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session" }), { status: 401 });
    }
    const username = sessionData.username;

    // Overwrite your image extraction logic inside src/pages/profile-api.ts:
const formData = await request.formData();
const displayName = formData.get("displayName")?.toString().trim() || "";
const address = formData.get("address")?.toString().trim() || "";
const bio = formData.get("bio")?.toString().trim() || "";

// 🌟 READ THE LIGHTWEIGHT COMPRESSED CANVAS STRING
const compressedAvatarString = formData.get("compressedAvatarString")?.toString();

let finalAvatarUrl = null;

if (compressedAvatarString && compressedAvatarString.startsWith("data:image/")) {
  finalAvatarUrl = compressedAvatarString;
}

// Persist string records straight to MySQL safely
if (finalAvatarUrl) {
  await pool.execute(
    'UPDATE users SET display_name = ?, address = ?, bio = ?, avatar_url = ? WHERE BINARY username = ?',
    [displayName, address, bio, finalAvatarUrl, username]
  );
} else {
  await pool.execute(
    'UPDATE users SET display_name = ?, address = ?, bio = ? WHERE BINARY username = ?',
    [displayName, address, bio, username]
  );
}

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Profile API Error:", error);
    return new Response(JSON.stringify({ success: false, message: "Database update error" }), { status: 500 });
  }
};
