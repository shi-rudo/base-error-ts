import type { Options } from "@sentry/core";

import { beforeSend, logObjectContextIntegration } from "../sentry/index.js";

const options: Pick<Options, "beforeSend" | "integrations"> = {
  beforeSend,
  integrations: [logObjectContextIntegration()],
};
void options;
