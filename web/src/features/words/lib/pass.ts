// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import type { Game } from '@/api/games'

/**
 * Whether the next pass ends the game.
 *
 * Mirrors action_pass in words.star: the game is over once the passes in a row
 * reach the number of players, and each player's leftover tiles then come off
 * their own score. That is the one pass with something to lose, so it is the
 * one the player is asked about.
 */
export function passEndsGame(
  game: Pick<Game, 'consecutive_passes' | 'player_count'>
): boolean {
  return game.consecutive_passes + 1 >= game.player_count
}
