import { vi } from "vitest";

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  _selectFrom: ReturnType<typeof vi.fn>;
  _selectWhere: ReturnType<typeof vi.fn>;
  _insertValues: ReturnType<typeof vi.fn>;
  _updateSet: ReturnType<typeof vi.fn>;
  _updateWhere: ReturnType<typeof vi.fn>;
  _deleteWhere: ReturnType<typeof vi.fn>;
  _setSelectResult: (rows: unknown[]) => void;
  _selectResults: unknown[][];
  _selectCallCount: number;
  _executeResults: unknown[];
  _executeCallCount: number;
}

export function createMockDb(): MockDb {
  let selectResults: unknown[][] = [[]];
  let selectCallCount = 0;
  let executeResults: unknown[] = [[]];
  let executeCallCount = 0;

  const deleteWhereFn = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn(() => ({ where: deleteWhereFn }));
  const updateWhereFn = vi.fn().mockResolvedValue(undefined);
  const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
  const updateFn = vi.fn(() => ({ set: updateSetFn }));
  const onConflictDoNothingFn = vi.fn().mockResolvedValue(undefined);
  const insertValuesFn = vi.fn(() => {
    const p = Promise.resolve(undefined);
    (p as unknown as Record<string, unknown>).onConflictDoNothing = onConflictDoNothingFn;
    return p;
  });
  const insertFn = vi.fn(() => ({ values: insertValuesFn }));

  const selectWhereFn = vi.fn(() => {
    const idx = selectCallCount;
    selectCallCount++;
    const result = idx < selectResults.length ? selectResults[idx] : selectResults[selectResults.length - 1];
    const promise = Promise.resolve(result);
    const orderByFn = vi.fn(() => promise);
    const groupByFn = vi.fn(() => Object.assign(Promise.resolve(result), { orderBy: orderByFn }));
    return Object.assign(promise, { groupBy: groupByFn, orderBy: orderByFn });
  });

  const innerJoinFn = vi.fn();
  const joinable = { innerJoin: innerJoinFn, where: selectWhereFn };
  innerJoinFn.mockReturnValue(joinable);
  const selectFromFn = vi.fn(() => joinable);
  const selectFn = vi.fn(() => ({ from: selectFromFn }));

  const executeFn = vi.fn(() => {
    const idx = executeCallCount;
    executeCallCount++;
    const result = idx < executeResults.length ? executeResults[idx] : executeResults[executeResults.length - 1];
    return Promise.resolve(result);
  });

  const mockDb: MockDb = {
    select: selectFn,
    insert: insertFn,
    update: updateFn,
    delete: deleteFn,
    execute: executeFn,
    _selectFrom: selectFromFn,
    _selectWhere: selectWhereFn,
    _insertValues: insertValuesFn,
    _updateSet: updateSetFn,
    _updateWhere: updateWhereFn,
    _deleteWhere: deleteWhereFn,
    _setSelectResult: (rows: unknown[]) => {
      selectResults = [rows];
      selectCallCount = 0;
    },
    _selectResults: selectResults,
    _selectCallCount: selectCallCount,
    _executeResults: executeResults,
    _executeCallCount: executeCallCount,
  };

  Object.defineProperty(mockDb, "_selectResults", {
    get: () => selectResults,
    set: (val: unknown[][]) => { selectResults = val; },
  });

  Object.defineProperty(mockDb, "_selectCallCount", {
    get: () => selectCallCount,
    set: (val: number) => { selectCallCount = val; },
  });

  Object.defineProperty(mockDb, "_executeResults", {
    get: () => executeResults,
    set: (val: unknown[]) => { executeResults = val; },
  });

  Object.defineProperty(mockDb, "_executeCallCount", {
    get: () => executeCallCount,
    set: (val: number) => { executeCallCount = val; },
  });

  return mockDb;
}

export function buildRequest(body: unknown, method = "POST"): Request {
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/api/agent", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  });
}

export async function consumeSSEStream(response: Response): Promise<object[]> {
  const events: object[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        events.push(JSON.parse(line.slice(6)));
      }
    }
  }

  if (buffer.startsWith("data: ")) {
    events.push(JSON.parse(buffer.slice(6)));
  }

  await new Promise((r) => setTimeout(r, 0));

  return events;
}
