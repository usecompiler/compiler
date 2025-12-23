import { redirect } from "react-router";
import type { Route } from "./+types/onboarding.github-callback";
import { requireActiveAuth } from "~/lib/auth.server";
import { getInstallationAccessToken, saveInstallation } from "~/lib/github.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  if (user.membership?.role !== "owner") {
    return redirect("/");
  }

  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action");

  if (!installationId) {
    return redirect("/onboarding/github?error=missing_installation_id");
  }

  if (setupAction === "install" || setupAction === "update") {
    const { token, expiresAt } = await getInstallationAccessToken(installationId);
    await saveInstallation(user.organization.id, installationId, token, expiresAt);
  }

  if (user.organization.onboardingCompleted) {
    return redirect("/settings/repositories?showAdd=true");
  }

  return redirect("/onboarding/repos");
}

export default function OnboardingGithubCallback() {
  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
      <div className="text-center">
        <div className="w-8 h-8 mx-auto mb-4 border-2 border-neutral-300 dark:border-neutral-600 border-t-neutral-900 dark:border-t-neutral-100 rounded-full animate-spin" />
        <p className="text-neutral-500 dark:text-neutral-400">Connecting to GitHub...</p>
      </div>
    </div>
  );
}
