// Pricing against mocked price services: no network.

import { acceptPrice, priceIdentity, priceRow } from '../src/core/pricing';
import { confirmPick } from '../src/core/recognize';
import type { CatalogCard, ScanRow } from '../src/core/types';
import { installPlatform } from '../src/platform/install';

const realFetch = globalThis.fetch;
const asked: string[] = [];

type Reply = { status: number; body?: unknown };

function mockFetch(reply: (url: string) => Reply): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const { status, body } = reply(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;
}

const cardOf = (id: string): CatalogCard => ({ id, name: 'Charizard', set: 'Base', setCode: 'base1', number: '4' });
const openRow: ScanRow = {
  identity: { name: 'Charizard' }, confidence: 0.4, abstain: false, unsure: true, market_price: null, price_variant: null, price_grid: null,
};

beforeEach(() => {
  installPlatform();
  asked.length = 0;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

test('a card priced by pokemontcg.io alone gets its market price and a printing grid', async () => {
  mockFetch((url) => {
    if (url.includes('pokemontcg.io')) {
      return {
        status: 200,
        body: { data: { id: 'base1-4', tcgplayer: { url: 'https://prices.pokemontcg.io/tcgplayer/base1-4', updatedAt: '2026/11/14', prices: { holofoil: { market: 350.5 }, normal: { mid: 90 } } } } },
      };
    }
    return { status: 404 };
  });
  const price = await priceIdentity(cardOf('base1-4'));
  expect(price.market_price).toBe(350.5);
  expect(price.price_variant).toBe('holofoil');
  expect(Object.keys(price.price_grid?.variants ?? {}).sort()).toEqual(['holofoil', 'normal']);
  expect(asked.some((url) => url.includes('api.tcgdex.net/v2/en/cards/base1-4'))).toBe(true);
});

test('a confirmed row comes back priced and no longer waiting', async () => {
  mockFetch((url) => (url.includes('pokemontcg.io')
    ? { status: 200, body: { data: { id: 'base1-5', tcgplayer: { prices: { normal: { market: 2.25 } } } } } }
    : { status: 404 }));
  const priced = await priceRow(confirmPick(openRow, cardOf('base1-5')));
  expect(priced.pricing).toBe(false);
  expect(priced.priceError).toBe(false);
  expect(priced.market_price).toBe(2.25);
  expect(priced.userConfirmed).toBe(true);
});

test('when no service has the card the row is flagged, not priced', async () => {
  mockFetch(() => ({ status: 404 }));
  const priced = await priceRow(confirmPick(openRow, cardOf('base1-6')));
  expect(priced.pricing).toBe(false);
  expect(priced.priceError).toBe(true);
  expect(priced.market_price).toBeNull();
  expect(priced.price_grid).toBeNull();
});

test('without a saved price-service key the local developer server is never asked', async () => {
  mockFetch(() => ({ status: 404 }));
  await priceIdentity(cardOf('base1-7'));
  expect(asked.length).toBeGreaterThan(0);
  expect(asked.some((url) => url.includes('127.0.0.1') || url.includes('localhost'))).toBe(false);
});

describe('a price answer that arrives late', () => {
  const waiting = confirmPick(openRow, cardOf('base1-8'));
  const answer: ScanRow = { ...waiting, pricing: false, market_price: 12 };

  test('is used while the row still waits for that card', () => {
    expect(acceptPrice(waiting, answer)).toBe(answer);
  });

  test('is dropped after the user took the confirmation back', () => {
    const withdrawn: ScanRow = { ...waiting, userConfirmed: false, unsure: true, pricing: false };
    expect(acceptPrice(withdrawn, answer)).toBe(withdrawn);
    expect(acceptPrice(withdrawn, answer).market_price).toBeNull();
  });

  test('is dropped after the user picked another card', () => {
    const other = confirmPick(openRow, cardOf('base1-9'));
    expect(acceptPrice(other, answer)).toBe(other);
  });

  test('is dropped when the row already has its answer', () => {
    const settled: ScanRow = { ...answer, market_price: 15 };
    expect(acceptPrice(settled, answer)).toBe(settled);
  });
});

test('a row without a catalog card is never sent to a price service', async () => {
  mockFetch(() => ({ status: 200, body: {} }));
  const priced = await priceRow({ ...openRow, pricing: true });
  expect(priced.priceError).toBe(true);
  expect(asked).toEqual([]);
});
