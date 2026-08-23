// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

/* eslint-disable lingui/no-unlocalized-strings -- vitest names and the fake catalogue below are not user-facing */
import { describe, it, expect, vi } from 'vitest'
import type { Game } from '@/api/games'

// The macros compile to calls on the runtime `t` from @lingui/react's useLingui.
// Standing in for it keeps the suite in the node environment: the model calls no
// other hook, so with this mock it is a plain function.
function render(descriptor: unknown): string {
  if (typeof descriptor === 'string') return descriptor
  const { message, values } = descriptor as {
    message: string
    values?: Record<string, unknown>
  }
  return message.replace(/\{(\w+)\}/g, (_whole, key: string) => String(values?.[key] ?? ''))
}

vi.mock('@lingui/react', () => ({
  useLingui: () => ({ t: render, i18n: { _: render } }),
}))

vi.mock('@lingui/core', () => ({
  i18n: { _: render },
}))

const { useWordsHeaderModel } = await import('./header-model')

// Four seats, Carol resigned, Bob leads on score and so takes the win.
function game(overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    language: 'en',
    player_count: 4,
    player1: 'id1',
    player1_name: 'Alice',
    player1_score: 10,
    player2: 'id2',
    player2_name: 'Bob',
    player2_score: 20,
    player3: 'id3',
    player3_name: 'Carol',
    player3_score: 5,
    player4: 'id4',
    player4_name: 'Dave',
    player4_score: 1,
    current_turn: 1,
    status: 'resigned',
    winner: 'id2',
    writer: 'id3',
    board: '',
    my_rack: '',
    my_player_number: 1,
    bag_count: 0,
    move_count: 0,
    consecutive_passes: 0,
    key: 'k',
    updated: 0,
    created: 0,
    ...overrides,
  }
}

// Named as a hook because it calls one; with @lingui/react mocked the model
// touches no other React machinery, so it runs outside a component.
function useStatus(g: Game, identity?: string | null): string {
  return useWordsHeaderModel(g, identity)!.status
}

describe('resigned status', () => {
  it('tells the resigner they resigned', () => {
    expect(useStatus(game(), 'id3')).toBe('You resigned')
  })

  it('tells the winner the opponent resigned', () => {
    expect(useStatus(game(), 'id2')).toBe('Opponent resigned — you win!')
  })

  it('names the resigner to a player who neither resigned nor won', () => {
    expect(useStatus(game(), 'id1')).toBe('Carol resigned')
  })

  it('names the resigner to the remaining non-winner as well', () => {
    expect(useStatus(game(), 'id4')).toBe('Carol resigned')
  })

  it('falls back to the player number when the identity is unknown', () => {
    expect(useStatus(game({ my_player_number: 3 }))).toBe('You resigned')
    expect(useStatus(game({ my_player_number: 1 }))).toBe('Carol resigned')
  })

  it('says only that the game is over when no writer was recorded', () => {
    expect(useStatus(game({ writer: undefined }), 'id1')).toBe('Game over')
  })

  it('says only that the game is over when the writer is not at the table', () => {
    expect(useStatus(game({ writer: 'stranger' }), 'id1')).toBe('Game over')
  })

  it('uses the seat number when the resigner has no name', () => {
    expect(useStatus(game({ player3_name: undefined }), 'id1')).toBe('Player 3 resigned')
  })

  it('still reads correctly with two seats', () => {
    const heads_up = game({ player_count: 2, winner: 'id1', writer: 'id2' })
    expect(useStatus(heads_up, 'id2')).toBe('You resigned')
    expect(useStatus(heads_up, 'id1')).toBe('Opponent resigned — you win!')
  })
})

describe('other statuses', () => {
  it('is unaffected on an active game', () => {
    expect(useStatus(game({ status: 'active', current_turn: 2 }), 'id1')).toBe("Bob's move")
    expect(useStatus(game({ status: 'active', current_turn: 1 }), 'id1')).toBe('Your move')
  })

  it('is unaffected on a finished game', () => {
    expect(useStatus(game({ status: 'finished' }), 'id2')).toBe('You win!')
    expect(useStatus(game({ status: 'finished' }), 'id1')).toBe('Bob wins')
  })
})
