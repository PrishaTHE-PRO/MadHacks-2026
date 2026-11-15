// How a clicked link would have opened. Pure, so Node tests can import it.

export type OpenHow = "same-tab" | "new-tab" | "background-tab";

/** Same tab, new tab, or new tab in the background, from the mouse button, modifier keys and link target. */
export function openHow(e: { button: number; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, target: string): OpenHow {
  if (e.button === 1 || ((e.ctrlKey || e.metaKey) && !e.shiftKey)) return "background-tab";
  if (e.shiftKey || (target && target !== "_self" && target !== "_top" && target !== "_parent")) return "new-tab";
  return "same-tab";
}
