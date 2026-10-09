"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  MATRIX,
  REQUIRED_SELECTIONS,
  SIZE,
  isComplete,
  isLocked,
  isSelected,
  valueOf,
  type Cell,
  type GameState,
} from "@/lib/engine";
import { Ltr } from "../Ltr";
import { ScreenHeading } from "../ScreenHeading";

/** Decorative evidence glyphs, one per file. Purely cosmetic. */
const GLYPHS = ["Δ", "Ψ", "Ω", "Σ", "Φ", "Λ", "Ξ", "Θ", "Π", "Γ", "Χ", "ϟ", "λ", "μ", "ζ", "β"];

interface Props {
  game: GameState;
  onSelect: (cell: Cell) => void;
  onUndo: () => void;
  onRestart: () => void;
  onContinue: () => void;
}

export function ChamberScreen({ game, onSelect, onUndo, onRestart, onContinue }: Props) {
  const count = game.selections.length;
  const complete = isComplete(game);
  const gridRef = useRef<HTMLDivElement>(null);
  const reduce = !!useReducedMotion();
  const last = game.selections[count - 1];

  // A chosen tile (or a control) becomes disabled after use; keep keyboard focus inside the chamber.
  useEffect(() => {
    const active = document.activeElement as HTMLButtonElement | null;
    if (active && active !== document.body && !active.disabled) return;
    if (complete) return; // the continue button takes focus itself
    gridRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [count, complete]);

  // Arrow-key navigation between the files that are still open.
  function onGridKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const d = delta[e.key];
    const target = e.target as HTMLElement;
    if (!d || !target.dataset.row) return;
    e.preventDefault();
    let row = Number(target.dataset.row);
    let col = Number(target.dataset.col);
    for (let step = 0; step < SIZE * SIZE; step++) {
      row = (row + d[0] + SIZE) % SIZE;
      col = (col + d[1] + SIZE) % SIZE;
      const next = gridRef.current?.querySelector<HTMLButtonElement>(`[data-row="${row}"][data-col="${col}"]`);
      if (next && !next.disabled) {
        next.focus();
        return;
      }
    }
  }

  return (
    <section className="flex flex-1 flex-col py-6" aria-labelledby="chamber-title">
      <div className="mb-1 flex items-center justify-between">
        <Ltr className="label">SELECTION CHAMBER</Ltr>
        <Ltr className="label text-signal" aria-hidden="true">
          {count}/{REQUIRED_SELECTIONS}
        </Ltr>
      </div>
      <ScreenHeading className="font-display text-2xl font-bold sm:text-3xl">
        <span id="chamber-title">חדר הבחירה</span>
      </ScreenHeading>
      <p className="mt-2 leading-relaxed text-muted">בחר תא אחד. לאחר כל בחירה, השורה והעמודה שלו יינעלו.</p>

      {/* Progress */}
      <div className="mt-5" aria-hidden="true">
        <div className="flex gap-1.5" dir="ltr">
          {Array.from({ length: REQUIRED_SELECTIONS }, (_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-line">
              <motion.div
                className="h-full bg-signal"
                initial={false}
                animate={{ width: i < count ? "100%" : "0%" }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" data-testid="progress">
        {complete
          ? `ארבע בחירות הושלמו: ${game.selections.map(valueOf).join(", ")}`
          : `בחירה ${count} מתוך ${REQUIRED_SELECTIONS}${last ? `. נבחר ${valueOf(last)}, השורה והעמודה שלו ננעלו.` : ""}`}
      </p>
      <p className="mt-2 text-sm text-muted" aria-hidden="true">
        {complete ? "כל ארבע ההחלטות התקבלו." : `החלטה ${count + 1} מתוך ${REQUIRED_SELECTIONS}`}
      </p>

      {/* The matrix is shown left-to-right, exactly as defined: 1 at top-left, 16 at bottom-right. */}
      <div
        ref={gridRef}
        dir="ltr"
        role="group"
        aria-label="מטריצת הבחירה, ארבע על ארבע"
        onKeyDown={onGridKeyDown}
        className="mx-auto mt-5 grid w-full max-w-[26rem] grid-cols-4 gap-2 sm:gap-3"
      >
        {MATRIX.map((rowValues, row) =>
          rowValues.map((value, col) => {
            const cell = { row, col };
            const selected = isSelected(game, cell);
            const order = game.selections.findIndex((s) => s.row === row && s.col === col);
            const locked = isLocked(game, cell);
            const lockedBy = locked ? game.selections.find((s) => s.row === row || s.col === col) : undefined;
            const distance = lockedBy ? Math.abs(lockedBy.row - row) + Math.abs(lockedBy.col - col) : 0;
            const disabled = selected || locked || complete;
            return (
              <Tile
                key={value}
                row={row}
                col={col}
                value={value}
                glyph={GLYPHS[value - 1]}
                selected={selected}
                order={order}
                locked={locked}
                distance={distance}
                disabled={disabled}
                reduce={reduce}
                onSelect={() => onSelect(cell)}
              />
            );
          }),
        )}
      </div>

      {/* Chosen evidence */}
      <div className="mt-5 flex items-center justify-center gap-2" dir="ltr" aria-hidden="true">
        {Array.from({ length: REQUIRED_SELECTIONS }, (_, i) => {
          const c = game.selections[i];
          return (
            <div
              key={i}
              className={`flex h-10 w-12 items-center justify-center rounded-lg border font-mono text-base transition-colors ${
                c ? "border-signal/50 bg-signal/10 text-signal" : "border-dashed border-line text-muted/50"
              }`}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={c ? valueOf(c) : "empty"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  {c ? valueOf(c) : "··"}
                </motion.span>
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <button type="button" className="btn-ghost" onClick={onUndo} disabled={count === 0}>
          <Undo2 className="size-4" aria-hidden="true" />
          בטל בחירה
        </button>
        <button type="button" className="btn-ghost" onClick={onRestart} disabled={count === 0}>
          <RotateCcw className="size-4" aria-hidden="true" />
          התחל מחדש
        </button>
      </div>

      <AnimatePresence>
        {complete && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.35 }}
            className="mt-4"
          >
            <button type="button" className="btn-primary w-full" onClick={onContinue} autoFocus>
              לחישוב התוצאה
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

interface TileProps {
  row: number;
  col: number;
  value: number;
  glyph: string;
  selected: boolean;
  order: number;
  locked: boolean;
  distance: number;
  disabled: boolean;
  reduce: boolean;
  onSelect: () => void;
}

function Tile({ row, col, value, glyph, selected, order, locked, distance, disabled, reduce, onSelect }: TileProps) {
  const status = selected ? `נבחר, בחירה ${order + 1}` : locked ? "נעול" : disabled ? "לא זמין" : "זמין";
  // Locks ripple outward from the cell that caused them.
  const delay = reduce ? 0 : Math.min(distance, 4) * 0.045;
  const duration = reduce ? 0 : 0.3;

  return (
    <motion.button
      type="button"
      data-row={row}
      data-col={col}
      data-state={selected ? "selected" : locked ? "locked" : "open"}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`תיק ${value}, שורה ${row + 1}, עמודה ${col + 1}, ${status}`}
      onClick={onSelect}
      animate={{
        opacity: locked ? 0.32 : 1,
        scale: locked ? 0.94 : 1,
      }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ delay: locked ? delay : 0, duration, ease: "easeOut" }}
      className={`group relative isolate aspect-square min-h-14 overflow-hidden rounded-xl border text-start transition-[border-color,box-shadow,background-color] duration-200 motion-reduce:transition-none ${
        selected
          ? "border-signal bg-signal/[0.12] shadow-glow"
          : locked
            ? "border-line bg-panel/60"
            : "border-line bg-panel hover:border-signal/50 hover:bg-panel-2 disabled:hover:border-line"
      }`}
    >
      {/* Evidence-file label */}
      <span
        className={`absolute start-1.5 top-1 font-mono text-[0.55rem] tracking-[0.12em] sm:start-2 sm:top-1.5 sm:text-[0.6rem] ${
          selected ? "text-signal/80" : "text-muted/70"
        }`}
        aria-hidden="true"
      >
        EV-{String(value).padStart(2, "0")}
      </span>
      <span
        className={`absolute bottom-1 end-1.5 font-display text-xs sm:bottom-1.5 sm:end-2 sm:text-sm ${
          selected ? "text-signal" : "text-muted/50"
        }`}
        aria-hidden="true"
      >
        {glyph}
      </span>

      <span
        className={`flex h-full items-center justify-center font-mono text-2xl font-medium sm:text-3xl ${
          selected ? "text-signal" : "text-ink"
        }`}
      >
        {value}
      </span>

      {selected && (
        <motion.span
          className="absolute bottom-1 start-1.5 rounded bg-signal px-1 font-mono text-[0.55rem] font-semibold text-void sm:bottom-1.5 sm:start-2"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          aria-hidden="true"
        >
          #{order + 1}
        </motion.span>
      )}

      {/* Elimination strike */}
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full text-muted"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <motion.line
          x1="10"
          y1="90"
          x2="90"
          y2="10"
          stroke="currentColor"
          strokeWidth="1.25"
          vectorEffect="non-scaling-stroke"
          initial={false}
          animate={{ pathLength: locked ? 1 : 0, opacity: locked ? 0.85 : 0 }}
          transition={{ delay: locked ? delay : 0, duration: reduce ? 0 : 0.35, ease: "easeOut" }}
        />
      </svg>
    </motion.button>
  );
}
