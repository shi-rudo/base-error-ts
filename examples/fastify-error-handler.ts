/**
 * Answers an error, a bad URL and an unknown route in Fastify with the result
 * of the public-error pipeline, and logs each error with pino. Without this
 * setup, Fastify sends the internal `code` and the technical `message` to the
 * client.
 *
 * Run the demo with `npx tsx examples/fastify-error-handler.ts`. It sends real
 * requests. It compares the status, the content type and the body of each
 * response with the public problem, and it reads the log lines.
 */
import assert from "node:assert/strict";

import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import pino from "pino";

import { StructuredError } from "../src/index.js";
import { pinoErrorOptions } from "../src/pino/index.js";
import {
  definePublicErrors,
  project,
  toProblem,
} from "../src/public-error/index.js";

type LogLine = { level: number; err?: { message?: string } };

const logLines: LogLine[] = [];
const logger = pino(pinoErrorOptions, {
  write(line: string) {
    logLines.push(JSON.parse(line) as LogLine);
  },
});

// #region usage
const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
})
  .registerByCode("USER_NOT_FOUND", {
    publicCode: "user_not_found",
    status: 404,
  })
  .registerByCode("FST_ERR_CTP_INVALID_JSON_BODY", {
    publicCode: "invalid_json",
    status: 400,
  })
  .registerByCode("FST_ERR_CTP_EMPTY_JSON_BODY", {
    publicCode: "invalid_json",
    status: 400,
  })
  .registerByCode("FST_ERR_VALIDATION", {
    publicCode: "invalid_request",
    status: 400,
  })
  .registerByCode("FST_ERR_CTP_BODY_TOO_LARGE", {
    publicCode: "payload_too_large",
    status: 413,
  })
  .registerByCode("FST_ERR_CTP_INVALID_MEDIA_TYPE", {
    publicCode: "unsupported_media_type",
    status: 415,
  })
  .registerByCode("FST_ERR_BAD_URL", {
    publicCode: "invalid_url",
    status: 400,
  })
  .registerByCode("ROUTE_NOT_FOUND", {
    publicCode: "route_not_found",
    status: 404,
  });

function sendProblem(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { status, headers, body } = toProblem(catalog, project(catalog, error));
  request.log[status >= 500 ? "error" : "info"](
    { err: error },
    "request failed",
  );
  return reply.status(status).headers(headers).send(body);
}

const app = Fastify({
  loggerInstance: logger,
  // Fastify answers a bad URL before the error handler can run.
  frameworkErrors: sendProblem,
});

app.setErrorHandler(sendProblem);

// Fastify raises no error for an unknown route.
app.setNotFoundHandler((request, reply) =>
  sendProblem(
    new StructuredError({
      code: "ROUTE_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `No route for ${request.method} ${request.url}`,
    }),
    request,
    reply,
  ),
);
// #endregion usage

app.get("/users/:id", () => {
  throw new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: "No user 42 in the primary database",
  });
});

app.get("/crash", () => {
  throw new Error("Connection to db-primary.internal:5432 refused");
});

app.post(
  "/users",
  {
    bodyLimit: 64,
    schema: {
      body: {
        type: "object",
        required: ["name"],
        properties: { name: { type: "string" } },
      },
    },
  },
  () => ({ created: true }),
);

const origin = await app.listen({ port: 0, host: "127.0.0.1" });

async function assertProblem(
  path: string,
  expected: { status: number; code: string },
  init?: RequestInit,
): Promise<void> {
  const response = await fetch(`${origin}${path}`, init);

  assert.equal(response.status, expected.status, path);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/problem\+json/,
    path,
  );
  assert.deepEqual(await response.json(), expected, path);
}

function postUsers(contentType: string, body: string): RequestInit {
  return { method: "POST", headers: { "content-type": contentType }, body };
}

await assertProblem("/users/42", { status: 404, code: "user_not_found" });
await assertProblem("/crash", { status: 500, code: "internal_error" });
await assertProblem(
  "/users",
  { status: 400, code: "invalid_json" },
  postUsers("application/json", "{oops"),
);
await assertProblem(
  "/users",
  { status: 400, code: "invalid_json" },
  postUsers("application/json", ""),
);
await assertProblem(
  "/users",
  { status: 400, code: "invalid_request" },
  postUsers("application/json", "{}"),
);
await assertProblem(
  "/users",
  { status: 413, code: "payload_too_large" },
  postUsers("application/json", JSON.stringify({ name: "x".repeat(100) })),
);
await assertProblem(
  "/users",
  { status: 415, code: "unsupported_media_type" },
  postUsers("text/csv", "name\nada"),
);

await assertProblem("/users/%E0%A4%A", { status: 400, code: "invalid_url" });
await assertProblem("/no-such-route", { status: 404, code: "route_not_found" });

await app.close();

const errorLevelMessages = logLines
  .filter((line) => line.level === 50)
  .map((line) => line.err?.message);
assert.deepEqual(errorLevelMessages, [
  "Connection to db-primary.internal:5432 refused",
]);

console.log("Fastify: each checked response holds only the public problem");
