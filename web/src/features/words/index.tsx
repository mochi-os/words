// Copyright © 2026 Mochisoft OÜ
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Mochi, licensed under the GNU AGPL v3 with the
// Mochi Application Interface Exception - see license.txt and license-exception.md.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useLingui } from '@lingui/react/macro'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  useAuthStore,
  usePageTitle,
  PageHeader,
  Main,
  GeneralError,
  GameHeader,
  GameHeaderStat,
  ConfirmDialog,
  Button,
  IconButton,
  getAppPath,
  getErrorMessage,
  toast,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Skeleton,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from '@mochi/web'
import { ArrowLeftRight, Flag, Loader2, MessageCircle, MoreHorizontal, RotateCcw, Send, Shuffle, SkipForward, Trash2 } from 'lucide-react'
import {
  parseBoard,
  serializeBoard,
  type Placement,
} from '@/lib/words-engine'
import { useSidebarContext } from '@/context/sidebar-context'
import { setLastGame } from '@/hooks/useGameStorage'
import { useGameWebsocket } from '@/hooks/useGameWebsocket'
import {
  getValidateWordQueryOptions,
  useInfiniteMessagesQuery,
  useGamesQuery,
  useSendMessageMutation,
  useGameDetailQuery,
  useMoveMutation,
  usePassMutation,
  useExchangeMutation,
  useResignMutation,
  useDeleteGameMutation,
  useCreateGameMutation,
} from '@/hooks/useGames'
import { GameEmptyState } from './components/game-empty-state'
import { WordsBoard } from './components/words-board'
import { TileRack } from './components/tile-rack'
import { ChatMessageList } from './components/chat-message-list'
import { ChatInput } from './components/chat-input'
import { MoveComposer } from './components/move-composer'
import { useWordsHeaderModel } from './lib/header-model'
import {
  createDraftSignature,
  deriveMoveDraft,
  getUniqueDraftWords,
  hasInvalidValidatedWords,
  resolveMoveDraftStatus,
  shouldApplyValidationResult,
  type DraftWordValidationState,
  type MoveErrorMessages,
} from './lib/move-draft'

