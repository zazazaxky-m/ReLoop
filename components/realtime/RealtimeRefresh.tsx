"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function RealtimeRefresh() {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const url =
      process.env.NEXT_PUBLIC_REALTIME_WS_URL ?? "ws://localhost:3001/ws";
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const scheduleRefresh = () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, 350);
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === "event") scheduleRefresh();
        } catch {
          // Ignore malformed gateway messages.
        }
      };
      socket.onclose = () => {
        if (!stopped) retry = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    return () => {
      stopped = true;
      socket?.close();
      if (retry) clearTimeout(retry);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [router]);

  return null;
}
