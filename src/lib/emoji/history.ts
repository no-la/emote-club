export type History<T> = { present: T; past: T[]; future: T[]; group: string | null };
export type HistoryAction<T> = { type: "update"; update: T | ((previous: T) => T); group: string | null } | { type: "undo" | "redo" };
export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return { present: state.past.at(-1)!, past: state.past.slice(0, -1), future: [state.present, ...state.future], group: null };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return { present: state.future[0], past: [...state.past, state.present], future: state.future.slice(1), group: null };
  }
  if (!("update" in action)) return state;
  const next = typeof action.update === "function" ? (action.update as (previous: T) => T)(state.present) : action.update;
  if (next === state.present) return state;
  const grouped = action.group !== null && action.group === state.group;
  // Immutable snapshots retain decoded image sources without cloning DOM objects.
  return { present: next, past: grouped ? state.past : [...state.past, state.present].slice(-40), future: [], group: action.group };
}
