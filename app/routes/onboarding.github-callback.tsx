import { redirect } from "react-router";
import type { Route } from "./+types/onboarding.github-callback";
import { requireActiveAuth } from "~/lib/auth.server";
import {
  getInstallationAccessToken,
  saveInstallation,
  exchangeCodeForUserToken,
  getGitHubUser,
  findInstallationRequestAccount,
  savePendingInstallation,
} from "~/lib/github.server";
import { isSaas } from "~/lib/appMode.server";

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

  if (setupAction === "request") {
    const code = url.searchParams.get("code");
    if (code) {
      try {
        const userToken = await exchangeCodeForUserToken(code, user.organization.id);
        const ghUser = await getGitHubUser(userToken);
        const accountLogin = await findInstallationRequestAccount(user.organization.id, ghUser.login);
        if (accountLogin) {
          await savePendingInstallation(user.organization.id, accountLogin);
        }
      } catch (error) {
        console.error("[github-callback] Failed to save pending installation:", error);
      }
    }
    return redirect("/onboarding/github");
  }

  if (!installationId) {
    return redirect("/onboarding/github?error=missing_installation_id");
  }

  if (setupAction === "install" || setupAction === "update") {
    const { token, expiresAt } = await getInstallationAccessToken(
      user.organization.id,
      installationId
    );
    await saveInstallation(user.organization.id, installationId, token, expiresAt);
  }

  if (user.organization.onboardingCompleted) {
    return redirect("/settings/github?showAdd=true");
  }

  return redirect(isSaas() ? "/onboarding/project" : "/onboarding/repos");
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
