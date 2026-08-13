// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import type { ReactNode } from 'react'
import type {
  UseInfiniteQueryResult,
  InfiniteData,
} from '@tanstack/react-query'
import { GameChatMessageList } from '@mochi/web'
import { Trans, useLingui } from '@lingui/react/macro'
import type { GameMessage, GetMessagesResponse } from '@/api/games'

interface ChatMessageListProps {
  messagesQuery: UseInfiniteQueryResult<
    InfiniteData<GetMessagesResponse>,
    unknown
  >
  chatMessages: GameMessage[]
  isLoadingMessages: boolean
  messagesError: unknown
  currentUserIdentity: string
}

export function ChatMessageList({
  messagesQuery,
  chatMessages,
  isLoadingMessages,
  messagesError,
  currentUserIdentity,
}: ChatMessageListProps) {
  const { t } = useLingui()

  return (
    <GameChatMessageList
      messagesQuery={messagesQuery}
      chatMessages={chatMessages}
      isLoadingMessages={isLoadingMessages}
      messagesError={messagesError}
      currentUserIdentity={currentUserIdentity}
      emptyLabel={t`No messages yet`}
      // Words has no draw, so resignation is the only event with wording of
      // its own. A row carrying no actor name falls back to the stored body,
      // which is what returning null here asks the list to do.
      systemLabels={{
        // `name` reaches Trans as a bare identifier, which keeps the msgid
        // "{name} resigned" shared with chess and go.
        resigned: (name) => (name ? <Trans>{name} resigned</Trans> : null),
      }}
      renderMove={(message, isSent) => {
        // Plays, passes and exchanges all arrive as type 'move' and are told
        // apart by the event marker, which also lets this viewer render
        // localised text. The stored body wrapped every row in "played",
        // producing "Alice played Alice passed" for pass rows; legacy rows
        // without a marker keep that behaviour rather than guessing.
        const actor = isSent ? t`You` : message.name
        const marker = message.event ?? ''
        let content: ReactNode
        if (marker === 'pass' || marker === 'pass:over') {
          content =
            marker === 'pass:over' ? (
              <Trans>{actor} passed — game over</Trans>
            ) : (
              <Trans>{actor} passed</Trans>
            )
        } else if (marker.startsWith('exchange:')) {
          // The marker carries the tile count, but rendering it needs a
          // count-inflected noun in every locale's plural categories -
          // hand-filling that across 105 catalogs is where quality collapses,
          // so the sentence omits the number. The count stays stored in the
          // marker for a future plural pass.
          content = <Trans>{actor} exchanged tiles</Trans>
        } else if (marker.startsWith('play:')) {
          const score = marker.slice('play:'.length)
          // Body is `<words> (+<score>)` with `played` as the no-words
          // placeholder; the marker's score strips it deterministically.
          const suffix = ` (+${score})`
          let words = message.body.endsWith(suffix)
            ? message.body.slice(0, -suffix.length)
            : message.body
          // 'played' is the stored placeholder token, not user-facing output.
          if (words === 'played') words = ''
          content = (
            <Trans>
              {isSent ? t`You` : message.name} played{' '}
              <span className="font-mono">
                {words ? `${words} (+${score})` : `(+${score})`}
              </span>
            </Trans>
          )
        } else {
          content = (
            <Trans>
              {isSent ? t`You` : message.name} played{' '}
              <span className="font-mono">{message.body}</span>
            </Trans>
          )
        }
        return content
      }}
    />
  )
}
