# Copyright © 2026 Mochisoft OÜ
# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Mochi, licensed under the GNU AGPL v3 with the
# Mochi Application Interface Exception - see license.txt and license-exception.md.

# Mochi Words (Scrabble-style word game)

def notify(topic, object="", title="", body="", url="", event_id=""):
	mochi.service.call("notifications", "send", topic, object, title, body, url, mochi.app.label("notifications.topic." + topic.replace("/", ".")), "", "", None, event_id)

# English tile distributions: (letter, value, count)
TILES_EN = [
	("A", 1, 9), ("B", 3, 2), ("C", 3, 2), ("D", 2, 4), ("E", 1, 12),
	("F", 4, 2), ("G", 2, 3), ("H", 4, 2), ("I", 1, 9), ("J", 8, 1),
	("K", 5, 1), ("L", 1, 4), ("M", 3, 2), ("N", 1, 6), ("O", 1, 8),
	("P", 3, 2), ("Q", 10, 1), ("R", 1, 6), ("S", 1, 4), ("T", 1, 6),
	("U", 1, 4), ("V", 4, 2), ("W", 4, 2), ("X", 8, 1), ("Y", 4, 2),
	("Z", 10, 1), ("_", 0, 2),
]

TILE_VALUES = {t[0]: t[1] for t in TILES_EN}

def rack_value(rack):
	"""Sum the point values of tiles in a rack string."""
	total = 0
	for ch in rack.elems():
		total += TILE_VALUES.get(ch, 0)
	return total

def make_bag():
	"""Create a full bag of tiles as a string."""
	tiles = []
	for letter, value, count in TILES_EN:
		for i in range(count):
			tiles.append(letter)
	return "".join(tiles)

def shuffle_string(s):
	"""Shuffle a string using Fisher-Yates."""
	chars = list(s.elems())
	n = len(chars)
	for i in range(n - 1, 0, -1):
		j_raw = mochi.random.alphanumeric(4)
		j = 0
		for ch in j_raw.elems():
			j = j * 256 + ord(ch)
		j = j % (i + 1)
		tmp = chars[i]
		chars[i] = chars[j]
		chars[j] = tmp
	return "".join(chars)

def draw_tiles(bag, count):
	"""Draw count tiles from bag. Returns (drawn, remaining_bag)."""
	bag = shuffle_string(bag)
	actual = min(count, len(bag))
	drawn = bag[:actual]
	remaining = bag[actual:]
	return drawn, remaining

def empty_board():
	"""Create an empty 15x15 board."""
	row = "." * 15
	rows = []
	for i in range(15):
		rows.append(row)
	return "/".join(rows)

def valid_board(board_str):
	"""Validate a board string."""
	if not board_str or len(board_str) > 500:
		return False
	rows = board_str.split("/")
	if len(rows) != 15:
		return False
	for row in rows:
		if len(row) != 15:
			return False
		for ch in row.elems():
			if ch != "." and not ch.isalpha():
				return False
	return True

def valid_rack(rack):
	"""Validate a rack string: up to seven tiles, letters or blanks."""
	if rack == None or len(rack) > 7:
		return False
	for ch in rack.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			return False
	return True

# Commit hook: fires the chat-message-arrival websocket on every host
# that sees a new messages row commit, whether locally (via action_send /
# event_message calling mochi.db.commit.fire) or via replication apply
# (auto-fired by core with op.UID set, per the row-uid wire field added
# in #36). Both replicas of a paired account thus see the live update
# in any open browser tab, instead of only the host that served the
# action.
#
# Scoped narrowly to messages.insert where type='message'. The move /
# pass / exchange / resign sites stay on direct mochi.websocket.write
# for now: their payloads carry per-event semantics (score delta, board
# diff, pass flag, exchange flag, resign event, winner) that aren't
# stored in the row alone, and they all share the (games, update)
# shape so the hook couldn't disambiguate them by table+kind. The
# game-state insert into messages on those paths uses type='move'
# / 'system', which the filter below skips so it doesn't double-emit.
def words_commit_hook(table, kind, row_uid):
	if table != "messages" or kind != "insert" or not row_uid:
		return
	message = mochi.db.row("select * from messages where id=?", row_uid)
	if not message:
		return
	if message["type"] != "message":
		return
	game = mochi.db.row("select key from games where id=?", message["game"])
	if not game:
		return
	mochi.websocket.write(game["key"], {
		"type": "message",
		"created": message["created"],
		"member": message["member"],
		"name": message["name"],
		"body": message["body"],
	})

# Lazy hook registration; the call to mochi.db.commit.hook needs a
# user/app context that's only present during a real request, not at
# module load. Re-registering on every call is a plain assignment on
# the AppVersion struct - cheap and idempotent at the framework level.
def words_ensure_commit_hook():
	mochi.db.commit.hook("words_commit_hook")

# Database

