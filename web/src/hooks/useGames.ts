// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { createGameHooks } from '@mochi/web'
import {
  gamesApi,
  type CreateGameResponse,
  type ExchangeRequest,
  type ExchangeResponse,
  type MoveResponse,
} from '@/api/games'

// Words has no draw offer, so the shared factory hands back no draw hooks. What
// stays here is what words adds on top: passing, exchanging tiles, the word
// validator, and a create that takes several opponents and a language.
const shared = createGameHooks(gamesApi)

export const gameKeys = shared.gameKeys

export const {
  useGameDetailQuery,
  useGamesQuery,
  useInfiniteMessagesQuery,
  useSendMessageMutation,
  useMoveMutation,
  useNewGameFriendsQuery,
  useResignMutation,
  useDeleteGameMutation,
} = shared

const WORD_VALIDATION_STALE_TIME = 10 * 60 * 1000

export const wordValidationKeys = {
  all: () => ['words', 'validate'] as const,
  detail: (language: string, word: string) =>
    ['words', 'validate', language, word.toUpperCase()] as const,
}

export const getValidateWordQueryOptions = (
  word: string,
  language = 'en_US'
) => ({
  queryKey: wordValidationKeys.detail(language, word),
  queryFn: () => gamesApi.validateWord(word, language),
  staleTime: WORD_VALIDATION_STALE_TIME,
})

/**
 * Pass and exchange advance the turn without placing a word, so they invalidate
 * exactly what a move does.
 */
const turnAction = <R, V extends { gameId: string }>(
  call: (variables: V) => Promise<R>
) =>
  function useAction(options?: UseMutationOptions<R, Error, V, unknown>) {
    const queryClient = useQueryClient()
    const { onSuccess, ...restOptions } = options ?? {}
    return useMutation({
      mutationFn: call,
      onSuccess: (data, variables, context, mutation) => {
        queryClient.invalidateQueries({
          queryKey: gameKeys.messages(variables.gameId),
        })
        queryClient.invalidateQueries({
          queryKey: gameKeys.detail(variables.gameId),
          exact: true,
        })
        queryClient.invalidateQueries({ queryKey: gameKeys.all(), exact: true })
        onSuccess?.(data, variables, context, mutation)
      },
      ...restOptions,
    })
  }

export const usePassMutation = turnAction<MoveResponse, { gameId: string }>(
  ({ gameId }) => gamesApi.pass(gameId)
)

interface ExchangeVariables extends ExchangeRequest {
  gameId: string
}

export const useExchangeMutation = turnAction<
  ExchangeResponse,
  ExchangeVariables
>(({ gameId, ...payload }) => gamesApi.exchange(gameId, payload))

interface CreateGameVariables {
  opponents: string[]
  language: string
}

export const useCreateGameMutation = (
  options?: UseMutationOptions<
    CreateGameResponse,
    Error,
    CreateGameVariables,
    unknown
  >
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ opponents, language }: CreateGameVariables) =>
      gamesApi.create(opponents, language),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: gameKeys.all(), exact: true })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}
