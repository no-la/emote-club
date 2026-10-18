import test from "node:test";
import assert from "node:assert/strict";
import { historyReducer, type History } from "../src/lib/emoji/history";
test("gesture groups undo once, redo and branching preserve snapshots", () => {
  let state: History<number> = { present: 0, past: [], future: [], group: null };
  state = historyReducer(state, { type: "update", update: 1, group: "drag" });
  state = historyReducer(state, { type: "update", update: 2, group: "drag" });
  assert.deepEqual(state.past, [0]);
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.present, 0);
  state = historyReducer(state, { type: "redo" });
  assert.equal(state.present, 2);
  state = historyReducer(state, { type: "undo" });
  state = historyReducer(state, { type: "update", update: value => value + 3, group: null });
  assert.deepEqual(state.future, []);
  assert.equal(state.present, 3);
});
test("history is bounded and retains non-cloneable image references", () => {
  const source = { decode() {} };
  let state: History<{ source: typeof source; x: number }> = { present: { source, x: 0 }, past: [], future: [], group: null };
  for (let x = 1; x <= 60; x++) state = historyReducer(state, { type: "update", update: { source, x }, group: null });
  assert.equal(state.past.length, 40);
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.present.source, source);
  assert.equal(state.present.x, 59);
  assert.equal(historyReducer(state, { type: "update", update: value => value, group: null }), state);
});
