// Link guard warning page (blocked.html). The background sends a tab here
// instead of a dangerous site; the reasons come in the URL.

import type { ExtensionMessage } from "../messages";

const params = new URLSearchParams(location.search);
const url = params.get("url") ?? "";
const domain = params.get("domain") ?? "";
let reasons: string[] = [];
try {
  reasons = (JSON.parse(params.get("reasons") ?? "[]") as unknown[]).filter((r): r is string => typeof r === "string");
} catch {
  /* no reasons */
}

document.getElementById("domain")!.textContent = domain || "this site";
const list = document.getElementById("reasons")!;
for (const r of reasons.length ? reasons : ["It matched Second Look's phishing checks."]) {
  const li = document.createElement("li");
  li.textContent = r; // textContent, never innerHTML: reasons name scammer-chosen domains
  list.append(li);
}

const send = (msg: ExtensionMessage) => chrome.runtime.sendMessage(msg).catch(() => {});

document.getElementById("back")!.addEventListener("click", () => {
  // Opened in a new tab from the chat: there's nothing to go back to, so close it.
  if (history.length > 1) history.back();
  else void send({ type: "CLOSE_TAB" });
});

document.getElementById("preview")!.addEventListener("click", () => {
  if (url && /^https?:\/\//i.test(url)) location.href = chrome.runtime.getURL(`safeview.html?url=${encodeURIComponent(url)}`);
});

document.getElementById("dns")!.addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://settings/security" });
});
