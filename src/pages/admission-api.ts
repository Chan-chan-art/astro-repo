// src/pages/admission-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';
import fs from 'node:fs/promises';
import path from 'node:path';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const sessionCookie = cookies.get("user_session");
    // 🌟 FIX: Parse the session data as a clean JSON object!
    const sessionData = sessionCookie ? sessionCookie.json() : null; 

    if (!sessionData) {
      return new Response(JSON.stringify({ success: false, message: "Unauthorized session state." }), { status: 401 });
    }
    
    // 🌟 FIX: Extract the actual clean string username out of the object
    const username = sessionData.username; 

    const data = await request.formData();
    const courseName = data.get("courseName")?.toString().trim();
    const file = data.get("documentFile") as File | null;

    if (!courseName) {
      return new Response(JSON.stringify({ success: false, message: "Course selection is required." }), { status: 400 });
    }

    // 1. Identify User ID using the clean username string safely
    const [userRows]: any = await pool.execute('SELECT id FROM users WHERE BINARY username = ?', [username]);
    if (!userRows || userRows.length === 0) {
      return new Response(JSON.stringify({ success: false, message: "User profile trace not found." }), { status: 404 });
    }
    const userId = userRows[0].id; // 🌟 Fix: Ensure we read position [0] from the rows array

    let savedDocumentUrl: string | null = null;

    // 2. Handle Document Upload (PDF/Images)
    if (file && file.size > 0 && file.name !== "undefined") {
      const fileExtension = path.extname(file.name) || '.pdf';
      const uniqueFilename = `doc-${username}-${Date.now()}${fileExtension}`;
      const publicUploadPath = path.join(process.cwd(), 'public', 'documents');
      
      await fs.mkdir(publicUploadPath, { recursive: true });
      const bytes = await file.arrayBuffer();
      await fs.writeFile(path.join(publicUploadPath, uniqueFilename), Buffer.from(bytes));
      
      savedDocumentUrl = `/documents/${uniqueFilename}`;
    }

    // 3. Insert or Update Application Record safely
    const [existing]: any = await pool.execute('SELECT id FROM admissions WHERE user_id = ?', [userId]);

    if (existing.length > 0) {
      if (savedDocumentUrl) {
        await pool.execute('UPDATE admissions SET course_name = ?, document_url = ? WHERE user_id = ?', [courseName, savedDocumentUrl, userId]);
      } else {
        await pool.execute('UPDATE admissions SET course_name = ? WHERE user_id = ?', [courseName, userId]);
      }
    } else {
      await pool.execute('INSERT INTO admissions (user_id, course_name, document_url) VALUES (?, ?, ?)', [userId, courseName, savedDocumentUrl]);
    }

    return new Response(JSON.stringify({ success: true, message: "Application details submitted successfully!" }), { status: 200 });

  } catch (error) {
    console.error("Admission API Error:", error);
    return new Response(JSON.stringify({ success: false, message: "Server error handling submission." }), { status: 500 });
  }
};
