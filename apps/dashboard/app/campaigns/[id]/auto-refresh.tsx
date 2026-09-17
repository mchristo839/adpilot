"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Polls while the worker is still generating (campaign or any creative). */
export function AutoRefresh({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  if (!active) return null;
  return <div className="warn">Generating with Claude and rendering images. This page refreshes itself every few seconds.</div>;
}
