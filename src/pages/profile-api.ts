import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // 1. Authenticate Request
    const sessionCookie = cookies.get("user_session");
    const sessionData = sessionCookie ? sessionCookie.json() : null;
    if (!sessionData || !sessionData.username) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized account session" }), { status: 401 });
    }
    const username = sessionData.username;

    // 2. Parse Multipart Form Fields
    const formData = await request.formData();
    const displayName = formData.get("displayName")?.toString() || "";
    const address = formData.get("address")?.toString() || "";
    const bio = formData.get("bio")?.toString() || "";
    const avatarFile = formData.get("avatarFile") as File | null;

    let avatarUrl = undefined;

    // 3. Process Avatar File Upload if present
    if (avatarFile && avatarFile.size > 0 && avatarFile.name !== "undefined") {
      const buffer = Buffer.from(await avatarFile.arrayBuffer());
      const uniqueFilename = `${Date.now()}-${avatarFile.name.replace(/\s+/g, "-")}`;
      
      // Save directly to Astro project's public asset path
      const publicPath = path.join(process.cwd(), 'public', 'uploads');
      await fs.mkdir(publicPath, { recursive: true });
      await fs.writeFile(path.join(publicPath, uniqueFilename), buffer);
      
      avatarUrl = `/uploads/${uniqueFilename}`;
    }

    // 4. Persist to Database
    if (avatarUrl) {
      await pool.execute(
        'UPDATE users SET display_name = ?, address = ?, bio = ?, avatar_url = ? WHERE BINARY username = ?',
        [displayName, address, bio, avatarUrl, username]
      );
    } else {
      await pool.execute(
        'UPDATE users SET display_name = ?, address = ?, bio = ? WHERE BINARY username = ?',
        [displayName, address, bio, username]
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Profile Update API Error:", error);
    return new Response(JSON.stringify({ success: false, message: "Server encountered an operational database error" }), { status: 500 });
  }
};


