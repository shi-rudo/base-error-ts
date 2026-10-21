import { ValidationError, type PublicIssue } from "../index.js";

declare const error: ValidationError;
declare const issue: PublicIssue;

const byDefault: PublicIssue[] = error.publicIssues();
const withMessages: PublicIssue[] = error.publicIssues({ messages: true });
const optionalMessage: string | undefined = issue.message;
// @ts-expect-error the message crosses only on opt-in, so it is optional
const requiredMessage: string = issue.message;

const nullSegment: NonNullable<PublicIssue["path"]>[number] = null;
const nullKeySegment: NonNullable<PublicIssue["path"]>[number] = { key: null };

const rfc7807: { name: string; reason: string }[] = error.publicIssues({
  mapIssue: (source) => ({
    name: (source.path ?? []).join("."),
    reason: source.message,
  }),
});

// @ts-expect-error a mapper replaces the whole projection, so messages has no effect
error.publicIssues({ mapIssue: (source) => source.message, messages: true });

const declaredReturn: ReturnType<ValidationError["publicIssues"]> = byDefault;
const projectedIssues: PublicIssue[] = declaredReturn;

void withMessages;
void optionalMessage;
void requiredMessage;
void nullSegment;
void nullKeySegment;
void rfc7807;
void projectedIssues;
