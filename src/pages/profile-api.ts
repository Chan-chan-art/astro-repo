// src/pages/profile-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const sessionCookie = cookies.get("user_session");
    if (!sessionCookie) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session state." }), { status: 401 });
    }
    const username = sessionCookie.value;

    const data = await request.formData();
    const displayName = data.get("displayName")?.toString().trim() || null;
    const bio = data.get("bio")?.toString().trim() || null;
    const address = data.get("address")?.toString().trim() || null;
    
    // 1. Extract the file parameter
    const file = data.get("avatarFile") as File | null;
    let savedAvatarUrl: string | null = null;

    // Check if the user actually chose a file and it isn't empty
    if (file && file.size > 0 && file.name !== "undefined") {
      // Create a unique filename using timestamps to avoid duplicate filename collisions
      const fileExtension = path.extname(file.name) || '.png';
      const uniqueFilename = `${username}-${Date.now()}${fileExtension}`;
      
      // Determine your project's local public storage destination path
      const publicUploadPath = path.join(process.cwd(), 'public', 'uploads');
      
      // Ensure the 'public/uploads' directory folder exists cleanly on your computer
      await fs.mkdir(publicUploadPath, { recursive: true });
      
      // Convert the uploaded binary file data into a buffer stream array
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      
      // Write the file to your hard drive folder location
      const fullFilePath = path.join(publicUploadPath, uniqueFilename);
      await fs.writeFile(fullFilePath, buffer);
      
      // Save this path link to insert into MySQL
      savedAvatarUrl = `/uploads/${uniqueFilename}`;
    }

    // 2. Perform the database update dynamically
    if (savedAvatarUrl) {
      // If a file was uploaded, update all fields including avatar_url
      await pool.execute(
        'UPDATE users SET display_name = ?, bio = ?, address = ?, avatar_url = ? WHERE BINARY username = ?',
        [displayName, bio, address, savedAvatarUrl, username]
      );
    } else {
      // If no file was chosen, keep their existing avatar intact
      await pool.execute(
        'UPDATE users SET display_name = ?, bio = ?, address = ? WHERE BINARY username = ?',
        [displayName, bio, address, username]
      );
    }

    return new Response(JSON.stringify({ success: true, message: "Profile and Avatar updated successfully!" }), { status: 200 });

  } catch (error) {
    console.error("Profile API Upload Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server file upload error occurred." }), { status: 500 });
  }
};
