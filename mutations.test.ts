import { describe, expect, test } from "bun:test";

type TableName =
  | "users"
  | "players"
  | "teams"
  | "heats"
  | "time_types"
  | "time_logs";

type Row = { _id: string; [key: string]: unknown };

type StartHeatArgs = {
  heat: number;
  date: string;
  team_a_id: string;
  player_a_id: string;
  team_b_id: string;
  player_b_id: string;
};

type StartHeatResult = {
  id: string;
  name: string;
  heat: number;
  date: string;
  is_current: true;
};

type IndexQuery = {
  eq: (field: string, value: unknown) => IndexQuery;
};

type QueryLike = {
  collect: () => Promise<Row[]>;
  first: () => Promise<Row | null>;
  withIndex: (
    indexName: string,
    applyIndex?: (query: IndexQuery) => unknown,
  ) => QueryLike;
};

type Write =
  | { kind: "patch"; id: string; fields: Record<string, unknown> }
  | {
      kind: "insert";
      table: TableName;
      id: string;
      value: Record<string, unknown>;
    };

type MutationContext = {
  now?: unknown;
  auth?: {
    getUserIdentity: () => Promise<{
      subject: string;
      tokenIdentifier: string;
    } | null>;
  };
  db: {
    get: (id: string) => Promise<Row | null>;
    query: (table: TableName) => QueryLike;
    patch: (id: string, fields: Record<string, unknown>) => Promise<void>;
    insert: (
      table: TableName,
      value: Record<string, unknown>,
    ) => Promise<string>;
  };
};

type Fixture = MutationContext & {
  data: Record<TableName, Row[]>;
  writes: Write[];
};

type StartHeatMutation = {
  _handler: (ctx: MutationContext, args: StartHeatArgs) => Promise<unknown>;
};

const args: StartHeatArgs = {
  heat: 3,
  date: "2026-09-06",
  team_a_id: "teams_a",
  player_a_id: "players_a",
  team_b_id: "teams_b",
  player_b_id: "players_b",
};

const approvedUserId = "users_approved";
const sailTypeId = "time_types_sail";
const priorCurrentHeatId = "heats_prior_current";

// Keep this lookup dynamic so a missing export fails the assertion below instead of failing module resolution at test collection.
async function loadStartHeat(): Promise<StartHeatMutation> {
  const mutations = (await import("./mutations")) as {
    startHeat?: StartHeatMutation;
  };

  expect(mutations.startHeat).toBeDefined();
  return mutations.startHeat as StartHeatMutation;
}

function makeQuery(rows: Row[]): QueryLike {
  return {
    collect: async () => rows,
    first: async () => rows[0] ?? null,
    withIndex: (_indexName, applyIndex) => {
      const constraints: Array<[string, unknown]> = [];
      const query: IndexQuery = {
        eq: (field, value) => {
          constraints.push([field, value]);
          return query;
        },
      };

      applyIndex?.(query);
      return makeQuery(
        rows.filter((row) =>
          constraints.every(([field, value]) => row[field] === value),
        ),
      );
    },
  };
}

