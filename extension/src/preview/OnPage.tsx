// Preview of the on-page pieces (badge + chat chips). They're plain DOM in
// their own shadow roots on real pages, so render them the same way here.

import { useEffect, useRef } from "react";
import type { ChatFlag } from "../../../shared/types";
import { renderChips } from "../chat/chips";
import { renderBadge, type BadgeState } from "../content/badge";
import { flagKey } from "../messages";
import { highReport, lowReport, mediumReport, mockChat } from "./mocks";

function Shadow({ draw }: { draw(root: ShadowRoot): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    draw(host.shadowRoot ?? host.attachShadow({ mode: "open" }));
  });
  return <div ref={ref} />;
}

const noop = () => {};

function Badge({ state, card = false }: { state: BadgeState; card?: boolean }) {
  return <Shadow draw={(root) => renderBadge(root, state, noop, { fixed: false, showCard: card })} />;
}

function Chips({ flags, expand = [] }: { flags: ChatFlag[]; expand?: ChatFlag[] }) {
  const expanded = new Set(expand.map(flagKey));
  return <Shadow draw={(root) => renderChips(root, flags, { report: noop, dismiss: noop }, expanded)} />;
}

const [aiDeposit, deposit, offPlatform, payment, urgency] = mockChat.flags;

export function OnPagePreview() {
  return (
    <div className="pv-onpage">
      <section className="pv-panel">
        <h2 className="pv-h">On-page badge</h2>
        <p className="pv-sub">Bottom-right of listing pages. Hover shows the card; click opens the sidebar.</p>
        <div className="pv-badges">
          <div className="pv-badge-slot tall">
            <Badge state={{ state: "done", report: highReport }} card />
            <span className="pv-cap">High risk + hover card</span>
          </div>
          <div className="pv-badge-slot">
            <Badge state={{ state: "done", report: mediumReport }} />
            <span className="pv-cap">Be careful</span>
          </div>
          <div className="pv-badge-slot">
            <Badge state={{ state: "done", report: lowReport }} />
            <span className="pv-cap">Low risk</span>
          </div>
          <div className="pv-badge-slot">
            <Badge state={{ state: "loading" }} />
            <span className="pv-cap">Checking</span>
          </div>
          <div className="pv-badge-slot">
            <Badge state={{ state: "error", message: "Can't reach the DealDig server. Is it running?" }} />
            <span className="pv-cap">Can't check</span>
          </div>
        </div>
      </section>

      <section className="pv-panel">
        <h2 className="pv-h">Chat warning chips</h2>
        <p className="pv-sub">Under each flagged message. “Why?” expands a chip; the site's own text is never changed.</p>
        <div className="pv-chat">
          <div className="pv-msg them">{mockChat.quotes.m4}</div>
          <Chips flags={[aiDeposit]} />
          <div className="pv-msg them">{mockChat.quotes.m5}</div>
          <Chips flags={[deposit, offPlatform, payment]} expand={[deposit]} />
          <div className="pv-msg me">Can I see it first? I'd rather pay in person.</div>
          <div className="pv-msg them">{mockChat.quotes.m6}</div>
          <Chips flags={[urgency]} />
        </div>
      </section>
    </div>
  );
}
