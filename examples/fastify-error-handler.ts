/**
 * Answers each error in Fastify with the result of the public-error pipeline.
 * Without this handler, Fastify sends the internal `code` and the technical
 * `message` to the client.
 *
 * Run the demo with `npx tsx examples/fastify-error-handler.ts`. It sends real
 * requests, and it fails if a response holds more than the public problem.
 */
import assert from "node:assert/strict";

import Fastify from "fastify";

import { StructuredError } from "../src/index.js";
import {
  definePublicErrors,
  project,
  toProblem,
} from "../src/public-error/index.js";

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
  });

const app = Fastify();

app.setErrorHandler((error, _request, reply) => {
  const { status, headers, body } = toProblem(catalog, project(catalog, error));
  return reply.status(status).headers(headers).send(body);
});
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

await app.close();
console.log("Fastify: each response holds only the public problem");
