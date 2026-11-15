// The DealDig bubble mark, used everywhere: logo, verdict, badge, chips, states.
// The bubble is never tinted by risk; only the glyph changes:
//   low → "check", medium/high → "alert", error / can't check → "dash", logo → "none".
// The artwork itself lives in bubbleSvg.ts (shared with the non-React badge and chips).

import { useId, useMemo } from "react";
import type { RiskLevel } from "../../../shared/types";
import { bubbleSvg, type BubbleIcon } from "./bubbleSvg";

export type { BubbleIcon };

export const iconForLevel = (level: RiskLevel): BubbleIcon => (level === "low" ? "check" : "alert");

export function Bubble({ size, icon = "none", animate = false }: { size: number; icon?: BubbleIcon; animate?: boolean }) {
  // Gradient and filter ids must be unique per instance.
  const id = useId();
  const html = useMemo(() => bubbleSvg(size, icon, { id, animate }), [size, icon, id, animate]);
  return (
    <span
      className="dd-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
      // Our own constant SVG markup (bubbleSvg.ts), no user data.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
