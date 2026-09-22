import { PlatformClient, type IPlatformClient } from "./client.js";
import { MockPlatformClient } from "./mock.js";
import { config, isProduction } from "../config.js";

/**
 * Platform client factory (server-only).
 * - Real service token configured → real client.
 * - Non-production without token → deterministic mock (dev/tests).
 * - Production without token → real client that fails closed at call time.
 */
export function getPlatformClient(): IPlatformClient {
  const token = config.userPlatformServiceToken;
  if (token) {
    return new PlatformClient({
      baseUrl: config.userPlatformUrl,
      getServiceToken: () => config.userPlatformServiceToken || undefined,
    });
  }
  if (!isProduction()) return new MockPlatformClient();
  return new PlatformClient({
    baseUrl: config.userPlatformUrl,
    getServiceToken: () => undefined,
  });
}

export type { IPlatformClient };
export { PlatformClient, MockPlatformClient };
export * from "./types.js";
export * from "./errors.js";
