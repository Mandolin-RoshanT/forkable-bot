export type GraphQLBody = {
  operationName?: string;
  query: string;
  variables?: Record<string, unknown>;
};

export type GraphQLResponse<T = unknown> = {
  data?: T;
  errors?: Array<{ message: string; path?: string[] }>;
};

// name → value, like a Python dict.
export type CookieJar = Map<string, string>;

export type Cookie = { name: string; value: string };

export type CapturedOp = { file: string; body: GraphQLBody };
