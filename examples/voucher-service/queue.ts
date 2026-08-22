/**
 * A simulated queue boundary. The wire loses classes and non-enumerable
 * fields; `fromJSON` is the lossless way back, aggregate members included.
 */
import { StructuredError } from "../../src/index.js";

const deadLetters: string[] = [];

export function enqueueDeadLetter(error: unknown): void {
  deadLetters.push(JSON.stringify(error));
}

export function consumeDeadLetters(): StructuredError<string, string>[] {
  const consumed = deadLetters.map((wire) =>
    StructuredError.fromJSON(JSON.parse(wire)),
  );
  deadLetters.length = 0;
  return consumed;
}
