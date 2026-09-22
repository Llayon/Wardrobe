import type { PlatformErrorCode } from "./types.js";

/**
 * Typed UserPlatform failure. Never carries tokens/initData.
 */
export class PlatformError extends Error {
  readonly status: number;
  readonly code: PlatformErrorCode;
  constructor(status: number, code: PlatformErrorCode, message: string) {
    super(message);
    this.name = "PlatformError";
    this.status = status;
    this.code = code;
  }
}

export function toPlatformError(
  status: number,
  body: { error?: string; code?: string },
  fallback: string,
): PlatformError {
  const raw = body.code ?? "UNKNOWN";
  const message = body.error ?? fallback;
  switch (raw) {
    case "INSUFFICIENT_CREDITS":
      return new PlatformError(status, "INSUFFICIENT_CREDITS", message);
    case "UNAUTHORIZED":
      return new PlatformError(status, "SESSION_EXPIRED", message);
    case "FORBIDDEN":
      return new PlatformError(status, "SESSION_FORBIDDEN", message);
    case "INVALID_PLATFORM_DATA":
      return new PlatformError(status, "INVALID_PLATFORM_DATA", message);
    case "PLATFORM_DATA_EXPIRED":
      return new PlatformError(status, "PLATFORM_DATA_EXPIRED", message);
    case "NOT_FOUND":
      return new PlatformError(status, "NOT_FOUND", message);
    case "RESERVATION_CONFLICT":
      return new PlatformError(status, "RESERVATION_CONFLICT", message);
    default:
      return new PlatformError(status, "UNKNOWN", message);
  }
}

export function platformUnavailable(
  message = "Сервис аккаунта временно недоступен",
): PlatformError {
  return new PlatformError(503, "PLATFORM_UNAVAILABLE", message);
}
