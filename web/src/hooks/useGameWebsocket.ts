// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback, useEffect, useState } from 'react'
import {
  useQueryClient,
  type QueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import { useLingui } from '@lingui/react/macro'
import { useAuthStore } from '@mochi/web'
import type { GameMessage, GetMessagesResponse, GameViewResponse, GetGamesResponse } from '@/api/games'
import {
  type ChatWebsocketMessagePayload,
  type WebsocketConnectionStatus,
} from '@/lib/websocket-manager'
import { gameKeys } from '@/hooks/useGames'
import { useWebsocketManager } from '@/hooks/useWebsocketManager'

interface UseGameWebsocketResult {
  status: WebsocketConnectionStatus
  retries: number
  error?: string
  forceReconnect: () => void
}

const isSameMessage = (incoming: GameMessage, existing: GameMessage): boolean =>
  incoming.created === existing.created &&
  incoming.body === existing.body &&
  incoming.name === existing.name &&
  incoming.type === existing.type

const createMessageFromPayload = (
  gameId: string,
  payload: ChatWebsocketMessagePayload,
  unknownSenderLabel: string,
): GameMessage => {
  const created =
    typeof payload.created === 'number'
      ? payload.created
      : Math.floor(Date.now() / 1000)
  const messageBody =
    typeof payload.body === 'string' ? payload.body : String(payload.body ?? '')
  const senderName = typeof payload.name === 'string' ? payload.name : unknownSenderLabel
  const senderId = typeof payload.member === 'string' ? payload.member : ''
  const msgType = typeof payload.type === 'string' ? payload.type as GameMessage['type'] : 'message'

  return {
    id: `ws-${gameId}-${created}-${Math.random().toString(36).slice(2)}`,
    game: gameId,
    body: messageBody,
    member: senderId,
    name: senderName,
    type: msgType,
    created,
  }
}

const handleWebsocketPayload = (
  gameId: string,
  payload: ChatWebsocketMessagePayload,
  queryClient: QueryClient,
  unknownSenderLabel: string,
  myIdentity: string,
) => {
  if (!gameId) return

  const msgType = payload.type as string | undefined
  const event = payload.event as string | undefined

  // Handle resign — the payload carries the final state, so patch the
  // caches directly. Invalidating here would refetch view + list a second
  // time on the actor's side (their mutation already invalidates).
  if (event === 'resign') {
    const winner =
      typeof payload.winner === 'string' && payload.winner ? payload.winner : null
    queryClient.setQueryData<GameViewResponse>(
      gameKeys.detail(gameId),
      (current) => {
        if (!current) return current
        return {
          ...current,
          game: {
            ...current.game,
            status: 'resigned' as const,
            winner: winner ?? current.game.winner,
          },
        }
      }
    )
    queryClient.setQueryData<GetGamesResponse>(gameKeys.all(), (current) => {
      if (!current) return current
      return {
        ...current,
        games: current.games.map((g) =>
          g.id === gameId
            ? { ...g, status: 'resigned' as const, winner: winner ?? g.winner }
            : g
        ),
      }
    })
  }

  // Handle move — refetch detail for updated rack + bag_count (private,
  // not in the payload). Skip our own echo: the move/pass/exchange
  // mutation already invalidated detail, messages, and the list.
  if (msgType === 'move' && !(myIdentity && payload.member === myIdentity)) {
    void queryClient.invalidateQueries({
      queryKey: gameKeys.detail(gameId),
      exact: true,
    })
    void queryClient.invalidateQueries({ queryKey: gameKeys.all(), exact: true })
  }

  // Append message to messages cache for all types (message, move, system)
  const incomingMessage = createMessageFromPayload(gameId, payload, unknownSenderLabel)

  queryClient.setQueryData<InfiniteData<GetMessagesResponse>>(
    gameKeys.messages(gameId),
    (current) => {
      if (!current || !current.pages || current.pages.length === 0) {
        return {
          pages: [{ messages: [incomingMessage] }],
          pageParams: [undefined],
        }
      }

      const alreadyExists = current.pages.some((page) =>
        page.messages.some((message) => isSameMessage(incomingMessage, message))
      )

      if (alreadyExists) return current

      const updatedPages = current.pages.map((page, index) => {
        if (index === 0) {
          return {
            ...page,
            messages: [...page.messages, incomingMessage],
          }
        }
        return page
      })

      return {
        ...current,
        pages: updatedPages,
      }
    }
  )
}

export const useGameWebsocket = (
  gameId?: string,
  gameKey?: string
): UseGameWebsocketResult => {
  const { t } = useLingui()
  const unknownSenderLabel = t`Unknown`
  const manager = useWebsocketManager()
  const queryClient = useQueryClient()
  const { identity: myIdentity } = useAuthStore()
  const [snapshot, setSnapshot] = useState<{
    status: WebsocketConnectionStatus
    retries: number
    lastError?: string
  } | null>(null)

  useEffect(() => {
    setSnapshot(null)

    if (!gameId || !manager) {
      return undefined
    }

    const unsubscribe = manager.subscribe(gameId, {
      chatKey: gameKey,
      onMessage: (event) => {
        handleWebsocketPayload(event.chatId, event.payload, queryClient, unknownSenderLabel, myIdentity)
      },
      onStatusChange: (nextSnapshot) => {
        setSnapshot(nextSnapshot)
      },
    })

    return () => {
      unsubscribe()
    }
  }, [gameId, gameKey, manager, queryClient, unknownSenderLabel, myIdentity])

  const forceReconnect = useCallback(() => {
    if (gameId && manager) {
      manager.forceReconnect(gameId)
    }
  }, [gameId, manager])

  return {
    status: snapshot?.status ?? 'idle',
    retries: snapshot?.retries ?? 0,
    error: snapshot?.lastError,
    forceReconnect,
  }
}
