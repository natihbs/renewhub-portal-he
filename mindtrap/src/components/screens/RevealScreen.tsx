"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, RotateCcw, Share2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { Commitment } from "@/lib/commitment";
import { selectedValues, total, type GameState } from "@/lib/engine";
import { shareExperiment, type ShareOutcome } from "@/lib/share";
import { Ltr } from "../Ltr";
import { ScreenHeading } from "../ScreenHeading";
import { VerifyPanel } from "../VerifyPanel";

interface Props {
  game: GameState;
  commitment: Commitment;
  onTryAgain: () => void;
  busy: boolean;
  error: string | null;
}

const SHARE_MESSAGES: Record<ShareOutcome, string> = {
  shared: "תודה ששיתפת.",
  copied: "הקישור והטקסט הועתקו. התחזית נשארת סוד.",
  cancelled: "",
  failed: "לא הצלחנו לשתף. אפשר להעתיק את כתובת הדף ידנית.",
};

const ease = [0.22, 1, 0.36, 1] as const;

export function RevealScreen({ game, commitment, onTryAgain, busy, error }: Props) {
  const values = selectedValues(game);
  const sum = total(game);
  const match = String(sum) === commitment.prediction;
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState("");

  async function share() {
    const url = window.location.origin + window.location.pathname;
    setShareMsg(SHARE_MESSAGES[await shareExperiment(url)]);
  }

  return (
    <section className="flex flex-1 flex-col py-8" aria-labelledby="reveal-title">
      {/* Unsealed dossier */}
      <motion.div
        className="panel relative overflow-hidden px-5 pb-8 pt-5 text-center"
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease }}
      >
        <div className="flex items-center justify-between">
          <Ltr className="label">PREDICTION · {commitment.sessionId}</Ltr>
          <motion.span
            dir="ltr"
            className="label text-signal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            UNSEALED
          </motion.span>
        </div>

        {/* Seal splitting open */}
        <div className="relative mx-auto mt-6 flex h-40 items-center justify-center sm:h-48" aria-hidden="true">
          <motion.div
            className="absolute inset-x-6 top-1/2 h-px bg-signal/60"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: [0, 1, 1], opacity: [1, 1, 0] }}
            transition={{ duration: 0.9, times: [0, 0.5, 1], ease: "easeInOut" }}
          />
          <motion.span
            className="font-display text-[7.5rem] font-bold leading-none text-ink [text-shadow:0_0_40px_rgb(163_242_225/0.35)] sm:text-[9rem]"
            initial={{ opacity: 0, scale: 0.85, filter: "blur(12px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ delay: 0.55, duration: 0.8, ease }}
            data-testid="prediction"
          >
            {commitment.prediction}
          </motion.span>
        </div>
        <p className="sr-only">התחזית החתומה היא {commitment.prediction}.</p>

        {/* Comparison */}
        <motion.div
          className="mx-auto mt-4 grid max-w-sm grid-cols-[1fr_auto_1fr] items-center gap-3"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.5, ease }}
        >
          <div className="rounded-xl border border-line bg-void/50 p-3">
            <p className="text-xs text-muted">התחזית</p>
            <p className="font-mono text-2xl text-ink">{commitment.prediction}</p>
          </div>
          <span className={`font-mono text-2xl ${match ? "text-signal" : "text-danger"}`} aria-hidden="true">
            {match ? "=" : "≠"}
          </span>
          <div className="rounded-xl border border-signal/40 bg-signal/10 p-3">
            <p className="text-xs text-muted">הסכום שלך</p>
            <p className="font-mono text-2xl text-signal" data-testid="reveal-total">
              {sum}
            </p>
          </div>
        </motion.div>
        <motion.p
          className="mt-4 text-sm text-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.3 }}
        >
          הדרך שלך:{" "}
          <bdi dir="rtl" className="font-mono text-ink">
            {values.join(" ← ")}
          </bdi>
        </motion.p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, duration: 0.6, ease }}
        className="mt-8"
      >
        <ScreenHeading className="font-display text-3xl font-bold leading-tight text-balance sm:text-4xl">
          <span id="reveal-title">לא הצלחת לשנות את התוצאה.</span>
        </ScreenHeading>
        <p className="mt-3 text-lg leading-relaxed text-muted">כל החלטה שינתה את הדרך. אף החלטה לא שינתה את היעד.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8, duration: 0.5 }}
        className="mt-8"
      >
        <button
          type="button"
          className="btn-primary w-full"
          aria-expanded={verifyOpen}
          onClick={() => setVerifyOpen((v) => !v)}
        >
          <ShieldCheck className="size-5" aria-hidden="true" />
          אמת את התחזית
        </button>

        <AnimatePresence initial={false}>
          {verifyOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <VerifyPanel commitment={commitment} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" className="btn-ghost flex-1 basis-36 whitespace-nowrap" onClick={onTryAgain} disabled={busy}>
            {busy ? (
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            נסה שוב
          </button>
          <button type="button" className="btn-ghost flex-1 basis-36 whitespace-nowrap" onClick={share}>
            <Share2 className="size-4" aria-hidden="true" />
            שתף את MindTrap
          </button>
        </div>
        <p className="mt-2 min-h-5 text-center text-sm text-muted" aria-live="polite">
          {error ?? shareMsg}
        </p>
        <p className="text-center text-xs text-muted">ניסיון חוזר פותח סשן חדש עם חותמת חדשה.</p>

        <details className="panel mt-6 p-5 text-sm leading-relaxed text-muted">
          <summary className="cursor-pointer rounded font-medium text-ink">איך זה עובד? (ספוילר)</summary>
          <div className="mt-3 space-y-2">
            <p>
              כל בחירה נעלה את השורה והעמודה שלה, ולכן בסוף בחרת בדיוק מספר אחד מכל שורה ומספר אחד מכל עמודה. במטריצה
              הזאת כל מספר שווה ל־<Ltr className="font-mono">4 × row + col + 1</Ltr> (כשהספירה מתחילה מ־0).
            </p>
            <p>
              לכן הסכום תמיד: <Ltr className="font-mono text-ink">4×(0+1+2+3) + (0+1+2+3) + 4 = 24 + 6 + 4 = 34</Ltr>.
            </p>
            <p>
              יש 576 סדרות בחירה אפשריות (24 צירופים שונים של מספרים) — וכולן מגיעות ל־34. לא שינינו את המטריצה ולא
              התערבנו בבחירות שלך. החופש היה אמיתי; היעד פשוט היה קבוע.
            </p>
          </div>
        </details>
      </motion.div>
    </section>
  );
}
