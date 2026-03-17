import { cn } from '@mochi/web'
import type { Game } from '@/api/games'

interface ScorePanelProps {
  game: Game
  myIdentity: string
  children?: React.ReactNode
}

export function ScorePanel({ game, myIdentity, children }: ScorePanelProps) {
  // Game-over status
  let endText: string | null = null
  if (game.status === 'finished') {
    if (game.winner) {
      if (game.winner === myIdentity) {
        endText = 'You win!'
      } else {
        let winnerName = 'Opponent'
        for (let i = 1; i <= game.player_count; i++) {
          if ((game[`player${i}` as keyof Game] as string) === game.winner) {
            winnerName = game[`player${i}_name` as keyof Game] as string
            break
          }
        }
        endText = `${winnerName} wins`
      }
    } else {
      endText = 'Game over'
    }
  } else if (game.status === 'resigned') {
    endText = game.winner === myIdentity
      ? 'Opponent resigned — you win!'
      : 'You resigned'
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-1">
      {Array.from({ length: game.player_count }).map((_, i) => {
        const num = i + 1
        const id = game[`player${num}` as keyof Game] as string
        const name = game[`player${num}_name` as keyof Game] as string
        const score = game[`player${num}_score` as keyof Game] as number
        const isMe = id === myIdentity
        const isTurn = game.current_turn === num && game.status === 'active'

        return (
          <div
            key={num}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-sm',
              isTurn && 'bg-blue-100 dark:bg-blue-900/40',
            )}
          >
            {isTurn && (
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            )}
            <span className={cn(
              'font-medium truncate max-w-[100px]',
              isMe && 'underline underline-offset-2',
            )}>
              {isMe ? 'You' : name}
            </span>
            <span className="font-bold tabular-nums">{score}</span>
          </div>
        )
      })}
      {endText && (
        <span className="text-sm font-medium">{endText}</span>
      )}
      <span className="text-muted-foreground text-xs ml-auto">
        {game.bag_count} tiles left
      </span>
      {children}
    </div>
  )
}
