import { createFileRoute } from '@tanstack/react-router'
import { WordsGameView } from '@/features/words'

export const Route = createFileRoute('/_authenticated/$gameId')({
  component: WordsGameView,
})
