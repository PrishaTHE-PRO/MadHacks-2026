/** Only the image CDNs used by the supported listing adapters. */
export function isMarketplacePhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && (
      url.hostname.endsWith(".fbcdn.net") ||
      url.hostname === "i.ebayimg.com" ||
      url.hostname === "di2ponv0v5otw.cloudfront.net"
    );
  } catch {
    return false;
  }
}
