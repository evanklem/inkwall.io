import React, { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Line, Image as KImage } from 'react-konva';
import useImage from 'use-image';
import { supabase } from '../lib/supabaseClient';
import { getSessionId } from '../lib/session';

const PAGE_ID = 'page_01'; // replace per routing

function flattenPoints(points) {
  // Accept either [[x,y],...] or [x,y,x,y,...]
  if (!points) return [];
  if (!Array.isArray(points)) return [];
  if (points.length === 0) return [];
  if (typeof points[0] === 'number') return points; // already flat
  return points.flat();
}

function downsample(points, stride = 2) {
  if (!points || points.length <= 100) return points;
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  const last = points[points.length - 1];
  if (out.length === 0 || out[out.length - 1] !== last) out.push(last);
  return out;
}

export default function DrawingCanvas({ pageMeta, initialStrokes = [], onNewStrokeFromRealtime }) {
  const stageRef = useRef();
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]); // [[x,y],...]
  const [localStrokes, setLocalStrokes] = useState(initialStrokes || []);
  const session_id = getSessionId();
  const [snapshotImg] = useImage(pageMeta?.snapshot_url || null);

  // if parent passes new initialStrokes later, sync them
  useEffect(() => {
    setLocalStrokes(initialStrokes || []);
  }, [initialStrokes]);

  // subscribe to realtime strokes (Supabase JS v2 channel API)
  useEffect(() => {
    const channel = supabase.channel('strokes_channel');

    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'strokes',
        filter: `page_id=eq.${PAGE_ID}`,
      },
      (payload) => {
        const stroke = payload?.new;
        if (!stroke) return;
        // optional callback to parent
        onNewStrokeFromRealtime?.(stroke);
        setLocalStrokes((s) => [...s, stroke]);
      }
    );

    // subscribe
    channel.subscribe();

    // cleanup
    return () => {
      supabase.removeChannel(channel);
    };
    // intentionally subscribe once on mount for this PAGE_ID
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // pointer handlers
  function handlePointerDown(e) {
    setIsDrawing(true);
    const pos = e.target.getStage().getPointerPosition();
    setCurrentPoints([[pos.x, pos.y]]);
  }

  function handlePointerMove(e) {
    if (!isDrawing) return;
    const pos = e.target.getStage().getPointerPosition();
    setCurrentPoints((prev) => {
      return [...prev, [pos.x, pos.y]];
    });
  }

  async function handlePointerUp() {
    if (!isDrawing) return;
    setIsDrawing(false);
    const raw = currentPoints;
    if (!raw || raw.length < 2) {
      setCurrentPoints([]);
      return;
    }

    const points = downsample(raw, 2);
    const stroke = {
      page_id: PAGE_ID,
      session_id,
      color: '#ff0066',
      width: 3,
      points, // stored as array-of-arrays (JSONB)
      tool: 'pen',
      created_at: new Date().toISOString(),
    };

    // optimistic add with a temp id
    const tempId = `temp-${Date.now()}`;
    setLocalStrokes((s) => [...s, { ...stroke, id: tempId }]);
    setCurrentPoints([]);

    // call Edge Function / RPC that enforces cooldown
    try {
      const res = await fetch(`https://irogfamckqyghjcyglpu.functions.supabase.co/insert-stroke`, {
        method: 'POST',
        headers: { 
          'ContentType': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(stroke),
      });

      if (!res.ok) {
        console.warn('stroke rejected', res.status);
        setLocalStrokes((s) => s.filter((st) => st.id !== tempId));
        return;
      }

      const created = await res.json(); // should be the inserted row including id
      setLocalStrokes((s) => s.map((st) => (st.id === tempId ? created : st)));
    } catch (err) {
      console.error('network error inserting stroke', err);
      setLocalStrokes((s) => s.filter((st) => st.id !== tempId));
    }
  }

   if (!pageMeta) return null; // guard

  return (
    <div style={{ width: pageMeta.width, height: pageMeta.height }}>
      <Stage
        width={pageMeta.width}
        height={pageMeta.height}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        ref={stageRef}
      >
        <Layer>
          {snapshotImg && (
            <KImage
              image={snapshotImg}
              x={0}
              y={0}
              width={pageMeta.width}
              height={pageMeta.height}
            />
          )}
        </Layer>

        <Layer>
          {localStrokes.map((s) => (
            <Line
              key={s.id}
              points={flattenPoints(s.points)}
              stroke={s.color}
              strokeWidth={s.width}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
              globalCompositeOperation={
                s.tool === 'eraser' ? 'destination-out' : 'source-over'
              }
            />
          ))}
        </Layer>

        {currentPoints.length > 0 && (
          <Layer>
            <Line
              points={flattenPoints(currentPoints)}
              stroke="#000"
              strokeWidth={3}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
            />
          </Layer>
        )}
      </Stage>
    </div>
  );
}