def database_upgrade(version):
	if version == 3:
		# Monotonic revision, bumped by every state change and carried on
		# every outbound event. Local writes compare-and-swap on the value
		# they read; inbound writes apply only when they carry a higher one.
		# Existing rows start at 0 on both peers, so they stay in step.
		found = False
		for column in mochi.db.table("games"):
			if column["name"] == "revision":
				found = True
		if not found:
			mochi.db.execute("alter table games add column revision integer not null default 0")
	if version == 2:
		# Drop the pre-2026-07 broadcast tables left in the app data DB when
		# broadcast state moved to the per-app system DB - inert, but stale
		# sequence/log copies mislead diagnosis.
		for table in ["sequence", "log", "acknowledged", "received"]:
			mochi.db.execute("drop table if exists " + table)

def database_create():
	mochi.db.execute("""create table if not exists games (
		id text not null primary key,
		language text not null default 'en_US',
		player_count integer not null,
		player1 text not null,
		player1_name text not null,
		player1_score integer not null default 0,
		player1_rack text not null default '',
		player2 text not null,
		player2_name text not null,
		player2_score integer not null default 0,
		player2_rack text not null default '',
		player3 text,
		player3_name text,
		player3_score integer not null default 0,
		player3_rack text not null default '',
		player4 text,
		player4_name text,
		player4_score integer not null default 0,
		player4_rack text not null default '',
		current_turn integer not null default 1,
		status text not null default 'active',
		winner text,
		board text not null default '',
		bag text not null default '',
		move_count integer not null default 0,
		consecutive_passes integer not null default 0,
		key text not null,
		revision integer not null default 0,
		updated integer not null,
		created integer not null
	)""")
	mochi.db.execute("create index if not exists games_updated on games( updated )")
	mochi.db.execute("create index if not exists games_player1 on games( player1 )")
	mochi.db.execute("create index if not exists games_player2 on games( player2 )")
	mochi.db.execute("create index if not exists games_player3 on games( player3 )")
	mochi.db.execute("create index if not exists games_player4 on games( player4 )")

	mochi.db.execute("""create table if not exists messages (
		id text not null primary key,
		game references games( id ),
		member text not null,
		name text not null,
		body text not null,
		type text not null default 'message',
		created integer not null
	)""")
	mochi.db.execute("create index if not exists messages_game_created on messages( game, created )")

	mochi.db.execute("""create table if not exists dictionary (
		word text not null,
		language text not null,
		primary key (word, language)
	)""")

	# Load dictionaries
	load_dictionary("en_US", "dictionaries/en_US.txt")
	load_dictionary("en_UK", "dictionaries/en_UK.txt")

def stream_asset(a, entity_id, service, asset):
	if not entity_id:
		a.error.label(404, "errors.asset_unavailable", asset=asset)
		return None
	s = mochi.remote.stream(entity_id, service, asset, {})
	if not s:
		a.error.label(404, "errors.asset_unavailable", asset=asset)
		return None
	header = s.read()
	if not header or header.get("status") != "200":
		a.error.label(404, "errors.asset_not_set", asset=asset)
		return None
	a.header("Cache-Control", "private, max-age=300")
	if "data" in header:
		return {"data": header["data"]}
	a.header("Content-Type", header.get("content_type", "application/octet-stream"))
	a.write.stream(s)
	return None

_PERSON_ASSETS = ("avatar", "banner", "favicon", "style", "information")

def action_user_asset(a):
	asset = a.input("asset")
	if asset not in _PERSON_ASSETS:
		a.error.label(404, "errors.unknown_asset")
		return
	# Public route - only a player in this game may resolve its players' assets.
	# Requires a real authenticated caller: an anonymous request to a public
	# action runs as the entity owner, so without the a.user test the ambient
	# owner would satisfy is_player for their own games.
	user_id = a.user.identity.id if a.user and a.user.identity else None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not user_id or not game or not is_player(game, user_id):
		a.error.label(403, "errors.not_a_player")
		return
	# Bind the requested identity to this game, so the route can only resolve
	# its own players rather than any entity the caller names.
	if not is_player(game, a.input("user") or ""):
		a.error.label(404, "errors.unknown_asset")
		return
	return stream_asset(a, a.input("user") or "", "people", asset)

def load_dictionary(language, filename):
	"""Load a word list file into the dictionary table."""
	content = mochi.app.asset.read(filename)
	if not content:
		return
	words = str(content).split("\n")
	batch = []
	for w in words:
		w = w.strip().upper()
		if w and len(w) >= 2:
			batch.append(w)
			if len(batch) >= 500:
				insert_word_batch(batch, language)
				batch = []
	if batch:
		insert_word_batch(batch, language)

def insert_word_batch(words, language):
	"""Insert a batch of words into the dictionary."""
	placeholders = []
	params = []
	for w in words:
		placeholders.append("(?, ?)")
		params.append(w)
		params.append(language)
	sql = "insert or ignore into dictionary (word, language) values " + ", ".join(placeholders)
	mochi.db.execute(sql, *params)

# Helpers

def get_player_number(game, user_id):
	"""Return 1-4 based on which player slot matches."""
	if game["player1"] == user_id:
		return 1
	if game["player2"] == user_id:
		return 2
	if game["player3"] and game["player3"] == user_id:
		return 3
	if game["player4"] and game["player4"] == user_id:
		return 4
	return 0

def is_player(game, user_id):
	"""Check if user is a player in the game."""
	return get_player_number(game, user_id) > 0

def get_other_players(game, user_id):
	"""Return list of other player entity IDs."""
	others = []
	for i in range(1, game["player_count"] + 1):
		pid = game["player" + str(i)]
		if pid and pid != user_id:
			others.append(pid)
	return others

