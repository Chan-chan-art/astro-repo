import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  try {
    // 1. Let the request continue to its intended page/API endpoint route
    return await next();
  } catch (error: any) {
    // 2. CRASH CAPTURED: Check if the error is related to your MySQL pool connection
    const errorMessage = error?.message || "";
    const isDatabaseCrash = 
      errorMessage.includes("ECONNREFUSED") || 
      errorMessage.includes("PROTOCOL_") || 
      errorMessage.includes("pool") ||
      errorMessage.includes("database") ||
      error?.code?.startsWith("ER_");

    // 3. Log the precise error silently into your VS Code terminal for you to debug
    console.error(`\n[🚨 GLOBAL APP CATCHER] Incident Logged at ${new Date().toLocaleTimeString()}`);
    console.error(`Target Route Path: ${context.url.pathname}`);
    console.error(`Error Details: ${error}\n`);

    // 4. Handle API routes vs standard HTML pages elegantly
    if (context.url.pathname.endsWith("-api") || context.request.headers.get("accept")?.includes("application/json")) {
      // If an API request crashes, return a structured JSON response so spinners stop loading
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Database workspace offline. Your transaction was safely aborted." 
        }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // 5. If it's a regular page (like the dashboard), pass a safe message to Astro.locals and render 500 page
    if (isDatabaseCrash) {
      context.locals.errorMessage = "Our database station went offline unexpectedly. Engineering has been alerted.";
    } else {
      context.locals.errorMessage = "An unexpected error occurred processing your workspace portal layout.";
    }

    // Rewrite the request stream to show your custom 500 safety page
    return context.rewrite("/500");
  }
});
