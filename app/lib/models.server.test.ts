import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db/index.server", () => ({ db: {} }));
vi.mock("~/lib/ai-provider.server", () => ({ getAIProviderConfig: vi.fn() }));

const mockSign = vi.fn().mockResolvedValue({
  method: "POST",
  url: new URL("https://bedrock.example.com"),
  headers: new Headers({ authorization: "AWS4-HMAC-SHA256 re-signed", "x-amz-date": "20260222T000000Z" }),
  body: "",
});

class MockAwsV4Signer {
  options: Record<string, unknown>;
  constructor(options: Record<string, unknown>) {
    this.options = options;
    MockAwsV4Signer.instances.push(this);
  }
  sign = mockSign;
  static instances: MockAwsV4Signer[] = [];
}

vi.mock("aws4fetch", () => ({
  AwsV4Signer: MockAwsV4Signer,
}));

import { createBedrockCompactionFetch } from "./models.server";

const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockClear();
  mockSign.mockClear();
  MockAwsV4Signer.instances = [];
});

const compactionFetch = createBedrockCompactionFetch(
  "us-east-1",
  "AKID",
  "SECRET",
);

describe("createBedrockCompactionFetch", () => {
  it("injects betas and re-signs when context_management is present", async () => {
    const body = JSON.stringify({
      context_management: { enabled: true },
      messages: [],
    });

    await compactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
    });

    const instance = MockAwsV4Signer.instances[0];
    const signedBody = JSON.parse(instance.options.body as string);
    expect(signedBody.anthropic_beta).toContain("compact-2026-01-12");
    expect(signedBody.anthropic_beta).toContain("context-management-2025-06-27");
    expect(instance.options.region).toBe("us-east-1");
    expect(instance.options.service).toBe("bedrock");
    expect(mockSign).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("preserves existing anthropic_beta entries", async () => {
    const body = JSON.stringify({
      context_management: { enabled: true },
      anthropic_beta: ["existing-beta-1"],
    });

    await compactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
    });

    const signedBody = JSON.parse(MockAwsV4Signer.instances[0].options.body as string);
    expect(signedBody.anthropic_beta).toContain("existing-beta-1");
    expect(signedBody.anthropic_beta).toContain("compact-2026-01-12");
    expect(signedBody.anthropic_beta).toContain("context-management-2025-06-27");
  });

  it("does not modify body or re-sign when context_management is absent", async () => {
    const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });

    await compactionFetch("https://bedrock.example.com", {
      method: "POST",
      body,
    });

    expect(MockAwsV4Signer.instances).toHaveLength(0);
    expect(mockFetch.mock.calls[0][1].body).toBe(body);
  });

  it("handles non-string body without throwing", async () => {
    const formData = new FormData();

    await compactionFetch("https://bedrock.example.com", {
      method: "POST",
      body: formData as never,
    });

    expect(MockAwsV4Signer.instances).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][1].body).toBe(formData);
  });
});
