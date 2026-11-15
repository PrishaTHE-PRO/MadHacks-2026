// Turns raw photo metadata (as parsed by exifr) into findings a seller can
// understand. Pure function, tested in Node.

export type FindingSeverity = "danger" | "caution" | "info";

export interface MetadataFinding {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
}

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

export interface MetadataSummary {
  findings: MetadataFinding[];
  /** Total number of metadata fields found across EXIF, XMP, IPTC, etc. */
  fieldCount: number;
  gps: GpsPoint | null;
}

type Segments = Record<string, Record<string, unknown> | undefined>;

const SEGMENTS = ["ifd0", "ifd1", "exif", "gps", "interop", "xmp", "iptc", "ihdr", "makerNote", "userComment"];
const SERIAL_KEYS = ["BodySerialNumber", "SerialNumber", "LensSerialNumber", "CameraSerialNumber", "InternalSerialNumber"];
const OWNER_KEYS = ["Artist", "OwnerName", "CameraOwnerName", "Copyright", "creator", "Creator", "By-line", "Credit", "rights"];
const DATE_KEYS = ["DateTimeOriginal", "CreateDate", "DateTimeDigitized", "DateTime", "ModifyDate"];
// PNG chunks that are just image format info, not personal data.
const HARMLESS_KEYS = new Set([
  "ImageWidth", "ImageHeight", "BitDepth", "ColorType", "Compression", "Filter", "Interlace",
  "ExifImageWidth", "ExifImageHeight", "Orientation", "XResolution", "YResolution", "ResolutionUnit",
  "ColorSpace", "YCbCrPositioning",
]);

function pick(segs: Segments, keys: string[]): unknown {
  for (const seg of SEGMENTS) {
    const s = segs[seg];
    if (!s) continue;
    for (const k of keys) {
      const v = s[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

const str = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v instanceof Date ? v.toISOString() : String(v)).trim();

export function countFields(segs: Segments | null | undefined): number {
  if (!segs) return 0;
  let n = 0;
  for (const seg of SEGMENTS) {
    const s = segs[seg];
    if (s && typeof s === "object") n += Object.keys(s).filter((k) => !HARMLESS_KEYS.has(k)).length;
  }
  return n;
}

export function summarizeMetadata(
  segs: Segments | null | undefined,
  gps: GpsPoint | null | undefined,
  hasThumbnail: boolean,
): MetadataSummary {
  const s = segs ?? {};
  const findings: MetadataFinding[] = [];
  const point =
    gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude) && !(gps.latitude === 0 && gps.longitude === 0)
      ? { latitude: gps.latitude, longitude: gps.longitude }
      : null;

  if (point) {
    findings.push({
      id: "gps",
      severity: "danger",
      title: "Exact location where the photo was taken",
      detail: `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}. Usually accurate to a few meters: often your home.`,
    });
  }

  if (hasThumbnail) {
    findings.push({
      id: "thumbnail",
      severity: "caution",
      title: "Hidden preview of the original photo",
      detail: "Photos can carry a small copy of the unedited image. If you cropped or edited it, the preview may still show what you removed.",
    });
  }

  const serial = pick(s, SERIAL_KEYS);
  if (serial !== undefined) {
    findings.push({
      id: "serial",
      severity: "caution",
      title: "Camera serial number",
      detail: `${str(serial)}. Links every photo you take with this camera to you.`,
    });
  }

  const owner = pick(s, OWNER_KEYS);
  if (owner !== undefined) {
    findings.push({ id: "owner", severity: "caution", title: "Your name or copyright", detail: str(owner) });
  }

  const make = pick(s, ["Make"]);
  const model = pick(s, ["Model", "HostComputer"]);
  if (make !== undefined || model !== undefined) {
    const device = [make, model].filter((v) => v !== undefined).map(str);
    // "Apple iPhone 15" rather than "Apple Apple iPhone 15"
    const name = device.length === 2 && device[1].startsWith(device[0]) ? device[1] : device.join(" ");
    findings.push({ id: "device", severity: "info", title: "Phone or camera model", detail: name });
  }

  const date = pick(s, DATE_KEYS);
  if (date !== undefined) {
    const d = date instanceof Date ? date : new Date(str(date));
    findings.push({
      id: "date",
      severity: "info",
      title: "Exact date and time taken",
      detail: Number.isNaN(d.getTime()) ? str(date) : d.toLocaleString(),
    });
  }

  const software = pick(s, ["Software", "CreatorTool"]);
  if (software !== undefined) {
    findings.push({ id: "software", severity: "info", title: "Editing software", detail: str(software) });
  }

  return { findings, fieldCount: countFields(s), gps: point };
}
