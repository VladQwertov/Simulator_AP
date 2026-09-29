import { describe, expect, it } from "vitest";
import { deriveOpponentMood } from "./mood";

describe("deriveOpponentMood", () => {
  it("trust >= 65 -> positive", () => {
    expect(deriveOpponentMood(65)).toBe("positive");
    expect(deriveOpponentMood(100)).toBe("positive");
  });

  it("trust <= 30 -> negative", () => {
    expect(deriveOpponentMood(30)).toBe("negative");
    expect(deriveOpponentMood(0)).toBe("negative");
  });

  it("между порогами -> neutral", () => {
    expect(deriveOpponentMood(50)).toBe("neutral");
    expect(deriveOpponentMood(31)).toBe("neutral");
    expect(deriveOpponentMood(64)).toBe("neutral");
  });
});
