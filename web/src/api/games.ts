import { createAppClient } from '@mochi/common'
import type {
  GameListItem,
  GameViewResponse,
  GetGamesResponse,
  GetMessagesResponse,
  GetNewGameResponse,
  CreateGameResponse,
  SendMessageRequest,
  SendMessageResponse,
  MoveRequest,
  MoveResponse,
  ExchangeRequest,
  ExchangeResponse,
  ResignResponse,
  DeleteResponse,
  ValidateWordResponse,
} from './types/games'
import endpoints from './endpoints'

export * from './types/games'

const client = createAppClient({ appName: 'words' })

const unwrapData = <T>(raw: unknown): T => {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data
  }
  return raw as T
}

export const gamesApi = {
  list: (): Promise<GetGamesResponse> =>
    client
      .get<{ data: GameListItem[] }>(endpoints.game.list)
      .then((res) => ({ games: res.data })),

  detail: (gameId: string) =>
    client
      .get<GameViewResponse | { data: GameViewResponse }>(
        endpoints.game.detail(gameId)
      )
      .then((res) => unwrapData<GameViewResponse>(res)),

  messages: (gameId: string, params?: { before?: number; limit?: number }) =>
    client
      .get<GetMessagesResponse | { data: GetMessagesResponse }>(
        endpoints.game.messages(gameId),
        { params }
      )
      .then((res) => unwrapData<GetMessagesResponse>(res)),

  sendMessage: (gameId: string, payload: SendMessageRequest) =>
    client.post<SendMessageResponse>(endpoints.game.send(gameId), payload),

  move: (gameId: string, payload: MoveRequest) =>
    client.post<MoveResponse>(endpoints.game.move(gameId), payload),

  pass: (gameId: string) =>
    client.post<MoveResponse>(endpoints.game.pass(gameId)),

  exchange: (gameId: string, payload: ExchangeRequest) =>
    client.post<ExchangeResponse>(endpoints.game.exchange(gameId), payload),

  getFriendsForNewGame: () =>
    client
      .get<{ data: GetNewGameResponse }>(endpoints.game.new)
      .then((res) => res.data),

  create: (opponents: string[], language: string = 'en_US') =>
    client
      .post<CreateGameResponse | { data: CreateGameResponse }>(endpoints.game.create, {
        opponents: opponents.join(','),
        language,
      })
      .then((res) => unwrapData<CreateGameResponse>(res)),

  resign: (gameId: string) =>
    client.post<ResignResponse>(endpoints.game.resign(gameId)),

  delete: (gameId: string) =>
    client.post<DeleteResponse>(endpoints.game.delete(gameId)),

  validateWord: (word: string, language: string = 'en_US') =>
    client
      .get<ValidateWordResponse | { data: ValidateWordResponse }>(endpoints.game.validate, {
        params: { word, language },
      })
      .then((res) => unwrapData<ValidateWordResponse>(res)),

  checkSubscription: () =>
    client
      .get<{ data: { exists: boolean } } | { exists: boolean }>('/-/notifications/check')
      .then((res) => unwrapData<{ exists: boolean }>(res)),
}
