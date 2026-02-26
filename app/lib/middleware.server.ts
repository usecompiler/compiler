import type { Route } from "../+types/root";
import { requestIdContext } from "./context.server";
import "./startup.server";

export const staleAssetMiddleware: Route.MiddlewareFunction = async (
  { request },
  next
) => {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/assets/")) {
    return new Response("Not Found", { status: 404 });
  }
  return next();
};

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
