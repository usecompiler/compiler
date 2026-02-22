import { describe, it, expect, vi, beforeEach } from "vitest";
import { bedrockCompactionFetch } from "./models.server";

const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockClear();
});

describe("bedrockCompactionFetch", () => {
  it("injects betas when context_management is present", async () => {
    const body = JSON.stringify({
      context_management: { enabled: true },
      messages: [],
    });

    await bedrockCompactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.anthropic_beta).toContain("compact-2026-01-12");
    expect(sentBody.anthropic_beta).toContain(
      "context-management-2025-06-27",
    );
  });

  it("preserves existing anthropic_beta entries", async () => {
    const body = JSON.stringify({
      context_management: { enabled: true },
      anthropic_beta: ["existing-beta-1"],
    });

    await bedrockCompactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
    });

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.anthropic_beta).toContain("existing-beta-1");
    expect(sentBody.anthropic_beta).toContain("compact-2026-01-12");
    expect(sentBody.anthropic_beta).toContain(
      "context-management-2025-06-27",
    );
  });

  it("does not modify body when context_management is absent", async () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });

    await bedrockCompactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
    });

    expect(mockFetch.mock.calls[0][1].body).toBe(body);
  });

  it("handles non-string body without throwing", async () => {
    const formData = new FormData();

    await bedrockCompactionFetch("https://bedrock.example.com", {
      method: "POST",
      body: formData as never,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][1].body).toBe(formData);
  });
});
