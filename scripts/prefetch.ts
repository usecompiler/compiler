import { prefetchAllRepos } from "../app/lib/clone.server";

async function main() {
  console.log("Prefetching repositories...");
  const start = Date.now();
  await prefetchAllRepos();
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Prefetch complete in ${duration}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Prefetch failed:", err);
  process.exit(1);
});
