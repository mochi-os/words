import { createFileRoute } from '@tanstack/react-router'
import { useAuthStore } from '@mochi/web'
import { WordsLayout } from '@/components/layout/words-layout'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async () => {
    const store = useAuthStore.getState()
    if (!store.isInitialized) {
      await store.initialize()
    }
  },
  component: WordsLayout,
})
