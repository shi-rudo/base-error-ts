# Catalog composition

A catalog is both a closed error set and a local provenance boundary. Compose
definitions before `defineErrors` creates the catalog.

## Build one catalog from definitions

Export reusable definition objects and combine them once at the application
boundary:

```ts
import {
  defineErrors,
  detailsType,
  type CatalogError,
  type CatalogErrorOf,
  type ErrorCatalogDefinition,
} from "@shirudo/base-error";

const userErrors = {
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
  },
} satisfies ErrorCatalogDefinition;

const billingErrors = {
  PAYMENT_DECLINED: {
    category: "PAYMENT",
    retryable: false,
  },
} satisfies ErrorCatalogDefinition;

export const AppErrors = defineErrors({
  ...userErrors,
  ...billingErrors,
});
```

The result has one `codes` list, one `CatalogError` union and one provenance
boundary. Keep code names unique: ordinary JavaScript object-spread rules apply,
so a later duplicate key replaces an earlier one before `defineErrors` receives
the object.

## Keep independently owned catalogs separate

Do not combine catalogs merely to obtain one guard. Independent catalogs can be
classified explicitly:

```ts
type DomainError =
  | CatalogError<typeof UserErrors>
  | CatalogError<typeof BillingErrors>;

function isDomainError(value: unknown): value is DomainError {
  return UserErrors.is(value) || BillingErrors.is(value);
}
```

An error created by `UserErrors` is intentionally not recognized by a second
catalog built from the same definitions. Provenance belongs to the exact catalog
instance that created the error.

## Why catalogs have no `merge`, `map` or `select`

Runtime catalog transformation would need to redefine provenance, duplicate-code
resolution, metadata conflicts and the meaning of existing instances. Keeping
composition at the definition level makes those decisions explicit before any
errors exist.

For a type-only subset, use `CatalogErrorOf` and a normal guard over the original
catalog:

```ts
type UserNotFound = CatalogErrorOf<typeof AppErrors, "USER_NOT_FOUND">;

function isUserNotFound(value: unknown): value is UserNotFound {
  return AppErrors.is(value, "USER_NOT_FOUND");
}
```
