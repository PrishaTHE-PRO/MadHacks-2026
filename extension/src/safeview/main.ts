// Safe preview page (safeview.html?url=...): asks the server to open a link in
// its throwaway browser and shows what it found, so the user doesn't have to
// open the link themselves. Opened from the right-click menu or the link
// guard's warning page.

import type { DetonationReport } from "../../../shared/types";
import type { ExtensionMessage } from "../messages";
import { SERVER_URL } from "../config";

const url = new URLSearchParams(location.search).get("url") ?? "";
const $ = (id: string) => document.getElementById(id)!;

const HEADLINES: Record<DetonationReport["verdict"], string> = {
  danger: "Don't open this link",
  caution: "Be careful with this link",
  ok: "Nothing dangerous found",
};

function setFindings(items: { severity: string; text: string }[]) {
  const list = $("findings");
  list.replaceChildren();
  for (const f of items) {
    const li = document.createElement("li");
    li.dataset.s = f.severity;
    li.textContent = f.text; // textContent only: findings quote scammer-chosen titles and domains
    list.append(li);
  }
}

function shot(src: string, caption: string) {
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  // Only our server's JPEG screenshots; never a URL the page chose.
  if (!src.startsWith("data:image/jpeg;base64,")) return fig;
  img.src = src;
  img.alt = caption;
  const cap = document.createElement("figcaption");
  cap.textContent = caption;
  fig.append(img, cap);
  return fig;
}

function render(r: DetonationReport) {
  $("main").dataset.verdict = r.verdict;
  $("headline").textContent = HEADLINES[r.verdict];
  $("link").textContent = r.domain || url;
  document.title = `${HEADLINES[r.verdict]} · DealDig`;
  setFindings(r.findings);

  const shots = $("shots");
  shots.replaceChildren();
  if (r.cloaking && r.scannerScreenshot && r.screenshot) {
    shots.classList.add("two");
    shots.append(shot(r.scannerScreenshot, "What a security scanner sees"), shot(r.screenshot, "What a real visitor sees"));
  } else if (r.screenshot) {
    shots.append(shot(r.screenshot, "What the page looks like (a picture, nothing on it is live)"));
  }

  if (r.redirects.length > 1) {
    const hops = $("hops");
    hops.replaceChildren(
      ...r.redirects.map((h) => {
        const li = document.createElement("li");
        li.textContent = h;
        return li;
      }),
    );
    $("chain").hidden = false;
  }

  const open = $("open") as HTMLButtonElement;
  open.hidden = false;
  open.onclick = () => {
    if (r.verdict === "danger" && !confirm(`DealDig found signs this is a scam. Open ${r.domain} anyway?`)) return;
    void chrome.runtime.sendMessage({ type: "ALLOW_SITE", domain: r.domain, url: r.finalUrl } satisfies ExtensionMessage).catch(() => {});
  };
}

async function run() {
  $("link").textContent = url;
  if (!/^https?:\/\//i.test(url)) {
    $("loading").hidden = true;
    $("headline").textContent = "That isn't a web link";
    return;
  }
  try {
    const res = await fetch(`${SERVER_URL}/detonate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.json();
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`);
    render(body as DetonationReport);
  } catch (err) {
    $("main").dataset.verdict = "caution";
    $("headline").textContent = "Couldn't preview this link";
    const msg = err instanceof Error ? err.message : String(err);
    setFindings([
      { severity: "caution", text: /fetch|network|timed? ?out|abort/i.test(msg) ? "The DealDig server didn't answer. Is it running?" : msg },
      { severity: "caution", text: "Until it's checked, treat a link from a marketplace chat as unsafe." },
    ]);
  } finally {
    $("loading").hidden = true;
  }
}

$("close").addEventListener("click", () => void chrome.runtime.sendMessage({ type: "CLOSE_TAB" } satisfies ExtensionMessage).catch(() => window.close()));
void run();
