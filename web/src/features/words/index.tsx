import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useAuthStore, usePageTitle, useQueryWithError, PageHeader, Main, GeneralError, Button, IconButton, getErrorMessage, toast, AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, Skeleton, shellSubscribeNotifications, Sheet, SheetContent, SheetHeader, SheetTitle, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@mochi/common'
import { MoreHorizontal, Trash2, Loader2, Flag, RotateCcw, ArrowLeftRight, Shuffle, SkipForward, MessageCircle } from 'lucide-react'
import {
  parseBoard,
  serializeBoard,
  validateAndScoreMove,
  type Placement,
} from '@/lib/words-engine'
import { useSidebarContext } from '@/context/sidebar-context'
import { setLastGame } from '@/hooks/useGameStorage'
import { useGameWebsocket } from '@/hooks/useGameWebsocket'
import { gamesApi } from '@/api/games'
import {
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
import { ScorePanel } from './components/score-panel'
import { ChatMessageList } from './components/chat-message-list'
import { ChatInput } from './components/chat-input'

export function WordsGameView() {
  usePageTitle('Words')

  const navigate = useNavigate()
  const { openNewGameDialog, setWebsocketStatus } = useSidebarContext()
  const [newMessage, setNewMessage] = useState('')
  const [showResignDialog, setShowResignDialog] = useState(false)
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

  const selectedGame = useMemo(
    () =>
      games.find(
        (g) => g.id === selectedGameId || g.fingerprint === selectedGameId
      ) ?? null,
    [games, selectedGameId]
  )

  // Game detail
  const { data: gameDetail, isLoading: isLoadingDetail } = useGameDetailQuery(selectedGame?.id)

  const game = gameDetail?.game
  const myIdentity = gameDetail?.identity ?? currentUserIdentity

  const myPlayerNumber = game?.my_player_number ?? 0
  const isMyTurn = game?.status === 'active' && game?.current_turn === myPlayerNumber

  // Initialize rack from game data
  useEffect(() => {
    if (game?.my_rack !== undefined) {
      setRackTiles(game.my_rack.split('').filter(Boolean))
    }
    // Reset placement state when game changes
    setPendingPlacements([])
    setSelectedRackIndex(null)
    setDragSource(null)
    setExchangeMode(false)
    setExchangeSelected(new Set())
  }, [game?.my_rack, game?.id])

  // Board state
  const board = useMemo(() => {
    if (!game?.board) return parseBoard('')
    return parseBoard(game.board)
  }, [game?.board])

  // Messages
  const messagesQuery = useInfiniteMessagesQuery(selectedGame?.id)
  const chatMessages = useMemo(() => {
    if (!messagesQuery.data?.pages) return []
    return [...messagesQuery.data.pages].reverse().flatMap((p) => p.messages)
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
      toast.error(getErrorMessage(error, 'Failed to submit move'))
    },
  })

  const passMutation = usePassMutation({
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to pass'))
    },
  })

  const exchangeMutation = useExchangeMutation({
    onSuccess: () => {
      setExchangeMode(false)
      setExchangeSelected(new Set())
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to exchange'))
    },
  })

  const resignMutation = useResignMutation({
    onSuccess: () => setShowResignDialog(false),
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to resign'))
    },
  })

  const rematchMutation = useCreateGameMutation({
    onSuccess: (data) => {
      void navigate({ to: '/$gameId', params: { gameId: data.id } })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to create rematch'))
    },
  })

  const deleteGameMutation = useDeleteGameMutation({
    onSuccess: () => {
      toast.success('Game deleted')
      void navigate({ to: '/' })
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'Failed to delete game'))
    },
  })

  // WebSocket
  const { status, retries } = useGameWebsocket(
    selectedGame?.id,
    game?.key
  )
  useEffect(() => {
    setWebsocketStatus(status, retries)
  }, [status, retries, setWebsocketStatus])

  // Subscription check
  const { data: subscriptionData, refetch: refetchSubscription } = useQueryWithError({
    queryKey: ['subscription-check', 'words'],
    queryFn: () => gamesApi.checkSubscription(),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (subscriptionData?.exists === false) {
      shellSubscribeNotifications('words', [
        { label: 'Words moves & messages', type: '', defaultEnabled: true },
      ]).then(() => refetchSubscription())
    }
  }, [subscriptionData?.exists])

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
    if (!game || !selectedGame || pendingPlacements.length === 0) return

    try {
      const result = validateAndScoreMove(board, pendingPlacements)
      const newBoardStr = serializeBoard(result.newBoard)
      const wordsStr = result.wordsFormed.map((w) => w.word).join(', ')

      moveMutation.mutate({
        gameId: selectedGame.id,
        board: newBoardStr,
        score: result.totalScore,
        tiles_used: result.tilesUsed,
        words_formed: wordsStr,
      })
    } catch (err) {
      toast.error(getErrorMessage(err, 'Invalid move'))
    }
  }, [game, selectedGame, board, pendingPlacements, moveMutation])

  // Pass
  const handlePass = useCallback(() => {
    if (!selectedGame) return
    passMutation.mutate({ gameId: selectedGame.id })
  }, [selectedGame, passMutation])

  // Exchange
  const handleExchangeConfirm = useCallback(() => {
    if (!selectedGame || exchangeSelected.size === 0) return
    const tilesToExchange = Array.from(exchangeSelected)
      .map((i) => rackTiles[i])
      .join('')
    exchangeMutation.mutate({
      gameId: selectedGame.id,
      tiles: tilesToExchange,
    })
  }, [selectedGame, exchangeSelected, rackTiles, exchangeMutation])

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

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedGame) return
    const body = newMessage.trim()
    if (!body) return
    sendMessageMutation.mutate({ gameId: selectedGame.id, body })
  }

  const handleResign = () => {
    if (!selectedGame) return
    resignMutation.mutate({ gameId: selectedGame.id })
  }

  const handleDelete = () => {
    if (!selectedGame) return
    deleteGameMutation.mutate({ gameId: selectedGame.id })
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

  // Loading / empty
  if (selectedGameId && gamesQuery.isLoading) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title="Words" />
        <Main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="aspect-square max-w-[600px] w-full" />
        </Main>
      </div>
    )
  }

  if (!selectedGame) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader title="Words" />
        <Main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
          {gamesQuery.error ? (
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
          <div className="flex flex-1 flex-col overflow-y-auto px-2 sm:px-4 pb-2">
            {isLoadingDetail ? (
              <Skeleton className="aspect-square max-w-[600px] w-full mx-auto" />
            ) : game ? (
              <>
                <div className="shrink-0 mb-3">
                  <ScorePanel game={game} myIdentity={myIdentity}>
                    <IconButton
                      variant='ghost'
                      className='size-7 shrink-0 md:hidden'
                      onClick={() => setShowMobileChat(true)}
                      label='Open chat panel'
                    >
                      <MessageCircle className="size-4" />
                    </IconButton>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          variant='ghost'
                          className='size-7 shrink-0'
                          label='Open game actions'
                        >
                          <MoreHorizontal className="size-4" />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {game.status === 'active' ? (
                          <>
                            {isMyTurn && (
                              <DropdownMenuItem onClick={handleShuffle}>
                                <Shuffle className="mr-2 size-4" /> Shuffle rack
                              </DropdownMenuItem>
                            )}
                            {isMyTurn && pendingPlacements.length === 0 && (
                              <DropdownMenuItem onClick={handlePass} disabled={passMutation.isPending}>
                                <SkipForward className="mr-2 size-4" /> Pass
                              </DropdownMenuItem>
                            )}
                            {isMyTurn && (
                              <DropdownMenuItem
                                onClick={() => {
                                  handleRecall()
                                  setExchangeMode(!exchangeMode)
                                  setExchangeSelected(new Set())
                                }}
                              >
                                <ArrowLeftRight className="mr-2 size-4" />
                                {exchangeMode ? 'Cancel exchange' : 'Exchange tiles'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setShowResignDialog(true)}>
                              <Flag className="mr-2 size-4" /> Resign
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={handleRematch} disabled={rematchMutation.isPending}>
                              <RotateCcw className="mr-2 size-4" /> Rematch
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleDelete}>
                              <Trash2 className="mr-2 size-4" /> Delete game
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </ScorePanel>
                </div>

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

                {/* Tile rack + action buttons */}
                {game.status === 'active' && (
                  <div className="shrink-0 mt-1 flex justify-center">
                    <div className="relative">
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
                      <div className="absolute left-full top-1/2 -translate-y-1/2 flex items-center gap-1 pl-2">
                        {isMyTurn && exchangeMode && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setExchangeMode(false)
                                setExchangeSelected(new Set())
                              }}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleExchangeConfirm}
                              disabled={exchangeSelected.size === 0 || exchangeMutation.isPending}
                            >
                              {exchangeMutation.isPending ? (
                                <Loader2 className="mr-1 size-3 animate-spin" />
                              ) : (
                                <ArrowLeftRight className="mr-1 size-3" />
                              )}
                              Exchange {exchangeSelected.size > 0 ? `(${exchangeSelected.size})` : ''}
                            </Button>
                          </>
                        )}

                        {isMyTurn && !exchangeMode && pendingPlacements.length > 0 && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleRecall}
                            >
                              Recall
                            </Button>
                            <Button
                              size="sm"
                              onClick={handleSubmitMove}
                              disabled={moveMutation.isPending}
                            >
                              {moveMutation.isPending && (
                                <Loader2 className="mr-1 size-3 animate-spin" />
                              )}
                              Submit
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Right: Chat sidebar */}
          <div className="hidden md:flex w-72 lg:w-80 flex-col border-l">
            <div className="border-b px-3 py-2">
              <h3 className="text-sm font-medium">Chat</h3>
            </div>
            <ChatMessageList
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
                  ? getErrorMessage(sendMessageMutation.error, 'Failed to send')
                  : null
              }
            />
          </div>
        </Main>
      </div>

      {/* Mobile chat sheet */}
      <Sheet open={showMobileChat} onOpenChange={setShowMobileChat}>
        <SheetContent side="right" className="flex flex-col p-0 w-80">
          <SheetHeader className="border-b px-3 py-2">
            <SheetTitle className="text-sm font-medium">Chat</SheetTitle>
          </SheetHeader>
          <ChatMessageList
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
                ? getErrorMessage(sendMessageMutation.error, 'Failed to send')
                : null
            }
          />
        </SheetContent>
      </Sheet>

      {/* Resign confirmation */}
      <AlertDialog
        open={showResignDialog}
        onOpenChange={setShowResignDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resign game?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to resign?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resignMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleResign}
              disabled={resignMutation.isPending}
            >
              {resignMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Resigning...
                </>
              ) : (
                'Resign'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Choose a letter</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="grid grid-cols-9 gap-1 py-2">
            {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => (
              <Button
                key={letter}
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0 text-sm font-bold"
                onClick={() => handleBlankLetterSelect(letter)}
              >
                {letter}
              </Button>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  )
}
