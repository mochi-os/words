import type { Game } from '@/api/games'

interface GameStatusProps {
  game: Game
  myIdentity: string
}

export function GameStatus({ game, myIdentity }: GameStatusProps) {
  const myNum = game.my_player_number

  let statusText: string
  if (game.status === 'finished') {
    if (game.winner) {
      if (game.winner === myIdentity) {
        statusText = 'You win!'
      } else {
        // Find winner name
        let winnerName = 'Opponent'
        for (let i = 1; i <= game.player_count; i++) {
          if ((game[`player${i}` as keyof Game] as string) === game.winner) {
            winnerName = game[`player${i}_name` as keyof Game] as string
            break
          }
        }
        statusText = `${winnerName} wins`
      }
    } else {
      statusText = 'Game over'
    }
  } else if (game.status === 'resigned') {
    if (game.winner === myIdentity) {
      statusText = 'Opponent resigned — you win!'
    } else {
      statusText = 'You resigned'
    }
  } else {
    const isMyTurn = game.current_turn === myNum
    if (isMyTurn) {
      statusText = 'Your turn'
    } else {
      const turnName = game[`player${game.current_turn}_name` as keyof Game] as string
      statusText = `${turnName}'s turn`
    }
  }

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <span className="text-sm font-medium">{statusText}</span>
    </div>
  )
}
