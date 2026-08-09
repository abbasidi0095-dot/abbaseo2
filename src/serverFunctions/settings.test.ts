import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: {},
  waitUntil: vi.fn(),
}));
import {
  parseAiTestResponse,
  parseDataforseoTestResponse,
} from "@/serverFunctions/settings";

describe("settings provider test response parsing", () => {
  it("accepts a successful DataForSEO account envelope", () => {
    expect(
      parseDataforseoTestResponse({
        status_code: 20000,
        tasks: [
          {
            status_code: 20000,
            result: [{ money: { balance: 12.5 } }],
          },
        ],
      }),
    ).toEqual({ balance: 12.5 });
  });

  it("rejects malformed DataForSEO success bodies", () => {
    expect(parseDataforseoTestResponse({})).toBeNull();
    expect(
      parseDataforseoTestResponse({
        status_code: 20000,
        tasks: [{ status_code: 40000 }],
      }),
    ).toBeNull();
  });

  it("requires non-empty assistant content from OpenRouter", () => {
    expect(
      parseAiTestResponse({
        choices: [{ message: { content: "ok" } }],
      }),
    ).toBe("ok");
    expect(parseAiTestResponse({ choices: [{}] })).toBeNull();
    expect(parseAiTestResponse({})).toBeNull();
  });
});
