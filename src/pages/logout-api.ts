// src/pages/logout-api.ts
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  // 1. Delete the user's active session cookie
  cookies.delete('user_session', { path: '/' });

  // 2. Clear out the connection cache and send them home
  return redirect('/', 302);
};
