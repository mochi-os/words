import { describe, it, expect } from 'vitest'
import {
  BOARD_SIZE,
  parseBoard,
  serializeBoard,
  emptyBoard,
  isBoardEmpty,
  getLetterValue,
  getPremium,
  validateAndScoreMove,
  getDisplayLetter,
  isBlankTile,
  type Placement,
} from './words-engine'

// Helpers

function makeEmptyBoard(): string[][] {
  return emptyBoard()
}

function placeOnBoard(board: string[][], row: number, col: number, letter: string): string[][] {
  const b = board.map((r) => [...r])
  b[row][col] = letter
  return b
}

// ─── Board parsing ───────────────────────────────────────────────

describe('parseBoard', () => {
  it('roundtrips with serializeBoard', () => {
    const board = makeEmptyBoard()
    board[7][7] = 'A'
    board[7][8] = 'b' // blank
    board[0][0] = 'Z'
    const serialized = serializeBoard(board)
    const parsed = parseBoard(serialized)
    expect(parsed).toEqual(board)
  })

  it('returns empty 15x15 board for empty string', () => {
    const board = parseBoard('')
    expect(board.length).toBe(BOARD_SIZE)
    expect(board[0].length).toBe(BOARD_SIZE)
    expect(isBoardEmpty(board)).toBe(true)
  })

  it('returns empty board for malformed input (wrong row count)', () => {
    const board = parseBoard('abc/def')
    expect(board.length).toBe(BOARD_SIZE)
    expect(isBoardEmpty(board)).toBe(true)
  })
})

describe('isBoardEmpty', () => {
  it('returns true for empty board', () => {
    expect(isBoardEmpty(makeEmptyBoard())).toBe(true)
  })

  it('returns false after placing a tile', () => {
    const board = placeOnBoard(makeEmptyBoard(), 7, 7, 'A')
    expect(isBoardEmpty(board)).toBe(false)
  })
})

// ─── Letter values ───────────────────────────────────────────────

describe('getLetterValue', () => {
  it('returns correct values for standard letters', () => {
    expect(getLetterValue('A')).toBe(1)
    expect(getLetterValue('B')).toBe(3)
    expect(getLetterValue('D')).toBe(2)
    expect(getLetterValue('E')).toBe(1)
    expect(getLetterValue('Q')).toBe(10)
    expect(getLetterValue('Z')).toBe(10)
    expect(getLetterValue('K')).toBe(5)
    expect(getLetterValue('J')).toBe(8)
    expect(getLetterValue('X')).toBe(8)
  })

  it('returns 0 for blank tiles (lowercase)', () => {
    expect(getLetterValue('a')).toBe(0)
    expect(getLetterValue('z')).toBe(0)
    expect(getLetterValue('q')).toBe(0)
  })

  it('returns 0 for unknown characters', () => {
    expect(getLetterValue('.')).toBe(0)
    expect(getLetterValue('1')).toBe(0)
    expect(getLetterValue('!')).toBe(0)
  })
})

// ─── Premium squares ────────────────────────────────────────────

describe('getPremium', () => {
  it('corners are TW', () => {
    expect(getPremium(0, 0)).toBe('TW')
    expect(getPremium(0, 14)).toBe('TW')
    expect(getPremium(14, 0)).toBe('TW')
    expect(getPremium(14, 14)).toBe('TW')
  })

  it('center is ST', () => {
    expect(getPremium(7, 7)).toBe('ST')
  })

  it('DW squares', () => {
    expect(getPremium(1, 1)).toBe('DW')
    expect(getPremium(2, 2)).toBe('DW')
    expect(getPremium(3, 3)).toBe('DW')
    expect(getPremium(4, 4)).toBe('DW')
  })

  it('DL squares', () => {
    expect(getPremium(0, 3)).toBe('DL')
    expect(getPremium(2, 6)).toBe('DL')
    expect(getPremium(6, 2)).toBe('DL')
  })

  it('TL squares', () => {
    expect(getPremium(1, 5)).toBe('TL')
    expect(getPremium(5, 1)).toBe('TL')
    expect(getPremium(5, 5)).toBe('TL')
  })

  it('normal squares are .', () => {
    expect(getPremium(0, 1)).toBe('.')
    expect(getPremium(1, 0)).toBe('.')
    expect(getPremium(0, 2)).toBe('.')
  })
})

// ─── validateAndScoreMove — validation ──────────────────────────

