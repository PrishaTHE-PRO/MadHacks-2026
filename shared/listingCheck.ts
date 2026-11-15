import type { CheckCoverage, RiskReport } from "./types";

/** Failed AI/photo checks should get a fresh attempt when the page is revisited. */
export function canReuseListingReport(report: Pick<RiskReport, "coverage">): boolean {
  const coverage = report.coverage;
  return Boolean(coverage?.ai && coverage.photos.checked >= Math.min(coverage.photos.total, 4));
}

export function coverageGaps(coverage?: CheckCoverage): string[] {
  // Old cached reports cannot establish what was checked.
  if (!coverage) return ["check coverage unavailable; check again"];
  const gaps: string[] = [];
  if (!coverage.seller) gaps.push("seller history unavailable");
  if (!coverage.ai) gaps.push("AI analysis unavailable");
  if (!coverage.photos.checked) gaps.push("photos not checked");
  else if (coverage.photos.checked < coverage.photos.total)
    gaps.push(`only ${coverage.photos.checked} of ${coverage.photos.total} photos checked`);
  if (!coverage.price) gaps.push("typical price unavailable");
  return gaps;
}

export function riskLabel(report: Pick<RiskReport, "level" | "coverage">): string {
  const label = { low: "Low risk", medium: "Be careful", high: "High risk" }[report.level];
  return label; // no "· partial check": incomplete checks aren't called out on screen
}
