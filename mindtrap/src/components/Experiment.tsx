"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { useCallback, useReducer, useState } from "react";
import { createCommitment } from "@/lib/commitment";
import { INITIAL_EXPERIMENT, experimentReducer } from "@/lib/experiment";
import { Ltr } from "./Ltr";
import { IntroScreen } from "./screens/IntroScreen";
import { SealedScreen } from "./screens/SealedScreen";
import { ChamberScreen } from "./screens/ChamberScreen";
import { CalculationScreen } from "./screens/CalculationScreen";
import { RevealScreen } from "./screens/RevealScreen";

const ERROR_TEXT = "לא ניתן לחתום את התחזית בדפדפן הזה. נסה דפדפן עדכני בחיבור מאובטח (HTTPS).";

export function Experiment() {
  const [state, dispatch] = useReducer(experimentReducer, INITIAL_EXPERIMENT);
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seal = useCallback(
    async (kind: "seal" | "new-session") => {
      setSealing(true);
      setError(null);
      try {
        const commitment = await createCommitment();
        dispatch({ type: kind, commitment });
      } catch {
        setError(ERROR_TEXT);
      } finally {
        setSealing(false);
      }
    },
    [],
  );

  const { screen, commitment, previous, game } = state;

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex items-center justify-between gap-3 py-2">
          <Ltr className="label !tracking-[0.35em] text-ink">MINDTRAP</Ltr>
          <div className="flex items-center gap-3">
            {commitment && (
              <Ltr className="label" aria-label={`Session ${commitment.sessionId}`}>
                SESSION {commitment.sessionId}
              </Ltr>
            )}
            <Ltr className="label hidden min-[380px]:inline">EXP 001</Ltr>
          </div>
        </header>

        <main className="flex flex-1 flex-col">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={screen + (commitment?.sessionId ?? "")}
              className="flex flex-1 flex-col"
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              {screen === "intro" && <IntroScreen onEnter={() => seal("seal")} busy={sealing} error={error} />}
              {screen === "sealed" && commitment && (
                <SealedScreen commitment={commitment} previous={previous} onBegin={() => dispatch({ type: "begin" })} />
              )}
              {screen === "chamber" && (
                <ChamberScreen
                  game={game}
                  onSelect={(cell) => dispatch({ type: "select", cell })}
                  onUndo={() => dispatch({ type: "undo" })}
                  onRestart={() => dispatch({ type: "restart" })}
                  onContinue={() => dispatch({ type: "calculate" })}
                />
              )}
              {screen === "calculation" && (
                <CalculationScreen game={game} onReveal={() => dispatch({ type: "reveal" })} />
              )}
              {screen === "reveal" && commitment && (
                <RevealScreen
                  game={game}
                  commitment={commitment}
                  onTryAgain={() => seal("new-session")}
                  busy={sealing}
                  error={error}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        <footer className="mt-8 border-t border-line pt-4 text-center text-xs leading-relaxed text-muted">
          חוויית בידור בלבד. אין כאן קריאת מחשבות ואין בינה מלאכותית — רק מבנה מתמטי גלוי, עיצוב והפתעה. ללא הרשמה,
          ללא עוגיות מעקב, ושום מידע לא נשלח מהמכשיר שלך.
        </footer>
      </div>
    </MotionConfig>
  );
}