describe('validateAndScoreMove — validation', () => {
  it('throws on empty placements', () => {
    expect(() => validateAndScoreMove(makeEmptyBoard(), [])).toThrow('No tiles placed')
  })

  it('throws on out of bounds placement', () => {
    const p: Placement[] = [{ row: -1, col: 7, letter: 'A', rackTile: 'A' }]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('out of bounds')
  })

  it('throws on out of bounds (too large)', () => {
    const p: Placement[] = [{ row: 7, col: 15, letter: 'A', rackTile: 'A' }]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('out of bounds')
  })

  it('throws on occupied square', () => {
    const board = placeOnBoard(makeEmptyBoard(), 7, 7, 'A')
    const p: Placement[] = [
      { row: 7, col: 7, letter: 'B', rackTile: 'B' },
      { row: 7, col: 8, letter: 'A', rackTile: 'A' },
    ]
    expect(() => validateAndScoreMove(board, p)).toThrow('already occupied')
  })

  it('throws when tiles not in single row/column', () => {
    const p: Placement[] = [
      { row: 7, col: 7, letter: 'A', rackTile: 'A' },
      { row: 8, col: 8, letter: 'B', rackTile: 'B' },
    ]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('single row or column')
  })

  it('throws on gap between tiles', () => {
    const p: Placement[] = [
      { row: 7, col: 6, letter: 'A', rackTile: 'A' },
      { row: 7, col: 7, letter: 'B', rackTile: 'B' },
      { row: 7, col: 9, letter: 'C', rackTile: 'C' },
    ]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('contiguous')
  })

  it('first move must cover center (7,7)', () => {
    const p: Placement[] = [
      { row: 0, col: 0, letter: 'A', rackTile: 'A' },
      { row: 0, col: 1, letter: 'B', rackTile: 'B' },
    ]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('center square')
  })

  it('first move must place at least 2 tiles', () => {
    const p: Placement[] = [{ row: 7, col: 7, letter: 'A', rackTile: 'A' }]
    expect(() => validateAndScoreMove(makeEmptyBoard(), p)).toThrow('at least 2 tiles')
  })

  it('subsequent move must connect to existing tiles', () => {
    const board = placeOnBoard(makeEmptyBoard(), 7, 7, 'A')
    board[7][8] = 'B'
    const p: Placement[] = [
      { row: 0, col: 0, letter: 'C', rackTile: 'C' },
      { row: 0, col: 1, letter: 'D', rackTile: 'D' },
    ]
    expect(() => validateAndScoreMove(board, p)).toThrow('connect to existing')
  })
})

// ─── validateAndScoreMove — scoring ─────────────────────────────

