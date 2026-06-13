// ────────────────────────────────────────────────────────────────
// Presentation (optional, technology-agnostic)
//
// Turns a technical error into a safe, localized public representation.
// Knows nothing about any transport channel. See proposal 0005.
// ────────────────────────────────────────────────────────────────

export { LocalizedMessageSet } from "./LocalizedMessageSet.js";
export type { LocalizedMessageSetOptions } from "./LocalizedMessageSet.js";
export { resolveUserMessage } from "./LocaleResolver.js";
export type { ResolvedUserMessage } from "./LocaleResolver.js";
export type { PublicErrorDefinition } from "./PublicErrorDefinition.js";
export { PublicErrorRegistry } from "./PublicErrorRegistry.js";
export type { RegistryResolution } from "./PublicErrorRegistry.js";
export { PublicErrorPresenter } from "./PublicErrorPresenter.js";
export type {
  PublicErrorView,
  PresentationOutcome,
  PublicPresentationContext,
  PublicErrorPresenterOptions,
} from "./PublicErrorPresenter.js";
