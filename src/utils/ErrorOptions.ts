export type ErrorOptions<
  TCode extends string,
  TCategory extends string,
  TDetails extends Record<string, unknown> = Record<string, unknown>,
> = {
  code: TCode;
  category: TCategory;
  retryable: boolean;
  message: string;
  details?: TDetails;
  cause?: unknown;
};
