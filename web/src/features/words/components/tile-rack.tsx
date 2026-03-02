import { cn } from '@mochi/common'
import { getLetterValue } from '@/lib/words-engine'

interface TileRackProps {
  tiles: string[]  // array of tile characters (uppercase letters or '_' for blank)
  selectedIndex: number | null
  onSelectTile: (index: number) => void
  disabled?: boolean
  exchangeMode?: boolean
  exchangeSelected?: Set<number>
  onToggleExchange?: (index: number) => void
  draggingIndex?: number | null
  onDragStart?: (index: number) => void
  onDragEnd?: () => void
}

export function TileRack({
  tiles,
  selectedIndex,
  onSelectTile,
  disabled,
  exchangeMode,
  exchangeSelected,
  onToggleExchange,
  draggingIndex,
  onDragStart,
  onDragEnd,
}: TileRackProps) {
  return (
    <div className="flex items-center justify-center gap-1.5 py-2">
      {Array.from({ length: 7 }).map((_, i) => {
        const tile = tiles[i]
        const hasTile = !!tile
        const isSelected = selectedIndex === i
        const isExchangeSelected = exchangeMode && exchangeSelected?.has(i)
        const value = tile ? getLetterValue(tile) : 0
        const displayLetter = tile === '_' ? '' : tile
        const isDragging = draggingIndex === i
        const canDrag = hasTile && !disabled && !exchangeMode

        return (
          <button
            key={i}
            type="button"
            disabled={disabled || !hasTile}
            draggable={canDrag}
            onDragStart={(e) => {
              if (!canDrag) return
              e.dataTransfer.setData('text/plain', String(i))
              e.dataTransfer.effectAllowed = 'move'
              onDragStart?.(i)
            }}
            onDragEnd={() => {
              onDragEnd?.()
            }}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded border-2 text-base font-bold transition-all select-none',
              hasTile && 'bg-amber-100 dark:bg-amber-900/60 border-amber-300 dark:border-amber-700',
              !hasTile && 'bg-transparent border-dashed border-gray-300 dark:border-gray-700',
              isSelected && !exchangeMode && 'ring-2 ring-blue-500 border-blue-500 scale-110',
              isExchangeSelected && 'ring-2 ring-red-500 border-red-500 opacity-60',
              hasTile && !disabled && !exchangeMode && 'cursor-grab hover:scale-105',
              hasTile && !disabled && exchangeMode && 'cursor-pointer hover:scale-105',
              disabled && 'opacity-50 cursor-default',
              isDragging && 'opacity-40',
            )}
            onClick={() => {
              if (!hasTile) return
              if (exchangeMode && onToggleExchange) {
                onToggleExchange(i)
              } else {
                onSelectTile(i)
              }
            }}
          >
            {hasTile && (
              <>
                <span>{displayLetter}</span>
                {value > 0 && (
                  <span className="absolute right-0 bottom-0 origin-bottom-right scale-50 text-base font-medium text-gray-600 dark:text-gray-400 leading-none">
                    {value}
                  </span>
                )}
                {tile === '_' && (
                  <span className="text-gray-400 dark:text-gray-500 text-xs">?</span>
                )}
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
