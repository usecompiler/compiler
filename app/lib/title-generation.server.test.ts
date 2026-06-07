import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();
vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("./models.server", () => ({
  getTitleGenerationModel: vi.fn().mockResolvedValue("mock-model"),
}));

const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
vi.mock("./db/index.server", () => ({
  db: { update: () => ({ set: mockUpdateSet }) },
}));

vi.mock("drizzle-orm", () => ({ eq: (...args: unknown[]) => ({ _op: "eq", args }) }));
vi.mock("./db/schema", () => ({ conversations: { id: "conversations.id" } }));

import { generateAndSaveTitle } from "./title-generation.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateAndSaveTitle", () => {
  it("saves a clean generated title", async () => {
    mockGenerateText.mockResolvedValue({ text: "Key Feature Walkthrough" });
    const result = await generateAndSaveTitle("conv-1", "org-1", "walk me through a key feature");
    expect(result).toBe("Key Feature Walkthrough");
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Key Feature Walkthrough" })
    );
  });

  it("strips surrounding quotes from the title", async () => {
    mockGenerateText.mockResolvedValue({ text: '"Payment Flow Overview"' });
    const result = await generateAndSaveTitle("conv-1", "org-1", "how do payments work");
    expect(result).toBe("Payment Flow Overview");
  });

  it("rejects a conversational run-on response instead of saving it as the title", async () => {
    mockGenerateText.mockResolvedValue({
      text: "I'd be happy to walk you through a key feature! However, I don't have context about what product you're referring to. Could you let me know",
    });
    const result = await generateAndSaveTitle("conv-1", "org-1", "walk me through one of the key features");
    expect(result).toBeNull();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("returns null without calling the model for empty input", async () => {
    const result = await generateAndSaveTitle("conv-1", "org-1", "   ");
    expect(result).toBeNull();
    expect(mockGenerateText).not.toHaveBeenCalled();
  });

  it("returns null when the model returns only whitespace", async () => {
    mockGenerateText.mockResolvedValue({ text: "   " });
    const result = await generateAndSaveTitle("conv-1", "org-1", "hello");
    expect(result).toBeNull();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});
