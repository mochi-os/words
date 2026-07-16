// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useEffect, useMemo } from 'react'
import { useLingui } from '@lingui/react/macro'
import { Outlet, useParams } from '@tanstack/react-router'
import {
  cn,
  useSidebar,
  useAuthStore,
  AuthenticatedLayout,
  type SidebarData,
} from '@mochi/web'
import { Plus } from 'lucide-react'
import { SidebarProvider, useSidebarContext } from '@/context/sidebar-context'
import { useGamesQuery } from '@/hooks/useGames'
import { NewGame } from '@/features/words/components/new-game'
import { getPlayerNames, isMyTurn, type GameListItem } from '@/api/games'

function WebsocketStatusIndicator() {
  const { websocketStatusMeta, gameId } = useSidebarContext()
  const { state } = useSidebar()
  const isCollapsed = state === 'collapsed'

  if (!gameId) return null

  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center gap-2 px-2 py-2 text-xs',
        isCollapsed && 'justify-center px-0'
      )}
    >
      <span
        className={cn(
          'h-2 w-2 flex-shrink-0 rounded-full',
          websocketStatusMeta.color
        )}
      />
      {!isCollapsed && <span>{websocketStatusMeta.label}</span>}
    </div>
  )
}

function WordsLayoutInner() {
  const { t } = useLingui()
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )
  const { setGame, openNewGameDialog } = useSidebarContext()
  const { identity: myIdentity } = useAuthStore()

  const params = useParams({ strict: false }) as { gameId?: string }
  const urlGameId = params?.gameId

  useEffect(() => {
    if (urlGameId) {
      const game = games.find(
        (g) => g.id === urlGameId || g.fingerprint === urlGameId
      )
      const name = game && myIdentity
        ? getPlayerNames(game, myIdentity)
        : undefined
      setGame(urlGameId, name)
    } else {
      setGame(null)
    }
  }, [urlGameId, games, myIdentity, setGame])

  const sidebarData: SidebarData = useMemo(() => {
    const sortedGames = [...games].sort((a, b) => b.updated - a.updated)
    const activeGames = sortedGames.filter((g) => g.status === 'active')
    const completedGames = sortedGames.filter((g) => g.status !== 'active')

    const getName = (game: GameListItem) =>
      myIdentity ? getPlayerNames(game, myIdentity) : game.player2_name

    const groups: SidebarData['navGroups'] = []

    if (activeGames.length > 0) {
      groups.push({
        title: t`Active Games`,
        items: activeGames.map((game) => ({
          title: getName(game),
          url: `/${game.fingerprint ?? game.id}`,
          badge: myIdentity && isMyTurn(game, myIdentity) ? '!' : undefined,
        })),
      })
    }

    if (completedGames.length > 0) {
      groups.push({
        title: t`Completed`,
        items: completedGames.map((game) => ({
          title: getName(game),
          url: `/${game.fingerprint ?? game.id}`,
          className: 'text-muted-foreground',
        })),
      })
    }

    groups.push({
      title: '',
      separator: true,
      items: [
        {
          title: t`New game`,
          onClick: openNewGameDialog,
          icon: Plus,
        },
      ],
    })

    return { navGroups: groups }
  }, [games, myIdentity, openNewGameDialog, t])

  return (
    <AuthenticatedLayout
      sidebarData={sidebarData}
      sidebarFooter={<WebsocketStatusIndicator />}
    >
      <Outlet />
    </AuthenticatedLayout>
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
