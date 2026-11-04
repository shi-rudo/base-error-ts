/**
 * Answers an error and an unknown route in Express with the result of the
 * public-error pipeline, and logs each error with pino. Without this setup,
 * Express sends the stack to the client when `NODE_ENV` is not `production`, and
 * the stack header holds the message.
 *
 * Run the demo with `npx tsx examples/express-error-handler.ts`. It sends real
 * requests. It compares the status, the content type and the body of each
 * response with the public problem, and it reads the log lines.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";

import express from "express";
import type { ErrorRequestHandler } from "express";
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

routes.get("/decode", () => {
  decodeURIComponent("%E0%A4%A");
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

function isBadUrlError(error: unknown): error is URIError {
  return error instanceof URIError && "status" in error && error.status === 400;
}

const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
})
  .registerByCode("USER_NOT_FOUND", {
    publicCode: "user_not_found",
    status: 404,
  })
  .registerByCode("ROUTE_NOT_FOUND", {
    publicCode: "route_not_found",
    status: 404,
  })
  .register({
    match: isBodyParserError("entity.parse.failed"),
    descriptor: { publicCode: "invalid_json", status: 400 },
  })
  .register({
    match: isBodyParserError("entity.too.large"),
    descriptor: { publicCode: "payload_too_large", status: 413 },
  })
  .register({
    match: isBodyParserError("charset.unsupported"),
    descriptor: { publicCode: "unsupported_media_type", status: 415 },
  })
  .register({
    match: isBodyParserError("encoding.unsupported"),
    descriptor: { publicCode: "unsupported_media_type", status: 415 },
  })
  .register({
    match: isBadUrlError,
    descriptor: { publicCode: "invalid_url", status: 400 },
  });

const app = express();
app.use(express.json());
app.use(routes);

// Express raises no error for an unknown route.
app.use((request, _response, next) => {
  next(
    new StructuredError({
      code: "ROUTE_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `No route for ${request.method} ${request.path}`,
    }),
  );
});

// Express finds an error middleware by its four parameters.
const sendProblem: ErrorRequestHandler = (error, _request, response, _next) => {
  const { status, headers, body } = toProblem(catalog, project(catalog, error));
  logger[status >= 500 ? "error" : "info"]({ err: error }, "request failed");
  // After the first chunk, the status is out, and only a closed connection
  // tells the client. `next(error)` also closes it, but then Express prints the
  // raw error to stderr, past the redaction of the log object.
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.status(status).set(headers).json(body);
};

app.use(sendProblem);
// #endregion usage

const errorsPastTheHandler: unknown[] = [];
const recordErrorPastTheHandler: ErrorRequestHandler = (
  error,
  _request,
  _response,
  next,
) => {
  errorsPastTheHandler.push(error);
  next(error);
};
app.use(recordErrorPastTheHandler);

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

function postUsers(
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
): RequestInit {
  return { method: "POST", headers, body };
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

await assertProblem(
  "/users",
  { status: 415, code: "unsupported_media_type" },
  postUsers("{}", { "content-type": "application/json; charset=latin1" }),
);
await assertProblem(
  "/users",
  { status: 415, code: "unsupported_media_type" },
  postUsers("{}", {
    "content-type": "application/json",
    "content-encoding": "foo",
  }),
);
await assertProblem("/users/%E0%A4%A", { status: 400, code: "invalid_url" });
await assertProblem("/decode", { status: 500, code: "internal_error" });
await assertProblem("/no-such-route", { status: 404, code: "route_not_found" });

await assert.rejects(
  fetch(`${origin}/partial-response`).then((response) => response.text()),
);
assert.deepEqual(errorsPastTheHandler, []);

server.close();
await once(server, "close");

const errorLevelMessages = logLines
  .filter((line) => line.level === 50)
  .map((line) => line.err?.message);
assert.deepEqual(errorLevelMessages, [
  "Connection to db-primary.internal:5432 refused",
  "URI malformed",
  "Upstream closed the stream",
]);

console.log("Express: each checked response holds only the public problem");
