import type { Route } from "./+types/api.blobs";
import { requireActiveAuth } from "~/lib/auth.server";
import { db } from "~/lib/db/index.server";
import { blobs } from "~/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireActiveAuth(request);
  if (!user.organization) {
    return Response.json({ blobs: [] });
  }

  const url = new URL(request.url);
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) || [];
  if (ids.length === 0) {
    return Response.json({ blobs: [] });
  }

  const rows = await db
    .select({
      id: blobs.id,
      contentType: blobs.contentType,
      filename: blobs.filename,
    })
    .from(blobs)
    .where(and(inArray(blobs.id, ids), eq(blobs.organizationId, user.organization.id)));

  return Response.json({
    blobs: rows.map((r) => ({
      id: r.id,
      contentType: r.contentType,
      filename: r.filename,
    })),
  });
}
