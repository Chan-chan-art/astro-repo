import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ cookies, redirect }) => {
  // Delete the cookie by explicitly clearing its value and setting its expiration to the past
  cookies.delete("user_session", { path: "/" });
  
  // Clean redirect back to the home / login layout
  return redirect('/', 302);
};
