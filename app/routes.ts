import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/agent", "routes/api.agent.ts"),
] satisfies RouteConfig;
