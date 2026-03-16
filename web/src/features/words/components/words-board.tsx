import { useCallback, useMemo, useRef } from 'react'
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
  'TW': { bg: 'bg-red-300 dark:bg-red-900/50', label: 'TW', textColor: 'text-red-500 dark:text-red-400' },
  'DW': { bg: 'bg-rose-200 dark:bg-rose-900/40', label: 'DW', textColor: 'text-rose-400 dark:text-rose-500' },
  'TL': { bg: 'bg-blue-200 dark:bg-blue-900/40', label: 'TL', textColor: 'text-blue-400 dark:text-blue-400' },
  'DL': { bg: 'bg-sky-200 dark:bg-sky-900/40', label: 'DL', textColor: 'text-sky-400 dark:text-sky-400' },
  'ST': { bg: 'bg-rose-200 dark:bg-rose-900/40', label: '', textColor: 'text-rose-400 dark:text-rose-500' },
  '.': { bg: '', label: '', textColor: '' },
}

type DragSource =
  | { type: 'rack'; index: number }
  | { type: 'board'; row: number; col: number }
  | null

interface WordsBoardProps {
  board: string[][]
  pendingPlacements: Placement[]
  selectedRackIndex: number | null
  isMyTurn: boolean
  gameStatus: string
  onCellClick: (row: number, col: number) => void
  onRemovePlacement: (row: number, col: number) => void
  dragSource?: DragSource
  onDrop?: (row: number, col: number) => void
  onBoardDragStart?: (row: number, col: number) => void
  onDragEnd?: () => void
}

