// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback, useEffect, useMemo } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Outlet, useParams } from '@tanstack/react-router'
import { GameLayout, useAuthStore } from '@mochi/web'
import { SidebarProvider, useSidebarContext } from '@/context/sidebar-context'
import { useGamesQuery } from '@/hooks/useGames'
import { NewGame } from '@/features/words/components/new-game'
import { getPlayerNames, isMyTurn, type GameListItem } from '@/api/games'

function WordsLayoutInner() {
  const { t } = useLingui()
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )
  const { setGame, openNewGameDialog, websocketStatusMeta, gameId } =
    useSidebarContext()
  const { identity: myIdentity } = useAuthStore()

  const params = useParams({ strict: false }) as { gameId?: string }
  const urlGameId = params?.gameId

  useEffect(() => {
    if (urlGameId) {
      setGame(urlGameId)
    } else {
      setGame(null)
    }
  }, [urlGameId, setGame])

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
    <GameLayout
      games={games}
      gameTitle={gameTitle}
      badge={badge}
      onNewGame={openNewGameDialog}
      websocketStatus={gameId ? websocketStatusMeta : null}
      labels={{
        active: t`Active games`,
        completed: t`Completed`,
        newGame: t`New game`,
      }}
    >
      <Outlet />
    </GameLayout>
  )
}

export function WordsLayout() {
  return (
    <SidebarProvider>
      <WordsLayoutInner />
      <NewGame />
    </SidebarProvider>
  )
}
