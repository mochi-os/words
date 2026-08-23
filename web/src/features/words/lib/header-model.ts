// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { plural } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
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
  tilesLeft: number
}

function getPlayerIdentity(game: Game, playerNumber: number): string | undefined {
  return game[`player${playerNumber}` as keyof Game] as string | undefined
}

function getPlayerNameRaw(game: Game, playerNumber: number): string | undefined {
  return game[`player${playerNumber}_name` as keyof Game] as string | undefined
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

function isCurrentUserWinner(game: Game, myIdentity?: string | null): boolean {
  if (!game.winner) {
    return false
  }

  if (myIdentity) {
    return game.winner === myIdentity
  }

  return game.winner === getPlayerIdentity(game, game.my_player_number)
}

function isCurrentUserResigner(game: Game, myIdentity?: string | null): boolean {
  if (!game.writer) {
    return false
  }

  if (myIdentity) {
    return game.writer === myIdentity
  }

  return game.writer === getPlayerIdentity(game, game.my_player_number)
}

function getResignerPlayerNumber(game: Game): number | null {
  if (!game.writer) {
    return null
  }
  for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
    if (getPlayerIdentity(game, playerNumber) === game.writer) {
      return playerNumber
    }
  }
  return null
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

export function useWordsHeaderModel(
  game: Game | null | undefined,
  myIdentity?: string | null
): WordsHeaderModel | null {
  const { t } = useLingui()
  if (!game) return null

  const getPlayerName = (playerNumber: number): string =>
    getPlayerNameRaw(game, playerNumber) ?? t`Player ${playerNumber}`

  const getOppositionNames = (): string[] => {
    const names: string[] = []
    for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
      if (isCurrentUserPlayer(game, playerNumber, myIdentity)) {
        continue
      }
      names.push(getPlayerName(playerNumber))
    }
    return names
  }

  const getStatus = (): string => {
    if (game.status === 'active') {
      if (game.current_turn === game.my_player_number) {
        return t`Your move`
      }
      const name = getPlayerName(game.current_turn)
      return t`${name}'s move`
    }

    if (game.status === 'finished') {
      if (isCurrentUserWinner(game, myIdentity)) {
        return t`You win!`
      }

      const winnerPlayerNumber = getWinnerPlayerNumber(game)
      if (winnerPlayerNumber) {
        const name = getPlayerName(winnerPlayerNumber)
        return t`${name} wins`
      }

      return t`Game over`
    }

    // Three outcomes, not two. With up to four seats a resignation leaves
    // players who neither resigned nor won, and they used to fall into the
    // else and be told they had resigned - contradicting the "<name> resigned"
    // line in the log beside it.
    if (isCurrentUserResigner(game, myIdentity)) {
      return t`You resigned`
    }
    if (isCurrentUserWinner(game, myIdentity)) {
      return t`Opponent resigned — you win!`
    }
    const resignerPlayerNumber = getResignerPlayerNumber(game)
    if (resignerPlayerNumber) {
      const name = getPlayerName(resignerPlayerNumber)
      return t`${name} resigned`
    }
    return t`Game over`
  }

  const players: WordsHeaderPlayer[] = []
  for (let playerNumber = 1; playerNumber <= game.player_count; playerNumber += 1) {
    const score = game[`player${playerNumber}_score` as keyof Game] as number
    const isMe = isCurrentUserPlayer(game, playerNumber, myIdentity)

    players.push({
      playerNumber,
      label: isMe ? t`You` : getPlayerName(playerNumber),
      score,
      isCurrentTurn: game.status === 'active' && game.current_turn === playerNumber,
      isMe,
    })
  }

  // Tiles left is a label and a value, not a sentence: "1 tiles left" has no
  // wording that is right in every locale's plural forms. The player line is
  // prose and takes plural().
  const playerCount = game.player_count
  return {
    title: getOppositionNames().join(', '),
    status: getStatus(),
    meta:
      game.player_count > 2
        ? plural(playerCount, {
            one: 'Playing with # player',
            other: 'Playing with # players',
          })
        : null,
    players,
    tilesLeftLabel: t`Tiles left`,
    tilesLeft: game.bag_count,
  }
}
