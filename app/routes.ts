import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("settings", "routes/settings.tsx"),
  route("api/agent", "routes/api.agent.ts"),
  route("api/conversations", "routes/api.conversations.ts"),
  route("api/items", "routes/api.items.ts"),
] satisfies RouteConfig;
