/**
 * Regression tests for the public data-deletion status page.
 *
 * Production defect: the page printed "Your automated Meta data deletion
 * request has been received" for *any* `?confirmation=` value. Nothing was
 * verified and nothing was stored, so the URL Meta received as proof of
 * deletion showed a green success banner that could never be checked — and any
 * visitor could manufacture that banner with a random query string.
 *
 * The page now looks the code up in the persisted request record and only then
 * reports what actually happened, without exposing the Meta user id or any
 * other account data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FakePrisma as FakePrismaType } from '@/test/fake-prisma';

const state = vi.hoisted(() => ({ db: null as unknown as FakePrismaType }));

vi.mock('@/lib/prisma', async () => {
  const { FakePrisma } = await import('@/test/fake-prisma');
  state.db = new FakePrisma();
  return { prisma: state.db.client };
});

import DataDeletionPage from './page';

const CONFIRMATION = '2f9c3a54-8f1d-4a5e-9a1b-7c6d5e4f3a2b';
const META_USER_ID = 'meta-user-private';

async function render(confirmation?: string) {
  const markup = renderToStaticMarkup(
    await DataDeletionPage({ searchParams: Promise.resolve(confirmation === undefined ? {} : { confirmation }) }),
  );
  return markup;
}

function seedRequest(overrides: Record<string, unknown> = {}) {
  return state.db.seed('metaDataDeletionRequest', {
    metaUserId: META_USER_ID,
    confirmationCode: CONFIRMATION,
    status: 'COMPLETED',
    deletedConnections: 1,
    deletedMedia: 4,
    deletedAutomations: 2,
    deletedContacts: 7,
    deletedWebhookEvents: 11,
    completedAt: new Date('2026-10-01T12:00:00Z'),
    ...overrides,
  });
}

beforeEach(() => {
  state.db.reset();
});

describe('data-deletion status page', () => {
  it('shows the instructions without any status claim when no code is given', async () => {
    const markup = await render();

    expect(markup).toContain('Data Deletion Instructions');
    expect(markup).toContain('mailto:ritesh.gupta131290@gmail.com');
    expect(markup).not.toContain('Deletion completed');
    expect(markup).not.toContain('has been received');
  });

  it('never confirms a deletion for an arbitrary query parameter', async () => {
    const markup = await render('totally-made-up-code');

    expect(markup).toContain('Confirmation code not verified');
    expect(markup).not.toContain('Deletion completed');
    expect(markup).not.toContain('totally-made-up-code'.repeat(1) + ' Deletion');
    expect(markup).not.toContain('automation(s)');
    // The unverified code is echoed back so the visitor can check their link.
    expect(markup).toContain('totally-made-up-code');
  });

  it('reports the stored completion with the real deletion counts', async () => {
    seedRequest();
    const markup = await render(CONFIRMATION);

    expect(markup).toContain('Deletion completed');
    expect(markup).toContain(CONFIRMATION);
    expect(markup).toContain('2026-10-01');
    expect(markup).toContain('1 connected Instagram/Facebook connection(s)');
    expect(markup).toContain('2 automation(s)');
    expect(markup).toContain('4 synced post(s)');
    expect(markup).toContain('7 contact record(s)');
    expect(markup).toContain('11 received webhook event(s)');
  });

  it('does not expose the Meta user id or any workspace PII', async () => {
    seedRequest();
    state.db.seed('user', { id: 'owner-private', email: 'creator@example.test', passwordHash: 'hash' });
    state.db.seed('metaConnection', {
      userId: 'owner-private',
      metaUserId: META_USER_ID,
      instagramAccountId: 'ig-private',
      instagramUsername: 'creator_ig_handle',
      accessTokenEncrypted: 'encrypted-token-private',
    });
    const markup = await render(CONFIRMATION);

    for (const secret of [META_USER_ID, 'creator@example.test', 'creator_ig_handle', 'owner-private', 'encrypted-token-private']) {
      expect(markup).not.toContain(secret);
    }
    // Every address on the page is the public support contact, never a user's.
    const addresses = markup.match(/[\w.-]+@[\w.-]+\.\w+/g) ?? [];
    expect(addresses.length).toBeGreaterThan(0);
    expect(new Set(addresses)).toEqual(new Set(['ritesh.gupta131290@gmail.com']));
  });

  it('reports a failed request as failed instead of completed', async () => {
    seedRequest({ status: 'FAILED', completedAt: null, errorDetails: 'Database error P2010' });
    const markup = await render(CONFIRMATION);

    expect(markup).toContain('Deletion could not be completed');
    expect(markup).not.toContain('Deletion completed');
    expect(markup).toContain(CONFIRMATION);
  });

  it('reports a pending request as still in progress', async () => {
    seedRequest({ status: 'PENDING', completedAt: null, requestedAt: new Date('2026-10-02T09:30:00Z') });
    const markup = await render(CONFIRMATION);

    expect(markup).toContain('still in progress');
    expect(markup).not.toContain('Deletion completed');
    expect(markup).toContain('2026-10-02');
  });

  it('says nothing was found when the request stored no connection', async () => {
    seedRequest({ deletedConnections: 0, deletedMedia: 0, deletedAutomations: 0, deletedContacts: 0, deletedWebhookEvents: 0 });
    const markup = await render(CONFIRMATION);

    expect(markup).toContain('Deletion completed');
    expect(markup).toContain('nothing left to delete');
  });

  it('accepts a padded code but still requires a stored match', async () => {
    seedRequest();
    expect(await render(`  ${CONFIRMATION}  `)).toContain('Deletion completed');
  });

  it('admits that the status could not be verified instead of claiming success', async () => {
    seedRequest();
    state.db.beforeOperation = (entry) => {
      if (entry.model === 'metaDataDeletionRequest') throw new Error('database unavailable');
    };

    const markup = await render(CONFIRMATION);

    expect(markup).toContain('temporarily unavailable');
    expect(markup).not.toContain('Deletion completed');
  });
});
