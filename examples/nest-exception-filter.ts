/**
 * Answers each exception in Nest with the result of the public-error pipeline,
 * and logs it with pino. Without this filter, Nest sends the text of an
 * `HttpException` and of the JSON parser to the client, in its own format.
 *
 * Run the demo with
 * `npx tsx --tsconfig tsconfig.examples.json examples/nest-exception-filter.ts`.
 * Nest needs the legacy decorators that this config turns on. The demo sends
 * real requests. It compares the status, the content type and the body of each
 * response with the public problem, and it reads the log lines.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

import {
  Catch,
  ConflictException,
  Controller,
  Get,
  HttpException,
  Module,
  NotFoundException,
  Post,
  Res,
} from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { Response } from "express";
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

@Controller()
class Routes {
  @Get("users/:id")
  user(): never {
    throw new StructuredError({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "No user 42 in the primary database",
    });
  }

  @Get("crash")
  crash(): never {
    throw new Error("Connection to db-primary.internal:5432 refused");
  }

  @Get("http-exception")
  httpException(): never {
    throw new NotFoundException("No row 42 in the primary database");
  }

  @Get("conflict")
  conflict(): never {
    throw new ConflictException("Row version 7 of user 42 is stale");
  }

  @Get("decode")
  decode(): string {
    return decodeURIComponent("%E0%A4%A");
  }

  @Get("partial-response")
  partialResponse(@Res() response: Response): void {
    response.write("first chunk");
    throw new Error("Upstream closed the stream");
  }

  @Post("users")
  createUser(): { created: boolean } {
    return { created: true };
  }
}

@Module({ controllers: [Routes] })
class AppModule {}

const app = await NestFactory.create(AppModule, { logger: false });

// #region usage
function isHttpException(status: number) {
  return (error: unknown): error is HttpException =>
    error instanceof HttpException && error.getStatus() === status;
}

const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
})
  .registerByCode("USER_NOT_FOUND", {
    publicCode: "user_not_found",
    status: 404,
  })
  .register({
    match: isHttpException(400),
    descriptor: { publicCode: "invalid_request", status: 400 },
  })
  .register({
    match: isHttpException(404),
    descriptor: { publicCode: "not_found", status: 404 },
  })
  .register({
    match: isHttpException(413),
    descriptor: { publicCode: "payload_too_large", status: 413 },
  })
  .register({
    match: isHttpException(415),
    descriptor: { publicCode: "unsupported_media_type", status: 415 },
  });

@Catch()
class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, headers, body } = toProblem(
      catalog,
      project(catalog, exception),
    );
    logger[status >= 500 ? "error" : "info"](
      { err: exception },
      "request failed",
    );
    // After the first chunk, the status is out, and only a closed connection
    // tells the client.
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.status(status).set(headers).json(body);
  }
}

app.useGlobalFilters(new ProblemFilter());
// #endregion usage

await app.listen(0, "127.0.0.1");
const { port } = app.getHttpServer().address() as AddressInfo;
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
await assertProblem("/http-exception", { status: 404, code: "not_found" });
await assertProblem("/conflict", { status: 500, code: "internal_error" });
await assertProblem("/decode", { status: 500, code: "internal_error" });
await assertProblem("/no-such-route", { status: 404, code: "not_found" });
await assertProblem("/users/%E0%A4%A", {
  status: 400,
  code: "invalid_request",
});
await assertProblem(
  "/users",
  { status: 400, code: "invalid_request" },
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

await assert.rejects(
  fetch(`${origin}/partial-response`).then((response) => response.text()),
);

await app.close();

const errorLevelMessages = logLines
  .filter((line) => line.level === 50)
  .map((line) => line.err?.message);
assert.deepEqual(errorLevelMessages, [
  "Connection to db-primary.internal:5432 refused",
  "Row version 7 of user 42 is stale",
  "URI malformed",
  "Upstream closed the stream",
]);

console.log("Nest: each checked response holds only the public problem");
