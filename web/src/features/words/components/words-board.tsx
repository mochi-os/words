import { useCallback } from 'react'
import { cn } from '@mochi/common'
import {
  BOARD_SIZE,
  getPremium,
  getLetterValue,
  getDisplayLetter,
  isBlankTile,
  type Placement,
  type PremiumType,
} from '@/lib/words-engine'

const PREMIUM_STYLES: Record<PremiumType, { bg: string; label: string; textColor: string }> = {
  'TW': { bg: 'bg-red-600 dark:bg-red-700', label: 'TW', textColor: 'text-white' },
  'DW': { bg: 'bg-rose-300 dark:bg-rose-800', label: 'DW', textColor: 'text-rose-800 dark:text-rose-200' },
  'TL': { bg: 'bg-blue-500 dark:bg-blue-700', label: 'TL', textColor: 'text-white' },
  'DL': { bg: 'bg-sky-300 dark:bg-sky-700', label: 'DL', textColor: 'text-sky-800 dark:text-sky-200' },
  'ST': { bg: 'bg-rose-300 dark:bg-rose-800', label: '', textColor: 'text-rose-800 dark:text-rose-200' },
  '.': { bg: '', label: '', textColor: '' },
}

interface WordsBoardProps {
  board: string[][]
  pendingPlacements: Placement[]
  selectedRackIndex: number | null
  isMyTurn: boolean
  gameStatus: string
  onCellClick: (row: number, col: number) => void
  onRemovePlacement: (row: number, col: number) => void
}

export function WordsBoard({
  board,
  pendingPlacements,
  selectedRackIndex,
  isMyTurn,
  gameStatus,
  onCellClick,
  onRemovePlacement,
}: WordsBoardProps) {
  const isActive = gameStatus === 'active'
  const canPlace = isActive && isMyTurn && selectedRackIndex !== null

  const getPending = useCallback(
    (row: number, col: number) =>
      pendingPlacements.find((p) => p.row === row && p.col === col),
    [pendingPlacements]
  )

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: 'min(100%, calc(100dvh - 260px))' }}
    >
      <div
        className="grid aspect-square w-full gap-px bg-neutral-400 dark:bg-neutral-600 rounded border border-neutral-400 dark:border-neutral-600"
        style={{
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
        }}
      >
        {Array.from({ length: BOARD_SIZE }).map((_, row) =>
          Array.from({ length: BOARD_SIZE }).map((_, col) => {
            const cellValue = board[row][col]
            const pending = getPending(row, col)
            const premium = getPremium(row, col)
            const premiumStyle = PREMIUM_STYLES[premium]
            const isEmpty = cellValue === '.' && !pending
            const isOccupied = cellValue !== '.'
            const isPending = !!pending

            let displayLetter = ''
            let letterValue = 0
            let isBlank = false

            if (isPending) {
              displayLetter = pending.letter.toUpperCase()
              letterValue = pending.rackTile === '_' ? 0 : getLetterValue(pending.letter)
              isBlank = pending.rackTile === '_'
            } else if (isOccupied) {
              displayLetter = getDisplayLetter(cellValue)
              letterValue = getLetterValue(cellValue)
              isBlank = isBlankTile(cellValue)
            }

            const canClickToPlace = canPlace && isEmpty
            const canClickToRemove = isPending

            return (
              <button
                key={`${row}-${col}`}
                type="button"
                className={cn(
                  'relative flex items-center justify-center text-xs font-bold select-none overflow-hidden',
                  isEmpty && !premiumStyle.bg && 'bg-amber-50 dark:bg-amber-950/30',
                  isEmpty && premiumStyle.bg && premiumStyle.bg,
                  isOccupied && 'bg-amber-100 dark:bg-amber-900/60',
                  isPending && 'bg-amber-200 dark:bg-amber-800 ring-2 ring-amber-500 ring-inset',
                  canClickToPlace && 'cursor-pointer hover:bg-amber-200/50 dark:hover:bg-amber-800/50',
                  canClickToRemove && 'cursor-pointer',
                  !canClickToPlace && !canClickToRemove && 'cursor-default',
                )}
                onClick={() => {
                  if (canClickToRemove) {
                    onRemovePlacement(row, col)
                  } else if (canClickToPlace) {
                    onCellClick(row, col)
                  }
                }}
                disabled={!canClickToPlace && !canClickToRemove}
              >
                {isEmpty && premiumStyle.label && (
                  <span className={cn('text-[9px] font-semibold leading-none', premiumStyle.textColor)}>
                    {premiumStyle.label}
                  </span>
                )}

                {isEmpty && premium === 'ST' && (
                  <span className={cn('text-base leading-none', premiumStyle.textColor)}>
                    {'\u2605'}
                  </span>
                )}

                {(isOccupied || isPending) && (
                  <>
                    <span className={cn(
                      'text-sm font-bold leading-none',
                      isBlank && 'text-gray-500 dark:text-gray-400',
                    )}>
                      {displayLetter}
                    </span>
                    {letterValue > 0 && (
                      <span className="absolute right-0.5 bottom-0 text-[7px] font-medium text-gray-600 dark:text-gray-400 leading-none">
                        {letterValue}
                      </span>
                    )}
                  </>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