def get_player_name(game, player_num):
	"""Return the name for a player number."""
	return game["player" + str(player_num) + "_name"] or ""

def next_turn(game):
	"""Get the next player's turn number."""
	t = game["current_turn"]
	t = t + 1
	if t > game["player_count"]:
		t = 1
	return t

def event_integer(value, fallback):
	"""Parse an integer field off a P2P event.

	Returns fallback when the field is absent and None when it is present
	but malformed. Starlark has no try/except, so a bare int() on a field
	the peer sent as a non-integer raises and aborts the whole handler -
	the move is lost with no retry that recovers it, which is how a
	version-skewed client silently drops a turn."""
	if value == None or value == "":
		return fallback
	if not mochi.text.valid(str(value), "integer"):
		return None
	return int(value)

def valid_turn(game, turn):
	"""Check a turn number names a real player slot in this game."""
	return turn != None and turn >= 1 and turn <= game["player_count"]

def load_game(a):
	"""Load game by ID from action input, validate access."""
	if not mochi.text.valid(a.input("game"), "id"):
		a.error.label(400, "errors.invalid_game_id")
		return None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error.label(404, "errors.game_not_found")
		return None
	if not is_player(game, a.user.identity.id):
		a.error.label(403, "errors.not_a_player")
		return None
	return game

def strip_other_racks(game, user_id):
	"""Return game dict with other players' racks removed."""
	pnum = get_player_number(game, user_id)
	result = dict(game)
	my_rack = ""
	for i in range(1, 5):
		rack_key = "player" + str(i) + "_rack"
		if i == pnum:
			my_rack = result[rack_key]
		result[rack_key] = ""
	result["my_rack"] = my_rack
	result["my_player_number"] = pnum
	result["bag_count"] = len(game["bag"])
	# Remove the actual bag contents
	result.pop("bag", None)
	return result

# Concurrency control.
#
# Nothing serialises HTTP actions for a (user, app): core's per-worker
# guarantee (protocol2_worker.go) covers inbound P2P frames only, and
# db_app's lock guards schema creation, not handler execution. So two
# HTTP actions, or an HTTP action and an inbound event, can all read the
# same games row and write over each other. That matters most here
# because scores are read-modify-write, so a lost update silently drops
# points rather than merely reordering moves.
#
# Every state change therefore bumps a monotonic revision. Local writes
# compare-and-swap on the value they read; inbound writes apply only when
# they carry a higher one. Monotonic ordering is what makes a rejected
# inbound event safe to discard - core acks a handler that simply returns
# (protocol2_worker.go run/handle), so the sender never retries, and a
# drop would be permanent. Because the revision only ever moves forward,
# a rejected event is by definition one whose state we have already
# reached or passed, so nothing is lost.

def game_write(game, columns, values, now):
	"""Apply a local state change, guarding on the revision we read.

	Returns the new revision, or 0 when another writer got there first -
	in which case the caller must abandon the change entirely, emitting
	no message, no websocket payload and no P2P event."""
	revision = game["revision"] + 1
	sql = "update games set " + columns + ", revision=?, updated=? where id=? and revision=?"
	params = values + [revision, now, game["id"], game["revision"]]
	if mochi.db.execute(sql, *params) == 0:
		return 0
	return revision

def game_apply(e, game, columns, values, now):
	"""Apply an inbound state change if it is newer than the row we hold.

	The sender's post-write revision orders the change. A peer predating
	the field sends none, and falls back to our own read value plus one,
	which makes the write behave exactly like the local compare-and-swap.
	Returns False when the row already sits at or past this state."""
	revision = event_integer(e.content("revision"), None)
	if revision == None:
		revision = game["revision"] + 1
	sql = "update games set " + columns + ", revision=?, updated=? where id=? and revision<?"
	params = values + [revision, now, game["id"], revision]
	return mochi.db.execute(sql, *params) > 0

# Actions

def action_new(a):
	friends = mochi.service.call("friends", "list", a.user.identity.id) or []
	return {
		"data": {"friends": friends}
	}

