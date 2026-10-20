// IANA timezone helpers shared by the server and the settings page. ICU (Node/Chrome) still reports some legacy
// names (e.g. Asia/Calcutta); we store and show the current IANA names instead.

const MODERN: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Godthab": "America/Nuuk",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Enderbury": "Pacific/Kanton",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Louisville": "America/Kentucky/Louisville",
};

export const FALLBACK_TIMEZONE = "Asia/Kolkata";

const modern = (name: string) => MODERN[name] ?? name;

/** All selectable timezones (modern names, sorted, including UTC). */
export function timezoneList(): string[] {
  const names = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return [...new Set([...names.map(modern), "UTC"])].sort();
}

/** Canonical modern IANA name for any accepted spelling or alias, or null when unknown. */
export function canonicalTimezone(value: string): string | null {
  if (typeof value !== "string" || value.length > 100 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
    if (resolved === "Etc/UTC" || resolved === "Etc/GMT" || resolved === "GMT") return "UTC";
    return modern(resolved);
  } catch {
    return null;
  }
}

/** "GMT+05:30" style offset of a timezone at a given instant (DST-aware). */
export function utcOffsetLabel(timezone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName");
    return part?.value === "GMT" ? "GMT+00:00" : (part?.value ?? "");
  } catch {
    return "";
  }
}

/** The browser's timezone (modern name), falling back to Asia/Kolkata. Client-side only. */
export function browserTimezone(): string {
  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? FALLBACK_TIMEZONE;
  } catch {
    return FALLBACK_TIMEZONE;
  }
}
