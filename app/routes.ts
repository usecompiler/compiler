import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  // Auth routes (no layout)
  route("login", "routes/login.tsx"),
  route("signup", "routes/signup.tsx"),
  route("setup", "routes/setup.tsx"),
  route("logout", "routes/logout.tsx"),

  // SAML routes
  route("auth/saml", "routes/auth.saml.tsx"),
  route("auth/saml/callback", "routes/auth.saml.callback.tsx"),
  route("auth/saml/metadata", "routes/auth.saml.metadata.tsx"),

  // Deactivated user page (no layout)
  route("deactivated", "routes/deactivated.tsx"),

  // Onboarding routes (no layout)
  route("onboarding/ai-provider", "routes/onboarding.ai-provider.tsx"),
  route("onboarding/github-app", "routes/onboarding.github-app.tsx"),
  route("onboarding/github", "routes/onboarding.github.tsx"),
  route("onboarding/github-callback", "routes/onboarding.github-callback.tsx"),
  route("onboarding/repos", "routes/onboarding.repos.tsx"),
  route("onboarding/syncing", "routes/onboarding.syncing.tsx"),

  // Invitation acceptance route (public, no layout)
  route("invite/:token", "routes/invite.$token.tsx"),

  // Share route (redirects to conversation)
  route("share/:token", "routes/share.$token.tsx"),

  // API routes
  route("api/agent", "routes/api.agent.ts"),
  route("api/conversations", "routes/api.conversations.ts"),
  route("api/items", "routes/api.items.ts"),
  route("api/search", "routes/api.search.ts"),

  // App routes (with layout that handles auth + conversations)
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("c/:id", "routes/conversation.tsx"),
    route("settings", "routes/settings.tsx"),
    route("settings/ai-provider", "routes/settings.ai-provider.tsx"),
    route("settings/github", "routes/settings.github.tsx"),
    route("settings/organization", "routes/settings.organization.tsx"),
    route("settings/authentication", "routes/settings.authentication.tsx"),
    route("analytics", "routes/analytics.tsx"),
  ]),
] satisfies RouteConfig;