function makeFixture({
  includeSail = true,
  mismatch = false,
  authToken = approvedUserId,
}: {
  includeSail?: boolean;
  mismatch?: boolean;
  authToken?: string | null;
} = {}): Fixture {
  const data: Record<TableName, Row[]> = {
    users: [{ _id: approvedUserId, approved: true }],
    players: [
      { _id: args.player_a_id, name: "Alice" },
      { _id: args.player_b_id, name: "Bob" },
    ],
    teams: [
      {
        _id: args.team_a_id,
        name: "Alpha",
        player_1_id: mismatch ? "players_other" : args.player_a_id,
      },
      {
        _id: args.team_b_id,
        name: "Beta",
        player_1_id: args.player_b_id,
      },
    ],
    heats: [
      {
        _id: priorCurrentHeatId,
        name: "Heat 2",
        heat: 2,
        date: "2026-09-05",
        is_current: true,
      },
    ],
    time_types: includeSail
      ? [{ _id: sailTypeId, name: "Sail", time_eng: "Sail" }]
      : [{ _id: "time_types_run", name: "Run", time_eng: "Run" }],
    time_logs: [],
  };
  const writes: Write[] = [];
  let nextInsertId = 1;

  const fixture = {
    now: new Date("2026-09-06T01:02:03.999Z"),
    db: {
      get: async (id: string) => {
        for (const rows of Object.values(data)) {
          const row = rows.find((candidate) => candidate._id === id);
          if (row) return row;
        }
        return null;
      },
      query: (table: TableName) => makeQuery(data[table]),
      patch: async (id: string, fields: Record<string, unknown>) => {
        const row = await fixture.db.get(id);
        if (!row) throw new Error(`Cannot patch missing row ${id}`);
        Object.assign(row, fields);
        writes.push({ kind: "patch", id, fields: { ...fields } });
      },
      insert: async (table: TableName, value: Record<string, unknown>) => {
        const id = `${table}_inserted_${nextInsertId++}`;
        const row = { _id: id, ...value };
        data[table].push(row);
        writes.push({ kind: "insert", table, id, value: { ...value } });
        return id;
      },
    },
    auth:
      authToken === undefined
        ? undefined
        : {
            getUserIdentity: async () =>
              authToken === null
                ? null
                : { subject: authToken, tokenIdentifier: authToken },
          },
    data,
    writes,
  } satisfies Fixture;

  return fixture;
}

describe("startHeat mutation", () => {
  test("unsets the current heat and creates two Sail logs with one shared timestamp", async () => {
    const startHeat = await loadStartHeat();
    const fixture = makeFixture();

    const result = (await startHeat._handler(fixture, args)) as StartHeatResult;

    const heatInserts = fixture.writes.filter(
      (write): write is Extract<Write, { kind: "insert" }> =>
        write.kind === "insert" && write.table === "heats",
    );
    const timeLogInserts = fixture.writes.filter(
      (write): write is Extract<Write, { kind: "insert" }> =>
        write.kind === "insert" && write.table === "time_logs",
    );

    expect(fixture.writes).toContainEqual({
      kind: "patch",
      id: priorCurrentHeatId,
      fields: { is_current: false },
    });
    expect(heatInserts).toHaveLength(1);
    expect(heatInserts[0]?.value).toEqual({
      name: "Heat 3",
      heat: args.heat,
      date: args.date,
      is_current: true,
    });
    expect(result).toEqual({
      id: heatInserts[0]?.id,
      name: "Heat 3",
      heat: args.heat,
      date: args.date,
      is_current: true,
    });

    expect(timeLogInserts).toHaveLength(2);
    expect(timeLogInserts.map((write) => write.value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          heat_id: heatInserts[0]?.id,
          time_type_id: sailTypeId,
          player_id: args.player_a_id,
          team_id: args.team_a_id,
        }),
        expect.objectContaining({
          heat_id: heatInserts[0]?.id,
          time_type_id: sailTypeId,
          player_id: args.player_b_id,
          team_id: args.team_b_id,
        }),
      ]),
    );
    expect(typeof timeLogInserts[0]?.value.time_seconds).toBe("number");
    expect(typeof timeLogInserts[0]?.value.time).toBe("string");
    expect(timeLogInserts[0]?.value.time_seconds).toBe(
      timeLogInserts[1]?.value.time_seconds,
    );
    expect(timeLogInserts[0]?.value.time).toBe(timeLogInserts[1]?.value.time);
  });

  test("rejects a missing Sail type before any writes", async () => {
    const startHeat = await loadStartHeat();
    const fixture = makeFixture({ includeSail: false });

    await expect(startHeat._handler(fixture, args)).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  test("rejects a player who does not belong to its selected team before any writes", async () => {
    const startHeat = await loadStartHeat();
    const fixture = makeFixture({ mismatch: true });

    await expect(startHeat._handler(fixture, args)).rejects.toThrow();
    expect(fixture.writes).toEqual([]);
  });

  test("rejects unauthenticated callers without writes", async () => {
    const startHeat = await loadStartHeat();
    const fixture = makeFixture({ authToken: null });

    await expect(startHeat._handler(fixture, args)).rejects.toThrow(
      "Not authenticated",
    );
    expect(fixture.writes).toEqual([]);
  });
});