def action_create(a):
	opponents_raw = a.input("opponents", "")
	language = a.input("language", "en_US")

	if language not in ["en_US", "en_UK"]:
		a.error.label(400, "errors.invalid_language")
		return

	# Parse opponents - comma-separated entity IDs
	if not opponents_raw:
		a.error.label(400, "errors.at_least_one_opponent_required")
		return

	opponents = opponents_raw.split(",")
	if len(opponents) < 1 or len(opponents) > 3:
		a.error.label(400, "errors.1_3_opponents_required")
		return

	# Validate each opponent
	opponent_names = []
	for opp in opponents:
		opp = opp.strip()
		if not mochi.text.valid(opp, "entity"):
			a.error.label(400, "errors.invalid_opponent", opponent=opp)
			return
		if opp == a.user.identity.id:
			a.error.label(400, "errors.cannot_play_against_yourself")
			return
		# One entity per player slot. get_player_number resolves to the
		# first matching slot while next_turn walks every slot, so a
		# duplicated opponent can never satisfy the turn check for their
		# second slot and the game wedges the moment play reaches it.
		for seen in opponent_names:
			if seen["id"] == opp:
				a.error.label(400, "errors.duplicate_opponent")
				return
		friend = mochi.service.call("friends", "get", a.user.identity.id, opp)
		if not friend:
			a.error.label(400, "errors.can_only_play_with_friends")
			return
		opponent_names.append({"id": opp, "name": friend["name"]})

	player_count = len(opponents) + 1

	# Initialize bag and draw tiles
	bag = make_bag()

	rack1, bag = draw_tiles(bag, 7)
	rack2, bag = draw_tiles(bag, 7)
	rack3 = ""
	rack4 = ""
	if player_count >= 3:
		rack3, bag = draw_tiles(bag, 7)
	if player_count >= 4:
		rack4, bag = draw_tiles(bag, 7)

	game_id = mochi.uid()
	now = mochi.time.now()
	key = mochi.random.alphanumeric(16)
	board = empty_board()

	# Player 1 is always the creator
	p1 = a.user.identity.id
	p1_name = a.user.identity.name
	p2 = opponent_names[0]["id"]
	p2_name = opponent_names[0]["name"]
	p3 = opponent_names[1]["id"] if len(opponent_names) > 1 else None
	p3_name = opponent_names[1]["name"] if len(opponent_names) > 1 else None
	p4 = opponent_names[2]["id"] if len(opponent_names) > 2 else None
	p4_name = opponent_names[2]["name"] if len(opponent_names) > 2 else None

	mochi.db.execute(
		"""insert into games (
			id, language, player_count,
			player1, player1_name, player1_rack,
			player2, player2_name, player2_rack,
			player3, player3_name, player3_rack,
			player4, player4_name, player4_rack,
			board, bag, key, updated, created
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
		game_id, language, player_count,
		p1, p1_name, rack1,
		p2, p2_name, rack2,
		p3, p3_name, rack3,
		p4, p4_name, rack4,
		board, bag, key, now, now
	)

	# Send new game event to all opponents with bag and racks
	for opp_info in opponent_names:
		mochi.message.send(
			{"from": a.user.identity.id, "to": opp_info["id"], "service": "words", "event": "new"},
			{
				"id": game_id, "language": language, "player_count": player_count,
				"player1": p1, "player1_name": p1_name, "player1_rack": rack1,
				"player2": p2, "player2_name": p2_name, "player2_rack": rack2,
				"player3": p3 or "", "player3_name": p3_name or "", "player3_rack": rack3,
				"player4": p4 or "", "player4_name": p4_name or "", "player4_rack": rack4,
				"bag": bag, "board": board, "created": now,
			}
		)

	return {
		"data": {"id": game_id}
	}

def action_list(a):
	games = mochi.db.rows("""
		SELECT id, language, player_count,
			player1, player1_name, player1_score,
			player2, player2_name, player2_score,
			player3, player3_name, player3_score,
			player4, player4_name, player4_score,
			current_turn, status, winner, board, move_count, consecutive_passes,
			updated, created
		FROM games
		WHERE player1 = ? OR player2 = ? OR player3 = ? OR player4 = ?
		ORDER BY updated DESC
	""", a.user.identity.id, a.user.identity.id, a.user.identity.id, a.user.identity.id)

	# Add my_player_number to each game
	for g in games:
		g["my_player_number"] = get_player_number(g, a.user.identity.id)

	return {
		"data": games
	}

def action_view(a):
	game = load_game(a)
	if not game:
		return

	mochi.service.call("notifications", "clear/object", "words", game["id"])

	return {
		"data": {"game": strip_other_racks(game, a.user.identity.id), "identity": a.user.identity.id}
	}

def action_messages(a):
	game = load_game(a)
	if not game:
		return

	limit = 30
	limit_str = a.input("limit")
	if limit_str and mochi.text.valid(limit_str, "natural"):
		limit = min(int(limit_str), 100)

	before = None
	before_str = a.input("before")
	if before_str and mochi.text.valid(before_str, "integer"):
		before = int(before_str)

	if before:
		messages = mochi.db.rows("select * from messages where game=? and created<? order by created desc limit ?", game["id"], before, limit + 1)
	else:
		messages = mochi.db.rows("select * from messages where game=? order by created desc limit ?", game["id"], limit + 1)

	has_more = len(messages) > limit
	if has_more:
		messages = messages[:limit]

	messages = list(reversed(messages))

	next_cursor = None
	if has_more and len(messages) > 0:
		next_cursor = messages[0]["created"]

	return {
		"data": {
			"messages": messages,
			"hasMore": has_more,
			"nextCursor": next_cursor
		}
	}

def action_send(a):
	game = load_game(a)
	if not game:
		return

	body = a.input("body", "")
	if not mochi.text.valid(body, "text"):
		a.error.label(400, "errors.invalid_message")
		return
	if len(body) > 10000:
		a.error.label(400, "errors.message_too_long")
		return
	if not body.strip():
		a.error.label(400, "errors.message_cannot_be_empty")
		return

	words_ensure_commit_hook()
	id = mochi.uid()
	now = mochi.time.now()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	mochi.db.commit.fire("messages", "insert", id)

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "message"},
			{"game": game["id"], "message": id, "created": now, "body": body, "name": a.user.identity.name}
		)

	return {
		"data": {"id": id}
	}

def action_move(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	# Validate turn
	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error.label(400, "errors.not_your_turn")
		return

	# Get move data
	board = a.input("board", "")
	score = a.input("score", "0")
	tiles_used = a.input("tiles_used", "")
	words_formed = a.input("words_formed", "")

	for ch in tiles_used.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			a.error.label(400, "errors.invalid_tile_character")
			return

	if not board or not valid_board(board):
		a.error.label(400, "errors.invalid_board_state")
		return

	if not mochi.text.valid(score, "integer"):
		a.error.label(400, "errors.invalid_score")
		return
	score = int(score)

	# Validate words against dictionary
	if words_formed:
		language = game["language"]
		for word in words_formed.split(", "):
			word = word.upper().strip()
			if len(word) < 2:
				continue
			row = mochi.db.row("select word from dictionary where word=? and language=?", word, language)
			if not row:
				a.error.label(400, "errors.invalid_word", word=word)
				return

	# Remove used tiles from rack
	rack_key = "player" + str(pnum) + "_rack"
	current_rack = game[rack_key]

	# tiles_used is a string of letters used (blanks as _)
	remaining_rack = current_rack
	for ch in tiles_used.elems():
		idx = -1
		for i in range(len(remaining_rack)):
			if remaining_rack[i] == ch:
				idx = i
				break
		if idx < 0:
			a.error.label(400, "errors.tile_not_in_rack", tile=ch)
			return
		remaining_rack = remaining_rack[:idx] + remaining_rack[idx+1:]

	# Draw new tiles from bag
	tiles_to_draw = min(7 - len(remaining_rack), len(game["bag"]))
	drawn, new_bag = draw_tiles(game["bag"], tiles_to_draw)
	new_rack = remaining_rack + drawn

	# Update score
	score_key = "player" + str(pnum) + "_score"
	new_score = game[score_key] + score

	# Check for game over: player used all tiles and bag is empty
	new_move_count = game["move_count"] + 1
	game_over = len(new_rack) == 0 and len(new_bag) == 0
	new_status = "finished" if game_over else "active"
	winner = None

	# Apply end-of-game rack penalties
	score_updates = {}
	if game_over:
		bonus = 0
		for i in range(1, game["player_count"] + 1):
			if i == pnum:
				continue
			opponent_rack = game["player" + str(i) + "_rack"]
			penalty = rack_value(opponent_rack)
			bonus += penalty
			opp_score_key = "player" + str(i) + "_score"
			score_updates[opp_score_key] = game[opp_score_key] - penalty
		new_score += bonus
		winner = a.user.identity.id

	new_turn = next_turn(game) if not game_over else game["current_turn"]

	now = mochi.time.now()

	# Build the column list; game_write appends the revision predicate.
	columns = "board=?, bag=?, " + rack_key + "=?, " + score_key + "=?, current_turn=?, move_count=?, consecutive_passes=0, status=?, winner=?"
	values = [board, new_bag, new_rack, new_score, new_turn, new_move_count, new_status, winner]
	for k, v in score_updates.items():
		columns += ", " + k + "=?"
		values.append(v)
	revision = game_write(game, columns, values, now)
	if revision == 0:
		a.error.label(409, "errors.game_state_changed")
		return

	# Insert move message
	id = mochi.uid()
	move_label = words_formed if words_formed else "played"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label + " (+" + str(score) + ")", now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": move_label + " (+" + str(score) + ")",
		"board": board, "score": score, "player_number": pnum,
		"current_turn": new_turn, "move_count": new_move_count,
		"status": new_status, "winner": winner or "",
		"player" + str(pnum) + "_score": new_score,
		"bag_count": len(new_bag),
	}
	for k, v in score_updates.items():
		ws_data[k] = v
	# Skip commit-hook conversion: the (games, update) shape is shared with pass / exchange / resign and the payload carries a per-move score delta that isn't stored in the row.
	mochi.websocket.write(game["key"], ws_data)

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
		"body": move_label + " (+" + str(score) + ")",
		"board": board, "score": score, "player_number": pnum,
		"current_turn": new_turn, "move_count": new_move_count,
		"status": new_status, "winner": winner or "",
		"new_score": new_score, "bag": new_bag, "revision": revision,
		# The mover's rack after drawing. Without this each host keeps every
		# opponent's OPENING rack for the whole game, and the player who goes
		# out then values their opponents' leftover tiles from that stale copy
		# - so the endgame penalties were wrong on every side at once.
		"rack": new_rack,
	}
	for k, v in score_updates.items():
		p2p_data[k] = v
	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "move"},
			p2p_data
		)

	return {
		"data": {"id": id}
	}

def action_pass(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error.label(400, "errors.not_your_turn")
		return

	new_consecutive = game["consecutive_passes"] + 1
	game_over = new_consecutive >= game["player_count"]
	new_status = "finished" if game_over else "active"
	new_turn = next_turn(game) if not game_over else game["current_turn"]

	# If game over, find winner by highest score
	winner = None
	if game_over:
		best_score = -1
		for i in range(1, game["player_count"] + 1):
			s = game["player" + str(i) + "_score"]
			if s > best_score:
				best_score = s
				winner = game["player" + str(i)]

	now = mochi.time.now()
	revision = game_write(game, "current_turn=?, consecutive_passes=?, status=?, winner=?",
		[new_turn, new_consecutive, new_status, winner], now)
	if revision == 0:
		a.error.label(409, "errors.game_state_changed")
		return

	id = mochi.uid()
	player_name = get_player_name(game, pnum)
	body = player_name + " passed"
	if game_over:
		body = body + " — game over"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "pass": True,
		"current_turn": new_turn, "consecutive_passes": new_consecutive,
		"status": new_status, "winner": winner or "",
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / exchange / resign and the payload carries a pass-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "pass"},
			{
				"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
				"body": body, "pass": True,
				"current_turn": new_turn, "consecutive_passes": new_consecutive,
				"status": new_status, "winner": winner or "", "revision": revision,
			}
		)

	return {
		"data": {"id": id}
	}

def action_exchange(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error.label(400, "errors.not_your_turn")
		return

	tiles_to_exchange = a.input("tiles", "")
	if not tiles_to_exchange or len(tiles_to_exchange) > 7:
		a.error.label(400, "errors.invalid_tiles_to_exchange")
		return
	for ch in tiles_to_exchange.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			a.error.label(400, "errors.invalid_tile_character")
			return

	if len(game["bag"]) < 7:
		a.error.label(400, "errors.not_enough_tiles_in_bag_to_exchange")
		return

	# Remove exchanged tiles from rack
	rack_key = "player" + str(pnum) + "_rack"
	current_rack = game[rack_key]
	remaining_rack = current_rack
	for ch in tiles_to_exchange.elems():
		idx = -1
		for i in range(len(remaining_rack)):
			if remaining_rack[i] == ch:
				idx = i
				break
		if idx < 0:
			a.error.label(400, "errors.tile_not_in_rack", tile=ch)
			return
		remaining_rack = remaining_rack[:idx] + remaining_rack[idx+1:]

	# Draw new tiles first
	drawn, new_bag = draw_tiles(game["bag"], len(tiles_to_exchange))
	# Put exchanged tiles back in bag
	new_bag = new_bag + tiles_to_exchange
	new_rack = remaining_rack + drawn

	new_turn = next_turn(game)
	now = mochi.time.now()

	revision = game_write(game, "bag=?, " + rack_key + "=?, current_turn=?, consecutive_passes=0",
		[new_bag, new_rack, new_turn], now)
	if revision == 0:
		a.error.label(409, "errors.game_state_changed")
		return

	id = mochi.uid()
	player_name = get_player_name(game, pnum)
	body = player_name + " exchanged " + str(len(tiles_to_exchange)) + " tiles"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "exchange": True,
		"current_turn": new_turn, "bag_count": len(new_bag),
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / pass / resign and the payload carries an exchange-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "exchange"},
			{
				"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
				"body": body, "exchange": True,
				"current_turn": new_turn, "bag": new_bag, "revision": revision,
				"rack": new_rack,
			}
		)

	return {
		"data": {"id": id}
	}

def action_resign(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] != "active":
		a.error.label(400, "errors.game_is_not_active")
		return

	# Find winner: highest score among remaining players
	pnum = get_player_number(game, a.user.identity.id)
	best_score = -1
	winner = None
	for i in range(1, game["player_count"] + 1):
		if i == pnum:
			continue
		s = game["player" + str(i) + "_score"]
		if s > best_score:
			best_score = s
			winner = game["player" + str(i)]

	now = mochi.time.now()
	revision = game_write(game, "status='resigned', winner=?", [winner], now)
	if revision == 0:
		a.error.label(409, "errors.game_state_changed")
		return

	id = mochi.uid()
	msg = a.user.identity.name + " resigned"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	# Skip commit-hook conversion: the resign payload carries an event marker and the winner (sourced from the games row), neither of which is on the messages row alone — and the games.update is shared with move / pass / exchange.
	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": msg, "winner": winner or ""})

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "resign"},
			{"game": game["id"], "created": now, "body": msg, "winner": winner or "", "revision": revision}
		)

	return {
		"data": {"success": True}
	}

def action_delete(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] == "active":
		a.error.label(400, "errors.cannot_delete_an_active_game")
		return

	mochi.db.execute("delete from messages where game=?", game["id"])
	mochi.db.execute("delete from games where id=?", game["id"])

	return {
		"data": {"success": True}
	}

def action_validate_word(a):
	word = a.input("word", "")
	language = a.input("language", "en_US")

	if not word:
		a.error.label(400, "errors.word_is_required")
		return
	if language not in ["en_US", "en_UK"]:
		a.error.label(400, "errors.invalid_language")
		return

	word = word.upper().strip()
	if len(word) < 2 or len(word) > 15:
		return {"data": {"valid": False}}

	row = mochi.db.row("select word from dictionary where word=? and language=?", word, language)
	valid = True if row else False
	return {
		"data": {"valid": valid}
	}

# P2P Events

def event_new(e):
	f = mochi.service.call("friends", "get", e.header("to"), e.header("from"))
	if not f:
		return

	game_id = e.content("id")
	if not mochi.text.valid(game_id, "id"):
		return

	language = e.content("language") or "en_US"
	player_count = e.content("player_count")
	if not player_count or not mochi.text.valid(str(player_count), "integer"):
		return
	player_count = int(player_count)
	if player_count < 2 or player_count > 4:
		return

	p1 = e.content("player1") or ""
	p1_name = e.content("player1_name") or ""
	p2 = e.content("player2") or ""
	p2_name = e.content("player2_name") or ""
	p3 = e.content("player3") or ""
	p3_name = e.content("player3_name") or ""
	p4 = e.content("player4") or ""
	p4_name = e.content("player4_name") or ""

	board = e.content("board") or empty_board()
	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		return

	# Verify this player is in the game
	my_id = e.header("to")
	if my_id not in [p1, p2, p3, p4]:
		return

	# ...and that the sender is too. The friend check above only proves the
	# sender is OUR friend, not that they are playing: without this a friend
	# could plant a game between us and third parties, who would then satisfy
	# every later is_player check on this host. Multiplayer Words does not
	# require the participants to be friends of each other, so this is the
	# only place the sender's own participation can be established.
	if e.header("from") not in [p1, p2, p3, p4]:
		return

	# One entity per player slot, same rule action_create enforces: a
	# duplicated player wedges the game once play reaches their second
	# slot, so refuse to store one that arrives already broken.
	filled = [p for p in [p1, p2, p3, p4] if p]
	for i in range(len(filled)):
		for j in range(i + 1, len(filled)):
			if filled[i] == filled[j]:
				return

	# Use bag and racks from the creating server
	bag = e.content("bag") or ""
	rack1 = e.content("player1_rack") or ""
	rack2 = e.content("player2_rack") or ""
	rack3 = e.content("player3_rack") or ""
	rack4 = e.content("player4_rack") or ""

	result = mochi.db.execute(
		"""insert or ignore into games (
			id, language, player_count,
			player1, player1_name, player1_rack,
			player2, player2_name, player2_rack,
			player3, player3_name, player3_rack,
			player4, player4_name, player4_rack,
			board, bag, key, updated, created
		) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
		game_id, language, player_count,
		p1, p1_name, rack1,
		p2, p2_name, rack2,
		p3 if p3 else None, p3_name if p3_name else None, rack3,
		p4 if p4 else None, p4_name if p4_name else None, rack4,
		board, bag, mochi.random.alphanumeric(16), mochi.time.now(), created
	)
	if result == 0:
		return

	sender_name = e.content("player1_name") or "Someone"
	notify("activity", "", mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.started_game", name=sender_name), "/words/" + game_id, event_id="game:" + game_id)

def event_move(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	board = e.content("board")
	if not board or not valid_board(board):
		return

	score = event_integer(e.content("score"), 0)
	if score == None:
		return

	# Derive the scoring slot from the sender rather than the payload. The
	# claimed number is interpolated into a column name below, so a wrong
	# one credits another player's score, and an out-of-range one builds a
	# column that doesn't exist and fails the statement.
	player_number = get_player_number(game, sender)
	if player_number < 1:
		return

	current_turn = event_integer(e.content("current_turn"), next_turn(game))
	if not valid_turn(game, current_turn):
		return

	move_count = event_integer(e.content("move_count"), game["move_count"] + 1)
	if move_count == None:
		return

	# Monotonic gate: move_count is sequential per game, so an incoming
	# event whose count isn't strictly greater than ours is stale (delayed
	# duplicate, or a replicated identity's parallel attempt that lost
	# the cross-host race). Drop without rewriting board / bag / scores.
	if game["move_count"] != None and move_count <= game["move_count"]:
		return

	new_score = event_integer(e.content("new_score"), game["player" + str(player_number) + "_score"] + score)
	if new_score == None:
		return

	status = e.content("status") or "active"
	if status not in ["active", "finished", "resigned"]:
		status = "active"
	winner = e.content("winner") or None
	# Clamp winner to an actual player of this game - a player must not be able
	# to declare an arbitrary entity the winner (matches chess/go).
	players = [game["player" + str(n)] for n in range(1, game["player_count"] + 1)]
	if winner and winner not in players:
		winner = None
	body = e.content("body") or ""
	name = e.content("name") or "Opponent"

	bag = e.content("bag")

	# End-of-game rack penalties. When a move empties the mover's rack,
	# action_move subtracts each opponent's leftover rack value from their
	# score and ships the results as playerN_score keys. Without reading them
	# back here the mover's final scoreboard and every opponent's disagree
	# permanently, on every completed game.
	#
	# The slot index comes from this bounded loop over the game's own
	# player_count, never from the payload, so the column name stays
	# server-derived and the peer supplies only the value.
	penalties = {}
	for n in range(1, game["player_count"] + 1):
		if n == player_number:
			continue
		key = "player" + str(n) + "_score"
		value = e.content(key)
		if value == None or value == "":
			continue
		if not mochi.text.valid(str(value), "integer"):
			return
		penalties[key] = int(value)

	# Apply atomically, ordered by the sender's revision. The move_count
	# gate above still rejects a stale event early, but on its own it was
	# a read-then-write: a concurrent local action could advance the row
	# between the check and this write, and the unconditional update then
	# erased it.
	now = mochi.time.now()
	score_key = "player" + str(player_number) + "_score"
	columns = "board=?"
	values = [board]
	if bag != None:
		columns += ", bag=?"
		values.append(bag)
	columns += ", " + score_key + "=?, current_turn=?, move_count=?, consecutive_passes=0, status=?, winner=?"
	values.extend([new_score, current_turn, move_count, status, winner])
	# Keep the sender's rack current. player_number is derived from the
	# sender above, so the column is server-derived; the peer supplies only
	# the tiles. A malformed rack drops the event rather than storing junk
	# that would later be valued as a penalty.
	rack = e.content("rack")
	if rack != None:
		if not valid_rack(rack):
			return
		columns += ", player" + str(player_number) + "_rack=?"
		values.append(rack)
	for k, v in penalties.items():
		columns += ", " + k + "=?"
		values.append(v)
	if not game_apply(e, game, columns, values, now):
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	ws_data = {
		"type": "move", "created": created, "member": sender, "name": name,
		"body": body,
		"board": board, "score": score, "player_number": player_number,
		"current_turn": current_turn, "move_count": move_count,
		"status": status, "winner": winner or "",
		"player" + str(player_number) + "_score": new_score,
		"bag_count": bag_count,
	}
	# Mirror action_move: an open client must see the penalised opponent
	# scores land, not just the mover's own.
	for k, v in penalties.items():
		ws_data[k] = v
	# Skip commit-hook conversion: matches action_move — shared (games, update) shape and per-move score delta isn't in the row.
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.move"), mochi.app.label("notifications.body.played_move", name=name, move=body), "/words/" + game["id"], event_id="move:" + str(id))

def event_pass(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	body = e.content("body") or "passed"
	name = e.content("name") or "Opponent"
	current_turn = event_integer(e.content("current_turn"), next_turn(game))
	if not valid_turn(game, current_turn):
		return

	consecutive_passes = event_integer(e.content("consecutive_passes"), game["consecutive_passes"] + 1)
	if consecutive_passes == None:
		return

	status = e.content("status") or "active"
	if status not in ["active", "finished", "resigned"]:
		status = "active"
	winner = e.content("winner") or None
	# Clamp winner to an actual player of this game, matching event_move.
	players = [game["player" + str(n)] for n in range(1, game["player_count"] + 1)]
	if winner and winner not in players:
		winner = None

	now = mochi.time.now()
	if not game_apply(e, game, "current_turn=?, consecutive_passes=?, status=?, winner=?",
			[current_turn, consecutive_passes, status, winner], now):
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "pass": True,
		"current_turn": current_turn, "consecutive_passes": consecutive_passes,
		"status": status, "winner": winner or "",
	}
	# Skip commit-hook conversion: matches action_pass — shared (games, update) shape and a pass flag the hook can't infer from row state.
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.words"), mochi.app.label("notifications.body.passed", name=name), "/words/" + game["id"], event_id="pass:" + str(id))

def event_exchange(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	body = e.content("body") or "exchanged tiles"
	name = e.content("name") or "Opponent"
	current_turn = event_integer(e.content("current_turn"), next_turn(game))
	if not valid_turn(game, current_turn):
		return

	bag = e.content("bag")

	now = mochi.time.now()
	columns = ""
	values = []
	if bag != None:
		columns = "bag=?, "
		values.append(bag)
	columns += "current_turn=?, consecutive_passes=0"
	values.append(current_turn)
	# An exchange swaps tiles, so the sender's rack changes here too.
	rack = e.content("rack")
	if rack != None:
		sender_number = get_player_number(game, sender)
		if sender_number < 1 or not valid_rack(rack):
			return
		columns += ", player" + str(sender_number) + "_rack=?"
		values.append(rack)
	if not game_apply(e, game, columns, values, now):
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "exchange": True,
		"current_turn": current_turn, "bag_count": bag_count,
	}
	# Skip commit-hook conversion: matches action_exchange — shared (games, update) shape and an exchange flag the hook can't infer from row state.
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.words"), mochi.app.label("notifications.body.exchanged_tiles", name=name), "/words/" + game["id"], event_id="exchange:" + str(id))

def event_message(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		return

	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		return

	body = e.content("body")
	if not mochi.text.valid(str(body), "text"):
		return
	if len(str(body)) > 10000:
		return

	name = e.content("name") or "Opponent"

	words_ensure_commit_hook()
	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], sender, name, body, created)

	mochi.db.commit.fire("messages", "insert", id)
	notify("message", "", mochi.app.label("notifications.title.message"), name + ": " + body, "/words/" + game["id"], event_id="message:" + str(id))

def event_resign(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	winner = e.content("winner") or None
	players = [game["player" + str(n)] for n in range(1, game["player_count"] + 1)]
	if winner and winner not in players:
		winner = None
	body = e.content("body") or "Opponent resigned"

	now = mochi.time.now()
	if not game_apply(e, game, "status='resigned', winner=?", [winner], now):
		return

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	# Skip commit-hook conversion: matches action_resign — payload carries an event marker and the winner from the games row, neither of which is on the messages row alone.
	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": body, "winner": winner or ""})
	notify("activity", "", mochi.app.label("notifications.title.game"), body, "/words/" + game["id"], event_id="resign:" + game["id"])
