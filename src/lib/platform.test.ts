import { describe, it, expect } from "vitest";
import { formatCredits, humanizePlatformError } from "./platform";

describe("formatCredits (Russian plurals)", () => {
  it("1 кредит, 2–4 кредита, 0/5+ кредитов", () => {
    expect(formatCredits(1)).toBe("1 AI-кредит");
    expect(formatCredits(21)).toBe("21 AI-кредит");
    expect(formatCredits(3)).toBe("3 AI-кредита");
    expect(formatCredits(0)).toBe("0 AI-кредитов");
    expect(formatCredits(10)).toBe("10 AI-кредитов");
    expect(formatCredits(11)).toBe("11 AI-кредитов");
  });
});

describe("humanizePlatformError", () => {
  it("maps credit/outage/session codes to Russian copy", () => {
    expect(humanizePlatformError({ code: "INSUFFICIENT_CREDITS" })).toMatch(/Кредиты закончились/);
    expect(humanizePlatformError({ code: "PLATFORM_UNAVAILABLE" })).toMatch(/временно недоступен/);
    expect(humanizePlatformError({ code: "SESSION_EXPIRED" })).toMatch(/войдите заново/);
    expect(humanizePlatformError({ code: "NOPE" })).toBe(
      "Что-то пошло не так. Попробуйте ещё раз.",
    );
  });
});
