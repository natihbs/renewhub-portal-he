"use client";

import { motion } from "framer-motion";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import { Ltr } from "../Ltr";
import { ScreenHeading } from "../ScreenHeading";

interface Props {
  onEnter: () => void;
  busy: boolean;
  error: string | null;
}

const rise = (delay: number) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
});

export function IntroScreen({ onEnter, busy, error }: Props) {
  return (
    <section className="flex flex-1 flex-col justify-center py-10" aria-labelledby="intro-title">
      <motion.div {...rise(0.05)} className="mb-10 flex items-center gap-3">
        <span className="inline-block size-2 rounded-full bg-signal shadow-[0_0_12px_rgb(163_242_225/0.8)]" aria-hidden="true" />
        <Ltr className="label text-signal">CLASSIFIED</Ltr>
        <span className="h-px flex-1 bg-line" aria-hidden="true" />
        <Ltr className="label">EXPERIMENT 001</Ltr>
      </motion.div>

      <motion.p {...rise(0.15)} className="mb-5 font-mono text-sm tracking-[0.3em] text-muted">
        <Ltr>THE INEVITABLE</Ltr>
      </motion.p>

      <motion.div {...rise(0.25)}>
        <ScreenHeading focusOnMount={false} className="font-display text-[2.6rem] font-bold leading-[1.08] text-balance sm:text-6xl">
          <span id="intro-title">אתה חושב שהבחירות שלך חופשיות?</span>
        </ScreenHeading>
      </motion.div>

      <motion.p {...rise(0.4)} className="mt-6 max-w-md text-lg leading-relaxed text-muted">
        ארבע החלטות. תחזית אחת. נראה אם תצליח לשנות אותה.
      </motion.p>

      <motion.div {...rise(0.55)} className="mt-12 flex flex-col gap-4">
        <button type="button" className="btn-primary w-full sm:w-auto sm:self-start" onClick={onEnter} disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              חותם תחזית…
            </>
          ) : (
            <>
              כניסה לניסוי
              <ArrowLeft className="size-5" aria-hidden="true" />
            </>
          )}
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <p className="text-sm text-muted">כ־90 שניות · ללא הרשמה · ללא איסוף נתונים</p>
      </motion.div>
    </section>
  );
}
