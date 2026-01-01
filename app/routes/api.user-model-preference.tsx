import type { Route } from "./+types/api.user-model-preference";
import { requireActiveAuth } from "~/lib/auth.server";
import { setUserPreferredModel, getModelConfig } from "~/lib/models.server";

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const user = await requireActiveAuth(request);

  if (!user.organization || !user.membership) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await request.json();
  const model = body.model;

  if (!model || typeof model !== "string") {
    return Response.json({ error: "Missing model" }, { status: 400 });
  }

  const modelConfig = await getModelConfig(user.organization.id);
  if (!modelConfig || !modelConfig.availableModels.includes(model)) {
    return Response.json({ error: "Model not available" }, { status: 400 });
  }

  await setUserPreferredModel(user.membership.id, model);

  return Response.json({ success: true });
}
