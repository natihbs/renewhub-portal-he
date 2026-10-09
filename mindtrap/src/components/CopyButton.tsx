"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

interface Props {
  value: string;
  label: string;
  copiedLabel?: string;
  className?: string;
}

export function CopyButton({ value, label, copiedLabel = "הועתק", className = "" }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function onClick() {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" onClick={onClick} className={`btn-ghost ${className}`}>
      {state === "copied" ? (
        <Check className="size-4 text-signal" aria-hidden="true" />
      ) : (
        <Copy className="size-4" aria-hidden="true" />
      )}
      <span aria-live="polite">{state === "copied" ? copiedLabel : state === "failed" ? "ההעתקה נכשלה" : label}</span>
    </button>
  );
}
