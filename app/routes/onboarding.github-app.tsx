import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/onboarding.github-app";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getGitHubAppConfig,
  saveGitHubAppConfig,
  validateGitHubAppConfig,
} from "~/lib/github.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  if (user.membership?.role !== "owner") {
    return redirect("/");
  }

  if (user.organization.onboardingCompleted) {
    return redirect("/");
  }

  const config = await getGitHubAppConfig(user.organization.id);
  if (config) {
    return redirect("/onboarding/github");
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || user.membership?.role !== "owner") {
    return { error: "Unauthorized" };
  }

  const formData = await request.formData();
  const appId = (formData.get("appId") as string)?.trim();
  const appSlug = (formData.get("appSlug") as string)?.trim();
  const privateKey = formData.get("privateKey") as string;

  if (!appId || !appSlug || !privateKey) {
    return { error: "All fields are required" };
  }

  if (!/^\d+$/.test(appId)) {
    return { error: "App ID must be a number" };
  }

  if (!/^[a-z0-9-]+$/.test(appSlug)) {
    return { error: "App Slug must contain only lowercase letters, numbers, and hyphens" };
  }

  const normalizedKey = privateKey.replace(/\\n/g, "\n");
  if (
    !normalizedKey.includes("-----BEGIN") ||
    !normalizedKey.includes("PRIVATE KEY-----")
  ) {
    return { error: "Private key must be in PEM format" };
  }

  const validation = validateGitHubAppConfig(appId, privateKey);
  if (!validation.valid) {
    return { error: validation.error || "Invalid private key" };
  }

  await saveGitHubAppConfig(user.organization.id, appId, appSlug, privateKey);

  return redirect("/onboarding/github");
}

export default function OnboardingGitHubApp() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-neutral-600 dark:text-neutral-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Configure GitHub App
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Enter your GitHub App credentials to enable repository access.
          </p>
        </div>

        <Form method="post" className="space-y-4">
          {actionData?.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          <div>
            <label
              htmlFor="appId"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              GitHub App ID
            </label>
            <input
              type="text"
              id="appId"
              name="appId"
              required
              autoFocus
              placeholder="123456"
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Found in your GitHub App settings under "App ID"
            </p>
          </div>

          <div>
            <label
              htmlFor="appSlug"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              GitHub App Slug
            </label>
            <input
              type="text"
              id="appSlug"
              name="appSlug"
              required
              placeholder="my-app-name"
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              The URL-friendly name from github.com/apps/your-app-slug
            </p>
          </div>

          <div>
            <label
              htmlFor="privateKey"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              Private Key
            </label>
            <textarea
              id="privateKey"
              name="privateKey"
              required
              rows={6}
              placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Generate a private key in your GitHub App settings
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Validating..." : "Continue"}
          </button>
        </Form>

        <p className="mt-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          Need a GitHub App?{" "}
          <a
            href="https://github.com/settings/apps/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-neutral-600 dark:text-neutral-300 hover:underline"
          >
            Create one on GitHub
          </a>
        </p>
      </div>
    </div>
  );
}
