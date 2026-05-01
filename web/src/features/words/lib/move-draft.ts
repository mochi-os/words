import { naturalCompare } from '@mochi/web'
import {
  type MoveResult,
  type Placement,
  type ScoredWord,
  validateAndScoreMove,
} from '@/lib/words-engine'

export type DraftWordValidationState =
  | 'checking'
  | 'valid'
  | 'invalid'
  | 'unknown'

export type MoveDraftStatus =
  | 'empty'
  | 'invalid_local'
  | 'ready'
  | 'checking'
  | 'ready_with_invalid_words'
  | 'validation_unavailable'

export type MoveDraftBase =
  | { status: 'empty'; errorMessage: null; result: null }
  | { status: 'invalid_local'; errorMessage: string; result: null }
  | { status: 'ready'; errorMessage: null; result: MoveResult }

interface ResolveMoveDraftStatusArgs {
  baseStatus: MoveDraftBase['status']
  hasInvalidWords: boolean
  hasValidationUnavailable: boolean
  isValidationChecking: boolean
}

export function deriveMoveDraft(
  board: string[][],
  placements: readonly Placement[]
): MoveDraftBase {
  if (placements.length === 0) {
    return { status: 'empty', errorMessage: null, result: null }
  }

  try {
    const result = validateAndScoreMove(board, [...placements])
    return { status: 'ready', errorMessage: null, result }
  } catch (error) {
    return {
      status: 'invalid_local',
      errorMessage: getErrorMessage(error),
      result: null,
    }
  }
}

export function resolveMoveDraftStatus({
  baseStatus,
  hasInvalidWords,
  hasValidationUnavailable,
  isValidationChecking,
}: ResolveMoveDraftStatusArgs): MoveDraftStatus {
  if (baseStatus !== 'ready') {
    return baseStatus
  }
  if (isValidationChecking) {
    return 'checking'
  }
  if (hasValidationUnavailable) {
    return 'validation_unavailable'
  }
  if (hasInvalidWords) {
    return 'ready_with_invalid_words'
  }
  return 'ready'
}

export function getUniqueDraftWords(wordsFormed: readonly ScoredWord[]): string[] {
  const uniqueWords = new Set<string>()
  for (const entry of wordsFormed) {
    if (entry.word) {
      uniqueWords.add(entry.word.toUpperCase())
    }
  }
  return [...uniqueWords]
}

export function hasInvalidValidatedWords(
  wordsFormed: readonly ScoredWord[],
  wordValidationState: Readonly<Record<string, DraftWordValidationState>>
): boolean {
  return wordsFormed.some(
    ({ word }) => wordValidationState[word.toUpperCase()] === 'invalid'
  )
}

export function createDraftSignature(
  boardRevision: string,
  placements: readonly Placement[]
): string {
  const orderedPlacements = [...placements]
    .sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row
      if (a.col !== b.col) return a.col - b.col
      if (a.letter !== b.letter) return naturalCompare(a.letter, b.letter)
      return naturalCompare(a.rackTile, b.rackTile)
    })
    .map((placement) =>
      `${placement.row},${placement.col},${placement.letter},${placement.rackTile}`
    )
    .join('|')

  return `${boardRevision}::${orderedPlacements}`
}

export function shouldApplyValidationResult(
  activeSignature: string,
  resultSignature: string
): boolean {
  return activeSignature === resultSignature
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Invalid move'
}
