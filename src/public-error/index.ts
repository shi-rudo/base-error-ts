// ────────────────────────────────────────────────────────────────
// Public error (prototype): three independent stages over one source.
//
//   project   (curation = security) → message-free PublicError
//   localize  (optional, orthogonal) → human text, keyed on publicCode
//   toProblem (transport)            → RFC 9457; title only when localized
//
// Localization is removable: client-localizing apps stop after `project`
// and render from `view.code`. Exported at the `@shirudo/base-error/public-error`
// subpath. See proposals/0011.
// ────────────────────────────────────────────────────────────────

export {
  PublicErrorCatalog,
  definePublicErrors,
} from "./PublicErrorCatalog.js";
export type {
  CatalogResolution,
  PublicCodeOf,
  Transport,
} from "./PublicErrorCatalog.js";
export { project, projectWithDescriptor } from "./project.js";
export { localize } from "./localize.js";
export { toProblem, PROBLEM_DETAILS_JSON } from "./toProblem.js";
export type {
  OmittedMember,
  ProblemBody,
  ProblemOutcome,
  ProblemResult,
  ToProblemContext,
} from "./toProblem.js";
export type {
  FieldFault,
  LocalizedPublicError,
  OnProject,
  ProjectionOutcome,
  ProjectionStatus,
  PublicError,
  PublicErrorDescriptor,
} from "./types.js";
