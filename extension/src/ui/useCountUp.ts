// Count a number up from 0 when it first appears (the verdict score).
// Jumps straight to the value under prefers-reduced-motion.

import { useEffect, useState } from "react";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      // rAF's timestamp can be a little before `start`; clamp so the first frame isn't negative.
      const t = Math.min(1, Math.max(0, (now - start) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      setValue(Math.round(target * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    // If the browser pauses animation frames (hidden or throttled panel), still land on the real number.
    const done = setTimeout(() => setValue(target), durationMs + 100);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [target, durationMs]);
  return value;
}
