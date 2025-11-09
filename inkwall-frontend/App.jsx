import React, { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";

export default function App() {
  const [page, setPage] = useState(null);
  const [error, setError] = useState(null);
  const PAGE_ID = "page_01";

  useEffect(() => {
    async function loadPage() {
      const { data, error } = await supabase
        .from("pages")
        .select("*")
        .eq("id", PAGE_ID)
        .single();

      if (error) {
        console.error("Supabase error:", error);
        setError(error);
      } else {
        setPage(data);
      }
    }

    loadPage();
  }, []);

  if (error) {
    return (
      <div style={{ padding: 20, color: "red" }}>
        <h2>Error loading page</h2>
        <pre>{error.message}</pre>
      </div>
    );
  }

  if (!page) return <div style={{ padding: 20 }}>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h1>Page: {page.id}</h1>
      <p>
        Width: {page.width}px <br />
        Height: {page.height}px
      </p>
      <p>Snapshot URL: {page.snapshot_url ?? "(none)"}</p>
      <p>Last Updated: {new Date(page.snapshot_ts).toLocaleString()}</p>
    </div>
  );
}

