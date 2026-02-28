import { createFileRoute } from '@tanstack/react-router'
import { GoGameView } from '@/features/go'

export const Route = createFileRoute('/_authenticated/$gameId')({
  component: GoGameView,
})
