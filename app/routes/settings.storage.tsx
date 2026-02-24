import type { Route } from "./+types/settings.storage";
import { Form, Link, useActionData } from "react-router";
import { useState, useEffect } from "react";
import { requireActiveAuth } from "~/lib/auth.server";
import { canManageOrganization } from "~/lib/permissions.server";
import { getStorageConfigPublic, saveStorageConfig, deleteStorageConfig } from "~/lib/storage.server";
import { redirect } from "react-router";
import { logAuditEvent } from "~/lib/audit.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);

  if (!canManageOrganization(user.membership?.role)) {
    throw redirect("/settings");
  }

  if (!user.organization) {
    return { config: null };
  }

  const config = await getStorageConfigPublic(user.organization.id);
  return { config };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireActiveAuth(request);

  if (!user.organization || !canManageOrganization(user.membership?.role)) {
    return { error: "Unauthorized", success: false, removed: false };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "remove") {
    await deleteStorageConfig(user.organization.id);
    await logAuditEvent(user.organization.id, user.id, "removed storage configuration");
    return { error: null, success: false, removed: true };
  }

  const provider = (formData.get("provider") as string)?.trim() || "s3";
  const bucket = (formData.get("bucket") as string)?.trim();
  const region = (formData.get("region") as string)?.trim();
  const accessKeyId = (formData.get("accessKeyId") as string)?.trim();
  const secretAccessKey = (formData.get("secretAccessKey") as string)?.trim();

  if (!bucket) {
    return { error: "Bucket name is required", success: false, removed: false };
  }

  if (!accessKeyId) {
    return { error: "Access Key ID is required", success: false, removed: false };
  }

  if (!secretAccessKey) {
    return { error: "Secret Access Key is required", success: false, removed: false };
  }

  await saveStorageConfig(user.organization.id, {
    provider,
    bucket,
    region: region || "us-east-1",
    accessKeyId,
    secretAccessKey,
  });

  await logAuditEvent(user.organization.id, user.id, "updated storage configuration");
  return { error: null, success: true, removed: false };
}

export default function StorageSettings({ loaderData }: Route.ComponentProps) {
  const { config } = loaderData;
  const actionData = useActionData<typeof action>();
  const [showEdit, setShowEdit] = useState(!config);

  useEffect(() => {
    if (actionData?.success) {
      setShowEdit(false);
    }
  }, [actionData]);

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link
            to="/"
            className="p-2 -ml-2 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">Settings</h1>
        </div>
      </header>

      <div className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="max-w-3xl mx-auto px-4">
          <nav className="flex gap-6">
            <Link to="/settings" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Account
            </Link>
            <Link to="/settings/ai-provider" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              AI Provider
            </Link>
            <Link to="/settings/audit-log" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Audit Log
            </Link>
            <Link to="/settings/authentication" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Authentication
            </Link>
            <Link to="/settings/github" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              GitHub
            </Link>
            <Link to="/settings/organization" className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent">
              Organization
            </Link>
            <Link
              to="/settings/projects"
              className="py-3 text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 border-b-2 border-transparent"
            >
              Projects
            </Link>
            <span className="py-3 text-sm text-neutral-900 dark:text-neutral-100 font-medium border-b-2 border-neutral-900 dark:border-neutral-100">
              Storage
            </span>
          </nav>
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              Storage Configuration
            </h2>
            {config && (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowEdit(!showEdit)}
                  className="text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100"
                >
                  {showEdit ? "Cancel" : "Edit"}
                </button>
                <Form method="post">
                  <input type="hidden" name="intent" value="remove" />
                  <button
                    type="submit"
                    onClick={(e) => {
                      if (!confirm("Remove storage configuration? Uploaded files will no longer be accessible.")) {
                        e.preventDefault();
                      }
                    }}
                    className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                  >
                    Remove
                  </button>
                </Form>
              </div>
            )}
          </div>

          {actionData?.error && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </div>
          )}

          {actionData?.success && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
              Storage configuration saved successfully
            </div>
          )}

          {actionData?.removed && (
            <div className="mb-4 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3 text-sm text-green-600 dark:text-green-400">
              Storage configuration removed
            </div>
          )}

          {showEdit ? (
            <Form method="post" className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
                  Provider
                </label>
                <div className="space-y-3">
                  <label className="flex items-start gap-3 p-3 border border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-700 rounded-lg cursor-pointer transition-colors">
                    <input
                      type="radio"
                      name="provider"
                      value="s3"
                      defaultChecked
                      className="mt-0.5"
                    />
                    <div>
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">Amazon S3</span>
                      <p className="text-sm text-neutral-500 dark:text-neutral-400">Store files in an S3 bucket</p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label htmlFor="bucket" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Bucket Name
                </label>
                <input
                  type="text"
                  id="bucket"
                  name="bucket"
                  required
                  defaultValue={config?.bucket || ""}
                  placeholder="my-bucket"
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label htmlFor="region" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Region
                </label>
                <input
                  type="text"
                  id="region"
                  name="region"
                  defaultValue={config?.region || "us-east-1"}
                  placeholder="us-east-1"
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label htmlFor="accessKeyId" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Access Key ID
                </label>
                <input
                  type="text"
                  id="accessKeyId"
                  name="accessKeyId"
                  required
                  placeholder="AKIA..."
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
              </div>

              <div>
                <label htmlFor="secretAccessKey" className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
                  Secret Access Key
                </label>
                <input
                  type="password"
                  id="secretAccessKey"
                  name="secretAccessKey"
                  required
                  className="w-full bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-600 rounded-lg px-3 py-2 text-neutral-900 dark:text-neutral-100 text-sm focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500"
                />
                <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
                  {config ? "Enter credentials to update" : "AWS credentials with S3 read/write access"}
                </p>
              </div>

              <button
                type="submit"
                className="px-4 py-2 text-sm font-medium bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors"
              >
                {config ? "Update Configuration" : "Save Configuration"}
              </button>
            </Form>
          ) : config ? (
            <div className="bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Provider</span>
                  <p className="text-neutral-900 dark:text-neutral-100">Amazon S3</p>
                </div>
                <div>
                  <span className="text-neutral-500 dark:text-neutral-400">Bucket</span>
                  <p className="text-neutral-900 dark:text-neutral-100 font-mono">{config.bucket}</p>
                </div>
                {config.region && (
                  <div>
                    <span className="text-neutral-500 dark:text-neutral-400">Region</span>
                    <p className="text-neutral-900 dark:text-neutral-100 font-mono">{config.region}</p>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
