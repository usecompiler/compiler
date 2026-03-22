import type { Route } from "./+types/up";
import { db } from "~/lib/db/index.server";
import { sql } from "drizzle-orm";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    await db.execute(sql`SELECT 1`);
    return new Response("OK", { status: 200 });
  } catch {
    return new Response("Service Unavailable", { status: 503 });
  }
}
