// Words game engine — board parsing, premium squares, scoring, word formation

export const BOARD_SIZE = 15

// Premium square types
export type PremiumType = '.' | 'DL' | 'TL' | 'DW' | 'TW' | 'ST'

// Standard Scrabble premium square layout (15x15)
// ST = center star (acts as DW on first move)
const PREMIUM_MAP: PremiumType[][] = [
  ['TW', '.', '.', 'DL', '.', '.', '.', 'TW', '.', '.', '.', 'DL', '.', '.', 'TW'],
  ['.', 'DW', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'DW', '.'],
  ['.', '.', 'DW', '.', '.', '.', 'DL', '.', 'DL', '.', '.', '.', 'DW', '.', '.'],
  ['DL', '.', '.', 'DW', '.', '.', '.', 'DL', '.', '.', '.', 'DW', '.', '.', 'DL'],
  ['.', '.', '.', '.', 'DW', '.', '.', '.', '.', '.', 'DW', '.', '.', '.', '.'],
  ['.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.'],
  ['.', '.', 'DL', '.', '.', '.', 'DL', '.', 'DL', '.', '.', '.', 'DL', '.', '.'],
  ['TW', '.', '.', 'DL', '.', '.', '.', 'ST', '.', '.', '.', 'DL', '.', '.', 'TW'],
  ['.', '.', 'DL', '.', '.', '.', 'DL', '.', 'DL', '.', '.', '.', 'DL', '.', '.'],
  ['.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.'],
  ['.', '.', '.', '.', 'DW', '.', '.', '.', '.', '.', 'DW', '.', '.', '.', '.'],
  ['DL', '.', '.', 'DW', '.', '.', '.', 'DL', '.', '.', '.', 'DW', '.', '.', 'DL'],
  ['.', '.', 'DW', '.', '.', '.', 'DL', '.', 'DL', '.', '.', '.', 'DW', '.', '.'],
  ['.', 'DW', '.', '.', '.', 'TL', '.', '.', '.', 'TL', '.', '.', '.', 'DW', '.'],
  ['TW', '.', '.', 'DL', '.', '.', '.', 'TW', '.', '.', '.', 'DL', '.', '.', 'TW'],
]

export function getPremium(row: number, col: number): PremiumType {
  return PREMIUM_MAP[row][col]
}

// Letter values (English)
const LETTER_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
}

export function getLetterValue(letter: string): number {
  // Lowercase letters are blanks (played as that letter but worth 0)
  if (letter >= 'a' && letter <= 'z') return 0
  return LETTER_VALUES[letter.toUpperCase()] ?? 0
}

// Board parsing

export function parseBoard(boardStr: string): string[][] {
  if (!boardStr) return emptyBoard()
  const rows = boardStr.split('/')
  if (rows.length !== BOARD_SIZE) return emptyBoard()
  return rows.map((row) => row.split(''))
}

export function serializeBoard(board: string[][]): string {
  return board.map((row) => row.join('')).join('/')
}

export function emptyBoard(): string[][] {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => '.')
  )
}

export function isBoardEmpty(board: string[][]): boolean {
  return board.every((row) => row.every((cell) => cell === '.'))
}

// Placement type
export interface Placement {
  row: number
  col: number
  letter: string     // uppercase letter to display on board
  rackTile: string   // the tile from the rack ('_' for blank, uppercase letter otherwise)
}

export interface ScoredWord {
  word: string
  score: number
  cells: [number, number][]
}

export interface MoveResult {
  newBoard: string[][]
  wordsFormed: ScoredWord[]
  totalScore: number
  tilesUsed: string  // rack tiles consumed (for server)
}