export function WordsGameView() {
  const { t } = useLingui()
  usePageTitle(t`Words`)

  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { openNewGameDialog, setWebsocketStatus } = useSidebarContext()
  const [newMessage, setNewMessage] = useState('')
  const [showResignDialog, setShowResignDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showMobileChat, setShowMobileChat] = useState(false)
  // Tile placement state
  const [selectedRackIndex, setSelectedRackIndex] = useState<number | null>(null)
  const [pendingPlacements, setPendingPlacements] = useState<Placement[]>([])
  const [rackTiles, setRackTiles] = useState<string[]>([])

  // Exchange mode
  const [exchangeMode, setExchangeMode] = useState(false)
  const [exchangeSelected, setExchangeSelected] = useState<Set<number>>(new Set())

  // Drag-and-drop state
  const [dragSource, setDragSource] = useState<
    | { type: 'rack'; index: number }
    | { type: 'board'; row: number; col: number }
    | null
  >(null)

  // Blank tile letter prompt
  const [blankPromptOpen, setBlankPromptOpen] = useState(false)
  const [pendingBlankCell, setPendingBlankCell] = useState<{ row: number; col: number } | null>(null)
  const [pendingBlankRackIndex, setPendingBlankRackIndex] = useState<number | null>(null)

  const [wordValidationState, setWordValidationState] = useState<Record<string, DraftWordValidationState>>({})
  const [isValidationChecking, setIsValidationChecking] = useState(false)
  const [validationUnavailable, setValidationUnavailable] = useState(false)
  const activeDraftSignatureRef = useRef('')

  const {
    identity: currentUserIdentity,
    initialize: initializeAuth,
  } = useAuthStore()

  useEffect(() => {
    initializeAuth()
  }, [initializeAuth])

  const params = useParams({ strict: false }) as { gameId?: string }
  const selectedGameId = params?.gameId

  useEffect(() => {
    if (selectedGameId) {
      setLastGame(selectedGameId)
    }
  }, [selectedGameId])

  // Games list
  const gamesQuery = useGamesQuery()
  const games = useMemo(
    () => gamesQuery.data?.games ?? [],
    [gamesQuery.data?.games]
  )

  // The route parameter alone decides which game is open. Gating on the games
  // list instead meant a game created a moment ago - present in the URL, not
  // yet in the refetched list - fell through to the empty state, so creating
  // your first game answered "No games yet".
  const {
    data: gameDetail,
    isLoading: isLoadingDetail,
    error: gameDetailError,
    refetch: refetchGameDetail,
  } = useGameDetailQuery(selectedGameId)

  const game = gameDetail?.game
  const myIdentity = gameDetail?.identity ?? currentUserIdentity

  const myPlayerNumber = game?.my_player_number ?? 0
  const isMyTurn = game?.status === 'active' && game?.current_turn === myPlayerNumber

  // Initialize rack from game data
  useEffect(() => {
    if (game?.my_rack !== undefined) {
      setRackTiles(game.my_rack.split('').filter(Boolean))
    }
    // Reset on board change too, not just the rack: an opponent's move changes
    // only the board, and a pending tile is drawn over whatever the board says,
    // hiding the tiles they just played.
    setPendingPlacements([])
    setSelectedRackIndex(null)
    setDragSource(null)
    setExchangeMode(false)
    setExchangeSelected(new Set())
  }, [game?.my_rack, game?.board, game?.id])

  // Board state
  const board = useMemo(() => {
    if (!game?.board) return parseBoard('')
    return parseBoard(game.board)
  }, [game?.board])

  const invalidMoveFallback = t`Invalid move`
  const moveErrorMessages = useMemo<MoveErrorMessages>(
    () => ({
      no_tiles: t`No tiles placed`,
      out_of_bounds: t`Placement out of bounds`,
      square_occupied: t`Square already occupied`,
      not_in_line: t`Tiles must be placed in a single row or column`,
      not_contiguous: t`Tiles must be contiguous (no gaps)`,
      first_move_centre: t`First move must cover the central square`,
      first_move_two_tiles: t`First move must place at least 2 tiles`,
      not_connected: t`Tiles must connect to existing tiles on the board`,
      no_words: t`No valid words formed`,
    }),
    [t]
  )
  const moveDraftBase = useMemo(
    () => deriveMoveDraft(board, pendingPlacements, moveErrorMessages, invalidMoveFallback),
    [board, pendingPlacements, moveErrorMessages, invalidMoveFallback]
  )

  const draftWords = useMemo(
    () =>
      moveDraftBase.status === 'ready'
        ? moveDraftBase.result.wordsFormed.map((entry) => ({
            word: entry.word,
            score: entry.score,
          }))
        : [],
    [moveDraftBase]
  )

  const draftScore = moveDraftBase.status === 'ready' ? moveDraftBase.result.totalScore : 0

  const draftErrorMessage =
    moveDraftBase.status === 'invalid_local' ? moveDraftBase.errorMessage : null

  const uniqueDraftWords = useMemo(
    () =>
      moveDraftBase.status === 'ready'
        ? getUniqueDraftWords(moveDraftBase.result.wordsFormed)
        : [],
    [moveDraftBase]
  )

  useEffect(() => {
    if (exchangeMode || moveDraftBase.status !== 'ready') {
      activeDraftSignatureRef.current = ''
      setWordValidationState({})
      setIsValidationChecking(false)
      setValidationUnavailable(false)
      return
    }

    const validationLanguage = game?.language ?? 'en_US'
    const signature = createDraftSignature(game?.board ?? '', pendingPlacements)
    activeDraftSignatureRef.current = signature

    if (uniqueDraftWords.length === 0) {
      setWordValidationState({})
      setIsValidationChecking(false)
      setValidationUnavailable(false)
      return
    }

    const initialValidationState = Object.fromEntries(
      uniqueDraftWords.map((word) => [word, 'checking' as const])
    )
    setWordValidationState(initialValidationState)
    setIsValidationChecking(true)
    setValidationUnavailable(false)

    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        const nextValidationState: Record<string, DraftWordValidationState> = {}
        let hasValidationError = false

        await Promise.all(
          uniqueDraftWords.map(async (word) => {
            try {
              const response = await queryClient.fetchQuery(
                getValidateWordQueryOptions(word, validationLanguage)
              )
              nextValidationState[word] = response.valid ? 'valid' : 'invalid'
            } catch {
              hasValidationError = true
              nextValidationState[word] = 'unknown'
            }
          })
        )

        if (cancelled) return
        if (
          !shouldApplyValidationResult(activeDraftSignatureRef.current, signature)
        ) {
          return
        }

        setWordValidationState(nextValidationState)
        setValidationUnavailable(hasValidationError)
        setIsValidationChecking(false)
      })()
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    exchangeMode,
    game?.board,
    game?.language,
    moveDraftBase,
    pendingPlacements,
    queryClient,
    uniqueDraftWords,
  ])

  const hasInvalidWords =
    moveDraftBase.status === 'ready'
      ? hasInvalidValidatedWords(moveDraftBase.result.wordsFormed, wordValidationState)
      : false

  const moveDraftStatus = useMemo(
    () =>
      resolveMoveDraftStatus({
        baseStatus: moveDraftBase.status,
        hasInvalidWords,
        hasValidationUnavailable: validationUnavailable,
        isValidationChecking,
      }),
    [hasInvalidWords, isValidationChecking, moveDraftBase.status, validationUnavailable]
  )

  // Messages
  const messagesQuery = useInfiniteMessagesQuery(selectedGameId)
  const chatMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return []
    const all = [...messagesQuery.data.pages].reverse().flatMap((p) => p.messages)
    const seen = new Set<string>()
    return all.filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
  }, [messagesQuery.data?.pages])

  // Mutations
  const sendMessageMutation = useSendMessageMutation({
    onSuccess: () => setNewMessage(''),
  })

  const moveMutation = useMoveMutation({
    onSuccess: () => {
      setPendingPlacements([])
      setSelectedRackIndex(null)
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to submit move`))
    },
  })

  const passMutation = usePassMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to pass`))
    },
  })

  const exchangeMutation = useExchangeMutation({
    onSuccess: () => {
      setExchangeMode(false)
      setExchangeSelected(new Set())
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to exchange`))
    },
  })

  const resignMutation = useResignMutation({
    onSuccess: () => setShowResignDialog(false),
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to resign`))
    },
  })

  const rematchMutation = useCreateGameMutation({
    onSuccess: (data) => {
      void navigate({ to: '/$gameId', params: { gameId: data.id } })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to create rematch`))
    },
  })

  const deleteGameMutation = useDeleteGameMutation({
    onSuccess: () => {
      setShowDeleteDialog(false)
      toast.success(t`Game deleted`)
      void navigate({ to: '/' })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, t`Failed to delete game`))
    },
  })

  // WebSocket
  const { status, retries } = useGameWebsocket(
    selectedGameId,
    game?.key
  )
  useEffect(() => {
    setWebsocketStatus(status, retries)
  }, [status, retries, setWebsocketStatus])

  // Handle cell click (place tile)
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (selectedRackIndex === null || !rackTiles[selectedRackIndex]) return

      const tile = rackTiles[selectedRackIndex]

      if (tile === '_') {
        // Blank tile — need to ask for letter
        setPendingBlankCell({ row, col })
        setPendingBlankRackIndex(selectedRackIndex)
        setBlankPromptOpen(true)
        return
      }

      // Place the tile
      const placement: Placement = {
        row,
        col,
        letter: tile,
        rackTile: tile,
      }
      setPendingPlacements((prev) => [...prev, placement])

      // Remove tile from rack display
      const newRack = [...rackTiles]
      newRack.splice(selectedRackIndex, 1)
      setRackTiles(newRack)
      setSelectedRackIndex(null)
    },
    [selectedRackIndex, rackTiles]
  )

  // Handle blank tile letter selection
  const handleBlankLetterSelect = useCallback(
    (letter: string) => {
      if (!pendingBlankCell || pendingBlankRackIndex === null) return

      const placement: Placement = {
        row: pendingBlankCell.row,
        col: pendingBlankCell.col,
        letter: letter.toUpperCase(),
        rackTile: '_',
      }
      setPendingPlacements((prev) => [...prev, placement])

      const newRack = [...rackTiles]
      newRack.splice(pendingBlankRackIndex, 1)
      setRackTiles(newRack)
      setSelectedRackIndex(null)
      setDragSource(null)
      setBlankPromptOpen(false)
      setPendingBlankCell(null)
      setPendingBlankRackIndex(null)
    },
    [pendingBlankCell, pendingBlankRackIndex, rackTiles]
  )

  // Remove a pending placement (return tile to rack)
  const handleRemovePlacement = useCallback(
    (row: number, col: number) => {
      const idx = pendingPlacements.findIndex(
        (p) => p.row === row && p.col === col
      )
      if (idx < 0) return

      const removed = pendingPlacements[idx]
      setPendingPlacements((prev) => prev.filter((_, i) => i !== idx))

      // Return tile to rack
      setRackTiles((prev) => [...prev, removed.rackTile])
    },
    [pendingPlacements]
  )

  // Drag-and-drop handlers
  const handleRackDragStart = useCallback((index: number) => {
    setDragSource({ type: 'rack', index })
    setSelectedRackIndex(null)
  }, [])

  const handleBoardDragStart = useCallback((row: number, col: number) => {
    setDragSource({ type: 'board', row, col })
    setSelectedRackIndex(null)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
  }, [])

  const handleDrop = useCallback(
    (row: number, col: number) => {
      if (!dragSource) return

      if (dragSource.type === 'rack') {
        const tile = rackTiles[dragSource.index]
        if (!tile) return

        if (tile === '_') {
          setPendingBlankCell({ row, col })
          setPendingBlankRackIndex(dragSource.index)
          setBlankPromptOpen(true)
          return
        }

        const placement: Placement = { row, col, letter: tile, rackTile: tile }
        setPendingPlacements((prev) => [...prev, placement])

        const newRack = [...rackTiles]
        newRack.splice(dragSource.index, 1)
        setRackTiles(newRack)
      } else {
        // board → board: move pending tile to new cell
        const existing = pendingPlacements.find(
          (p) => p.row === dragSource.row && p.col === dragSource.col
        )
        if (!existing) return

        setPendingPlacements((prev) => [
          ...prev.filter((p) => !(p.row === dragSource.row && p.col === dragSource.col)),
          { ...existing, row, col },
        ])
      }

      setDragSource(null)
    },
    [dragSource, rackTiles, pendingPlacements]
  )

  const handleDropOnRack = useCallback(
    (targetIndex: number) => {
      if (!dragSource) return

      if (dragSource.type === 'board') {
        // board → rack: return tile
        const existing = pendingPlacements.find(
          (p) => p.row === dragSource.row && p.col === dragSource.col
        )
        if (!existing) return

        setPendingPlacements((prev) =>
          prev.filter((p) => !(p.row === dragSource.row && p.col === dragSource.col))
        )
        setRackTiles((prev) => {
          const next = [...prev]
          const insertAt = Math.min(targetIndex, next.length)
          next.splice(insertAt, 0, existing.rackTile)
          return next
        })
      } else {
        // rack → rack: reorder
        if (dragSource.index === targetIndex) return
        setRackTiles((prev) => {
          const next = [...prev]
          const [tile] = next.splice(dragSource.index, 1)
          const insertAt = Math.min(targetIndex, next.length)
          next.splice(insertAt, 0, tile)
          return next
        })
      }

      setDragSource(null)
    },
    [dragSource, pendingPlacements]
  )

  // Recall all placed tiles
  const handleRecall = useCallback(() => {
    const returnedTiles = pendingPlacements.map((p) => p.rackTile)
    setRackTiles((prev) => [...prev, ...returnedTiles])
    setPendingPlacements([])
    setSelectedRackIndex(null)
  }, [pendingPlacements])

  // Shuffle rack
  const handleShuffle = useCallback(() => {
    setRackTiles((prev) => {
      const shuffled = [...prev]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      return shuffled
    })
  }, [])

  // Submit move
  const handleSubmitMove = useCallback(() => {
    if (!game || !selectedGameId || moveDraftBase.status !== 'ready') return

    const result = moveDraftBase.result
    const newBoardStr = serializeBoard(result.newBoard)
    const wordsStr = result.wordsFormed.map((word) => word.word).join(', ')

    moveMutation.mutate({
      gameId: selectedGameId,
      board: newBoardStr,
      score: result.totalScore,
      tiles_used: result.tilesUsed,
      words_formed: wordsStr,
    })
  }, [game, moveDraftBase, moveMutation, selectedGameId])

  // Pass
  const handlePass = useCallback(() => {
    if (!selectedGameId) return
    passMutation.mutate({ gameId: selectedGameId })
  }, [selectedGameId, passMutation])

  // Exchange
  const handleExchangeConfirm = useCallback(() => {
    if (!selectedGameId || exchangeSelected.size === 0) return
    const tilesToExchange = Array.from(exchangeSelected)
      .map((i) => rackTiles[i])
      .join('')
    exchangeMutation.mutate({
      gameId: selectedGameId,
      tiles: tilesToExchange,
    })
  }, [selectedGameId, exchangeSelected, rackTiles, exchangeMutation])

  const handleToggleExchange = useCallback((index: number) => {
    setExchangeSelected((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }, [])

  const canRecallMove = isMyTurn && pendingPlacements.length > 0 && !moveMutation.isPending
  // Submit on the base status: the rules engine decides legality, the
  // dictionary lookup is advice and the server accepts unknown words. Gating on
  // the resolved status left Submit dead through the debounce.
  const canSubmitMove =
    isMyTurn && !exchangeMode && moveDraftBase.status === 'ready' && !moveMutation.isPending
  // The server refuses an exchange once the bag is under seven tiles, so at
  // the end of a game the control was offered, accepted tiles and then failed.
  const canExchange = (game?.bag_count ?? 0) >= 7

  const headerModel = useWordsHeaderModel(game, myIdentity)

  // The avatar comes through this app's own game-bound player-asset route (as
  // on Android), never a cross-app fetch from the people app. Two-player games
  // only: larger games list several opponents.
  const opponent = useMemo(() => {
    if (!game || !selectedGameId || game.player_count !== 2) return null
    const number = game.my_player_number === 1 ? 2 : 1
    const id = game[`player${number}` as keyof typeof game] as string | undefined
    if (!id) return null
    const base = `${getAppPath()}/${selectedGameId}/-/user/${id}/asset`
    return {
      name: game[`player${number}_name` as keyof typeof game] as string | undefined,
      avatarUrl: `${base}/avatar`,
      styleUrl: `${base}/style`,
    }
  }, [game, selectedGameId])

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGameId) return
    const body = newMessage.trim()
    if (!body) return
    sendMessageMutation.mutate({ gameId: selectedGameId, body })
  }

  const handleResign = () => {
    if (!selectedGameId) return
    resignMutation.mutate({ gameId: selectedGameId })
  }

  const handleDelete = () => {
    if (!selectedGameId) return
    deleteGameMutation.mutate({ gameId: selectedGameId })
  }

  const handleRematch = () => {
    if (!game || !myIdentity) return
    const opponents: string[] = []
    for (let i = 1; i <= game.player_count; i++) {
      const pid = game[`player${i}` as keyof typeof game] as string
      if (pid && pid !== myIdentity) {
        opponents.push(pid)
      }
    }
    rematchMutation.mutate({ opponents, language: game.language })
  }

  const moveComposerSection = game?.status === 'active' && (pendingPlacements.length > 0 || exchangeMode) ? (
    <div className="border-t shrink-0">
      <MoveComposer
        isMyTurn={isMyTurn}
        draftStatus={moveDraftStatus}
        totalScore={draftScore}
        words={draftWords}
        wordValidationState={wordValidationState}
        localErrorMessage={draftErrorMessage}
        validationUnavailable={validationUnavailable}
        showMoveActions={!exchangeMode && pendingPlacements.length > 0}
        canRecall={canRecallMove}
        canSubmit={canSubmitMove}
        isSubmitting={moveMutation.isPending}
        onRecall={handleRecall}
        onSubmit={handleSubmitMove}
        showExchangeActions={exchangeMode}
        exchangeCount={exchangeSelected.size}
        isExchanging={exchangeMutation.isPending}
        onCancelExchange={() => { setExchangeMode(false); setExchangeSelected(new Set()) }}
        onConfirmExchange={handleExchangeConfirm}
      />
    </div>
  ) : null

  // With no game in the URL there is nothing to render but the empty state -
  // and not even that until the list has arrived, since "No games yet" and
  // "Select a game" are the same component told apart by the list's length.
  if (!selectedGameId) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title={t`Words`} />
        <Main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {gamesQuery.isLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : gamesQuery.error ? (
            <GeneralError
              error={gamesQuery.error}
              minimal
              mode="inline"
              reset={gamesQuery.refetch}
            />
          ) : (
            <GameEmptyState
              onNewGame={openNewGameDialog}
              hasExistingGames={games.length > 0}
            />
          )}
        </Main>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden">
        <Main className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left: Board + rack */}
          <div className="flex flex-1 flex-col px-2 sm:px-4 pb-2 min-h-0">
            {isLoadingDetail ? (
              <Skeleton className="aspect-square max-w-[600px] w-full mx-auto" />
            ) : gameDetailError ? (
              <GeneralError
                error={gameDetailError}
                minimal
                mode="inline"
                reset={refetchGameDetail}
              />
            ) : game ? (
              <>
                <div className="shrink-0">
                  {headerModel ? (
                    <GameHeader
                      variant='strip'
                      myTurn={game.status === 'active' ? isMyTurn : undefined}
                      title={headerModel.title}
                      status={headerModel.status}
                      meta={headerModel.meta}
                      opponentName={opponent?.name}
                      opponentAvatarUrl={opponent?.avatarUrl}
                      opponentStyleUrl={opponent?.styleUrl}
                      stats={
                        <>
                          {headerModel.players.map((player) => (
                            <GameHeaderStat
                              key={player.playerNumber}
                              label={player.label}
                              value={player.score}
                              className={cn(player.isCurrentTurn && 'bg-primary/15 text-foreground')}
                              labelClassName={cn(
                                player.isMe && 'font-semibold underline underline-offset-2'
                              )}
                            />
                          ))}
                          <GameHeaderStat
                            label={headerModel.tilesLeftLabel}
                            value={headerModel.tilesLeft}
                            labelClassName='max-w-none truncate-none text-muted-foreground'
                          />
                        </>
                      }
                      actions={
                        <>
                          <IconButton
                            variant='ghost'
                            className='md:hidden'
                            onClick={() => setShowMobileChat(true)}
                            label={t`Open chat panel`}
                          >
                            <MessageCircle className='size-4' />
                          </IconButton>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <IconButton
                                variant='ghost'
                                label={t`Open game actions`}
                              >
                                <MoreHorizontal className='size-4' />
                              </IconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='w-48'>
                              {game.status === 'active' ? (
                                <>
                                  {isMyTurn && !exchangeMode && (
                                    <DropdownMenuItem onClick={handleShuffle}>
                                      <Shuffle className='me-2 size-4' /> <Trans>Shuffle rack</Trans>
                                    </DropdownMenuItem>
                                  )}
                                  {isMyTurn && pendingPlacements.length === 0 && (
                                    <DropdownMenuItem
                                      onClick={handlePass}
                                      disabled={passMutation.isPending}
                                    >
                                      <SkipForward className='me-2 size-4' /> <Trans>Pass</Trans>
                                    </DropdownMenuItem>
                                  )}
                                  {isMyTurn && (canExchange || exchangeMode) && (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        handleRecall()
                                        setExchangeMode(!exchangeMode)
                                        setExchangeSelected(new Set())
                                      }}
                                    >
                                      <ArrowLeftRight className='me-2 size-4' />
                                      {exchangeMode ? t`Cancel exchange` : t`Exchange tiles`}
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem onClick={() => setShowResignDialog(true)}>
                                    <Flag className='me-2 size-4' /> <Trans>Resign</Trans>
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <>
                                  <DropdownMenuItem
                                    onClick={handleRematch}
                                    disabled={rematchMutation.isPending}
                                  >
                                    <RotateCcw className='me-2 size-4' /> <Trans>Rematch</Trans>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setShowDeleteDialog(true)}>
                                    <Trash2 className='me-2 size-4' /> <Trans>Delete game</Trans>
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      }
                    />
                  ) : null}
                </div>

                <div className="flex-1 min-h-0 mt-3" style={{ containerType: 'size' }}>
                  <WordsBoard
                    board={board}
                    pendingPlacements={pendingPlacements}
                    selectedRackIndex={selectedRackIndex}
                    isMyTurn={isMyTurn}
                    gameStatus={game.status}
                    onCellClick={handleCellClick}
                    onRemovePlacement={handleRemovePlacement}
                    dragSource={dragSource}
                    onDrop={handleDrop}
                    onBoardDragStart={handleBoardDragStart}
                    onDragEnd={handleDragEnd}
                  />
                </div>

                {/* Tile rack + move composer */}
                {game.status === 'active' && (
                  <div className="shrink-0 mt-1 flex w-full justify-center">
                    <div className="w-full max-w-[min(100%,36rem)]">
                      <TileRack
                        tiles={rackTiles}
                        selectedIndex={exchangeMode ? null : selectedRackIndex}
                        onSelectTile={(i) => {
                          if (!exchangeMode) {
                            setSelectedRackIndex(selectedRackIndex === i ? null : i)
                          }
                        }}
                        disabled={!isMyTurn}
                        exchangeMode={exchangeMode}
                        exchangeSelected={exchangeSelected}
                        onToggleExchange={handleToggleExchange}
                        draggingIndex={dragSource?.type === 'rack' ? dragSource.index : null}
                        onDragStart={handleRackDragStart}
                        onDragEnd={handleDragEnd}
                        isDragging={dragSource !== null}
                        onDropOnRack={handleDropOnRack}
                      />

                      {/* Compact action bar — mobile only (composer lives in the right panel on md+) */}
                      {(pendingPlacements.length > 0 || exchangeMode) && (
                        <div className="md:hidden flex items-center gap-2 pt-1">
                          {exchangeMode ? (
                            <>
                              <Button variant="outline" size="sm" onClick={() => { setExchangeMode(false); setExchangeSelected(new Set()) }}>
                                <Trans>Cancel</Trans>
                              </Button>
                              <div className="flex-1" />
                              <Button size="sm" onClick={handleExchangeConfirm} disabled={exchangeSelected.size === 0 || exchangeMutation.isPending}>
                                {/* button-icon-ok: Exchange (tiles back to the bag) has no conventional glyph */}
                                {exchangeMutation.isPending && <Loader2 className="size-3 animate-spin" />}
                                {exchangeSelected.size > 0 ? <Trans>Exchange ({exchangeSelected.size})</Trans> : <Trans>Exchange</Trans>}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="outline" size="sm" onClick={handleRecall} disabled={!canRecallMove}>
                                <Trans>Recall</Trans>
                              </Button>
                              <div className="flex-1" />
                              {draftScore > 0 && (
                                <span className="text-base font-bold tabular-nums">+{draftScore}</span>
                              )}
                              <Button size="sm" onClick={handleSubmitMove} disabled={!canSubmitMove}>
                                {moveMutation.isPending ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Send className="size-4" />
                                )}
                                <Trans>Submit</Trans>
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Right: Chat sidebar */}
          <div className="hidden md:flex w-72 lg:w-80 flex-col border-s">
            <div className="border-b px-3 py-2">
              <h3 className="text-sm font-medium"><Trans>Chat</Trans></h3>
            </div>
            <ChatMessageList
              key={selectedGameId}
              messagesQuery={messagesQuery}
              chatMessages={chatMessages}
              isLoadingMessages={messagesQuery.isLoading}
              messagesError={messagesQuery.error}
              currentUserIdentity={myIdentity}
            />
            <ChatInput
              newMessage={newMessage}
              setNewMessage={setNewMessage}
              onSendMessage={handleSendMessage}
              isSending={sendMessageMutation.isPending}
              errorMessage={
                sendMessageMutation.error
                  ? getErrorMessage(sendMessageMutation.error, t`Failed to send`)
                  : null
              }
            />
            {moveComposerSection}
          </div>
        </Main>
      </div>

      {/* Mobile chat sheet */}
      <Sheet open={showMobileChat} onOpenChange={setShowMobileChat}>
        <SheetContent
          side="right"
          className="flex flex-col p-0 w-80"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SheetHeader className="border-b px-3 py-2">
            <SheetTitle className="text-sm font-medium"><Trans>Chat</Trans></SheetTitle>
          </SheetHeader>
          <ChatMessageList
            key={selectedGameId}
            messagesQuery={messagesQuery}
            chatMessages={chatMessages}
            isLoadingMessages={messagesQuery.isLoading}
            messagesError={messagesQuery.error}
            currentUserIdentity={myIdentity}
          />
          <ChatInput
            newMessage={newMessage}
            setNewMessage={setNewMessage}
            onSendMessage={handleSendMessage}
            isSending={sendMessageMutation.isPending}
            errorMessage={
              sendMessageMutation.error
                ? getErrorMessage(sendMessageMutation.error, t`Failed to send`)
                : null
            }
          />
          {moveComposerSection}
        </SheetContent>
      </Sheet>

      {/* Resign confirmation */}
      <ConfirmDialog
        open={showResignDialog}
        onOpenChange={setShowResignDialog}
        title={t`Resign game?`}
        desc={t`Are you sure you want to resign?`}
        confirmText={
          resignMutation.isPending ? (
            <>
              <Loader2 className="me-2 size-4 animate-spin" />
              <Trans>Resigning...</Trans>
            </>
          ) : (
            t`Resign`
          )
        }
        destructive
        handleConfirm={handleResign}
        isLoading={resignMutation.isPending}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={t`Delete game?`}
        desc={t`This permanently deletes the game and its chat. This cannot be undone.`}
        confirmText={
          deleteGameMutation.isPending ? (
            <>
              <Loader2 className="me-2 size-4 animate-spin" />
              <Trans>Deleting...</Trans>
            </>
          ) : (
            t`Delete`
          )
        }
        destructive
        handleConfirm={handleDelete}
        isLoading={deleteGameMutation.isPending}
      />

      {/* Blank tile letter selection */}
      <AlertDialog
        open={blankPromptOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBlankPromptOpen(false)
            setPendingBlankCell(null)
            setPendingBlankRackIndex(null)
            setDragSource(null)
          }
        }}
      >
        <AlertDialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            const firstBtn = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>('.grid button')
            firstBtn?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle><Trans>Choose a letter</Trans></AlertDialogTitle>
          </AlertDialogHeader>
          <div className="grid grid-cols-7 gap-1 py-2">
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => (
              <Button
                key={letter}
                variant="outline"
                size="sm"
                className="h-10 w-10 p-0 text-sm font-bold"
                onClick={() => handleBlankLetterSelect(letter)}
              >
                {letter}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel><Trans>Cancel</Trans></AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  )
}
