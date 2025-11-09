// supabase/functions/insert-stroke/index.ts

// Optional: type hints for Supabase Edge runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Lightweight secret for basic protection (set this in your .env)
const PUBLIC_SECRET = Deno.env.get("INSERT_STROKE_SECRET");

Deno.serve(async (req) => {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Optional: check a secret token sent in header
    const token = req.headers.get("x-insert-stroke-secret");
    if (PUBLIC_SECRET && token !== PUBLIC_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse JSON body
    const body = await req.json();

    // Read env vars for your Supabase project
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      console.error("Missing environment variables for Supabase client");
      return new Response(JSON.stringify({ error: "Server misconfigured" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Admin client with full access
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Insert the stroke
    const { data, error } = await supabase
      .from("strokes")
      .insert([body])
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Return the inserted row with CORS headers
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // allow requests from anywhere
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Invalid request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

