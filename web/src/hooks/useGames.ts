import {
  useMutation,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
  type InfiniteData,
} from '@tanstack/react-query'
import {
  useQueryWithError,
  useInfiniteQueryWithError,
} from '@mochi/common'
import {
  gamesApi,
  type GetGamesResponse,
  type GetMessagesResponse,
  type SendMessageRequest,
  type SendMessageResponse,
  type GameViewResponse,
  type GetNewGameResponse,
  type CreateGameResponse,
  type MoveRequest,
  type MoveResponse,
  type ExchangeRequest,
  type ExchangeResponse,
  type ResignResponse,
  type DeleteResponse,
} from '@/api/games'

export const gameKeys = {
  all: () => ['games'] as const,
  detail: (gameId: string) => ['games', gameId] as const,
  messages: (gameId: string) => ['games', gameId, 'messages'] as const,
  newGame: () => ['games', 'new'] as const,
}

export const useGameDetailQuery = (
  gameId?: string,
  options?: Omit<
    UseQueryOptions<
      GameViewResponse,
      Error,
      GameViewResponse,
      ReturnType<typeof gameKeys.detail>
    >,
    'queryKey' | 'queryFn'
  >
) =>
  useQueryWithError({
    queryKey: gameKeys.detail(gameId ?? 'unknown'),
    enabled: Boolean(gameId) && (options?.enabled ?? true),
    queryFn: () => {
      if (!gameId) {
        throw new Error('Game ID is required')
      }
      return gamesApi.detail(gameId)
    },
    ...options,
  })

export const useGamesQuery = (
  options?: Pick<
    UseQueryOptions<
      GetGamesResponse,
      Error,
      GetGamesResponse,
      ReturnType<typeof gameKeys.all>
    >,
    'enabled' | 'staleTime' | 'gcTime'
  >
) =>
  useQueryWithError({
    queryKey: gameKeys.all(),
    queryFn: () => gamesApi.list(),
    refetchInterval: 30000,
    ...options,
  })

const DEFAULT_PAGE_SIZE = 30

export const useInfiniteMessagesQuery = (
  gameId?: string,
  options?: {
    enabled?: boolean
  }
) =>
  useInfiniteQueryWithError<GetMessagesResponse, Error, InfiniteData<GetMessagesResponse>, ReturnType<typeof gameKeys.messages>, number | undefined>({
    queryKey: gameKeys.messages(gameId ?? 'unknown'),
    enabled: Boolean(gameId) && (options?.enabled ?? true),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => {
      if (!gameId) {
        return Promise.resolve<GetMessagesResponse>({ messages: [] })
      }
      return gamesApi.messages(gameId, {
        before: pageParam,
        limit: DEFAULT_PAGE_SIZE,
      })
    },
    getNextPageParam: (lastPage, _allPages, _lastPageParam, allPageParams) => {
      if (!lastPage.hasMore) {
        return undefined
      }
      if (lastPage.nextCursor === undefined) {
        return undefined
      }
      if (allPageParams.includes(lastPage.nextCursor)) {
        return undefined
      }
      return lastPage.nextCursor
    },
  })

interface SendMessageVariables extends SendMessageRequest {
  gameId: string
}

export const useSendMessageMutation = (
  options?: UseMutationOptions<
    SendMessageResponse,
    Error,
    SendMessageVariables,
    unknown
  >
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId, ...payload }) =>
      gamesApi.sendMessage(gameId, payload),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({
        queryKey: gameKeys.messages(variables.gameId),
      })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface MoveVariables extends MoveRequest {
  gameId: string
}

export const useMoveMutation = (
  options?: UseMutationOptions<MoveResponse, Error, MoveVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId, ...payload }) => gamesApi.move(gameId, payload),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({
        queryKey: gameKeys.messages(variables.gameId),
      })
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
      })
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface PassVariables {
  gameId: string
}

export const usePassMutation = (
  options?: UseMutationOptions<MoveResponse, Error, PassVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId }) => gamesApi.pass(gameId),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({
        queryKey: gameKeys.messages(variables.gameId),
      })
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
      })
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface ExchangeVariables extends ExchangeRequest {
  gameId: string
}

export const useExchangeMutation = (
  options?: UseMutationOptions<ExchangeResponse, Error, ExchangeVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId, ...payload }) => gamesApi.exchange(gameId, payload),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({
        queryKey: gameKeys.messages(variables.gameId),
      })
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
      })
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

export const useNewGameFriendsQuery = (
  options?: Omit<
    UseQueryOptions<
      GetNewGameResponse,
      Error,
      GetNewGameResponse,
      ReturnType<typeof gameKeys.newGame>
    >,
    'queryKey' | 'queryFn'
  >
) =>
  useQueryWithError({
    queryKey: gameKeys.newGame(),
    queryFn: () => gamesApi.getFriendsForNewGame(),
    ...options,
  })

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
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface ResignVariables {
  gameId: string
}

export const useResignMutation = (
  options?: UseMutationOptions<ResignResponse, Error, ResignVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId }: ResignVariables) => gamesApi.resign(gameId),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      queryClient.invalidateQueries({
        queryKey: gameKeys.detail(variables.gameId),
      })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}

interface DeleteGameVariables {
  gameId: string
}

export const useDeleteGameMutation = (
  options?: UseMutationOptions<DeleteResponse, Error, DeleteGameVariables, unknown>
) => {
  const queryClient = useQueryClient()
  const { onSuccess, ...restOptions } = options ?? {}
  return useMutation({
    mutationFn: ({ gameId }: DeleteGameVariables) => gamesApi.delete(gameId),
    onSuccess: (data, variables, context, mutation) => {
      queryClient.invalidateQueries({ queryKey: gameKeys.all() })
      onSuccess?.(data, variables, context, mutation)
    },
    ...restOptions,
  })
}
