import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMockDb } from "~/test-utils/mock-db";

const mockDb = createMockDb();
vi.mock("~/lib/db/index.server", () => ({ db: mockDb }));

const requireActiveAuth = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireActiveAuth }));

vi.mock("~/lib/permissions.server", () => ({
  canManageOrganization: (role: string | undefined) => role === "owner" || role === "admin",
}));

vi.mock("~/lib/db/schema", () => ({
  conversations: { id: "conversations.id", createdAt: "conversations.createdAt", userId: "conversations.userId" },
  conversationShares: { id: "cs.id", createdAt: "cs.createdAt", conversationId: "cs.conversationId", revokedAt: "cs.revokedAt" },
  items: { id: "items.id", createdAt: "items.createdAt", conversationId: "items.conversationId", type: "items.type", role: "items.role", content: "items.content" },
  members: { userId: "members.userId", organizationId: "members.organizationId" },
  reviewRequests: { id: "rr.id", createdAt: "rr.createdAt", conversationId: "rr.conversationId" },
}));

const sqlCalls: { strings: string[]; values: unknown[] }[] = [];

vi.mock("drizzle-orm", () => ({
  eq: (...args: unknown[]) => ({ _op: "eq", args }),
  and: (...args: unknown[]) => ({ _op: "and", args }),
  gte: (...args: unknown[]) => ({ _op: "gte", args }),
  count: (...args: unknown[]) => ({ _op: "count", args }),
  countDistinct: (...args: unknown[]) => ({ _op: "countDistinct", args }),
  isNull: (...args: unknown[]) => ({ _op: "isNull", args }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const call = { strings: Array.from(strings), values };
    sqlCalls.push(call);
    return { _tag: "sql", ...call, as: () => ({ _tag: "sql", ...call }) };
  },
}));

function mockUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "test@example.com",
    name: "Test User",
    organization: { id: "org-1", onboardingCompleted: true, createdAt: new Date("2026-01-15T00:00:00Z") },
    membership: { id: "member-1", organizationId: "org-1", role: "owner" as const, isDeactivated: false },
    ...overrides,
  };
}

function setupEmptyAnalytics() {
  mockDb._selectResults = [
    [],
    [],
    [],
    [],
    [],
    [],
  ];
  mockDb._selectCallCount = 0;
  mockDb._executeResults = [
    [{ count: 0 }],
    [{ count: 0 }],
    [],
    [],
  ];
  mockDb._executeCallCount = 0;
}

