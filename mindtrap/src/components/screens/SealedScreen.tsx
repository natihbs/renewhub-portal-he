"use client";

import { motion } from "framer-motion";
import { ArrowLeft, ChevronDown, Lock } from "lucide-react";
import { useId, useState } from "react";
import { shortHash, type Commitment } from "@/lib/commitment";
import { CopyButton } from "../CopyButton";
import { Ltr } from "../Ltr";
import { ScreenHeading } from "../ScreenHeading";

interface Props {
  commitment: Commitment;
  previous: Pick<Commitment, "sessionId" | "hash"> | null;
  onBegin: () => void;
}

export function SealedScreen({ commitment, previous, onBegin }: Props) {
  const [showFull, setShowFull] = useState(false);
  const fullId = useId();

  return (
    <section className="flex flex-1 flex-col justify-center py-8" aria-labelledby="sealed-title">
      {previous && (
        <div role="status" className="mb-5 rounded-xl border border-signal/30 bg-signal/5 p-4 text-sm leading-relaxed">
          <p className="font-semibold text-ink">
            סשן חדש: <Ltr className="font-mono">{commitment.sessionId}</Ltr>
          </p>
          <p className="mt-1 text-muted">
            נוצרה חותמת חדשה. החותמת של הסשן הקודם (<Ltr className="font-mono">{previous.sessionId}</Ltr> ·{" "}
            <Ltr className="font-mono">{shortHash(previous.hash)}</Ltr>) אינה שייכת לניסוי הזה.
          </p>
        </div>
      )}

      <motion.article
        className="panel relative overflow-hidden"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Dossier tab */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <Ltr className="label">DOSSIER · EXP-001</Ltr>
          <Ltr className="label text-signal">CLASSIFIED</Ltr>
        </div>

        <div className="px-5 pb-6 pt-6 sm:px-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-signal/40 bg-signal/10 shadow-glow">
              <Lock className="size-6 text-signal" aria-hidden="true" />
            </div>
            <motion.div
              aria-hidden="true"
              className="rotate-[-6deg] whitespace-nowrap rounded-md border-2 border-signal/60 px-3 py-1 font-mono text-[0.7rem] font-medium tracking-[0.22em] text-signal"
              initial={{ opacity: 0, scale: 1.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.45, duration: 0.35, ease: "easeOut" }}
              dir="ltr"
            >
              PREDICTION SEALED
            </motion.div>
          </div>

          <ScreenHeading className="font-display text-3xl font-bold leading-tight sm:text-4xl">
            <span id="sealed-title">התוצאה שלך נקבעה ונחתמה.</span>
          </ScreenHeading>
          <p className="mt-3 leading-relaxed text-muted">
            התחזית נקבעה לפני שבחרת דבר. היא נעולה מאחורי חותמת קריפטוגרפית שלא תשתנה עד סוף הניסוי.
          </p>

          <div className="mt-7 rounded-xl border border-line bg-void/60 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Ltr className="label">SHA-256 COMMITMENT</Ltr>
              <Ltr className="label">{commitment.sessionId}</Ltr>
            </div>
            <p className="hash text-lg text-signal" aria-label="חותמת מקוצרת">
              {shortHash(commitment.hash)}
            </p>
            {showFull && (
              <p id={fullId} className="hash mt-3 border-t border-line pt-3 text-sm leading-relaxed text-ink" data-testid="full-hash">
                {commitment.hash}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost"
                aria-expanded={showFull}
                aria-controls={fullId}
                onClick={() => setShowFull((v) => !v)}
              >
                <ChevronDown
                  className={`size-4 transition-transform motion-reduce:transition-none ${showFull ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
                {showFull ? "הסתר חותמת מלאה" : "הצג חותמת מלאה"}
              </button>
              <CopyButton value={commitment.hash} label="העתק חותמת" />
            </div>
          </div>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            שמור או צלם את החותמת. בסוף הניסוי ייחשפו התחזית והמפתח, ותוכל לוודא בעצמך שהם מייצרים בדיוק את החותמת הזאת.
          </p>
        </div>
      </motion.article>

      <button type="button" className="btn-primary mt-8 w-full" onClick={onBegin}>
        אני מוכן לבחור
        <ArrowLeft className="size-5" aria-hidden="true" />
      </button>
    </section>
  );
}
