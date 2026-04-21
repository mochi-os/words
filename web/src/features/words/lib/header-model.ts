import type { Game } from '@/api/games'

export interface WordsHeaderPlayer {
  playerNumber: number
  label: string
  score: number
  isCurrentTurn: boolean
  isMe: boolean
}

export interface WordsHeaderModel {
  title: string
  status: string
  meta: string | null
  players: WordsHeaderPlayer[]
  tilesLeftLabel: string
}

function getPlayerIdentity(game: Game, playerNumber: number): string | undefined {
  return game[`player${playerNumber}` as keyof Game] as string | undefined
}

function getPlayerName(game: Game, playerNumber: number): string {
  return (
    (game[`player${playerNumber}_name` as keyof Game] as string | undefined) ??
    `Player ${playerNumber}`
  )
}

function isCurrentUserPlayer(
  game: Game,
  playerNumber: number,
  myIdentity?: string | null
): boolean {
  if (myIdentity) {
    return getPlayerIdentity(game, playerNumber) === myIdentity
  }

  return playerNumber === game.my_player_number
}

function getOppositionNames(game: Game, myIdentity?: string | null): string[] {
  const names: string[] = []

  for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
    if (isCurrentUserPlayer(game, playerNumber, myIdentity)) {
      continue
    }

    names.push(getPlayerName(game, playerNumber))
  }

  return names
}

function isCurrentUserWinner(game: Game, myIdentity?: string | null): boolean {
  if (!game.winner) {
    return false
  }

  if (myIdentity) {
    return game.winner === myIdentity
  }

  return game.winner === getPlayerIdentity(game, game.my_player_number)
}

function getWinnerPlayerNumber(game: Game): number | null {
  if (!game.winner) {
    return null
  }

  for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
    if (getPlayerIdentity(game, playerNumber) === game.winner) {
      return playerNumber
    }
  }

  return null
}

export function getWordsHeaderStatus(game: Game, myIdentity?: string | null): string {
  if (game.status === 'active') {
    if (game.current_turn === game.my_player_number) {
      return 'Your move'
    }

    return `${getPlayerName(game, game.current_turn)}'s move`
  }

  if (game.status === 'finished') {
    if (isCurrentUserWinner(game, myIdentity)) {
      return 'You win!'
    }

    const winnerPlayerNumber = getWinnerPlayerNumber(game)
    if (winnerPlayerNumber) {
      return `${getPlayerName(game, winnerPlayerNumber)} wins`
    }

    return 'Game over'
  }

  return isCurrentUserWinner(game, myIdentity)
    ? 'Opponent resigned — you win!'
    : 'You resigned'
}

export function getWordsHeaderModel(
  game: Game,
  myIdentity?: string | null
): WordsHeaderModel {
  const players: WordsHeaderPlayer[] = []

  for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
    const score = game[`player${playerNumber}_score` as keyof Game] as number
    const isMe = isCurrentUserPlayer(game, playerNumber, myIdentity)

    players.push({
      playerNumber,
      label: isMe ? 'You' : getPlayerName(game, playerNumber),
      score,
      isCurrentTurn: game.status === 'active' && game.current_turn === playerNumber,
      isMe,
    })
  }

  return {
    title: getOppositionNames(game, myIdentity).join(', '),
    status: getWordsHeaderStatus(game, myIdentity),
    meta: game.player_count > 2 ? `Playing with ${game.player_count} players` : null,
    players,
    tilesLeftLabel: `${game.bag_count} tiles left`,
  }
}