describe('validateAndScoreMove — scoring', () => {
  it('scores simple word on normal squares', () => {
    // Place AT on center: A(1) + T(1) = 2, center is ST (DW) so 2*2 = 4
    // Actually center is ST which acts as DW, so word multiplier = 2
    const board = makeEmptyBoard()
    const placements: Placement[] = [
      { row: 7, col: 7, letter: 'A', rackTile: 'A' },
      { row: 7, col: 8, letter: 'T', rackTile: 'T' },
    ]
    const result = validateAndScoreMove(board, placements)
    // A on ST(DW): value 1, wordMultiplier *=2
    // T on normal: value 1
    // Total: (1+1)*2 = 4
    expect(result.totalScore).toBe(4)
    expect(result.wordsFormed.length).toBe(1)
    expect(result.wordsFormed[0].word).toBe('AT')
  })

  it('scores word on DL square (letter doubled)', () => {
    // Place a word where a new tile lands on DL
    // (0,3) is DL — need existing tiles to connect there
    // Use board with existing tiles at row 0, cols 1-2, place at col 3 (DL)
    const board = makeEmptyBoard()
    board[0][1] = 'A' // existing
    board[0][2] = 'T' // existing
    const placements: Placement[] = [
      { row: 0, col: 3, letter: 'E', rackTile: 'E' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: ATE
    // A (existing, col 1, normal): 1
    // T (existing, col 2, normal): 1
    // E (new, col 3, DL): 1*2 = 2
    // Total: 1+1+2 = 4
    expect(result.totalScore).toBe(4)
    expect(result.wordsFormed[0].word).toBe('ATE')
  })

  it('scores word on TL square (letter tripled)', () => {
    // (1,5) is TL
    const board = makeEmptyBoard()
    board[1][3] = 'G'
    board[1][4] = 'O'
    const placements: Placement[] = [
      { row: 1, col: 5, letter: 'T', rackTile: 'T' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: GOT
    // G (existing): 2, O (existing): 1, T (new, TL): 1*3 = 3
    // Total: 2+1+3 = 6
    expect(result.totalScore).toBe(6)
    expect(result.wordsFormed[0].word).toBe('GOT')
  })

  it('scores word on DW square (word doubled)', () => {
    // (1,1) is DW
    const board = makeEmptyBoard()
    board[1][2] = 'O' // existing
    const placements: Placement[] = [
      { row: 1, col: 1, letter: 'G', rackTile: 'G' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: GO
    // G (new, DW): 2, wordMultiplier = 2
    // O (existing): 1
    // Total: (2+1)*2 = 6
    expect(result.totalScore).toBe(6)
  })

  it('scores word on TW square (word tripled)', () => {
    // (0,0) is TW
    const board = makeEmptyBoard()
    board[0][1] = 'O' // existing
    const placements: Placement[] = [
      { row: 0, col: 0, letter: 'G', rackTile: 'G' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: GO
    // G (new, TW): 2, wordMultiplier = 3
    // O (existing): 1
    // Total: (2+1)*3 = 9
    expect(result.totalScore).toBe(9)
  })

  it('premiums only apply to newly placed tiles', () => {
    // Place tile next to an existing tile on a premium square
    // The existing tile's premium should NOT count again
    const board = makeEmptyBoard()
    // Put A on (0,0) TW — already placed
    board[0][0] = 'A'
    const placements: Placement[] = [
      { row: 0, col: 1, letter: 'T', rackTile: 'T' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: AT
    // A (existing, TW — but not new!): 1
    // T (new, normal): 1
    // Total: 1+1 = 2 (no multiplier from existing TW)
    expect(result.totalScore).toBe(2)
  })

  it('stacks word multipliers (two DW = 4x)', () => {
    // (1,1) and (2,2) are both DW
    // Place both in one move, need vertical word through them
    // Actually we need a diagonal... they're on a diagonal not in a line
    // Let's use (3,3) DW and (4,4) DW — still diagonal
    // Better: use (1,1) DW and (1,13) DW — same row
    // Actually row 1: (1,1)=DW, (1,13)=DW, with tiles between
    // That's too far apart, need existing tiles to fill gap
    // Simpler: first move on center covers ST(DW at 7,7), place another on (3,3)DW via vertical
    // Let's do: existing tiles from (2,2) to (4,4) col=2 vertical
    // (2,2) is DW, (4,4) is DW — different columns
    // Let me think... (2,2) DW, (3,3) DW are diagonal
    // Actually let's just test with existing board state:
    // Row 4: (4,4) is DW, (4,10) is DW
    // Place a word from col 4 to col 10 in row 4 with existing tiles in between
    const board = makeEmptyBoard()
    board[4][5] = 'A'
    board[4][6] = 'B'
    board[4][7] = 'C'
    board[4][8] = 'D'
    board[4][9] = 'E'
    const placements: Placement[] = [
      { row: 4, col: 4, letter: 'F', rackTile: 'F' },  // DW
      { row: 4, col: 10, letter: 'G', rackTile: 'G' }, // DW
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: FABCDEG
    // F (new, DW): 4, multiplier *=2
    // A (existing): 1
    // B (existing): 3
    // C (existing): 3
    // D (existing): 2
    // E (existing): 1
    // G (new, DW): 2, multiplier *=2
    // Total: (4+1+3+3+2+1+2) * 4 = 16 * 4 = 64
    expect(result.totalScore).toBe(64)
  })

  it('scores cross-words separately', () => {
    // Existing horizontal word, place a vertical word that crosses it
    const board = makeEmptyBoard()
    board[7][7] = 'A'
    board[7][8] = 'T'
    // Place vertically at col 7: row 6 and row 8
    const placements: Placement[] = [
      { row: 6, col: 7, letter: 'C', rackTile: 'C' },
      { row: 8, col: 7, letter: 'E', rackTile: 'E' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Main vertical word: CAE (C at 6,7 + A at 7,7 + E at 8,7)
    // (6,7) is normal: C=3, (7,7) existing A: 1, (8,7) is normal: E=1
    // Vertical score: 3+1+1 = 5
    expect(result.wordsFormed.length).toBe(1)
    expect(result.wordsFormed[0].word).toBe('CAE')
    expect(result.totalScore).toBe(5)
  })

  it('scores cross-words when tile extends perpendicular words', () => {
    // Existing: H at (7,7), I at (7,8) (horizontal "HI")
    // Existing: A at (6,8) (above I)
    // Place: T at (8,8) (below I) — forms vertical word AIT, and no new horizontal word
    const board = makeEmptyBoard()
    board[7][7] = 'H'
    board[7][8] = 'I'
    board[6][8] = 'A'
    const placements: Placement[] = [
      { row: 8, col: 8, letter: 'T', rackTile: 'T' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Vertical cross-word: AIT (A at 6,8 + I at 7,8 + T at 8,8)
    // A (existing): 1, I (existing): 1, T (new, DL at 8,8 — check: (8,6) is DL but (8,8) is .)
    // Actually check PREMIUM_MAP row 8: ['.', '.', 'DL', '.', '.', '.', 'DL', '.', 'DL', '.', '.', '.', 'DL', '.', '.']
    // (8,8) is DL!
    // T (new, DL): 1*2=2
    // Vertical: 1+1+2 = 4
    expect(result.wordsFormed.length).toBe(1)
    expect(result.wordsFormed[0].word).toBe('AIT')
    expect(result.totalScore).toBe(4)
  })

  it('awards 50-point bingo bonus for using all 7 tiles', () => {
    const board = makeEmptyBoard()
    const placements: Placement[] = [
      { row: 7, col: 4, letter: 'S', rackTile: 'S' },
      { row: 7, col: 5, letter: 'T', rackTile: 'T' },
      { row: 7, col: 6, letter: 'A', rackTile: 'A' },
      { row: 7, col: 7, letter: 'R', rackTile: 'R' },
      { row: 7, col: 8, letter: 'T', rackTile: 'T' },
      { row: 7, col: 9, letter: 'E', rackTile: 'E' },
      { row: 7, col: 10, letter: 'D', rackTile: 'D' },
    ]
    const result = validateAndScoreMove(board, placements)
    // Word: STARTED across row 7
    // Row 7 premiums: TW . . DL . . . ST . . . DL . . TW
    // (7,4): S=1, normal
    // (7,5): T=1, normal
    // (7,6): A=1, normal
    // (7,7): R=1, ST(DW) → wordMult *=2
    // (7,8): T=1, normal
    // (7,9): E=1, normal
    // (7,10): D=2, normal
    // rawScore: 1+1+1+1+1+1+2 = 8, multiplier=2 → 16
    // + 50 bingo bonus = 66
    expect(result.totalScore).toBe(66)
    expect(result.wordsFormed[0].word).toBe('STARTED')
  })

  it('blank tiles contribute 0 to score', () => {
    const board = makeEmptyBoard()
    // Place blank A and normal T on center
    const placements: Placement[] = [
      { row: 7, col: 7, letter: 'A', rackTile: '_' }, // blank played as A
      { row: 7, col: 8, letter: 'T', rackTile: 'T' },
    ]
    const result = validateAndScoreMove(board, placements)
    // blank A (stored lowercase 'a'): value 0, on ST(DW): wordMult *=2
    // T on normal: 1
    // Total: (0+1)*2 = 2
    expect(result.totalScore).toBe(2)
  })
})

// ─── Display helpers ─────────────────────────────────────────────

describe('getDisplayLetter', () => {
  it('returns uppercase letter for uppercase cell', () => {
    expect(getDisplayLetter('A')).toBe('A')
    expect(getDisplayLetter('Z')).toBe('Z')
  })

  it('returns uppercase for blank tile (lowercase cell)', () => {
    expect(getDisplayLetter('a')).toBe('A')
    expect(getDisplayLetter('z')).toBe('Z')
  })

  it('returns empty string for empty cell', () => {
    expect(getDisplayLetter('.')).toBe('')
  })
})

describe('isBlankTile', () => {
  it('returns false for uppercase letters', () => {
    expect(isBlankTile('A')).toBe(false)
    expect(isBlankTile('Z')).toBe(false)
  })

  it('returns true for lowercase letters', () => {
    expect(isBlankTile('a')).toBe(true)
    expect(isBlankTile('z')).toBe(true)
  })

  it('returns false for empty cell', () => {
    expect(isBlankTile('.')).toBe(false)
  })
})
