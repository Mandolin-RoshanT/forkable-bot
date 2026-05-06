// Zod schemas for Forkable GraphQL responses. Source of truth for both
// compile-time types and runtime validation. Validated against captured
// payloads in scripts/captures/ — `tests/integration/schemas.test.ts`
// re-parses those captures on every CI run as a drift tripwire.

import { z } from 'zod';

// ─── Auth ──────────────────────────────────────────────────────────────────

export const ForkableUserSchema = z.object({
  id: z.number(),
  email: z.string(),
  mfaEnabled: z.boolean(),
});
export type ForkableUser = z.infer<typeof ForkableUserSchema>;

export const CreateSessionResponseSchema = z.object({
  createSession: z.object({
    user: ForkableUserSchema.nullable(),
    errorAttributes: z.unknown(),
    errorDetails: z.unknown(),
  }),
});

export const MeResponseSchema = z.object({
  me: ForkableUserSchema.nullable(),
});

// ─── Week query ────────────────────────────────────────────────────────────

// A `Piece` is the user's chosen meal item for a delivery. Only ONE order
// per delivery has a piece — the rest are placeholders for alternative venues.
const PieceSchema = z.object({
  id: z.string(),
  itemId: z.number(),
  menuId: z.number(),
  name: z.string(),
  price: z.number().nullable(),
});

const OrderMenuSchema = z.object({
  id: z.number(),
  name: z.string(),
});

const OrderSchema = z.object({
  id: z.number(),
  state: z.string(),
  menu: OrderMenuSchema.nullable(),
  pieces: z.array(PieceSchema),
});

const ClubSchema = z.object({
  id: z.number(),
  name: z.string(),
});

// A `Delivery` = one day. The picker's "Day" model.
export const DeliverySchema = z.object({
  id: z.number(),
  state: z.string(),
  isReadOnly: z.boolean(),
  forDeliveryAt: z.string(),
  availableMenuIds: z.array(z.number()),
  club: ClubSchema.nullable(),
  orders: z.array(OrderSchema),
});
export type Delivery = z.infer<typeof DeliverySchema>;

export const GetWeekResponseSchema = z.object({
  myDeliveries: z.array(DeliverySchema),
});

// ─── Alternatives query ────────────────────────────────────────────────────

const ModifierOptionSchema = z.object({
  id: z.number(),
  name: z.string(),
  ingredientTags: z.array(z.string()),
});

const ModifierSchema = z.object({
  id: z.number(),
  name: z.string(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  required: z.boolean(),
  options: z.array(ModifierOptionSchema),
});

export const ItemSchema = z.object({
  id: z.number(),
  menuId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  price: z.number().nullable(),
  ingredientTags: z.array(z.string()),
  dietLevel: z.number().nullable(),
  averageRating: z.number().nullable(),
  userRating: z.number().nullable(),
  modifiers: z.array(ModifierSchema),
});
export type Item = z.infer<typeof ItemSchema>;

const SectionSchema = z.object({
  id: z.number(),
  name: z.string(),
  items: z.array(ItemSchema),
});

const VenueSchema = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string().nullable(),
});

export const MenuSchema = z.object({
  id: z.number(),
  name: z.string(),
  displayName: z.string().nullable(),
  venue: VenueSchema,
  sections: z.array(SectionSchema),
});
export type Menu = z.infer<typeof MenuSchema>;

export const GetAlternativesResponseSchema = z.object({
  menus: z.array(MenuSchema),
});

// ─── Swap mutation ─────────────────────────────────────────────────────────

export const ReplacePieceResponseSchema = z.object({
  replacePiece: z.object({
    delivery: z.object({
      id: z.number(),
      state: z.string(),
      isReadOnly: z.boolean(),
      orders: z.array(
        z.object({
          id: z.number(),
          pieces: z.array(
            z.object({
              id: z.string(),
              itemId: z.number(),
              menuId: z.number(),
              name: z.string(),
              price: z.number().nullable(),
            }),
          ),
        }),
      ),
    }),
  }),
});
