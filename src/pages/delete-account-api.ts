// src/pages/delete-account-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ cookies }) => {
  try {
    // 1. Authenticate user session string context
    const sessionCookie = cookies.get("user_session");
    if (!sessionCookie) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized request state." }), { status: 401 });
    }
    const username = sessionCookie.value;

    // 2. Fetch their avatar filename location to verify if we need to purge a hard drive block
    const [rows]: any = await pool.execute(
      'SELECT avatar_url FROM users WHERE BINARY username = ?',
      [username]
    );

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "Account mapping trace not found." }), { status: 404 });
    }

    const currentAvatarUrl = rows[0].avatar_url;

    // 3. 🌟 PHYSICAL FILE CLEANUP PURGE
    // Check if they are using a custom uploaded file rather than our fallback asset link
    if (currentAvatarUrl && currentAvatarUrl.startsWith('/uploads/')) {
      try {
        // Resolve target absolute path direction on your local machine hard drive
        const physicalFilePath = path.join(process.cwd(), 'public', currentAvatarUrl);
        
        // Use fs.unlink to delete the file permanently from the folder structure
        await fs.unlink(physicalFilePath);
        console.log(`\n🗑️ [PHYSICAL FILE DELETED]: Purged ${physicalFilePath} successfully.`);
      } catch (fileErr: any) {
        // Log minor warning if file wasn't found on disk but don't crash the whole function layout
        console.warn("File cleanup warning (File might have already been removed):", fileErr.message);
      }
    }

    // 4. Delete the User Record Row completely out of MySQL
    await pool.execute(
      'DELETE FROM users WHERE BINARY username = ?',
      [username]
    );
    console.log(`❌ [DATABASE ROW DELETED]: User account "${username}" removed.`);

    // 5. Destroy active browser tracking parameters instantly
    cookies.delete('user_session', { path: '/' });

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Your account and all associated profile attachment data have been deleted successfully." 
    }), { status: 200 });

  } catch (error) {
    console.error("Account Deletion Failure:", error);
    return new Response(JSON.stringify({ success: false, message: "A server destruction pipeline error occurred." }), { status: 500 });
  }
};
