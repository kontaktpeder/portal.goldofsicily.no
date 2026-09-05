export const MENU_FILE_MAX_BYTES = 50 * 1024 * 1024;
export const MENU_FILE_BUCKET = "venue-menus";
export const MENU_FILE_ACCEPT =
  "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXT = new Set(["pdf", "jpg", "jpeg", "png", "webp"]);

export type MenuFileLike = {
  name: string;
  size: number;
  type: string;
};

export type MenuFileError = "too_large" | "bad_type";

export function validateMenuFile(file: MenuFileLike): MenuFileError | null {
  if (file.size > MENU_FILE_MAX_BYTES) return "too_large";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ALLOWED_TYPES.has(file.type) || ALLOWED_EXT.has(ext)) return null;
  return "bad_type";
}

export function sanitizeMenuFileName(name: string): string {
  const trimmed = name.trim();
  const lastDot = trimmed.lastIndexOf(".");
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt = lastDot > 0 ? trimmed.slice(lastDot + 1) : "";
  const cleaned = rawBase
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeBase = cleaned.slice(0, 80) || "meny";
  return ext ? `${safeBase}.${ext}` : safeBase;
}

export function menuFileObjectPath(venueId: string, fileName: string, now = Date.now()): string {
  return `${venueId}/${now}-${sanitizeMenuFileName(fileName)}`;
}

export function isPublicMenuUrl(url: string | null | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url.trim()));
}

export function menuFileDisplayName(path: string | null | undefined, fallback = "meny"): string {
  if (!path) return fallback;
  const raw = path.split("/").pop() ?? fallback;
  return raw.replace(/^\d+-/, "") || fallback;
}
