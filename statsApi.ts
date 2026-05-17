import { httpAction } from "convex/server";
import { api } from "./_generated/api";

const STATS_API_KEY = process.env.STATS_API_KEY;

export const getStatsData = httpAction(async (ctx, request) => {
  if (!STATS_API_KEY) {
    return new Response(JSON.stringify({ error: "STATS_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${STATS_API_KEY}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const [players, teams, heats, timeTypes, timeLogs] = await Promise.all([
    ctx.runQuery(api.queries.getPlayers, {}),
    ctx.runQuery(api.queries.getTeams, {}),
    ctx.runQuery(api.queries.getHeats, {}),
    ctx.runQuery(api.queries.getTimeTypes, {}),
    ctx.runQuery(api.queries.getTimeLogs, {}),
  ]);

  return new Response(
    JSON.stringify({ players, teams, heats, timeTypes, timeLogs }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
      },
    },
  );
});