import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@mochi/common'
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
  XCircle,
} from 'lucide-react'
import type {
  DraftWordValidationState,
  MoveDraftStatus,
} from '../lib/move-draft'

interface DraftWordPreview {
  word: string
  score: number
}

interface MoveComposerProps {
  isMyTurn: boolean
  draftStatus: MoveDraftStatus
  totalScore: number
  words: readonly DraftWordPreview[]
  wordValidationState: Readonly<Record<string, DraftWordValidationState>>
  localErrorMessage: string | null
  validationUnavailable: boolean
  showMoveActions: boolean
  canRecall: boolean
  canSubmit: boolean
  isSubmitting: boolean
  onRecall: () => void
  onSubmit: () => void
  showExchangeActions: boolean
  exchangeCount: number
  isExchanging: boolean
  onCancelExchange: () => void
  onConfirmExchange: () => void
}

export function MoveComposer({
  isMyTurn,
  draftStatus,
  totalScore,
  words,
  wordValidationState,
  localErrorMessage,
  validationUnavailable,
  showMoveActions,
  canRecall,
  canSubmit,
  isSubmitting,
  onRecall,
  onSubmit,
  showExchangeActions,
  exchangeCount,
  isExchanging,
  onCancelExchange,
  onConfirmExchange,
}: MoveComposerProps) {
  const statusLabel = getStatusLabel(draftStatus, isMyTurn)
  const hasAdvisoryInvalidWords = draftStatus === 'ready_with_invalid_words'
  const showWordList = words.length > 0

  return (
    <Card className="mt-3 w-full max-w-[min(100%,36rem)] py-4">
      <CardHeader className="px-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold tracking-tight">
            Move composer
          </CardTitle>
          <Badge
            variant={hasAdvisoryInvalidWords ? 'destructive' : 'outline'}
            className="shrink-0"
          >
            {statusLabel}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 px-4">
        <div
          className="flex items-center justify-between rounded-md border border-border/80 bg-background px-3 py-2"
          aria-live="polite"
        >
          <span className="text-sm text-muted-foreground">Preview score</span>
          <span className="text-base font-semibold tabular-nums">
            {showWordList ? totalScore : 0}
          </span>
        </div>

        {draftStatus === 'checking' && (
          <p
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-3 animate-spin" />
            Checking dictionary...
          </p>
        )}

        {draftStatus === 'invalid_local' && localErrorMessage && (
          <Alert variant="destructive" className="py-2">
            <AlertTriangle className="size-4" />
            <AlertTitle>Invalid move</AlertTitle>
            <AlertDescription>{localErrorMessage}</AlertDescription>
          </Alert>
        )}

        {validationUnavailable && (
          <Alert className="py-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            <AlertTitle>Dictionary checks are temporarily unavailable</AlertTitle>
            <AlertDescription>
              Submit remains available. Validation will resume automatically.
            </AlertDescription>
          </Alert>
        )}

        {hasAdvisoryInvalidWords && (
          <Alert className="py-2">
            <XCircle className="size-4 text-destructive" />
            <AlertTitle>Contains dictionary misses</AlertTitle>
            <AlertDescription>
              Validation is advisory only. You can still submit this move.
            </AlertDescription>
          </Alert>
        )}

        {showWordList ? (
          <ul className="space-y-1.5">
            {words.map(({ word, score }) => {
              const normalizedWord = word.toUpperCase()
              const validationState = wordValidationState[normalizedWord] ?? 'unknown'

              return (
                <li
                  key={`${normalizedWord}-${score}`}
                  className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <ValidationIndicator state={validationState} />
                    <span className="truncate font-medium tracking-wide">
                      {normalizedWord}
                    </span>
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                    {score} pts
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isMyTurn
              ? 'Place tiles on the board to preview score and words.'
              : 'Waiting for your turn to place tiles.'}
          </p>
        )}

        {showExchangeActions && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onCancelExchange}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={onConfirmExchange}
              disabled={exchangeCount === 0 || isExchanging}
            >
              {isExchanging ? (
                <Loader2 className="mr-1 size-3 animate-spin" />
              ) : (
                <ArrowLeftRight className="mr-1 size-3" />
              )}
              Exchange {exchangeCount > 0 ? `(${exchangeCount})` : ''}
            </Button>
          </div>
        )}

        {showMoveActions && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onRecall} disabled={!canRecall}>
              Recall
            </Button>
            <Button size="sm" onClick={onSubmit} disabled={!canSubmit}>
              {isSubmitting && <Loader2 className="mr-1 size-3 animate-spin" />}
              Submit
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ValidationIndicator({ state }: { state: DraftWordValidationState }) {
  if (state === 'checking') {
    return <Loader2 className="size-3 text-muted-foreground animate-spin" />
  }

  if (state === 'valid') {
    return <CheckCircle2 className="size-3 text-emerald-600" />
  }

  if (state === 'invalid') {
    return <XCircle className="size-3 text-destructive" />
  }

  return (
    <span
      className={cn(
        'inline-flex size-3 items-center justify-center rounded-full border border-border text-[9px] text-muted-foreground'
      )}
      aria-hidden
    >
      ?
    </span>
  )
}

function getStatusLabel(status: MoveDraftStatus, isMyTurn: boolean): string {
  if (!isMyTurn && status === 'empty') {
    return 'Waiting for turn'
  }

  switch (status) {
    case 'empty':
      return 'Waiting for tiles'
    case 'invalid_local':
      return 'Invalid move'
    case 'ready':
      return 'Ready'
    case 'checking':
      return 'Checking'
    case 'ready_with_invalid_words':
      return 'Advisory warning'
    case 'validation_unavailable':
      return 'Validation offline'
    default:
      return 'Ready'
  }
}
