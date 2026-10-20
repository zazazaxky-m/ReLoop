"use client";
import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    media.removeEventListener("change", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}
const snapshot = () =>
  document.hidden ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const serverSnapshot = () => false;

export function useMotionEnvironment() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
