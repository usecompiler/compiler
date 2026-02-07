import type { Route } from "./+types/api.image.$blobId";
import { requireActiveAuth } from "~/lib/auth.server";
import { getStorageConfig, generatePresignedUrl } from "~/lib/storage.server";
import { db } from "~/lib/db/index.server";
import { blobs } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const blobId = params.blobId;
  if (!blobId) {
    return new Response("Blob ID required", { status: 400 });
  }

  const result = await db
    .select()
    .from(blobs)
    .where(eq(blobs.id, blobId))
    .limit(1);

  if (result.length === 0) {
    return new Response("Not found", { status: 404 });
  }

  const blob = result[0];
  if (blob.organizationId !== user.organization.id) {
    return new Response("Not found", { status: 404 });
  }

  const storageConfig = await getStorageConfig(user.organization.id);
  if (!storageConfig) {
    return new Response("Storage not configured", { status: 500 });
  }

  const url = generatePresignedUrl(storageConfig, blob.key);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "Cache-Control": "private, max-age=600",
    },
  });
}