export function WordsBoard({
  board,
  pendingPlacements,
  selectedRackIndex,
  isMyTurn,
  gameStatus,
  onCellClick,
  onRemovePlacement,
  dragSource,
  onDrop,
  onBoardDragStart,
  onDragEnd,
}: WordsBoardProps) {
  const isActive = gameStatus === 'active'
  const canPlace = isActive && isMyTurn && selectedRackIndex !== null
  const isDragging = dragSource !== null && dragSource !== undefined
  const canDrop = isActive && isMyTurn && isDragging

  const getPending = useCallback(
    (row: number, col: number) =>
      pendingPlacements.find((p) => p.row === row && p.col === col),
    [pendingPlacements]
  )

  // Is this the first move of the game? (board entirely empty, no pending placements yet)
  const isBoardEmpty = useMemo(() =>
    board.every((row) => row.every((cell) => cell === '.')),
    [board]
  )
  const center = Math.floor(BOARD_SIZE / 2)

  // When dragging from board, filter out the dragged tile for validLine
  const effectivePlacements = useMemo(() => {
    if (dragSource?.type === 'board') {
      return pendingPlacements.filter(
        (p) => !(p.row === dragSource.row && p.col === dragSource.col)
      )
    }
    return pendingPlacements
  }, [pendingPlacements, dragSource])

  // Determine which row/col are valid for the next placement
  const validLine = useMemo(() => {
    if (effectivePlacements.length === 0) {
      if (isBoardEmpty) {
        // First move: must pass through center — only center row or col
        return { row: center, col: center }
      }
      return null // any empty cell is valid
    }
    if (effectivePlacements.length === 1) {
      return { row: effectivePlacements[0].row, col: effectivePlacements[0].col }
    }
    // 2+ placements: direction is locked
    const allSameRow = effectivePlacements.every((p) => p.row === effectivePlacements[0].row)
    if (allSameRow) return { row: effectivePlacements[0].row, col: null }
    return { row: null, col: effectivePlacements[0].col }
  }, [effectivePlacements, isBoardEmpty, center])

  const isValidLineCell = useCallback(
    (row: number, col: number) => {
      if (!validLine) return true
      if (validLine.row !== null && validLine.col !== null) return validLine.row === row || validLine.col === col
      if (validLine.row !== null && validLine.col === null) return validLine.row === row
      if (validLine.col !== null && validLine.row === null) return validLine.col === col
      return true
    },
    [validLine]
  )

  const isDroppableCell = useCallback(
    (row: number, col: number) => {
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return false
      if (board[row][col] !== '.') return false
      if (getPending(row, col)) return false
      return true
    },
    [board, getPending]
  )

  const gridRef = useRef<HTMLDivElement>(null)

  const cellFromPointer = useCallback(
    (e: React.DragEvent) => {
      const grid = gridRef.current
      if (!grid) return null
      const rect = grid.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const col = Math.floor((x / rect.width) * BOARD_SIZE)
      const row = Math.floor((y / rect.height) * BOARD_SIZE)
      if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null
      return { row, col }
    },
    []
  )

  return (
    <div
      className="mx-auto w-full"
      style={{ maxWidth: 'min(100%, calc(100dvh - 178px))' }}
    >
      <div
        ref={gridRef}
        className="grid aspect-square w-full gap-px bg-neutral-300 dark:bg-neutral-700 rounded border border-neutral-300 dark:border-neutral-700"
        style={{
          gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
          gridTemplateRows: `repeat(${BOARD_SIZE}, 1fr)`,
        }}
        onDragOver={(e) => {
          if (!canDrop) return
          const cell = cellFromPointer(e)
          if (cell && isDroppableCell(cell.row, cell.col)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(e) => {
          if (!canDrop) return
          const cell = cellFromPointer(e)
          if (cell && isDroppableCell(cell.row, cell.col)) {
            e.preventDefault()
            onDrop?.(cell.row, cell.col)
          }
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
            const canClickToRemove = isPending && !isDragging
            const canAcceptDrop = canDrop && isEmpty
            const isDropTarget = canAcceptDrop && isValidLineCell(row, col)
            const isPlaceTarget = canClickToPlace && isValidLineCell(row, col)
            const isValidTarget = isDropTarget || isPlaceTarget
            const canDragThis = isActive && isMyTurn && isPending
            const isBeingDragged = dragSource?.type === 'board' && dragSource.row === row && dragSource.col === col

            return (
              <div
                key={`${row}-${col}`}
                role="button"
                tabIndex={canClickToPlace || canClickToRemove || canAcceptDrop ? 0 : -1}
                draggable={canDragThis}
                onDragStart={(e) => {
                  if (!canDragThis) return
                  e.dataTransfer.setData('text/plain', `board-${row}-${col}`)
                  e.dataTransfer.effectAllowed = 'move'
                  onBoardDragStart?.(row, col)
                }}
                onDragEnd={() => onDragEnd?.()}
                className={cn(
                  'relative flex items-center justify-center text-xs font-bold select-none overflow-hidden',
                  isEmpty && !premiumStyle.bg && 'bg-stone-50 dark:bg-stone-900/30',
                  isEmpty && premiumStyle.bg && premiumStyle.bg,
                  isOccupied && 'bg-amber-100 dark:bg-amber-900/60',
                  isPending && 'bg-amber-200 dark:bg-amber-800 ring-2 ring-amber-500 ring-inset',
                  canClickToPlace && 'cursor-pointer hover:bg-amber-200/50 dark:hover:bg-amber-800/50',
                  canClickToRemove && 'cursor-pointer',
                  canDragThis && 'cursor-grab',
                  !canClickToPlace && !canClickToRemove && !canAcceptDrop && !canDragThis && 'cursor-default',
                  canAcceptDrop && 'cursor-copy',
                  isBeingDragged && 'opacity-40',
                )}
                onClick={() => {
                  if (canClickToRemove) {
                    onRemovePlacement(row, col)
                  } else if (canClickToPlace) {
                    onCellClick(row, col)
                  }
                }}
                onDragOver={(e) => {
                  if (canAcceptDrop) {
                    e.preventDefault()
                    e.stopPropagation()
                    e.dataTransfer.dropEffect = 'move'
                  }
                }}
                onDrop={(e) => {
                  if (canAcceptDrop) {
                    e.preventDefault()
                    e.stopPropagation()
                    onDrop?.(row, col)
                  }
                }}
              >
                {isEmpty && premiumStyle.label && !isValidTarget && (
                  <span className={cn('scale-50 text-lg font-semibold leading-none', premiumStyle.textColor)}>
                    {premiumStyle.label}
                  </span>
                )}

                {isEmpty && premium === 'ST' && !isValidTarget && (
                  <span className={cn('text-base leading-none', premiumStyle.textColor)}>
                    {'\u2605'}
                  </span>
                )}

                {isValidTarget && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[30%] h-[30%] rounded-full bg-emerald-500/30" />
                  </div>
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
                      <span className="absolute right-0 bottom-0 origin-bottom-right scale-[0.45] text-sm font-medium text-gray-600 dark:text-gray-400 leading-none">
                        {letterValue}
                      </span>
                    )}
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
