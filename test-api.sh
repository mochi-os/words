#!/bin/bash
# Test Words app API endpoints
# Usage: ./test-api.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CURL="$SCRIPT_DIR/../../claude/scripts/curl.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "${GREEN}✓ $1${NC}"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗ $1${NC}"; echo -e "  ${RED}$2${NC}"; FAILED=$((FAILED + 1)); }
info() { echo -e "${YELLOW}→ $1${NC}"; }

echo "Testing Words API"
echo "========================================"
echo

# ── Dictionary validation ────────────────────────────────────────

info "Testing dictionary validation"

RESPONSE=$("$CURL" -X POST -d "word=A&language=en_US" /words/-/validate)
if echo "$RESPONSE" | grep -q '"valid":false'; then
	pass "Single letter rejected"
else
	fail "Single letter should be rejected" "$RESPONSE"
fi

RESPONSE=$("$CURL" -X POST -d "word=HELLO&language=en_US" /words/-/validate)
if echo "$RESPONSE" | grep -q '"valid":true'; then
	pass "HELLO is valid"
else
	fail "HELLO should be valid" "$RESPONSE"
fi

RESPONSE=$("$CURL" -X POST -d "word=XYZZY&language=en_US" /words/-/validate)
if echo "$RESPONSE" | grep -q '"valid":false'; then
	pass "XYZZY is invalid"
else
	fail "XYZZY should be invalid" "$RESPONSE"
fi

echo

# ── Starlark test suites ─────────────────────────────────────────

for SUITE in test_bag test_board test_dictionary test_game_flow; do
	info "Running Starlark $SUITE"
	RESPONSE=$("$CURL" /words/-/$SUITE)

	if echo "$RESPONSE" | grep -q '"passed":true'; then
		pass "Starlark $SUITE passed"
	else
		fail "Starlark $SUITE failed" "$RESPONSE"
	fi
done

echo

# ── Game lifecycle ───────────────────────────────────────────────

info "Creating a 2-player game"

# Get friends list to find an opponent
FRIENDS_RESPONSE=$("$CURL" /words/-/new)
OPPONENT=$(echo "$FRIENDS_RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
friends = d.get('data', {}).get('friends', [])
if friends:
    print(friends[0].get('id', ''))
" 2>/dev/null || echo "")

if [ -z "$OPPONENT" ]; then
	info "No friends found, skipping game lifecycle tests"
	echo
	echo "========================================"
	echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
	if [ $FAILED -gt 0 ]; then exit 1; fi
	exit 0
fi

RESPONSE=$("$CURL" -X POST -d "opponents=$OPPONENT&language=en_US" /words/-/create)
GAME_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('data', {}).get('id', ''))" 2>/dev/null || echo "")

if [ -n "$GAME_ID" ]; then
	pass "Created game: $GAME_ID"
else
	fail "Failed to create game" "$RESPONSE"
	echo
	echo "========================================"
	echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
	if [ $FAILED -gt 0 ]; then exit 1; fi
	exit 0
fi

# View game
info "Viewing game"
RESPONSE=$("$CURL" -X POST -d "game=$GAME_ID" /words/$GAME_ID/-/view)
VIEW=$(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
game = d.get('data', {}).get('game', {})
print(json.dumps({
    'rack_len': len(game.get('my_rack', '')),
    'bag_count': game.get('bag_count', -1),
    'my_player_number': game.get('my_player_number', 0),
    'status': game.get('status', ''),
    'board_empty': game.get('board', '') == '.............../' * 14 + '...............',
    'player2_rack': game.get('player2_rack', 'HIDDEN'),
    'has_bag': 'bag' in game,
}))
" 2>/dev/null || echo "{}")

RACK_LEN=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('rack_len', 0))" 2>/dev/null)
BAG_COUNT=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('bag_count', -1))" 2>/dev/null)
MY_PNUM=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('my_player_number', 0))" 2>/dev/null)
STATUS=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
P2_RACK=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('player2_rack', ''))" 2>/dev/null)
HAS_BAG=$(echo "$VIEW" | python3 -c "import sys, json; print(json.load(sys.stdin).get('has_bag', True))" 2>/dev/null)

if [ "$RACK_LEN" = "7" ]; then
	pass "Rack has 7 tiles"
else
	fail "Expected 7 tiles in rack" "got $RACK_LEN"
fi

if [ "$BAG_COUNT" = "86" ]; then
	pass "Bag count is 86 (100 - 7 - 7)"
else
	fail "Expected bag count 86" "got $BAG_COUNT"
fi

if [ "$MY_PNUM" = "1" ]; then
	pass "my_player_number is 1 (creator)"
else
	fail "Expected my_player_number=1" "got $MY_PNUM"
fi

if [ "$STATUS" = "active" ]; then
	pass "Game status is active"
else
	fail "Expected status=active" "got $STATUS"
fi

if [ "$P2_RACK" = "" ]; then
	pass "Opponent rack is hidden"
else
	fail "Opponent rack should be hidden" "got '$P2_RACK'"
fi

if [ "$HAS_BAG" = "False" ]; then
	pass "Bag contents not exposed"
else
	fail "Bag contents should not be exposed" "has_bag=$HAS_BAG"
fi

# Pass turn
info "Passing turn"
RESPONSE=$("$CURL" -X POST -d "game=$GAME_ID" /words/$GAME_ID/-/pass)
if echo "$RESPONSE" | grep -q '"id"'; then
	pass "Pass accepted"
else
	fail "Pass failed" "$RESPONSE"
fi

# View after pass
info "Viewing game after pass"
RESPONSE=$("$CURL" -X POST -d "game=$GAME_ID" /words/$GAME_ID/-/view)
AFTER_PASS=$(echo "$RESPONSE" | python3 -c "
import sys, json
d = json.load(sys.stdin)
game = d.get('data', {}).get('game', {})
print(json.dumps({
    'consecutive_passes': game.get('consecutive_passes', -1),
    'current_turn': game.get('current_turn', -1),
}))
" 2>/dev/null || echo "{}")

CONSEC=$(echo "$AFTER_PASS" | python3 -c "import sys, json; print(json.load(sys.stdin).get('consecutive_passes', -1))" 2>/dev/null)
CUR_TURN=$(echo "$AFTER_PASS" | python3 -c "import sys, json; print(json.load(sys.stdin).get('current_turn', -1))" 2>/dev/null)

if [ "$CONSEC" = "1" ]; then
	pass "consecutive_passes is 1"
else
	fail "Expected consecutive_passes=1" "got $CONSEC"
fi

if [ "$CUR_TURN" = "2" ]; then
	pass "Turn advanced to player 2"
else
	fail "Expected current_turn=2" "got $CUR_TURN"
fi

# Cleanup: resign + delete
info "Cleaning up (resign + delete)"
# Need to be player1 and it needs to be our turn — but we passed so it's player2's turn
# Resign works regardless of whose turn it is
RESPONSE=$("$CURL" -X POST -d "game=$GAME_ID" /words/$GAME_ID/-/resign)
if echo "$RESPONSE" | grep -q '"success":true'; then
	pass "Resigned from game"
else
	fail "Resign failed" "$RESPONSE"
fi

RESPONSE=$("$CURL" -X POST -d "game=$GAME_ID" /words/$GAME_ID/-/delete)
if echo "$RESPONSE" | grep -q '"success":true'; then
	pass "Deleted game"
else
	fail "Delete failed" "$RESPONSE"
fi

echo
echo "========================================"
echo -e "Results: ${GREEN}$PASSED passed${NC}, ${RED}$FAILED failed${NC}"
if [ $FAILED -gt 0 ]; then exit 1; fi
