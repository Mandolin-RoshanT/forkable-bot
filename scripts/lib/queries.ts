// Auth queries live in src/queries/forkable.ts (canonical); this file
// re-exports them and adds the spike-only INTROSPECTION_QUERY.
//
// IMPORTANT: keep every operation string single-line — Forkable's edge 401s
// on leading whitespace from template literals.

export { CREATE_SESSION_MUTATION, ME_QUERY } from '../../src/queries/forkable.ts';

// Forkable currently disables introspection; kept to detect if they re-enable it.
export const INTROSPECTION_QUERY =
  'query IntrospectionQuery { __schema { queryType { name } mutationType { name } types { kind name description fields(includeDeprecated: true) { name description args { name description type { ...TypeRef } defaultValue } type { ...TypeRef } } inputFields { name description type { ...TypeRef } defaultValue } interfaces { ...TypeRef } enumValues(includeDeprecated: true) { name description } possibleTypes { ...TypeRef } } } } fragment TypeRef on __Type { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }';
