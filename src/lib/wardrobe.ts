import { DEVICE_HEADER, getDeviceId } from "./deviceId";

export interface CandidateItem {
  canonicalName: string;
  displayName: string;
  category: string;
  colors: string[];
  confidence: number;
}

export interface UncertainGarment {
  canonicalName: string;
  displayName: string;
  reason?: string;
}

export interface StoredItemView {
  id: string;
  canonicalName: string;
  displayName: string;
  category: string;
  colors: string[];
  season: string;
  status: string;
  thumbnail: {
    width: number;
    height: number;
    byteSize: number;
    contentHash: string;
  } | null;
  createdAt: string;
}

export interface WardrobeApiError {
  message: string;
  code: string;
  status: number;
}

function deviceHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", [DEVICE_HEADER]: getDeviceId() };
}

async function parseError(res: Response, fallback: string): Promise<never> {
  const json = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  throw {
    message: json.error ?? fallback,
    code: json.code ?? "UNKNOWN",
    status: res.status,
  } as WardrobeApiError;
}

export async function scanItems(params: {
  imageBase64: string;
  mimeType: string;
  requestId: string;
}): Promise<{
  data: { items: CandidateItem[]; uncertainItems: UncertainGarment[] };
  meta: {
    provider: string;
    modelId: string;
    balance?: { available: number };
    charged?: boolean;
  };
}> {
  const res = await fetch("/api/items/scan", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseError(res, "Ошибка анализа");
  return (await res.json()) as {
    data: { items: CandidateItem[]; uncertainItems: UncertainGarment[] };
    meta: { provider: string; modelId: string; balance?: { available: number }; charged?: boolean };
  };
}

export async function confirmItems(params: {
  requestId: string;
  imageBase64: string;
  selections: Array<{
    canonicalName: string;
    displayName: string;
    category: string;
    colors: string[];
    season: string;
  }>;
}): Promise<{ items: StoredItemView[] }> {
  const res = await fetch("/api/items/confirm", {
    method: "POST",
    headers: deviceHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) await parseError(res, "Ошибка сохранения");
  return (await res.json()) as { items: StoredItemView[] };
}

export async function listItems(limit = 20): Promise<{ items: StoredItemView[] }> {
  const res = await fetch(`/api/items?limit=${limit}`);
  if (!res.ok) await parseError(res, "Не удалось загрузить гардероб");
  return (await res.json()) as { items: StoredItemView[] };
}

export async function deleteItem(id: string): Promise<void> {
  const res = await fetch(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await parseError(res, "Не удалось удалить");
}

export function thumbnailUrl(id: string): string {
  return `/api/items/${encodeURIComponent(id)}/image`;
}

export function isWardrobeApiError(e: unknown): e is WardrobeApiError {
  return typeof e === "object" && e !== null && "code" in e && "status" in e;
}

export const CATEGORIES = [
  { value: "outerwear", label: "Верхняя одежда" },
  { value: "top", label: "Верх" },
  { value: "bottom", label: "Низ" },
  { value: "dress", label: "Платье" },
  { value: "shoes", label: "Обувь" },
  { value: "accessory", label: "Аксессуар" },
] as const;

export function humanizeWardrobeError(e: unknown): string {
  if (isWardrobeApiError(e)) {
    switch (e.code) {
      case "IMAGE_TOO_LARGE":
        return "Фото слишком большое (максимум 300 КБ). Попробуйте другое.";
      case "NO_GARMENTS_DETECTED":
        return "Не нашёл одежду на фото. Попробуйте снять ближе или с лучшим светом.";
      case "INSUFFICIENT_CREDITS":
        return "Кредиты закончились — новые начисления скоро появятся.";
      case "PLATFORM_UNAVAILABLE":
        return "Сервис аккаунта временно недоступен. Попробуйте позже.";
      case "SCAN_NOT_FOUND":
        return "Скан не найден — просканируйте фото заново.";
      case "DAILY_LIMIT_REACHED":
        return "На сегодня лимит закончился. Попробуйте снова завтра.";
      case "MISSING_REQUEST_ID":
        return "Обновите приложение и попробуйте снова.";
      default:
        return e.message || "Что-то пошло не так. Попробуйте ещё раз.";
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
