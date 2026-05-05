// Keep every operation on ONE line — Forkable's edge 401s on leading
// whitespace from template literals.

export const CREATE_SESSION_MUTATION =
  'mutation createSession($input: CreateSessionInput!) { createSession(input: $input) { user { id email mfaEnabled } errorAttributes errorDetails } }';

export const ME_QUERY = 'query me { me { id email mfaEnabled } }';

// Forkable currently disables introspection; kept to detect if they re-enable it.
export const INTROSPECTION_QUERY =
  'query IntrospectionQuery { __schema { queryType { name } mutationType { name } types { kind name description fields(includeDeprecated: true) { name description args { name description type { ...TypeRef } defaultValue } type { ...TypeRef } } inputFields { name description type { ...TypeRef } defaultValue } interfaces { ...TypeRef } enumValues(includeDeprecated: true) { name description } possibleTypes { ...TypeRef } } } } fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }';
