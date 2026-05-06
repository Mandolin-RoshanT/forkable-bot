// Single-line — Forkable's edge 401s on leading whitespace from template literals.

export const CREATE_SESSION_MUTATION =
  'mutation CreateSession($input: CreateSessionInput!) { createSession(input: $input) { user { id email mfaEnabled } errorAttributes errorDetails } }';

export const ME_QUERY = 'query Me { me { id email mfaEnabled } }';

// Captured fields trimmed to what the picker actually reads.
// `from`'s scalar type is `Date!` — discovered by sending `String!` and reading
// the server's "Type mismatch" error.
export const GET_WEEK_QUERY =
  'query GetWeek($from: Date!) { myDeliveries(from: $from) { id state isReadOnly forDeliveryAt availableMenuIds club { id name } orders { id state menu { id name } pieces { id itemId menuId name price } } } }';

export const GET_ALTERNATIVES_QUERY =
  'query GetAlternatives($ids: [Int!]!, $clubId: Int!) { menus(ids: $ids, clubId: $clubId) { id name displayName venue { id name displayName } sections { id name items { id menuId name description price ingredientTags dietLevel averageRating userRating modifiers { id name min max required options { id name ingredientTags } } } } } }';

export const REPLACE_PIECE_MUTATION =
  'mutation ReplacePiece($input: ReplacePieceInput!) { replacePiece(input: $input) { delivery { id state isReadOnly orders { id pieces { id itemId menuId name price } } } } }';

export type GetWeekVariables = { from: string };

export type GetAlternativesVariables = { ids: number[]; clubId: number };

export type ReplacePieceVariables = {
  input: {
    deliveryId: number;
    itemId: number;
    menuId: number;
    oldPieceId: string;
    instructions: string;
    selectionsHash: Record<string, number[]>;
    fromTopRated: boolean;
    topRatedType: string;
    myMeals: boolean;
  };
};
