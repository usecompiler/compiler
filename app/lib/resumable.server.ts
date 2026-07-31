import { createResumableStreamContext, type ResumableStreamContext } from "resumable-stream";
import { createClient } from "redis";

const ACTIVE_STREAM_TTL_SECONDS = 60 * 60 * 24;
const STOP_CHANNEL = "compiler:stream-stop";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required. Add a Redis instance to your deployment (see docker-compose.yml).");
}

async function connectRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  client.on("error", (err) => console.error("[resumable] Redis error:", err));
  await client.connect();
  return client;
}

type RedisClient = Awaited<ReturnType<typeof connectRedis>>;

let streamContext: ResumableStreamContext | null = null;
let redisPromise: Promise<RedisClient> | null = null;
let stopSubscriberPromise: Promise<void> | null = null;
const abortControllers = new Map<string, Set<AbortController>>();

export function getStreamContext(): ResumableStreamContext {
  if (!streamContext) {
    streamContext = createResumableStreamContext({
      waitUntil: (promise) => {
        void Promise.resolve(promise).catch((err) => {
          console.error("[resumable] Background stream error:", err);
        });
      },
    });
  }
  return streamContext;
}

function getRedis(): Promise<RedisClient> {
  if (!redisPromise) {
    redisPromise = connectRedis();
    redisPromise.catch(() => {
      redisPromise = null;
    });
  }
  return redisPromise;
}

function activeStreamKey(conversationId: string): string {
  return `conversation:${conversationId}:active-stream`;
}

export async function setActiveStream(conversationId: string, streamId: string): Promise<void> {
  const redis = await getRedis();
  await redis.set(activeStreamKey(conversationId), streamId, { EX: ACTIVE_STREAM_TTL_SECONDS });
}

export async function getActiveStream(conversationId: string): Promise<string | null> {
  const redis = await getRedis();
  return redis.get(activeStreamKey(conversationId));
}

export async function clearActiveStream(conversationId: string, streamId: string): Promise<void> {
  const redis = await getRedis();
  const key = activeStreamKey(conversationId);
  const current = await redis.get(key);
  if (current === streamId) {
    await redis.del(key);
  }
}

export function registerAbort(conversationId: string, controller: AbortController): void {
  let controllers = abortControllers.get(conversationId);
  if (!controllers) {
    controllers = new Set();
    abortControllers.set(conversationId, controllers);
  }
  controllers.add(controller);
  void ensureStopSubscriber().catch((err) => {
    console.error("[resumable] Stop subscriber error:", err);
  });
}

export function releaseAbort(conversationId: string, controller: AbortController): void {
  const controllers = abortControllers.get(conversationId);
  if (!controllers) return;
  controllers.delete(controller);
  if (controllers.size === 0) {
    abortControllers.delete(conversationId);
  }
}

function abortLocal(conversationId: string): void {
  const controllers = abortControllers.get(conversationId);
  if (!controllers) return;
  for (const controller of controllers) {
    controller.abort();
  }
}

function ensureStopSubscriber(): Promise<void> {
  if (!stopSubscriberPromise) {
    stopSubscriberPromise = (async () => {
      const subscriber = createClient({ url: process.env.REDIS_URL });
      subscriber.on("error", (err) => console.error("[resumable] Redis subscriber error:", err));
      await subscriber.connect();
      await subscriber.subscribe(STOP_CHANNEL, (conversationId) => {
        abortLocal(conversationId);
      });
    })();
    stopSubscriberPromise.catch(() => {
      stopSubscriberPromise = null;
    });
  }
  return stopSubscriberPromise;
}

export async function requestStop(conversationId: string): Promise<void> {
  abortLocal(conversationId);
  const redis = await getRedis();
  await redis.publish(STOP_CHANNEL, conversationId);
}
