import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sslEnabled = process.env.DATABASE_SSL !== "false";
const client = postgres(connectionString, {
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});
export const db = drizzle(client, { schema });
