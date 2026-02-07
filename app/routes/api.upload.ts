import type { Route } from "./+types/api.upload";
import { requireActiveAuth } from "~/lib/auth.server";
import { getStorageConfig, uploadFile } from "~/lib/storage.server";
import { db } from "~/lib/db/index.server";
import { blobs } from "~/lib/db/schema";

const MAX_SIZE = 32 * 1024 * 1024;

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return new Response("Organization required", { status: 403 });
  }

  const organizationId = user.organization.id;
  const storageConfig = await getStorageConfig(organizationId);

  if (!storageConfig) {
    return Response.json(
      { error: "Storage not configured. Please configure S3 in Settings > Storage." },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const conversationId = formData.get("conversationId") as string | null;

  if (!file) {
    return Response.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return Response.json(
      { error: "File too large. Maximum size is 32MB." },
      { status: 400 }
    );
  }

  const ext = file.name?.split(".").pop()?.toLowerCase() || "bin";
  const blobId = crypto.randomUUID();
  const key = conversationId
    ? `${organizationId}/${conversationId}/${blobId}.${ext}`
    : `${organizationId}/${blobId}.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  await uploadFile(storageConfig, buffer, key, file.type);

  await db.insert(blobs).values({
    id: blobId,
    key,
    filename: file.name || `upload.${ext}`,
    contentType: file.type,
    byteSize: file.size,
    organizationId,
    itemId: null,
  });

  return Response.json({
    blobId,
    url: `/api/image/${blobId}`,
  });
}
