import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/signup";
import {
  getUserByEmail,
  createUser,
  createSession,
  createSessionCookie,
  getUser,
} from "~/lib/auth.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);
  if (user) {
    return redirect("/");
  }
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!name || !email || !password) {
    return { error: "All fields are required" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    return { error: "An account with this email already exists" };
  }

  const user = await createUser(email, name, password);
  const sessionId = await createSession(user.id);

  return redirect("/", {
    headers: {
      "Set-Cookie": createSessionCookie(sessionId),
    },
  });
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 text-center mb-8">
          Create your account
        </h1>

        <Form method="post" className="space-y-4">
          {actionData?.error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-400">
              {actionData.error}
            </div>
          )}

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              autoComplete="name"
              autoFocus
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
          </div>

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
              autoComplete="new-password"
              minLength={8}
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              Must be at least 8 characters
            </p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-2.5 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Creating account..." : "Create account"}
          </button>
        </Form>

        <p className="mt-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
          Already have an account?{" "}
          <Link to="/login" className="text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