// Validate and score a move
export function validateAndScoreMove(
  board: string[][],
  placements: Placement[]
): MoveResult {
  if (placements.length === 0) {
    throw new Error('No tiles placed')
  }

  // Check all placements are on empty squares
  for (const p of placements) {
    if (p.row < 0 || p.row >= BOARD_SIZE || p.col < 0 || p.col >= BOARD_SIZE) {
      throw new Error('Placement out of bounds')
    }
    if (board[p.row][p.col] !== '.') {
      throw new Error('Square already occupied')
    }
  }

  // Check all placements are in a single row or column
  const rows = new Set(placements.map((p) => p.row))
  const cols = new Set(placements.map((p) => p.col))

  if (rows.size > 1 && cols.size > 1) {
    throw new Error('Tiles must be placed in a single row or column')
  }

  const isHorizontal = rows.size === 1

  // Sort placements by position
  const sorted = [...placements].sort((a, b) =>
    isHorizontal ? a.col - b.col : a.row - b.row
  )

  // Create new board with placements applied
  const newBoard = board.map((row) => [...row])
  const newlyPlaced = new Set<string>()
  for (const p of placements) {
    // Blanks stored as lowercase
    newBoard[p.row][p.col] = p.rackTile === '_' ? p.letter.toLowerCase() : p.letter.toUpperCase()
    newlyPlaced.add(`${p.row},${p.col}`)
  }

  // Check continuity: no gaps between placed tiles (existing tiles fill gaps)
  if (sorted.length > 1) {
    const start = isHorizontal ? sorted[0].col : sorted[0].row
    const end = isHorizontal ? sorted[sorted.length - 1].col : sorted[sorted.length - 1].row
    const fixedAxis = isHorizontal ? sorted[0].row : sorted[0].col

    for (let i = start; i <= end; i++) {
      const r = isHorizontal ? fixedAxis : i
      const c = isHorizontal ? i : fixedAxis
      if (newBoard[r][c] === '.') {
        throw new Error('Tiles must be contiguous (no gaps)')
      }
    }
  }

  // Check connectivity: must touch existing tiles (or center on first move)
  const boardIsEmpty = isBoardEmpty(board)
  if (boardIsEmpty) {
    // First move must cover center square (7,7)
    const coversCenter = placements.some((p) => p.row === 7 && p.col === 7)
    if (!coversCenter) {
      throw new Error('First move must cover the center square')
    }
    if (placements.length < 2) {
      throw new Error('First move must place at least 2 tiles')
    }
  } else {
    // Must connect to at least one existing tile
    let connected = false
    for (const p of placements) {
      const neighbors = [
        [p.row - 1, p.col], [p.row + 1, p.col],
        [p.row, p.col - 1], [p.row, p.col + 1],
      ]
      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          if (board[nr][nc] !== '.') {
            connected = true
            break
          }
        }
      }
      if (connected) break
    }
    if (!connected) {
      throw new Error('Tiles must connect to existing tiles on the board')
    }
  }

  // Find all words formed
  const wordsFormed: ScoredWord[] = []

  // Find the main word (along the direction of placement)
  const mainWord = findWord(newBoard, sorted[0].row, sorted[0].col, isHorizontal, newlyPlaced)
  if (mainWord && mainWord.word.length >= 2) {
    wordsFormed.push(mainWord)
  }

  // Find cross-words (perpendicular words formed by each placed tile)
  for (const p of placements) {
    const crossWord = findWord(newBoard, p.row, p.col, !isHorizontal, newlyPlaced)
    if (crossWord && crossWord.word.length >= 2) {
      wordsFormed.push(crossWord)
    }
  }

  if (wordsFormed.length === 0) {
    throw new Error('No valid words formed')
  }

  let totalScore = wordsFormed.reduce((sum, w) => sum + w.score, 0)

  // 50-point bonus for using all 7 tiles
  if (placements.length === 7) {
    totalScore += 50
  }

  // Build tiles_used string (rack tiles consumed)
  const tilesUsed = placements.map((p) => p.rackTile).join('')

  return { newBoard, wordsFormed, totalScore, tilesUsed }
}

function findWord(
  board: string[][],
  row: number,
  col: number,
  horizontal: boolean,
  newlyPlaced: Set<string>
): ScoredWord | null {
  // Find the start of the word
  let r = row
  let c = col
  if (horizontal) {
    while (c > 0 && board[r][c - 1] !== '.') c--
  } else {
    while (r > 0 && board[r - 1][c] !== '.') r--
  }

  // Collect the word
  const cells: [number, number][] = []
  let word = ''
  let wordScore = 0
  let wordMultiplier = 1
  let cr = r
  let cc = c

  while (cr < BOARD_SIZE && cc < BOARD_SIZE && board[cr][cc] !== '.') {
    const cellLetter = board[cr][cc]
    const displayLetter = cellLetter.toUpperCase()
    word += displayLetter
    cells.push([cr, cc])

    const isNew = newlyPlaced.has(`${cr},${cc}`)
    const letterValue = getLetterValue(cellLetter)

    if (isNew) {
      const premium = getPremium(cr, cc)
      switch (premium) {
        case 'DL':
          wordScore += letterValue * 2
          break
        case 'TL':
          wordScore += letterValue * 3
          break
        case 'DW':
        case 'ST':
          wordScore += letterValue
          wordMultiplier *= 2
          break
        case 'TW':
          wordScore += letterValue
          wordMultiplier *= 3
          break
        default:
          wordScore += letterValue
      }
    } else {
      wordScore += letterValue
    }

    if (horizontal) cc++
    else cr++
  }

  if (word.length < 2) return null

  return {
    word,
    score: wordScore * wordMultiplier,
    cells,
  }
}

// Utility: get display letter for a cell (uppercase, whether blank or not)
export function getDisplayLetter(cell: string): string {
  if (cell === '.') return ''
  return cell.toUpperCase()
}

// Check if a cell is a blank tile (lowercase = blank played as that letter)
export function isBlankTile(cell: string): boolean {
  return cell >= 'a' && cell <= 'z'
}
