import { Form, Link, redirect, useActionData, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import {
  getUserByEmail,
  verifyPassword,
  createSession,
  createSessionCookie,
  getUser,
} from "~/lib/auth.server";
import { getDefaultOrgSSOConfig } from "~/lib/saml.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (user) {
    return redirect("/");
  }

  const ssoConfig = await getDefaultOrgSSOConfig();

  return {
    ssoEnabled: ssoConfig?.enabled ?? false,
    passwordLoginEnabled: ssoConfig?.allowPasswordLogin ?? true,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required" };
  }

  const user = await getUserByEmail(email);
  if (!user || !user.passwordHash) {
    return { error: "Invalid email or password" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { error: "Invalid email or password" };
  }

  const sessionId = await createSession(user.id);

  return redirect("/", {
    headers: {
      "Set-Cookie": createSessionCookie(sessionId),
    },
  });
}

function getErrorMessage(errorCode: string | null): string | null {
  if (!errorCode) return null;

  const messages: Record<string, string> = {
    sso_not_configured: "SSO is not configured for this organization",
    sso_error: "An error occurred during SSO login",
    missing_saml_response: "Invalid SSO response",
    user_not_provisioned: "Your account is not authorized to access this application",
    saml_validation_failed: "SSO authentication failed",
  };

  return messages[errorCode] || "An error occurred";
}

export default function Login() {
  const { ssoEnabled, passwordLoginEnabled } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const [searchParams] = useSearchParams();
  const errorFromUrl = getErrorMessage(searchParams.get("error"));
  const error = actionData?.error || errorFromUrl;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 text-center mb-8">
          Sign in to Compiler
        </h1>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400 mb-4">
            {error}
          </div>
        )}

        {ssoEnabled && (
          <div className="space-y-4">
            <Link
              to="/auth/saml"
              className="w-full flex items-center justify-center bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-2.5 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
            >
              Sign in with SSO
            </Link>

            {passwordLoginEnabled && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-300 dark:border-neutral-700" />
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-neutral-50 dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400">
                    or
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {passwordLoginEnabled && (
          <Form method="post" className="space-y-4 mt-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                Email
              </label>
              <input
                type="email"
                id="email"
                name="email"
                required
                autoComplete="email"
                autoFocus={!ssoEnabled}
                className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
              >
                Password
              </label>
              <input
                type="password"
                id="password"
                name="password"
                required
                autoComplete="current-password"
                className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-2.5 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </Form>
        )}

        {!ssoEnabled && !passwordLoginEnabled && (
          <div className="text-center text-neutral-500 dark:text-neutral-400">
            <p>No login methods are configured.</p>
            <p className="text-sm mt-2">Please contact your administrator.</p>
          </div>
        )}
      </div>
    </div>
  );
}
