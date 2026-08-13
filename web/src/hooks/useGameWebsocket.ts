// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useLingui } from '@lingui/react/macro'
import {
  useGameWebsocket as useSharedGameWebsocket,
  type UseGameWebsocketResult,
} from '@mochi/web'
import { gameKeys } from '@/hooks/useGames'
import type { Game } from '@/api/games'

export const useGameWebsocket = (
  gameId?: string,
  gameKey?: string
): UseGameWebsocketResult => {
  const { t } = useLingui()

  // No mergeMove: the rack and the bag are private to each player, so the
  // copies in a move frame are not the ones this viewer is entitled to see and
  // the shared hook refetches the game instead of patching it. `board` is where
  // words carries the position, which is what marks a frame as a full snapshot.
  return useSharedGameWebsocket<Game>({
    gameId,
    gameKey,
    keys: gameKeys,
    unknownSenderLabel: t`Unknown`,
    snapshotField: 'board',
  })
}
