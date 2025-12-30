import type { Route } from "../+types/root";
import { requestIdContext } from "./context.server";

export const loggingMiddleware: Route.MiddlewareFunction = async (
  { request, context },
  next
) => {
  const requestId = crypto.randomUUID();
  context.set(requestIdContext, requestId);

  console.log(`[${requestId}] ${request.method} ${request.url}`);

  const start = performance.now();
  const response = await next();
  const duration = performance.now() - start;

  console.log(`[${requestId}] Response ${response.status} (${duration.toFixed(2)}ms)`);

  return response;
}
