import type { Commitment } from "./commitment";
import { INITIAL_GAME, isComplete, restart, select, undo, type Cell, type GameState } from "./engine";

export type Screen = "intro" | "sealed" | "chamber" | "calculation" | "reveal";

export interface ExperimentState {
  readonly screen: Screen;
  /** The commitment for the current session. Fixed from "sealed" until a new session starts. */
  readonly commitment: Commitment | null;
  /** The session that preceded this one, shown so the two are never confused. */
  readonly previous: Pick<Commitment, "sessionId" | "hash"> | null;
  readonly game: GameState;
}

export type ExperimentAction =
  | { type: "seal"; commitment: Commitment }
  | { type: "begin" }
  | { type: "select"; cell: Cell }
  | { type: "undo" }
  | { type: "restart" }
  | { type: "calculate" }
  | { type: "reveal" }
  | { type: "new-session"; commitment: Commitment };

export const INITIAL_EXPERIMENT: ExperimentState = {
  screen: "intro",
  commitment: null,
  previous: null,
  game: INITIAL_GAME,
};

export function experimentReducer(state: ExperimentState, action: ExperimentAction): ExperimentState {
  switch (action.type) {
    case "seal":
      // The first commitment of a session may only be created from the intro screen.
      if (state.screen !== "intro" || state.commitment) return state;
      return { ...state, screen: "sealed", commitment: action.commitment, game: INITIAL_GAME };

    case "begin":
      if (state.screen !== "sealed" || !state.commitment) return state;
      return { ...state, screen: "chamber" };

    case "select": {
      if (state.screen !== "chamber") return state;
      const result = select(state.game, action.cell);
      return result.ok ? { ...state, game: result.state } : state;
    }

    case "undo":
      if (state.screen !== "chamber" && state.screen !== "calculation") return state;
      return { ...state, screen: "chamber", game: undo(state.game) };

    case "restart":
      // Clears the choices only. The sealed prediction for this session is untouched.
      if (state.screen !== "chamber" && state.screen !== "calculation") return state;
      return { ...state, screen: "chamber", game: restart() };

    case "calculate":
      if (state.screen !== "chamber" || !isComplete(state.game)) return state;
      return { ...state, screen: "calculation" };

    case "reveal":
      if (state.screen !== "calculation") return state;
      return { ...state, screen: "reveal" };

    case "new-session":
      // Only after a reveal: a fresh session with a fresh, clearly labelled commitment.
      if (state.screen !== "reveal" || !state.commitment) return state;
      if (action.commitment.hash === state.commitment.hash) return state;
      return {
        screen: "sealed",
        commitment: action.commitment,
        previous: { sessionId: state.commitment.sessionId, hash: state.commitment.hash },
        game: INITIAL_GAME,
      };
  }
}
