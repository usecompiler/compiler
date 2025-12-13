import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  // Auth routes (no layout)
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("logout", "routes/logout.tsx"),

  // API routes
  route("api/agent", "routes/api.agent.ts"),
  route("api/conversations", "routes/api.conversations.ts"),
  route("api/items", "routes/api.items.ts"),

  // App routes (with layout that handles auth + conversations)
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("c/:id", "routes/conversation.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig;
