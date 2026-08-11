// Keyboard activation rule for a focusable CARD that contains its own
// interactive controls.
//
// A management card (role="button", tabIndex={0}) that opens a details surface
// on Enter/Space cannot handle those keys unconditionally: it also contains
// buttons, dropdown triggers and — because a Radix portal still bubbles through
// the REACT tree — the items and confirm/cancel buttons of the menus and
// dialogs those controls open. A keydown on any of them reaches the card's
// handler, where an unconditional preventDefault() would swallow the control's
// own activation and open the details surface instead.
//
// The rule: the card reacts only to a keypress on the card ITSELF. Nested
// controls keep their native keyboard behavior; nothing is globally suppressed.
// (Phase 4 established this pattern for the /teams card; /users adopts it here.)

export function isSelfActivation(e: {
  key: string;
  target: unknown;
  currentTarget: unknown;
}): boolean {
  if (e.key !== "Enter" && e.key !== " ") return false;
  return e.target === e.currentTarget;
}
