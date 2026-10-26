// src/pages/admin-api.ts
import type { APIRoute } from 'astro';
import { pool } from '../lib/db';

export const prerender = false;

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    // 1. Grab your cookie session object securely
    const sessionCookie = cookies.get("user_session");
    const sessionData = sessionCookie ? sessionCookie.json() : null;

    // 🌟 FIX: Securely validate admin authority status using our clean JSON format!
    if (!sessionData || sessionData.role !== 'admin') {
      return new Response(JSON.stringify({ success: false, message: "Access denied. Admins only." }), { status: 403 });
    }

    const data = await request.formData();
    const admissionId = data.get("admissionId")?.toString();
    const newStatus = data.get("status")?.toString();

    if (!admissionId || !newStatus) {
      return new Response(JSON.stringify({ success: false, message: "Missing data parameters." }), { status: 400 });
    }

    // 2. Update the application status row inside your admissions table layout safely
    await pool.execute(
      'UPDATE admissions SET application_status = ? WHERE id = ?',
      [newStatus, admissionId]
    );

    return new Response(JSON.stringify({ success: true, message: "Application status updated successfully!" }), { status: 200 });

  } catch (error) {
    console.error("Admin Status API Error:", error);
    return new Response(JSON.stringify({ success: false, message: "A server gate error occurred." }), { status: 500 });
  }
};
