export type Probe = { label: string; query: string };

export const PROBES: Probe[] = [
  {
    label: 'deliveries from 2026-05-04',
    query:
      '{ deliveries(from:"2026-05-04") { id state forDeliveryAt replacementCutoffTs venue { id name } } }',
  },
  {
    label: 'deliveries from 2026-04-27',
    query:
      '{ deliveries(from:"2026-04-27") { id state forDeliveryAt replacementCutoffTs venue { id name } } }',
  },
  {
    label: 'deliveries with menu + pieces (real data shape)',
    query:
      '{ deliveries(from:"2026-04-27") { id state forDeliveryAt replacementCutoffTs hasChangeRequest changeRequestAllowed menu { id name displayName } pieces { id name menuId itemId } } }',
  },
  {
    label: 'order: replacementMenus (try as deliveries field)',
    query: '{ deliveries(from:"2026-04-27") { id replacementMenus { id name } } }',
  },
  {
    label: 'top-level: replacementMenus(deliveryId)',
    query: '{ replacementMenus(deliveryId: 0) { id name } }',
  },
  {
    label: 'top-level: replacements(deliveryId)',
    query: '{ replacements(deliveryId: 0) { id name } }',
  },
  {
    label: 'top-level: menusForReplacement',
    query: '{ menusForReplacement(deliveryId: 0) { id name } }',
  },
  {
    label: 'orders w/o 2026-04-20 — fallback',
    query:
      '{ orders(weekOf:"2026-04-20") { id state forDeliveryAt replacementCutoffTs hasChangeRequest } }',
  },
  {
    label: 'order field: replaceableMenus',
    query: '{ orders(weekOf:"2026-04-27") { id replaceableMenus { id } } }',
  },
  {
    label: 'order field: alternativeMenus',
    query: '{ orders(weekOf:"2026-04-27") { id alternativeMenus { id } } }',
  },
  {
    label: 'order field: replacementMenus',
    query: '{ orders(weekOf:"2026-04-27") { id replacementMenus { id } } }',
  },
  {
    label: 'order field: replacements',
    query: '{ orders(weekOf:"2026-04-27") { id replacements { id } } }',
  },
  {
    label: 'order field: candidateMenus',
    query: '{ orders(weekOf:"2026-04-27") { id candidateMenus { id } } }',
  },
  {
    label: 'mutation: replaceOrder',
    query: 'mutation { replaceOrder(input: {}) { __typename } }',
  },
  {
    label: 'mutation: replacePiece',
    query: 'mutation { replacePiece(input: {}) { __typename } }',
  },
  {
    label: 'mutation: replaceMeal',
    query: 'mutation { replaceMeal(input: {}) { __typename } }',
  },
  {
    label: 'mutation: requestChange',
    query: 'mutation { requestChange(input: {}) { __typename } }',
  },
  {
    label: 'mutation: createChangeRequest',
    query: 'mutation { createChangeRequest(input: {}) { __typename } }',
  },
];
