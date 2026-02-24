import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql, eq, isNull } from "drizzle-orm";
import {
  organizations,
  projects,
  projectRepositories,
  repositories,
  conversations,
  members,
} from "../app/lib/db/schema";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

const connectionString =
  process.env.DATABASE_SSL === "true"
    ? dbUrl.includes("?")
      ? `${dbUrl}&sslmode=require`
      : `${dbUrl}?sslmode=require`
    : dbUrl;

const client = postgres(connectionString);
const db = drizzle(client);

async function backfillDefaultProjects() {
  console.log("[backfillDefaultProjects] Starting...");

  const orgsWithoutProjects = await db
    .select({ id: organizations.id })
    .from(organizations)
    .leftJoin(projects, eq(projects.organizationId, organizations.id))
    .where(isNull(projects.id));

  if (orgsWithoutProjects.length === 0) {
    console.log("[backfillDefaultProjects] All organizations already have projects. Nothing to do.");
  } else {
    console.log(`[backfillDefaultProjects] Found ${orgsWithoutProjects.length} org(s) without projects.`);

    for (const org of orgsWithoutProjects) {
      const projectId = crypto.randomUUID();
      const now = new Date();

      await db.insert(projects).values({
        id: projectId,
        organizationId: org.id,
        name: "Default",
        createdAt: now,
        updatedAt: now,
      });

      const orgRepos = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.organizationId, org.id));

      if (orgRepos.length > 0) {
        await db
          .insert(projectRepositories)
          .values(
            orgRepos.map((repo) => ({
              id: crypto.randomUUID(),
              projectId,
              repositoryId: repo.id,
            }))
          )
          .onConflictDoNothing();

        console.log(`[backfillDefaultProjects] Org ${org.id}: created project, linked ${orgRepos.length} repo(s).`);
      } else {
        console.log(`[backfillDefaultProjects] Org ${org.id}: created project (no repos to link).`);
      }
    }
  }

  const result = await db.execute(sql`
    UPDATE conversations c
    SET project_id = (
      SELECT p.id FROM projects p
      INNER JOIN members m ON m.organization_id = p.organization_id
      WHERE m.user_id = c.user_id
      ORDER BY p.created_at ASC
      LIMIT 1
    )
    WHERE c.project_id IS NULL
    AND EXISTS (
      SELECT 1 FROM members m2
      INNER JOIN projects p2 ON p2.organization_id = m2.organization_id
      WHERE m2.user_id = c.user_id
    )
  `);

  const backfilledCount = result.count ?? 0;
  console.log(`[backfillDefaultProjects] Backfilled project_id on ${backfilledCount} conversation(s).`);
  console.log("[backfillDefaultProjects] Done.");
}

const migrations = [backfillDefaultProjects];

async function run() {
  console.log("Running data migrations...");
  for (const fn of migrations) {
    await fn();
  }
  console.log("All data migrations complete.");
  await client.end();
}

run().catch((err) => {
  console.error("Data migration failed:", err);
  process.exit(1);
});
