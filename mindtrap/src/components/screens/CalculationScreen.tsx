"use client";

import { animate, motion, useReducedMotion } from "framer-motion";
import { Eye } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { selectedValues, total, type GameState } from "@/lib/engine";
import { Ltr } from "../Ltr";
import { ScreenHeading } from "../ScreenHeading";

interface Props {
  game: GameState;
  onReveal: () => void;
}

// Pacing: each number lands 0.4s apart, the sum counts up, then the CTA appears (~2.4s total).
const STEP = 0.4;

export function CalculationScreen({ game, onReveal }: Props) {
  const values = selectedValues(game);
  const sum = total(game);
  const reduce = useReducedMotion();
  const sumDelay = reduce ? 0 : values.length * STEP + 0.2;
  const [shown, setShown] = useState(reduce ? sum : 0);
  const [ready, setReady] = useState(!!reduce);

  useEffect(() => {
    if (reduce) {
      setShown(sum);
      setReady(true);
      return;
    }
    const controls = animate(0, sum, {
      delay: sumDelay,
      duration: 0.8,
      ease: "easeOut",
      onUpdate: (v) => setShown(Math.round(v)),
      onComplete: () => setReady(true),
    });
    return () => controls.stop();
  }, [reduce, sum, sumDelay]);

  return (
    <section className="flex flex-1 flex-col justify-center py-8" aria-labelledby="calc-title">
      <Ltr className="label">ANALYSIS · 4/4 DECISIONS LOGGED</Ltr>
      <ScreenHeading className="mt-2 font-display text-3xl font-bold sm:text-4xl">
        <span id="calc-title">ארבע החלטות. ארבעה מספרים.</span>
      </ScreenHeading>
      <p className="mt-3 leading-relaxed text-muted">
        שורה אחת מכל שורה, עמודה אחת מכל עמודה. כל בחירה שלך חסמה אפשרויות אחרות — זו הדרך שבחרת.
      </p>

      <div className="panel mt-8 px-4 py-8 sm:px-8">
        <div
          dir="ltr"
          className="flex items-center justify-center gap-1.5 font-mono text-2xl sm:gap-2 sm:text-4xl"
          aria-label={`${values.join(" ועוד ")} שווה ${sum}`}
          role="img"
        >
          {values.map((v, i) => (
            <Fragment key={i}>
              {i > 0 && (
                <motion.span
                  className="text-muted"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * STEP - 0.1, duration: 0.3 }}
                >
                  +
                </motion.span>
              )}
              <motion.span
                className="flex size-[3.25rem] items-center justify-center rounded-xl border border-signal/40 bg-signal/10 text-signal min-[400px]:size-16 sm:size-20"
                initial={{ opacity: 0, y: 16, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: i * STEP, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                {v}
              </motion.span>
            </Fragment>
          ))}
        </div>

        <motion.div
          className="mt-6 flex items-center justify-center gap-4 border-t border-line pt-6"
          dir="ltr"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: Math.max(0, sumDelay - 0.1), duration: 0.4 }}
          aria-hidden="true"
        >
          <span className="font-mono text-3xl text-muted">=</span>
          <span className="font-display text-6xl font-bold tabular-nums text-ink sm:text-7xl" data-testid="user-total">
            {shown}
          </span>
        </motion.div>
        <p className="mt-4 text-center text-sm text-muted">
          <Ltr className="label">YOUR TOTAL</Ltr>
        </p>
      </div>

      <motion.div
        initial={false}
        animate={{ opacity: ready ? 1 : 0, y: ready ? 0 : 8 }}
        transition={{ duration: 0.4 }}
        className="mt-8"
      >
        <button
          type="button"
          className="btn-primary w-full"
          onClick={onReveal}
          disabled={!ready}
          aria-hidden={!ready}
          tabIndex={ready ? 0 : -1}
        >
          <Eye className="size-5" aria-hidden="true" />
          פתח את התחזית
        </button>
      </motion.div>
    </section>
  );
}
