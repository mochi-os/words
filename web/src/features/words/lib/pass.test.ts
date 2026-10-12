// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.
import { describe, it, expect } from 'vitest'
import { passEndsGame } from './pass'

describe('passEndsGame', () => {
  it('is false for the first pass of a two-player game', () => {
    expect(passEndsGame({ consecutive_passes: 0, player_count: 2 })).toBe(false)
  })

  it('is true when the other player of two has just passed', () => {
    expect(passEndsGame({ consecutive_passes: 1, player_count: 2 })).toBe(true)
  })

  it('needs every player to have passed in a larger game', () => {
    expect(passEndsGame({ consecutive_passes: 1, player_count: 3 })).toBe(false)
    expect(passEndsGame({ consecutive_passes: 2, player_count: 3 })).toBe(true)
    expect(passEndsGame({ consecutive_passes: 2, player_count: 4 })).toBe(false)
    expect(passEndsGame({ consecutive_passes: 3, player_count: 4 })).toBe(true)
  })
})
