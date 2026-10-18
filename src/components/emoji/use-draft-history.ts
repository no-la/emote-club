import { useCallback, useEffect, useReducer, useRef, type SetStateAction } from "react";
import { initialDraft, type EmojiDraft } from "@/lib/emoji/model";
import { historyReducer, type History } from "@/lib/emoji/history";
export function useDraftHistory() {
  const [history, dispatch] = useReducer(historyReducer<EmojiDraft>, undefined, (): History<EmojiDraft> => ({ present: initialDraft(), past: [], future: [], group: null }));
  const sequence = useRef(0);
  const group = useRef<string | null>(null);
  useEffect(() => {
    const end = () => { if (group.current?.startsWith("pointer:")) group.current = null; };
    window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
    return () => { window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
  }, []);
  const setDraft = useCallback((update: SetStateAction<EmojiDraft>) => dispatch({ type: "update", update, group: group.current }), []);
  return { draft: history.present, setDraft, canUndo: !!history.past.length, canRedo: !!history.future.length,
    begin: (kind: "pointer" | "text") => { group.current = `${kind}:${++sequence.current}`; },
    end: () => { if (group.current?.startsWith("text:")) group.current = null; },
    undo: () => { group.current = null; dispatch({ type: "undo" }); },
    redo: () => { group.current = null; dispatch({ type: "redo" }); },
  };
}
