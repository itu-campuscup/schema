import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { getStatsData } from "./statsApi";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({
  path: "/stats",
  method: "GET",
  handler: getStatsData,
});

export default http;
