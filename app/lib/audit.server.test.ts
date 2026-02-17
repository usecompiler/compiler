import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn().mockReturnValue({ values: vi.fn() });
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockOffset = vi.fn();

vi.mock("~/lib/db/index.server", () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

vi.mock("~/lib/db/schema", () => ({
  auditLogs: { id: "id", organizationId: "organization_id", actorId: "actor_id", action: "action", metadata: "metadata", createdAt: "created_at" },
  users: { id: "id", name: "name", email: "email" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: "eq", args })),
  desc: vi.fn((...args: unknown[]) => ({ type: "desc", args })),
}));

beforeEach(() => {
  vi.clearAllMocks();

  const insertValues = vi.fn().mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: insertValues });

  mockOffset.mockResolvedValue([]);
  mockLimit.mockReturnValue({ offset: mockOffset });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
  mockSelect.mockReturnValue({ from: mockFrom });
});

describe("logAuditEvent", () => {
  it("inserts a row with the given parameters", async () => {
    const { logAuditEvent } = await import("./audit.server");

    await logAuditEvent("org-1", "user-1", "created invitation (member role)");

    expect(mockInsert).toHaveBeenCalled();
    const valuesCall = mockInsert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        actorId: "user-1",
        action: "created invitation (member role)",
        metadata: null,
      })
    );
  });

  it("includes metadata when provided", async () => {
    const { logAuditEvent } = await import("./audit.server");

    await logAuditEvent("org-1", "user-1", "deactivated member", { memberId: "m-1" });

    const valuesCall = mockInsert.mock.results[0].value.values;
    expect(valuesCall).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { memberId: "m-1" },
      })
    );
  });

  it("generates a UUID for the id field", async () => {
    const { logAuditEvent } = await import("./audit.server");

    await logAuditEvent("org-1", "user-1", "test action");

    const valuesCall = mockInsert.mock.results[0].value.values;
    const insertedData = valuesCall.mock.calls[0][0];
    expect(insertedData.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});

describe("getAuditLogs", () => {
  it("returns entries and hasMore from the database", async () => {
    const mockEntries = [
      { id: "1", action: "Test", metadata: null, createdAt: new Date(), actorName: "Alice", actorEmail: "alice@test.com" },
    ];
    mockOffset.mockResolvedValue(mockEntries);

    const { getAuditLogs } = await import("./audit.server");
    const result = await getAuditLogs("org-1");

    expect(result).toEqual({ entries: mockEntries, hasMore: false });
    expect(mockSelect).toHaveBeenCalled();
  });

  it("uses default limit of 100 and fetches limit + 1", async () => {
    const { getAuditLogs } = await import("./audit.server");
    await getAuditLogs("org-1");

    expect(mockLimit).toHaveBeenCalledWith(101);
  });

  it("accepts a custom limit and fetches limit + 1", async () => {
    const { getAuditLogs } = await import("./audit.server");
    await getAuditLogs("org-1", 50);

    expect(mockLimit).toHaveBeenCalledWith(51);
  });

  it("passes offset to the query", async () => {
    const { getAuditLogs } = await import("./audit.server");
    await getAuditLogs("org-1", 100, 25);

    expect(mockOffset).toHaveBeenCalledWith(25);
  });

  it("sets hasMore to true when rows exceed limit", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: String(i),
      action: "Test",
      metadata: null,
      createdAt: new Date(),
      actorName: "Alice",
      actorEmail: "alice@test.com",
    }));
    mockOffset.mockResolvedValue(rows);

    const { getAuditLogs } = await import("./audit.server");
    const result = await getAuditLogs("org-1", 50);

    expect(result.hasMore).toBe(true);
    expect(result.entries).toHaveLength(50);
  });
});
