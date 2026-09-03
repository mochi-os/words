// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback, useMemo } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Outlet } from '@tanstack/react-router'
import { GameRouteLayout, useAuthStore } from '@mochi/web'
import { useGamesQuery } from '@/hooks/useGames'
import { NewGame } from '@/features/words/components/new-game'
import { getPlayerNames, isMyTurn, type GameListItem } from '@/api/games'

export function WordsLayout() {
  const { t } = useLingui()
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )
  const { identity: myIdentity } = useAuthStore()

  // A words game can seat up to four, so the entry names every other player
  // rather than a single opponent - which is also why no avatar is drawn.
  const gameTitle = useCallback(
    (game: GameListItem) =>
      myIdentity ? getPlayerNames(game, myIdentity) : game.player2_name,
    [myIdentity]
  )

  // isMyTurn already answers false for a finished game, so the completed
  // group never carries this even though the shell offers it to both.
  const badge = useCallback(
    (game: GameListItem) =>
      myIdentity && isMyTurn(game, myIdentity) ? '!' : undefined,
    [myIdentity]
  )

  return (
    <GameRouteLayout
      games={games}
      gameTitle={gameTitle}
      badge={badge}
      labels={{
        active: t`Active games`,
        completed: t`Completed`,
        newGame: t`New game`,
      }}
      newGameDialog={<NewGame />}
    >
      <Outlet />
    </GameRouteLayout>
  )
}
