import { useCallback, useEffect, useState } from 'react'
import {
  useQueryClient,
  type QueryClient,
  type InfiniteData,
} from '@tanstack/react-query'
import type { GameMessage, GetMessagesResponse } from '@/api/games'
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
  payload: ChatWebsocketMessagePayload
): GameMessage => {
  const created =
    typeof payload.created === 'number'
      ? payload.created
      : Math.floor(Date.now() / 1000)
  const messageBody =
    typeof payload.body === 'string' ? payload.body : String(payload.body ?? '')
  const senderName = typeof payload.name === 'string' ? payload.name : 'Unknown'
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
    created_local: '',
  }
}

const handleWebsocketPayload = (
  gameId: string,
  payload: ChatWebsocketMessagePayload,
  queryClient: QueryClient
) => {
  if (!gameId) return

  const msgType = payload.type as string | undefined
  const event = payload.event as string | undefined

  // Handle resign event — invalidate all queries
  if (event === 'resign') {
    void queryClient.invalidateQueries({ queryKey: gameKeys.all() })
    void queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) })
  }

  // Handle move — update game detail cache with new board/scores/status
  if (msgType === 'move') {
    // For moves, we invalidate the detail to get updated rack + bag_count
    void queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) })
    void queryClient.invalidateQueries({ queryKey: gameKeys.all() })
  }

  // Append message to messages cache for all types (message, move, system)
  const incomingMessage = createMessageFromPayload(gameId, payload)

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
  const manager = useWebsocketManager()
  const queryClient = useQueryClient()
  const [snapshot, setSnapshot] = useState<{
    status: WebsocketConnectionStatus
    retries: number
    lastError?: string
  } | null>(null)

  useEffect(() => {
    setSnapshot(null)

    if (!gameId) {
      return undefined
    }

    const unsubscribe = manager.subscribe(gameId, {
      chatKey: gameKey,
      onMessage: (event) => {
        handleWebsocketPayload(event.chatId, event.payload, queryClient)
      },
      onStatusChange: (nextSnapshot) => {
        setSnapshot(nextSnapshot)
      },
    })

    return () => {
      unsubscribe()
    }
  }, [gameId, gameKey, manager, queryClient])

  const forceReconnect = useCallback(() => {
    if (gameId) {
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
