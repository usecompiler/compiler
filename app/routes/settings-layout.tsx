import { Link, Outlet, useLocation } from "react-router";
import type { Route } from "./+types/settings-layout";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { isSaas } from "~/lib/appMode.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  const canManageOrg = canManageOrganization(user.membership?.role);
  const isSaasMode = isSaas();

  return { canManageOrg, isSaasMode };
}

export interface SettingsContext {
  canManageOrg: boolean;
  isSaasMode: boolean;
}

const TABS = [
  { label: "Account", path: "/settings", adminOnly: false, selfHostedOnly: false },
  { label: "AI Provider", path: "/settings/ai-provider", adminOnly: true, selfHostedOnly: true },
  { label: "Audit Log", path: "/settings/audit-log", adminOnly: true, selfHostedOnly: false },
  { label: "Authentication", path: "/settings/authentication", adminOnly: true, selfHostedOnly: false },
  { label: "GitHub", path: "/settings/github", adminOnly: true, selfHostedOnly: false },
  { label: "Organization", path: "/settings/organization", adminOnly: true, selfHostedOnly: false },
  { label: "Projects", path: "/settings/projects", adminOnly: true, selfHostedOnly: false },
  { label: "Storage", path: "/settings/storage", adminOnly: true, selfHostedOnly: true },
];

export default function SettingsLayout({ loaderData }: Route.ComponentProps) {
  const { canManageOrg, isSaasMode } = loaderData;
  const location = useLocation();

  const visibleTabs = TABS.filter((tab) => {
    if (tab.adminOnly && !canManageOrg) return false;
    if (tab.selfHostedOnly && isSaasMode) return false;
    return true;
  });

  const context: SettingsContext = { canManageOrg, isSaasMode };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            Settings
          </h1>
        </div>
      </header>

      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            {visibleTabs.map((tab) => {
              const isActive = location.pathname === tab.path;
              return isActive ? (
                <span
                  key={tab.path}
                  className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100"
                >
                  {tab.label}
                </span>
              ) : (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      <Outlet context={context} />
    </div>
  );
}
