import { describe, expect, test } from "bun:test";

type StatsData = {
  players: unknown[];
  teams: unknown[];
  heats: unknown[];
  timeTypes: unknown[];
  timeLogs: unknown[];
};

type StatsApiAction = {
  _handler: (
    context: {
      runQuery: (
        reference: unknown,
        args: Record<string, never>,
      ) => Promise<StatsData>;
    },
    request: Request,
  ) => Promise<Response>;
};

async function loadStatsApi(): Promise<StatsApiAction> {
  process.env.STATS_API_KEY = "stats-test-key";
  // Dynamic loading makes a missing protected stats endpoint fail as a test assertion.
  const statsApiModule = (await import("./statsApi")) as {
    getStatsData?: StatsApiAction;
  };

  expect(statsApiModule.getStatsData).toBeDefined();
  return statsApiModule.getStatsData as StatsApiAction;
}

describe("getStatsData", () => {
  test("returns the data needed to publish the current heat", async () => {
    const getStatsData = await loadStatsApi();
    const response = await getStatsData._handler(
      {
        runQuery: async () => ({
          players: [],
          teams: [],
          heats: [],
          timeTypes: [],
          timeLogs: [],
        }),
      },
      new Request("https://stats.example/stats", {
        headers: { Authorization: "Bearer stats-test-key" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      players: [],
      teams: [],
      heats: [],
      timeTypes: [],
      timeLogs: [],
    } satisfies StatsData);
  });
});
