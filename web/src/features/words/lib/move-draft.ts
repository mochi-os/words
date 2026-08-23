// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { naturalCompare } from '@mochi/web'
import {
  type MoveErrorCode,
  type MoveResult,
  type Placement,
  type ScoredWord,
  moveErrorCode,
  validateAndScoreMove,
} from '@/lib/words-engine'

// Translated text for each engine rejection, supplied by the component that
// has the Lingui context.
export type MoveErrorMessages = Readonly<Record<MoveErrorCode, string>>

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
  placements: readonly Placement[],
  messages: MoveErrorMessages,
  invalidMoveFallback: string,
): MoveDraftBase {
  if (placements.length === 0) {
    return { status: 'empty', errorMessage: null, result: null }
  }

  try {
    const result = validateAndScoreMove(board, [...placements])
    return { status: 'ready', errorMessage: null, result }
  } catch (error) {
    // A rejection the engine names gets the caller's translated text. Anything
    // else is a programming error, and its JavaScript message is both
    // untranslatable and meaningless to a player, so it gets the fallback
    // rather than being passed through.
    const code = moveErrorCode(error)
    return {
      status: 'invalid_local',
      errorMessage: code ? messages[code] : invalidMoveFallback,
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

// Translated text for each badge state, supplied by the component that has the
// Lingui context. `waiting` is not a draft status: an empty draft on the
// opponent's turn reads differently from an empty draft on your own.
export type MoveStatusMessages = Readonly<Record<MoveDraftStatus | 'waiting', string>>

export function getMoveStatusLabel(
  status: MoveDraftStatus,
  isMyTurn: boolean,
  messages: MoveStatusMessages
): string {
  if (!isMyTurn && status === 'empty') {
    return messages.waiting
  }
  return messages[status]
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

