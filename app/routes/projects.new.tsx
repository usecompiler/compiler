import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/projects.new";
import { requireActiveAuth } from "~/lib/auth.server";
import { createProject } from "~/lib/projects.server";
import { isSelfHosted } from "~/lib/appMode.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  const isOnboarding = !user.organization.onboardingCompleted;

  if (isOnboarding && user.membership?.role !== "owner") {
    return redirect("/");
  }

  if (isOnboarding && isSelfHosted()) {
    return redirect("/onboarding/github-app");
  }

  return { isOnboarding };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization) {
    return redirect("/");
  }

  const formData = await request.formData();
  const name = (formData.get("name") as string)?.trim();

  if (!name) {
    return { error: "Project name is required" };
  }

  const project = await createProject(user.organization.id, name);

  return redirect(`/projects/new/${project.id}/repos`);
}

export default function ProjectsNew({ loaderData }: Route.ComponentProps) {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const { isOnboarding } = loaderData;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            {isOnboarding ? "Create your first project" : "Create a new project"}
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400">
            Projects group repositories and conversations together.
          </p>
        </div>

        {actionData?.error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionData.error}
          </div>
        )}

        <Form method="post">
          <div className="mb-6">
            <label
              htmlFor="name"
              className="block text-sm font-medium text-neutral-500 dark:text-neutral-400 mb-1.5"
            >
              Project name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              autoFocus
              placeholder="My Project"
              className="w-full bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg px-4 py-2.5 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 font-medium rounded-lg px-4 py-3 hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Continue"}
          </button>
        </Form>
      </div>
    </div>
  );
}
