import type { LoggerOptions } from "pino";

import { pinoErrorOptions } from "../pino/index.js";

const options: LoggerOptions = { ...pinoErrorOptions, level: "info" };
void options;

const ownHooks: LoggerOptions = {
  serializers: { err: pinoErrorOptions.serializers.err },
  hooks: { logMethod: pinoErrorOptions.hooks.logMethod },
};
void ownHooks;
