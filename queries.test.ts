import { describe, expect, test } from "bun:test";

import { getPlayers } from "./queries";

type Player = { _id: string; name: string };
type Team = { _id: string; name: string };
type Heat = { _id: string; name: string; date: string; is_current: boolean };
type TimeType = { _id: string; name: string };
type TimeLog = {
  _id: string;
  heat_id: string;
  player_id: string;
  time_type_id: string;
  time_ms: number;
};

type QueryTableName =
  | "players"
  | "teams"
  | "heats"
  | "time_types"
  | "time_logs";

type QueryCtx = Parameters<(typeof getPlayers)["_handler"]>[0];

type QueryQuery = {
  collect: () => Promise<unknown[]>;
  order?: (direction: string) => QueryQuery;
};

type Context = Omit<QueryCtx, "db"> & {
  db: {
    query: (table: QueryTableName) => QueryQuery;
    get: (id: string) => Promise<unknown | null>;
  };
  auth?: {
    getUserIdentity: () => Promise<{
      subject: string;
      tokenIdentifier: string;
    } | null>;
  };
};

type InternalQueryLike = {
  isQuery?: boolean;
  isInternal?: boolean;
  _handler: (ctx: QueryCtx, args?: Record<string, unknown>) => Promise<unknown>;
};

const makeContext = ({
  players,
  teams,
  heats,
  timeTypes,
  timeLogs,
  users,
  authToken,
}: {
  players: Player[];
  teams: Team[];
  heats: Heat[];
  timeTypes: TimeType[];
  timeLogs: TimeLog[];
  users?: Record<string, { approved?: boolean }>;
  authToken?: string | null;
}): QueryCtx => {
  const data: Record<QueryTableName, unknown[]> = {
    players,
    teams,
    heats,
    time_types: timeTypes,
    time_logs: timeLogs,
  };

  const queryWithRows = (rows: unknown[]): QueryQuery => ({
    collect: async () => rows,
    order: (direction) => {
      if (direction === "desc") {
        return {
          collect: async () => [...rows].reverse(),
        };
      }

      return {
        collect: async () => [...rows],
      };
    },
  });

  const ctx = {
    db: {
      query(table) {
        return queryWithRows(data[table]);
      },
      get: async (id: string) => {
        return users?.[id] ?? null;
      },
    },
  } as Context;

  if (authToken !== undefined) {
    ctx.auth = {
      getUserIdentity: async () => {
        if (authToken === null) {
          return null;
        }

        return {
          subject: authToken,
          tokenIdentifier: authToken,
        };
      },
    };
  }

  return ctx as QueryCtx;
};

const playerRows: Player[] = [{ _id: "players_1", name: "Jordan" }];

const teamRows: Team[] = [{ _id: "teams_1", name: "Pioneers" }];

const heatRows: Heat[] = [
  { _id: "heats_2025", name: "Heat 1", date: "2025-03-01", is_current: false },
  { _id: "heats_2026", name: "Heat 2", date: "2026-09-06", is_current: true },
];
const heatRowsDesc = [...heatRows].reverse();

const timeTypeRows: TimeType[] = [{ _id: "time_types_1", name: "Run" }];

const timeLogRows: TimeLog[] = [
  {
    _id: "time_logs_1",
    heat_id: "heats_2026",
    player_id: "players_1",
    time_type_id: "time_types_1",
    time_ms: 1200,
  },
];

describe("queries", () => {
  test("getPlayers requires authentication via Not authenticated", async () => {
    const unauthenticatedCtx = makeContext({
      players: playerRows,
      teams: [],
      heats: [],
      timeTypes: [],
      timeLogs: [],
      authToken: null,
      users: {},
    });

    await expect(getPlayers._handler(unauthenticatedCtx)).rejects.toThrow(
      "Not authenticated",
    );
  });
  test("getPlayers rejects approved=false users", async () => {
    const pendingUserId = "users_pending_1";
    const pendingCtx = makeContext({
      players: playerRows,
      teams: [],
      heats: [],
      timeTypes: [],
      timeLogs: [],
      authToken: pendingUserId,
      users: {
        [pendingUserId]: {
          approved: false,
        },
      },
    });

    await expect(getPlayers._handler(pendingCtx)).rejects.toThrow(
      "pending admin approval",
    );
  });

  test("getPlayers returns player rows for approved users", async () => {
    const approvedUserId = "users_approved_1";
    const authenticatedCtx = makeContext({
      players: playerRows,
      teams: [],
      heats: [],
      timeTypes: [],
      timeLogs: [],
      authToken: approvedUserId,
      users: {
        [approvedUserId]: {
          approved: true,
        },
      },
    });

    await expect(getPlayers._handler(authenticatedCtx)).resolves.toEqual(
      playerRows,
    );
  });

  test("queries exports exportStatsData as an internal query and returns all stat collections", async () => {
    const queriesModule = await import("./queries");
    const exportStatsData = (
      queriesModule as {
        exportStatsData?: InternalQueryLike;
      }
    ).exportStatsData;

    expect(exportStatsData).toBeDefined();
    expect(exportStatsData?.isQuery).toBe(true);
    expect(exportStatsData?.isInternal).toBe(true);

    const exportCtx = makeContext({
      players: playerRows,
      teams: teamRows,
      heats: heatRows,
      timeTypes: timeTypeRows,
      timeLogs: timeLogRows,
      users: {},
      // no auth identity to prove this internal export is unauthenticated
    });

    const result = await exportStatsData!._handler(exportCtx);

    expect(result).toEqual({
      players: playerRows,
      teams: teamRows,
      heats: heatRowsDesc,
      timeTypes: timeTypeRows,
      timeLogs: timeLogRows,
    });
  });
});
