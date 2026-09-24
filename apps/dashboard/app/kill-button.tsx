"use client";
import { useState, useTransition } from "react";
import { kill } from "./actions";

export function KillButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="row">
      {msg && <span className="muted">{msg}</span>}
      <button
        className="danger"
        disabled={pending}
        onClick={() => {
          if (!confirm("Pause EVERY campaign across ALL brands now?")) return;
          start(async () => {
            const r = await kill("all");
            setMsg(`Paused ${r.paused.length} campaigns in ${r.ms}ms`);
          });
        }}
      >
        {pending ? "Killing..." : "KILL SWITCH"}
      </button>
    </div>
  );
}
