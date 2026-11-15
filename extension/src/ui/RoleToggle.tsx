// "I'm buying / I'm selling" segmented toggle. Clicking the selected side again
// clears it back to "unknown".

import type { ChatRole } from "../../../shared/types";

const SIDES: { value: Exclude<ChatRole, "unknown">; label: string }[] = [
  { value: "buyer", label: "I'm buying" },
  { value: "seller", label: "I'm selling" },
];

export function RoleToggle({ role, onChange }: { role: ChatRole; onChange(role: ChatRole): void }) {
  return (
    <div className="dd-seg" role="radiogroup" aria-label="Are you buying or selling?">
      {SIDES.map((s) => (
        <button
          key={s.value}
          role="radio"
          aria-checked={role === s.value}
          onClick={() => onChange(role === s.value ? "unknown" : s.value)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
