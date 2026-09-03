// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useEffect, useMemo, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { plural } from '@lingui/core/macro'
import { useNavigate } from '@tanstack/react-router'
import {
  Button,
  GameNewGameDialog,
  getErrorMessage,
  toast,
  type Person,
} from '@mochi/web'
import { useSidebarContext } from '@/context/sidebar-context'
import { useNewGameFriendsQuery, useCreateGameMutation } from '@/hooks/useGames'

function useLanguages() {
  const { t } = useLingui()
  return [
    { value: 'en_UK', label: t`English (UK)` },
    { value: 'en_US', label: t`English (US)` },
  ] as const
}

export function NewGame() {
  const { t } = useLingui()
  const languages = useLanguages()
  const navigate = useNavigate()
  const { newGameDialogOpen: open, closeNewGameDialog } = useSidebarContext()
  const onOpenChange = (isOpen: boolean) => {
    if (!isOpen) closeNewGameDialog()
  }
  const [selectedFriends, setSelectedFriends] = useState<string[]>([])
  const [language, setLanguage] = useState<string>('en_UK')

  const { data, isLoading, error, refetch } = useNewGameFriendsQuery({
    enabled: open,
  })

  const createGameMutation = useCreateGameMutation({
    onSuccess: (data) => {
      onOpenChange(false)
      if (data.id) {
        void navigate({ to: '/$gameId', params: { gameId: data.id } })
        toast.success(t`Game created`)
      }
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to create game`))
    },
  })

  const friends = useMemo(() => data?.friends ?? [], [data?.friends])

  const friendsAsPeople: Person[] = useMemo(
    () => friends.map((f) => ({ id: f.id, name: f.name })),
    [friends]
  )

  const handleCreateGame = () => {
    if (selectedFriends.length < 1) {
      toast.error(t`Please select at least one friend`)
      return
    }
    if (selectedFriends.length > 3) {
      toast.error(t`Maximum 3 opponents`)
      return
    }
    createGameMutation.mutate({
      opponents: selectedFriends,
      language,
    })
  }

  useEffect(() => {
    if (!open) {
      setSelectedFriends([])
      setLanguage('en_UK')
    }
  }, [open])

  return (
    <GameNewGameDialog
      open={open}
      onOpenChange={onOpenChange}
      friends={friendsAsPeople}
      isLoading={isLoading}
      error={error}
      onRetry={refetch}
      mode="multiple"
      value={selectedFriends}
      onChange={(value) => setSelectedFriends(value as string[])}
      pickerFooter={
        selectedFriends.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {plural(selectedFriends.length + 1, {
              one: '# player',
              other: '# players',
            })}
          </p>
        ) : null
      }
      canSubmit={
        selectedFriends.length >= 1 &&
        selectedFriends.length <= 3 &&
        !createGameMutation.isPending
      }
      isSubmitting={createGameMutation.isPending}
      onSubmit={handleCreateGame}
      options={
        <div className="space-y-2">
          <label className="text-sm font-medium"><Trans>Language</Trans></label>
          <div className="flex gap-2">
            {languages.map((lang) => (
              <Button
                key={lang.value}
                type="button"
                variant={language === lang.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLanguage(lang.value)}
                className="flex-1"
              >
                {lang.label}
              </Button>
            ))}
          </div>
        </div>
      }
      labels={{
        title: <Trans>New game</Trans>,
        description: <Trans>Start a new Words game</Trans>,
        opponentLabel: (
          <Trans>Choose opponents <span className="text-muted-foreground font-normal">(1-3)</span></Trans>
        ),
        emptyTitle: <Trans>No friends yet</Trans>,
        emptyHint: <Trans>Add friends in the People app to start playing</Trans>,
        addFriends: <Trans>Add friends</Trans>,
        placeholder: t`Select friends...`,
        emptyMessage: t`No friends found`,
        cancel: <Trans>Cancel</Trans>,
        submit: t`Start game`,
        submitting: t`Creating...`,
      }}
    />
  )
}
