// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

/* eslint-disable lingui/no-unlocalized-strings -- vitest names and the fake catalogue below are not user-facing */
import { describe, it, expect, vi } from 'vitest'
import { emptyBoard, type MoveErrorCode, type Placement } from '@/lib/words-engine'
import { deriveMoveDraft, type MoveErrorMessages } from './move-draft'

// The suite runs under the node environment (the engine it exercises is pure),
// but @mochi/web's barrel touches document at import time. Only naturalCompare
// is reachable from here, and nothing under test calls it.
vi.mock('@mochi/web', () => ({
  naturalCompare: (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
}))

// Stands in for the Lingui catalogue: every value is unmistakably not the
// English the engine used to throw, so a test passes only if the caller's
// text is what comes back.
const MESSAGES: MoveErrorMessages = {
  no_tiles: 'catalogue:no_tiles',
  out_of_bounds: 'catalogue:out_of_bounds',
  square_occupied: 'catalogue:square_occupied',
  not_in_line: 'catalogue:not_in_line',
  not_contiguous: 'catalogue:not_contiguous',
  first_move_centre: 'catalogue:first_move_centre',
  first_move_two_tiles: 'catalogue:first_move_two_tiles',
  not_connected: 'catalogue:not_connected',
  no_words: 'catalogue:no_words',
}

const FALLBACK = 'catalogue:fallback'

function draft(placements: Placement[], board = emptyBoard()) {
  return deriveMoveDraft(board, placements, MESSAGES, FALLBACK)
}

describe('deriveMoveDraft — rejection text', () => {
  // Each row is a rejection the composer renders whenever tiles are on the
  // board, which is most of the time a player is composing a word. Before the
  // engine carried codes these came back as the engine's English literals in
  // every locale, because getErrorMessage passes a non-empty error.message
  // through unchanged and so never reached the translated fallback.
  // no_tiles is absent deliberately: deriveMoveDraft answers 'empty' for an
  // empty placement list and never reaches the engine, so that code cannot
  // arrive here. words-engine.test.ts covers the throw itself.
  const cases: Array<[string, MoveErrorCode, Placement[], string[][] | undefined]> = [
    [
      'off the board',
      'out_of_bounds',
      [{ row: -1, col: 7, letter: 'A', rackTile: 'A' }],
      undefined,
    ],
    [
      'not in one line',
      'not_in_line',
      [
        { row: 7, col: 7, letter: 'A', rackTile: 'A' },
        { row: 8, col: 8, letter: 'B', rackTile: 'B' },
      ],
      undefined,
    ],
    [
      'gap between tiles',
      'not_contiguous',
      [
        { row: 7, col: 6, letter: 'A', rackTile: 'A' },
        { row: 7, col: 7, letter: 'B', rackTile: 'B' },
        { row: 7, col: 9, letter: 'C', rackTile: 'C' },
      ],
      undefined,
    ],
    [
      'first move misses the middle',
      'first_move_centre',
      [
        { row: 0, col: 0, letter: 'A', rackTile: 'A' },
        { row: 0, col: 1, letter: 'B', rackTile: 'B' },
      ],
      undefined,
    ],
    [
      'first move is a single tile',
      'first_move_two_tiles',
      [{ row: 7, col: 7, letter: 'A', rackTile: 'A' }],
      undefined,
    ],
  ]

  for (const [name, code, placements, board] of cases) {
    it(`renders the caller's text for ${name}`, () => {
      const result = draft(placements, board)
      expect(result.status).toBe('invalid_local')
      expect(result.errorMessage).toBe(MESSAGES[code])
    })
  }

  it('uses the caller text for an occupied square', () => {
    const board = emptyBoard()
    board[7][7] = 'A'
    const result = draft(
      [
        { row: 7, col: 7, letter: 'B', rackTile: 'B' },
        { row: 7, col: 8, letter: 'A', rackTile: 'A' },
      ],
      board
    )
    expect(result.errorMessage).toBe(MESSAGES.square_occupied)
  })

  it('uses the caller text when the move touches nothing', () => {
    const board = emptyBoard()
    board[7][7] = 'A'
    board[7][8] = 'B'
    const result = draft(
      [
        { row: 0, col: 0, letter: 'C', rackTile: 'C' },
        { row: 0, col: 1, letter: 'D', rackTile: 'D' },
      ],
      board
    )
    expect(result.errorMessage).toBe(MESSAGES.not_connected)
  })

  it('never surfaces the engine reason itself', () => {
    // The codes are internal. If one leaks to the composer the player sees
    // "not_in_line" rather than a sentence, which is worse than the English
    // this replaced.
    const result = draft([
      { row: 7, col: 7, letter: 'A', rackTile: 'A' },
      { row: 8, col: 8, letter: 'B', rackTile: 'B' },
    ])
    expect(result.errorMessage).not.toBe('not_in_line')
  })

  it('falls back for an error the engine did not raise', () => {
    // deriveMoveDraft must not assume every throw carries a code.
    const board = emptyBoard()
    // A malformed board makes the engine index into undefined.
    board[7] = undefined as unknown as string[]
    const result = draft([{ row: 7, col: 7, letter: 'A', rackTile: 'A' }], board)
    expect(result.status).toBe('invalid_local')
    expect(result.errorMessage).toBe(FALLBACK)
  })

  it('reports a legal move as ready with no message', () => {
    const result = draft([
      { row: 7, col: 7, letter: 'C', rackTile: 'C' },
      { row: 7, col: 8, letter: 'A', rackTile: 'A' },
      { row: 7, col: 9, letter: 'T', rackTile: 'T' },
    ])
    expect(result.status).toBe('ready')
    expect(result.errorMessage).toBeNull()
  })
})
