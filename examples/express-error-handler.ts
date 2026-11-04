/**
 * Answers each error in Express with the result of the public-error pipeline.
 * Without this error middleware, Express sends the stack to the client when
 * `NODE_ENV` is not `production`, and the stack header holds the message.
 *
 * Run the demo with `npx tsx examples/express-error-handler.ts`. It sends real
 * requests, and it fails if a response holds more than the public problem.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import express from "express";
import type { ErrorRequestHandler } from "express";

import { StructuredError } from "../src/index.js";
import {
  definePublicErrors,
  project,
  toProblem,
} from "../src/public-error/index.js";

const routes = express.Router();

routes.get("/users/:id", () => {
  throw new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: "No user 42 in the primary database",
  });
});

routes.get("/crash", () => {
  throw new Error("Connection to db-primary.internal:5432 refused");
});

const partialResponseFailure = new Error("Upstream closed the stream");

routes.get("/partial-response", (_request, response) => {
  response.write("first chunk");
  throw partialResponseFailure;
});

routes.post("/users", (_request, response) => {
  response.json({ created: true });
});

// #region usage
function isBodyParserError(type: string) {
  return (error: unknown): error is { type: string } =>
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === type;
}

const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
})
  .registerByCode("USER_NOT_FOUND", {
    publicCode: "user_not_found",
    status: 404,
  })
  .register({
    match: isBodyParserError("entity.parse.failed"),
    descriptor: { publicCode: "invalid_json", status: 400 },
  })
  .register({
    match: isBodyParserError("entity.too.large"),
    descriptor: { publicCode: "payload_too_large", status: 413 },
  });

const app = express();
app.use(express.json());
app.use(routes);

const sendProblem: ErrorRequestHandler = (error, _request, response, next) => {
  // After the first chunk, only Express can end the response: it closes the
  // connection.
  if (response.headersSent) {
    next(error);
    return;
  }
  const { status, headers, body } = toProblem(catalog, project(catalog, error));
  response.status(status).set(headers).json(body);
};

app.use(sendProblem);
// #endregion usage

const delegatedErrors: unknown[] = [];
const recordDelegatedError: ErrorRequestHandler = (
  error,
  _request,
  _response,
  next,
) => {
  delegatedErrors.push(error);
  next(error);
};
app.use(recordDelegatedError);

// Express writes a delegated error to stderr unless its env is `test`.
app.set("env", "test");

const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address() as AddressInfo;
const origin = `http://127.0.0.1:${port}`;

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

function postUsers(body: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  };
}

await assertProblem("/users/42", { status: 404, code: "user_not_found" });
await assertProblem("/crash", { status: 500, code: "internal_error" });
await assertProblem(
  "/users",
  { status: 400, code: "invalid_json" },
  postUsers("{oops"),
);
await assertProblem(
  "/users",
  { status: 413, code: "payload_too_large" },
  postUsers(JSON.stringify({ name: "x".repeat(200_000) })),
);

const partialResponse = await fetch(`${origin}/partial-response`);
await assert.rejects(partialResponse.text());
assert.deepEqual(delegatedErrors, [partialResponseFailure]);

server.close();
await once(server, "close");
console.log("Express: each response holds only the public problem");
