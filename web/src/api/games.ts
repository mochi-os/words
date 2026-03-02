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

export const gamesApi = {
  list: (): Promise<GetGamesResponse> =>
    client
      .get<{ data: GameListItem[] }>(endpoints.game.list)
      .then((res) => ({ games: res.data })),

  detail: (gameId: string) =>
    client
      .get<{ data: GameViewResponse }>(endpoints.game.detail(gameId))
      .then((res) => res.data),

  messages: (gameId: string, params?: { before?: number; limit?: number }) =>
    client
      .get<{ data: GetMessagesResponse }>(
        endpoints.game.messages(gameId),
        { params }
      )
      .then((res) => res.data),

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
      .post<{ data: CreateGameResponse }>(endpoints.game.create, {
        opponents: opponents.join(','),
        language,
      })
      .then((res) => res.data),

  resign: (gameId: string) =>
    client.post<ResignResponse>(endpoints.game.resign(gameId)),

  delete: (gameId: string) =>
    client.post<DeleteResponse>(endpoints.game.delete(gameId)),

  validateWord: (word: string, language: string = 'en_US') =>
    client
      .get<{ data: ValidateWordResponse }>(endpoints.game.validate, {
        params: { word, language },
      })
      .then((res) => res.data),

  checkSubscription: () =>
    client
      .get<{ data: { exists: boolean } }>('/-/notifications/check')
      .then((res) => res.data),
}
