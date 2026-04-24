"use client";

import { useEffect, useRef, useState } from "react";
import type { WsMessage } from "./types";

export function useWs(url: string, onMessage: (m: WsMessage) => void) {
  const [connected, setConnected] = useState(false);
  const ref = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(url);
      ref.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!cancelled) reconnectTimer = setTimeout(connect, 1000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data) as WsMessage);
        } catch {}
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [url]);

  return {
    connected,
    send: (data: unknown) => {
      ref.current?.send(JSON.stringify(data));
    },
  };
}
