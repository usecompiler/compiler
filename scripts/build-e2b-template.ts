import { buildTemplate } from "../app/lib/e2b/template.server";

buildTemplate()
  .then((info) => {
    console.log(`[e2b] Template built: ${info.name} (${info.templateId})`);
  })
  .catch((err) => {
    console.error("[e2b] Failed to build template:");
    console.error("Message:", err.message);
    console.error("Name:", err.name);
    if (err.cause) console.error("Cause:", err.cause);
    if (err.logs) console.error("Logs:", err.logs);
    console.error(err);
    process.exit(1);
  });