function setupAnalyticsWithData() {
  mockDb._selectResults = [
    [{ date: "2026-02-15", count: 5 }],
    [{ date: "2026-02-15", count: 10 }],
    [{ date: "2026-02-15", count: 3 }],
    [{ date: "2026-02-15", tokens: "500" }],
    [{ date: "2026-02-15", count: 2 }],
    [{ date: "2026-02-15", count: 1 }],
  ];
  mockDb._selectCallCount = 0;
  mockDb._executeResults = [
    [{ count: 8 }],
    [{ count: 15 }],
    [{ date: "2026-02-15", count: 7 }],
    [{ date: "2026-02-15", count: 12 }],
  ];
  mockDb._executeCallCount = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  sqlCalls.length = 0;
  vi.useFakeTimers({ now: new Date("2026-02-16T12:00:00Z") });
  setupEmptyAnalytics();
  requireActiveAuth.mockResolvedValue(mockUser());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("validateTimezone", () => {
  it("returns valid timezone as-is", async () => {
    const { validateTimezone } = await import("~/lib/analytics.server");
    expect(validateTimezone("America/New_York")).toBe("America/New_York");
  });

  it("returns UTC for invalid timezone", async () => {
    const { validateTimezone } = await import("~/lib/analytics.server");
    expect(validateTimezone("Invalid/Timezone")).toBe("UTC");
  });

  it("returns UTC for empty string", async () => {
    const { validateTimezone } = await import("~/lib/analytics.server");
    expect(validateTimezone("")).toBe("UTC");
  });

  it("accepts common IANA timezones", async () => {
    const { validateTimezone } = await import("~/lib/analytics.server");
    expect(validateTimezone("Europe/London")).toBe("Europe/London");
    expect(validateTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(validateTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
});

describe("getOrganizationAnalytics", () => {
  it("returns stats and totals", async () => {
    setupAnalyticsWithData();
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-01-15T00:00:00Z"), "UTC");
    expect(result.stats.length).toBeGreaterThan(0);
    expect(result.totals).toBeDefined();
    expect(result.totals.wau).toBe(8);
    expect(result.totals.mau).toBe(15);
  });

  it("uses AT TIME ZONE in drizzle SQL queries", async () => {
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    await getOrganizationAnalytics("org-1", new Date("2026-01-15T00:00:00Z"), "America/New_York");

    const atTimeZoneCalls = sqlCalls.filter(call =>
      call.strings.some(s => s.includes("AT TIME ZONE"))
    );
    expect(atTimeZoneCalls.length).toBeGreaterThan(0);

    const tzValues = atTimeZoneCalls.flatMap(call => call.values);
    expect(tzValues).toContain("America/New_York");
  });

  it("uses AT TIME ZONE in raw rolling WAU/MAU SQL", async () => {
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    await getOrganizationAnalytics("org-1", new Date("2026-01-15T00:00:00Z"), "Europe/London");

    const rawSqlCalls = sqlCalls.filter(call =>
      call.strings.some(s => s.includes("generate_series"))
    );
    expect(rawSqlCalls.length).toBe(2);

    for (const call of rawSqlCalls) {
      const joined = call.strings.join("");
      expect(joined).toContain("AT TIME ZONE");
      expect(joined).toContain("CURRENT_TIMESTAMP AT TIME ZONE");
      expect(call.values).toContain("Europe/London");
    }
  });

  it("falls back to UTC for invalid timezone", async () => {
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    await getOrganizationAnalytics("org-1", new Date("2026-01-15T00:00:00Z"), "Invalid/TZ");

    const atTimeZoneCalls = sqlCalls.filter(call =>
      call.strings.some(s => s.includes("AT TIME ZONE"))
    );
    const tzValues = atTimeZoneCalls.flatMap(call => call.values);
    expect(tzValues).toContain("UTC");
    expect(tzValues).not.toContain("Invalid/TZ");
  });

  it("generates YYYY-MM-DD date strings", async () => {
    setupAnalyticsWithData();
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-02-15T00:00:00Z"), "UTC");

    for (const stat of result.stats) {
      expect(stat.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("includes today in the date range", async () => {
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-02-15T00:00:00Z"), "UTC");

    const dates = result.stats.map(s => s.date);
    expect(dates).toContain("2026-02-16");
  });

  it("populates stats from query results", async () => {
    setupAnalyticsWithData();
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-02-01T00:00:00Z"), "UTC");

    const feb15 = result.stats.find(s => s.date === "2026-02-15");
    expect(feb15).toBeDefined();
    expect(feb15!.conversationCount).toBe(5);
    expect(feb15!.messageCount).toBe(10);
    expect(feb15!.activeUserCount).toBe(3);
    expect(feb15!.tokenCount).toBe(500);
    expect(feb15!.shareCount).toBe(2);
    expect(feb15!.reviewRequestCount).toBe(1);
    expect(feb15!.wauCount).toBe(7);
    expect(feb15!.mauCount).toBe(12);
  });

  it("computes totals from today", async () => {
    mockDb._selectResults = [
      [{ date: "2026-02-16", count: 5 }],
      [{ date: "2026-02-16", count: 10 }],
      [{ date: "2026-02-16", count: 3 }],
      [{ date: "2026-02-16", tokens: "500" }],
      [{ date: "2026-02-16", count: 2 }],
      [{ date: "2026-02-16", count: 1 }],
    ];
    mockDb._selectCallCount = 0;
    mockDb._executeResults = [
      [{ count: 8 }],
      [{ count: 15 }],
      [{ date: "2026-02-16", count: 7 }],
      [{ date: "2026-02-16", count: 12 }],
    ];
    mockDb._executeCallCount = 0;

    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-01-15T00:00:00Z"), "UTC");

    expect(result.totals.dau).toBe(3);
    expect(result.totals.conversations).toBe(5);
    expect(result.totals.messages).toBe(10);
    expect(result.totals.shares).toBe(2);
    expect(result.totals.reviewRequests).toBe(1);
    expect(result.totals.tokens).toBe(500);
  });

  it("computes avgMessagesPerUser in stats", async () => {
    setupAnalyticsWithData();
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-02-01T00:00:00Z"), "UTC");

    const feb15 = result.stats.find(s => s.date === "2026-02-15");
    expect(feb15).toBeDefined();
    expect(feb15!.avgMessagesPerUser).toBeCloseTo(10 / 3);
  });

  it("returns zero avgMessagesPerUser when no active users", async () => {
    const { getOrganizationAnalytics } = await import("~/lib/analytics.server");
    const result = await getOrganizationAnalytics("org-1", new Date("2026-02-15T00:00:00Z"), "UTC");

    for (const stat of result.stats) {
      expect(stat.avgMessagesPerUser).toBe(0);
    }
  });
});

describe("analytics route loader", () => {
  it("redirects when user cannot manage organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ membership: { role: "member" } }));
    const { loader } = await import("~/routes/analytics");

    try {
      await loader({ request: new Request("http://localhost/analytics?tz=UTC") } as never);
      expect.fail("Should have thrown redirect");
    } catch (response: unknown) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
    }
  });

  it("redirects when user has no organization", async () => {
    requireActiveAuth.mockResolvedValue(mockUser({ organization: null }));
    const { loader } = await import("~/routes/analytics");

    try {
      await loader({ request: new Request("http://localhost/analytics?tz=UTC") } as never);
      expect.fail("Should have thrown redirect");
    } catch (response: unknown) {
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(302);
    }
  });

  it("returns analytics data from loader", async () => {
    setupAnalyticsWithData();
    const { loader } = await import("~/routes/analytics");
    const result = await loader({
      request: new Request("http://localhost/analytics?tz=UTC"),
    } as never);

    expect(result).toHaveProperty("stats");
    expect(result).toHaveProperty("totals");
  });

  it("passes tz param to analytics function", async () => {
    const { loader } = await import("~/routes/analytics");
    await loader({
      request: new Request("http://localhost/analytics?tz=America/Chicago"),
    } as never);

    const atTimeZoneCalls = sqlCalls.filter(call =>
      call.strings.some(s => s.includes("AT TIME ZONE"))
    );
    const tzValues = atTimeZoneCalls.flatMap(call => call.values);
    expect(tzValues).toContain("America/Chicago");
  });
});

describe("analytics clientLoader", () => {
  it("redirects to add tz param when missing", async () => {
    const { clientLoader } = await import("~/routes/analytics");

    try {
      await clientLoader({
        request: new Request("http://localhost/analytics"),
        serverLoader: vi.fn(),
      } as never);
      expect.fail("Should have thrown redirect");
    } catch (response: unknown) {
      expect(response).toBeInstanceOf(Response);
      const location = (response as Response).headers.get("Location");
      expect(location).toContain("tz=");
    }
  });

  it("calls serverLoader when tz is present", async () => {
    const mockData = { stats: [], totals: {} };
    const serverLoader = vi.fn().mockResolvedValue(mockData);
    const { clientLoader } = await import("~/routes/analytics");

    const result = await clientLoader({
      request: new Request("http://localhost/analytics?tz=America/New_York"),
      serverLoader,
    } as never);

    expect(serverLoader).toHaveBeenCalled();
    expect(result).toEqual(mockData);
  });
});
