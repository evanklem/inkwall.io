import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import DrawingCanvas from './components/DrawingCanvas';
import { getSessionId } from './lib/session';

const PAGE_ID = 'page_01'; // for now, hardcode one page

export default function App() {
  const [pageMeta, setPageMeta] = useState(null);
  const [strokes, setStrokes] = useState([]);
  const session_id = getSessionId();

  useEffect(() => {
    async function load() {
      const { data: page } = await supabase
        .from('pages')
        .select('*')
        .eq('id', PAGE_ID)
        .single();

      const { data: strokes } = await supabase
        .from('strokes')
        .select('*')
        .eq('page_id', PAGE_ID)
        .order('created_at', { ascending: true });

      setPageMeta(page);
      setStrokes(strokes);
    }
    load();
  }, []);

  if (!pageMeta) return <p>Loading...</p>;

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
      <DrawingCanvas
        pageMeta={pageMeta}
        initialStrokes={strokes}
        onNewStrokeFromRealtime={(stroke) => setStrokes((s) => [...s, stroke])}
      />
    </div>
  );
}

