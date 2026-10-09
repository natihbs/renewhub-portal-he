"use client";

import { CircleCheck, CircleX, LoaderCircle, ShieldCheck } from "lucide-react";
import { useId, useState } from "react";
import { serialize, shellVerifyCommand, sha256Hex, verifyCommitment, type Commitment } from "@/lib/commitment";
import { CopyButton } from "./CopyButton";
import { Ltr } from "./Ltr";

type Result = { ok: boolean; recomputed: string } | null;

export function VerifyPanel({ commitment }: { commitment: Commitment }) {
  // Editable so anyone can try to "tamper" and watch verification fail.
  const [prediction, setPrediction] = useState(commitment.prediction);
  const [nonce, setNonce] = useState(commitment.nonce);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const predictionId = useId();
  const nonceId = useId();

  const tampered = prediction !== commitment.prediction || nonce !== commitment.nonce;

  async function verify() {
    setBusy(true);
    try {
      const [ok, recomputed] = await Promise.all([
        verifyCommitment(prediction, nonce, commitment.hash),
        sha256Hex(serialize(prediction, nonce)),
      ]);
      setResult({ ok, recomputed });
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPrediction(commitment.prediction);
    setNonce(commitment.nonce);
    setResult(null);
  }

  return (
    <div className="panel mt-4 p-5 text-start" data-testid="verify-panel">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Ltr className="label text-signal">VERIFICATION · {commitment.sessionId}</Ltr>
      </div>

      <dl className="space-y-4 text-sm">
        <div>
          <dt className="mb-1 text-muted">החותמת שהוצגה לפני הבחירה הראשונה</dt>
          <dd className="hash rounded-lg border border-line bg-void/60 p-3 text-xs leading-relaxed text-ink" data-testid="original-hash">
            {commitment.hash}
          </dd>
        </div>

        <div>
          <dt>
            <label htmlFor={predictionId} className="mb-1 block text-muted">
              התחזית שנחשפה
            </label>
          </dt>
          <dd>
            <input
              id={predictionId}
              dir="ltr"
              value={prediction}
              onChange={(e) => {
                setPrediction(e.target.value);
                setResult(null);
              }}
              className="hash w-full rounded-lg border border-line bg-void/60 p-3 text-base text-ink focus:border-signal/60"
              autoComplete="off"
              spellCheck={false}
            />
          </dd>
        </div>

        <div>
          <dt>
            <label htmlFor={nonceId} className="mb-1 block text-muted">
              המפתח האקראי (nonce)
            </label>
          </dt>
          <dd>
            <textarea
              id={nonceId}
              dir="ltr"
              rows={2}
              value={nonce}
              onChange={(e) => {
                setNonce(e.target.value);
                setResult(null);
              }}
              className="hash w-full resize-none rounded-lg border border-line bg-void/60 p-3 text-xs leading-relaxed text-ink focus:border-signal/60"
              autoComplete="off"
              spellCheck={false}
            />
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary min-h-12 flex-1 text-base" onClick={verify} disabled={busy}>
          {busy ? (
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-5" aria-hidden="true" />
          )}
          חשב מחדש והשווה
        </button>
        {tampered && (
          <button type="button" className="btn-ghost" onClick={reset}>
            שחזר ערכים מקוריים
          </button>
        )}
      </div>

      <div aria-live="polite" className="min-h-0">
        {result && (
          <div
            data-testid="verify-result"
            data-ok={result.ok}
            className={`mt-4 rounded-xl border p-4 text-sm leading-relaxed ${
              result.ok ? "border-signal/50 bg-signal/10" : "border-danger/50 bg-danger/10"
            }`}
          >
            <p className={`flex items-center gap-2 font-semibold ${result.ok ? "text-signal" : "text-danger"}`}>
              {result.ok ? <CircleCheck className="size-5" aria-hidden="true" /> : <CircleX className="size-5" aria-hidden="true" />}
              {result.ok ? "האימות עבר: התחזית לא שונתה." : "האימות נכשל: הערכים אינם תואמים לחותמת."}
            </p>
            <p className="mt-2 text-muted">ה־hash שחושב עכשיו במכשיר שלך:</p>
            <p className="hash mt-1 text-xs text-ink">{result.recomputed}</p>
          </div>
        )}
      </div>

      <details className="mt-5 text-sm text-muted">
        <summary className="cursor-pointer rounded py-2 font-medium text-ink">שיטת האימות</summary>
        <div className="mt-2 space-y-3 leading-relaxed">
          <p>
            החותמת היא <Ltr>SHA-256</Ltr> (בקידוד <Ltr>UTF-8</Ltr>) של המחרוזת הבאה — מערך <Ltr>JSON</Ltr> עם תגית
            קבועה, התחזית והמפתח האקראי:
          </p>
          <p className="hash rounded-lg border border-line bg-void/60 p-3 text-xs text-ink">
            {serialize(commitment.prediction, commitment.nonce)}
          </p>
          <p>אפשר לבדוק גם מחוץ לאתר, למשל בטרמינל:</p>
          <p className="hash rounded-lg border border-line bg-void/60 p-3 text-xs text-ink">
            {shellVerifyCommand(commitment.prediction, commitment.nonce)}
          </p>
          <CopyButton value={shellVerifyCommand(commitment.prediction, commitment.nonce)} label="העתק פקודה" />
          <p>
            המפתח נוצר באקראיות קריפטוגרפית של הדפדפן, כך שאי אפשר היה לנחש את התחזית מתוך החותמת. זוהי התחייבות
            קריפטוגרפית בתוך הסשן הזה: היא מוכיחה שהתחזית לא שונתה אחרי שהחותמת הוצגה לך, אך אינה חותמת זמן חיצונית
            ואינה מוכיחה מתי צד שלישי ראה אותה.
          </p>
        </div>
      </details>
    </div>
  );
}
