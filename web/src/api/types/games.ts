export interface Game {
  id: string
  fingerprint?: string
  language: string
  player_count: number
  player1: string
  player1_name: string
  player1_score: number
  player2: string
  player2_name: string
  player2_score: number
  player3?: string
  player3_name?: string
  player3_score: number
  player4?: string
  player4_name?: string
  player4_score: number
  current_turn: number
  status: 'active' | 'finished' | 'resigned'
  winner: string | null
  board: string
  my_rack: string
  my_player_number: number
  bag_count: number
  move_count: number
  consecutive_passes: number
  key: string
  updated: number
  created: number
}

// Lightweight game type for list view (no rack/bag info)
export interface GameListItem {
  id: string
  fingerprint?: string
  language: string
  player_count: number
  player1: string
  player1_name: string
  player1_score: number
  player2: string
  player2_name: string
  player2_score: number
  player3?: string
  player3_name?: string
  player3_score: number
  player4?: string
  player4_name?: string
  player4_score: number
  current_turn: number
  status: 'active' | 'finished' | 'resigned'
  winner: string | null
  board: string
  my_player_number: number
  move_count: number
  consecutive_passes: number
  updated: number
  created: number
}

export function getPlayerNames(game: GameListItem | Game, myIdentity: string): string {
  const names: string[] = []
  for (let i = 1; i <= game.player_count; i++) {
    const id = game[`player${i}` as keyof typeof game] as string
    const name = game[`player${i}_name` as keyof typeof game] as string
    if (id && id !== myIdentity && name) {
      names.push(name)
    }
  }
  return names.join(', ')
}

export function isMyTurn(game: GameListItem | Game, myIdentity: string): boolean {
  if (game.status !== 'active') return false
  const myNum = getMyPlayerNumber(game, myIdentity)
  return game.current_turn === myNum
}

function getMyPlayerNumber(game: GameListItem | Game, myIdentity: string): number {
  for (let i = 1; i <= game.player_count; i++) {
    if ((game[`player${i}` as keyof typeof game] as string) === myIdentity) {
      return i
    }
  }
  return 0
}

export type MessageType = 'message' | 'move' | 'system'

export interface GameMessage {
  id: string
  game: string
  member: string
  name: string
  body: string
  type: MessageType
  created: number
  created_local?: string
}

export interface GameViewResponse {
  game: Game
  identity: string
}

export interface GetGamesResponse {
  games: GameListItem[]
}

export interface GetMessagesResponse {
  messages: GameMessage[]
  hasMore?: boolean
  nextCursor?: number
}

export interface CreateGameResponse {
  id: string
}

export interface NewGameFriend {
  class: string
  id: string
  identity: string
  name: string
}

export interface GetNewGameResponse {
  friends: NewGameFriend[]
}

export interface SendMessageRequest {
  body: string
}

export interface SendMessageResponse {
  id: string
}

export interface MoveRequest {
  board: string
  score: number
  tiles_used: string
  words_formed: string
}

export interface MoveResponse {
  id: string
}

export interface ExchangeRequest {
  tiles: string
}

export interface ExchangeResponse {
  id: string
}

export interface ResignResponse {
  success: boolean
}

export interface DeleteResponse {
  success: boolean
}

export interface ValidateWordResponse {
  valid: boolean
}
