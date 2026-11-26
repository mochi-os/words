// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import type { ComponentProps } from 'react'
import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { GameMessage } from '@/api/games'
import { ChatMessageList } from './chat-message-list'

// The list itself, without the rest of the library, which needs a DOM.
vi.mock(
  '@mochi/web',
  async () =>
    await import('@mochi/web/components/game/game-chat-message-list.tsx')
)

// No catalogue is loaded, so every message reads as its English source.
beforeAll(() => {
  i18n.load('en', {})
  i18n.activate('en')
})

type Query = ComponentProps<typeof ChatMessageList>['messagesQuery']

// The list reads only the paging fields of the query.
const query = {
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => undefined,
  refetch: () => undefined,
} as unknown as Query

function resign(fields: Partial<GameMessage>): GameMessage {
  return {
    id: 'm1',
    game: 'g1',
    member: 'a1',
    name: 'Alice',
    body: '',
    type: 'system',
    event: 'resign',
    created: 1_700_000_000,
    ...fields,
  }
}

function text(message: GameMessage): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={i18n}>
      <ChatMessageList
        messagesQuery={query}
        chatMessages={[message]}
        isLoadingMessages={false}
        messagesError={null}
        currentUserIdentity='b1'
      />
    </I18nProvider>
  ).replace(/<[^>]+>/g, ' ')
}

describe('a resignation in the chat', () => {
  it('is worded from the player, as the server stores it now', () => {
    expect(text(resign({}))).toContain('Alice resigned')
  })

  it('falls back to the body of a row that names no player', () => {
    expect(text(resign({ name: '', body: 'Opponent resigned' }))).toContain(
      'Opponent resigned'
    )
  })
})
