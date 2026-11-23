# Copyright © 2026 Mochisoft OÜ
# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Mochi, licensed under the GNU AGPL v3 with the
# Mochi Application Interface Exception - see license.txt and license-exception.md.

# Mochi Words (Scrabble-style word game)

# Trust model: the rules engine is the client's (words-engine.ts); the server
# validates shape, never legality. It does enforce that only a listed player can
# create a game or write its state, and that every stored field is valid. The
# protocol itself - ordering, snapshots, reconciliation - is shared with chess
# and go in lib/games.star.

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

# Packaged word lists, consulted by dictionary_contains. Held as files rather
# than loaded into a table: the words are identical for every account, so a
# per-user copy cost 22 MB each.
DICTIONARIES = {
	"en_US": "dictionaries/en_US.txt",
	"en_UK": "dictionaries/en_UK.txt",
}

def rack_value(rack):
	"""Sum the point values of tiles in a rack string."""
	total = 0
	for ch in rack.elems():
		total += TILE_VALUES.get(ch, 0)
	return total

def game_finish(game, scores, out):
	"""Standard Scrabble end-of-game adjustments and winner. out is the slot
	that emptied its rack, or 0 for a pass-out. Ties break on the score before
	adjustments, then the lowest slot. Returns (adjusted, winner slot)."""
	adjusted = {}
	bonus = 0
	for n in range(1, game["player_count"] + 1):
		if n == out:
			# The row still holds the pre-move rack; the going-out player's
			# rack is empty by definition.
			penalty = 0
		else:
			penalty = rack_value(game["player" + str(n) + "_rack"])
		adjusted[n] = scores[n] - penalty
		if n != out:
			bonus += penalty
	if out:
		adjusted[out] = scores[out] + bonus
	victor = 1
	for n in range(2, game["player_count"] + 1):
		if adjusted[n] > adjusted[victor]:
			victor = n
		elif adjusted[n] == adjusted[victor] and scores[n] > scores[victor]:
			victor = n
	return adjusted, victor

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
	for i in range(len(chars) - 1, 0, -1):
		j = mochi.random.integer(0, i)
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
	if not textual(board_str):
		return False
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
	# Text first: a rack is the peer's, and len() of a number raises.
	if not textual(rack) or len(rack) > 7:
		return False
	for ch in rack.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			return False
	return True

# Fires the chat-message-arrival websocket wherever a messages row commits.
# Scoped to type='message': move / pass / exchange / resign carry per-event
# payloads the row cannot supply, so those paths write the websocket directly.
# Every frame that adds a chat row carries the row's id, so a client tells two
# rows apart however alike they are.
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
		"id": message["id"],
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
	if version == 6:
		# The word lists are read from the packaged files now. Each account held
		# its own copy of the same 451,897 immutable rows - 22 MB per database.
		mochi.db.execute("drop table if exists dictionary")
	if version == 5:
		# Event marker on game messages, so the client renders localised text
		# per viewer instead of the English sentence the acting host stored in
		# body. body keeps that sentence as the fallback for legacy rows and
		# clients. Same design as chess and go.
		found = False
		for column in mochi.db.table("messages"):
			if column["name"] == "event":
				found = True
		if not found:
			mochi.db.execute("alter table messages add column event text not null default ''")
	if version == 4:
		# Version tuple (revision, terminal, writer, event) - a scalar counter is not
		# a total order with independent writers. See lib/games.star.
		columns = []
		for column in mochi.db.table("games"):
			columns.append(column["name"])
		if "writer" not in columns:
			mochi.db.execute("alter table games add column writer text not null default ''")
		if "event" not in columns:
			mochi.db.execute("alter table games add column event text not null default ''")
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
		# Drop the broadcast tables left in the app data DB when broadcast state moved
		# to the per-app system DB - stale copies mislead diagnosis.
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
		writer text not null default '',
		event text not null default '',
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
		event text not null default '',
		created integer not null
	)""")
	mochi.db.execute("create index if not exists messages_game_created on messages( game, created )")

def action_user_asset(a):
	return game_asset(GAME, a)

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
	return next_seat(game, game["current_turn"])

def next_seat(game, seat):
	"""The seat whose turn follows seat."""
	if seat >= game["player_count"]:
		return 1
	return seat + 1

def event_turn_bound(e, game, seat, ends):
	"""Whether an inbound snapshot's turn is the one the sender's own act leaves: the seat after theirs while the game goes on, their own once it has ended (action_move and action_pass keep the turn on game over). Judged on the payload alone - a gate on our stored turn would refuse every later event once one snapshot had been refused."""
	turn = event_integer(e.content("current_turn"), None)
	if turn == None:
		return False
	if ends and e.content("status") != "active":
		return turn == seat
	return turn == next_seat(game, seat)

def event_integer(value, fallback):
	"""Parse an integer field off a P2P event. Returns fallback when the field
	is absent and None when it is present but malformed; a bare int() on a
	malformed value raises and aborts the whole handler."""
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
	return game_load(GAME, a)

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

GAME_COLUMNS = ["board", "bag",
	"player1_rack", "player2_rack", "player3_rack", "player4_rack",
	"player1_score", "player2_score", "player3_score", "player4_score",
	"current_turn", "move_count", "consecutive_passes", "status", "winner"]
GAME_TERMINAL = ["finished", "resigned"]

# Columns a websocket payload may carry. The snapshot the peers exchange holds
# every rack and the bag; the browser must not, because the UI hides other
# players' tiles and the viewer refetches its own rack through the API, which
# applies strip_other_racks.
GAME_PUBLIC = ["board", "player1_score", "player2_score", "player3_score",
	"player4_score", "current_turn", "move_count", "consecutive_passes",
	"status", "winner"]

def game_players(game):
	"""Entities entitled to write this game's state."""
	return [game["player" + str(n)] for n in range(1, game["player_count"] + 1)]

def player_name(game, id):
	"""A player's name from our own row, never the event's: a peer cannot rename itself per move."""
	return get_player_name(game, get_player_number(game, id))

def game_snapshot_valid(game, state):
	"""Validate a complete inbound snapshot before it can replace our row. A
	snapshot on any event type can replace board, bag, racks and scores, and no
	handler validates those fields itself."""
	# Every text column is text before anything else looks at it, so an empty
	# value can only be "": a list or a number passed the falsy test on the
	# winner, and was then bound into the update or stored and sent on in every
	# later snapshot.
	for column in ["board", "bag", "player1_rack", "player2_rack", "player3_rack", "player4_rack", "status", "winner"]:
		if not textual(state[column]):
			return False
	if not valid_board(state["board"]):
		return False
	if len(state["bag"]) > 200:
		return False
	for ch in state["bag"].elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			return False
	for n in range(1, 5):
		if not valid_rack(state["player" + str(n) + "_rack"]):
			return False
		if not mochi.text.valid(str(state["player" + str(n) + "_score"]), "integer"):
			return False
		if int(state["player" + str(n) + "_score"]) < -100000 or int(state["player" + str(n) + "_score"]) > 100000:
			return False
	if not mochi.text.valid(str(state["current_turn"]), "integer"):
		return False
	if not valid_turn(game, int(state["current_turn"])):
		return False
	if not mochi.text.valid(str(state["move_count"]), "integer"):
		return False
	if int(state["move_count"]) < 0 or int(state["move_count"]) > 10000:
		return False
	if not mochi.text.valid(str(state["consecutive_passes"]), "integer"):
		return False
	if int(state["consecutive_passes"]) < 0 or int(state["consecutive_passes"]) > game["player_count"]:
		return False
	if state["status"] not in ["active", "finished", "resigned"]:
		return False
	players = [game["player" + str(n)] for n in range(1, game["player_count"] + 1)]
	if state["winner"] and state["winner"] not in players:
		return False
	return True

# What lib/games.star needs of this app.
GAME = {
	"service": "words",
	"columns": GAME_COLUMNS,
	"terminal": GAME_TERMINAL,
	"public": GAME_PUBLIC,
	"players": game_players,
	"valid": game_snapshot_valid,
	"name": player_name,
	"hook": words_ensure_commit_hook,
	"outsider": "errors.not_a_player",
}

# Actions

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
		select id, language, player_count,
			player1, player1_name, player1_score,
			player2, player2_name, player2_score,
			player3, player3_name, player3_score,
			player4, player4_name, player4_score,
			current_turn, status, winner, board, move_count, consecutive_passes,
			updated, created
		from games
		where player1=? or player2=? or player3=? or player4=?
		order by updated desc
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

	mochi.service.call("notifications", "clear/object", game["id"])

	return {
		"data": {"game": strip_other_racks(game, a.user.identity.id), "identity": a.user.identity.id}
	}

def action_messages(a):
	return game_messages(GAME, a)

def action_send(a):
	return chat_send(GAME, a)

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

	# words_formed is the move's display label, not a rule - event_move accepts an
	# opponent's move without consulting the dictionary, so a test here would bind
	# only this server's player. Bound it as display text: it ships to peers.
	if words_formed:
		if len(words_formed) > 200 or not mochi.text.valid(words_formed, "name"):
			a.error.label(400, "errors.invalid_words")
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
	# Bound the running total, not the move: peers validate player scores, so a
	# total they reject writes into the row and forks the game permanently.
	if new_score < -100000 or new_score > 100000:
		a.error.label(400, "errors.invalid_score")
		return

	# Check for game over: player used all tiles and bag is empty
	new_move_count = game["move_count"] + 1
	game_over = len(new_rack) == 0 and len(new_bag) == 0
	new_status = "finished" if game_over else "active"
	winner = None

	# Standard end-of-game scoring. The winner comes from the adjusted totals, not
	# from who went out.
	score_updates = {}
	if game_over:
		scores = {}
		for i in range(1, game["player_count"] + 1):
			scores[i] = game["player" + str(i) + "_score"]
		scores[pnum] = new_score
		adjusted, victor = game_finish(game, scores, pnum)
		for i in range(1, game["player_count"] + 1):
			if i != pnum:
				score_updates["player" + str(i) + "_score"] = adjusted[i]
		new_score = adjusted[pnum]
		winner = game["player" + str(victor)]

	new_turn = next_turn(game) if not game_over else game["current_turn"]

	now = mochi.time.now()

	changes = {"board": board, "bag": new_bag, rack_key: new_rack, score_key: new_score,
		"current_turn": new_turn, "move_count": new_move_count,
		"consecutive_passes": 0, "status": new_status, "winner": winner}
	for k, v in score_updates.items():
		changes[k] = v
	state = game_write(GAME, game, changes, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert move message
	id = mochi.uid()
	move_label = words_formed if words_formed else "played"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label + " (+" + str(score) + ")", "play:" + str(score), now)

	ws_data = {
		"type": "move", "id": id, "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": move_label + " (+" + str(score) + ")",
		"event": "play:" + str(score),
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

	# No row id: each opponent keys its own row, since an id chosen here could
	# name a row it already holds.
	p2p_data = {
		"game": game["id"], "created": now, "name": a.user.identity.name,
		"body": move_label + " (+" + str(score) + ")",
		"event": "play:" + str(score),
		"board": board, "score": score, "player_number": pnum,
		"current_turn": new_turn, "move_count": new_move_count,
		"status": new_status, "winner": winner or "",
		"new_score": new_score,
		# Retained for peers that predate the snapshot: without a rack on the
		# move event they keep every opponent's OPENING rack for the whole
		# game and misvalue leftover tiles at the end.
		"rack": new_rack, "bag": new_bag,
	}
	for key, value in state.items():
		p2p_data[key] = value
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

	# Pass-out scoring: each player's own leftovers come off their own score,
	# nobody gains, and the winner comes from the adjusted totals.
	winner = None
	changes = {}
	if game_over:
		scores = {}
		for i in range(1, game["player_count"] + 1):
			scores[i] = game["player" + str(i) + "_score"]
		adjusted, victor = game_finish(game, scores, 0)
		for i in range(1, game["player_count"] + 1):
			changes["player" + str(i) + "_score"] = adjusted[i]
		winner = game["player" + str(victor)]

	now = mochi.time.now()
	changes["current_turn"] = new_turn
	changes["consecutive_passes"] = new_consecutive
	changes["status"] = new_status
	changes["winner"] = winner
	state = game_write(GAME, game, changes, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	id = mochi.uid()
	name = get_player_name(game, pnum)
	body = name + " passed"
	if game_over:
		body = body + " — game over"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, "pass:over" if game_over else "pass", now)

	ws_data = {
		"type": "move", "id": id, "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "pass": True,
		"event": "pass:over" if game_over else "pass",
		"current_turn": new_turn, "consecutive_passes": new_consecutive,
		"status": new_status, "winner": winner or "",
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / exchange / resign and the payload carries a pass-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	# No row id: each opponent keys its own row.
	p2p_data = {
		"game": game["id"], "created": now, "name": a.user.identity.name,
		"body": body, "pass": True,
	}
	for key, value in state.items():
		p2p_data[key] = value
	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "pass"},
			p2p_data
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

	state = game_write(GAME, game, {"bag": new_bag, rack_key: new_rack,
		"current_turn": new_turn, "consecutive_passes": 0}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	id = mochi.uid()
	name = get_player_name(game, pnum)
	body = name + " exchanged " + str(len(tiles_to_exchange)) + " tiles"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, "exchange:" + str(len(tiles_to_exchange)), now)

	ws_data = {
		"type": "move", "id": id, "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "exchange": True,
		"event": "exchange:" + str(len(tiles_to_exchange)),
		"current_turn": new_turn, "bag_count": len(new_bag),
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / pass / resign and the payload carries an exchange-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	# No row id: each opponent keys its own row.
	p2p_data = {
		"game": game["id"], "created": now, "name": a.user.identity.name,
		"body": body, "exchange": True,
		"tiles": len(tiles_to_exchange),
		# Retained for peers that predate the snapshot.
		"bag": new_bag, "rack": new_rack,
	}
	for key, value in state.items():
		p2p_data[key] = value
	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "exchange"},
			p2p_data
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
	# Seeded from None rather than a numeric floor: scores go negative (a move
	# may score negative, and end-of-game rack penalties subtract), so any
	# starting number can be above every remaining player and leave no winner.
	best_score = None
	winner = None
	for i in range(1, game["player_count"] + 1):
		if i == pnum:
			continue
		s = game["player" + str(i) + "_score"]
		if best_score == None or s > best_score:
			best_score = s
			winner = game["player" + str(i)]

	now = mochi.time.now()
	state = game_write(GAME, game, {"status": "resigned", "winner": winner}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# The row is the event and its player, with no prose: each client words it
	# in its own viewer's language from member and name.
	id = mochi.uid()
	member = a.user.identity.id
	name = a.user.identity.name
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, '', 'system', 'resign', ? )", id, game["id"], member, name, now)

	# Skip commit-hook conversion: the resign payload carries an event marker and the winner (sourced from the games row), neither of which is on the messages row alone — and the games.update is shared with move / pass / exchange.
	mochi.websocket.write(game["key"], {"type": "system", "id": id, "event": "resign", "created": now, "member": member, "name": name, "body": "", "winner": winner or ""})

	resign_data = {"game": game["id"], "created": now, "member": member, "name": name, "body": ""}
	for key, value in state.items():
		resign_data[key] = value
	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "resign"},
			resign_data
		)

	return {
		"data": {"success": True}
	}

def action_delete(a):
	return game_delete(GAME, a)

def action_validate_word(a):
	word = a.input("word", "")
	language = a.input("language", "en_US")

	if not word:
		a.error.label(400, "errors.word_is_required")
		return
	if language not in ["en_US", "en_UK"]:
		a.error.label(400, "errors.invalid_language")
		return

	# Letters only: the list scan matches a whole line, so a word carrying a
	# line break matched two adjacent entries as one "word".
	word = word.strip()
	if not mochi.text.valid(word, "^[A-Za-z]{2,15}$"):
		return {"data": {"valid": False}}

	return {
		"data": {"valid": dictionary_contains(word, language)}
	}

def dictionary_contains(word, language):
	"""Whether word appears in the packaged word list for language.

	Core answers it where it can: mochi.app.asset.contains searches the
	sorted list without bringing it into the interpreter. The lists are
	lowercase, one word per line, sorted bytewise, which is what that search
	needs.

	A core without it has the list read per call. mochi.app.asset.read is
	uncached and the read cannot be hoisted: a module-level call runs on a
	thread carrying no app, so it fails and takes every definition in this
	file with it, and a global cache is impossible because Starlark freezes
	module globals. What makes that affordable is scanning for the word
	rather than splitting on newlines - the scan is a single pass in Go over
	the bytes, where split() would build a list of 279,000 strings and cost
	nine times as much.
	"""
	file = DICTIONARIES.get(language)
	if not file:
		return False
	needle = word.lower()
	if hasattr(mochi.app.asset, "contains"):
		return mochi.app.asset.contains(file, needle)
	content = mochi.app.asset.read(file)
	if not content:
		return False

	# The lists are lowercase, one word per line, and end WITHOUT a trailing
	# newline - so the first and last words carry a separator on one side
	# only and a "\n<word>\n" scan alone would report both as invalid.
	text = str(content)
	if text.startswith(needle + "\n") or text.endswith("\n" + needle):
		return True
	return ("\n" + needle + "\n") in text

# P2P Events

def event_new(e):
	f = mochi.service.call("friends", "get", e.header("to"), e.header("from"))
	if not f:
		return

	# Every field is decoded JSON under the peer's control: mochi.text.valid
	# and len() raise on a non-string, which would abort the handler and mail
	# the administrator on every redelivery, so each is read as text first.
	game_id = str(e.content("id") or "")
	if not mochi.text.valid(game_id, "id"):
		return

	language = str(e.content("language") or "en_US")
	player_count = e.content("player_count")
	if not player_count or not mochi.text.valid(str(player_count), "integer"):
		return
	player_count = int(player_count)
	if player_count < 2 or player_count > 4:
		return

	p1 = str(e.content("player1") or "")
	p1_name = str(e.content("player1_name") or "")
	p2 = str(e.content("player2") or "")
	p2_name = str(e.content("player2_name") or "")
	p3 = str(e.content("player3") or "")
	p3_name = str(e.content("player3_name") or "")
	p4 = str(e.content("player4") or "")
	p4_name = str(e.content("player4_name") or "")

	board = e.content("board") or empty_board()
	created = event_created(e, mochi.time.now())
	if created == None:
		return

	# Verify this player is in the game
	my_id = e.header("to")
	if my_id not in [p1, p2, p3, p4]:
		return

	# ...and that the sender is the creator, who is always player one
	# (action_create): the friend check above only proves they are OUR
	# friend, and a friend naming us as the creator would plant a game we
	# never started. The creator's name is the friend record's, not the
	# wire's, for the same reason.
	if e.header("from") != p1:
		return
	p1_name = str(f["name"] or "")

	# One entity per player slot, same rule action_create enforces: a
	# duplicated player wedges the game once play reaches their second
	# slot, so refuse to store one that arrives already broken.
	filled = [p for p in [p1, p2, p3, p4] if p]
	for i in range(len(filled)):
		for j in range(i + 1, len(filled)):
			if filled[i] == filled[j]:
				return

	# Use bag and racks from the creating server
	bag = str(e.content("bag") or "")
	rack1 = str(e.content("player1_rack") or "")
	rack2 = str(e.content("player2_rack") or "")
	rack3 = str(e.content("player3_rack") or "")
	rack4 = str(e.content("player4_rack") or "")

	# Validate every stored field: game_snapshot_valid guards later state, but a
	# row planted here is stored raw, and a player_count above the filled slots
	# wedges the game when the turn reaches an empty slot.
	if language not in ["en_US", "en_UK"]:
		return
	if not valid_board(board):
		return
	if len(bag) > 200:
		return
	for ch in bag.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			return
	if len(filled) != player_count:
		return
	for player in filled:
		if not mochi.text.valid(player, "entity"):
			return
	for name in [p1_name, p2_name, p3_name, p4_name]:
		if name and not mochi.text.valid(name, "name"):
			return
	if not p1_name or not p2_name or (p3 and not p3_name) or (p4 and not p4_name):
		return
	for rack in [rack1, rack2, rack3, rack4]:
		if not valid_rack(rack):
			return

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

	# The validated local, not a re-read of the payload: the checks above have
	# already refused an empty or malformed player1_name, so the fallback that
	# stood here was both unreachable and untranslated.
	sender_name = p1_name
	notify("activity", game_id, mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.started_game", name=sender_name), "/words/" + game_id, event_id="game:" + game_id, name=sender_name)

def event_move(e):
	game = game_event(GAME, e)
	if not game:
		return
	sender = e.header("from")

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

	# Do not gate on move_count here: a second ordering ahead of the version tuple
	# drops a concurrent resignation, which carries a lower move_count.
	if not event_turn_bound(e, game, player_number, True):
		return

	# The label ships as display text; action_move bounds it the same way.
	body = event_body(e.content("body"), 200, "")
	if body and not mochi.text.valid(body, "name"):
		body = ""
	name = get_player_name(game, player_number)

	bag = e.content("bag")

	now = mochi.time.now()
	state = game_apply(GAME, e, game, now)
	if state == None:
		return

	created = event_created(e, now)
	if created == None:
		created = now

	# The receiver stamps the marker from what it validated, not from any
	# sender text, so the row localises for this viewer whatever language the
	# acting host spoke. The row's id is our own: the version tuple has already
	# refused a redelivery, and an id the peer chose could name a row we hold,
	# leaving an applied move with no row, no frame and no notification.
	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, "play:" + str(score), created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	# Only the keys GAME_PUBLIC does not carry: everything it does list - board,
	# current_turn, move_count, status, winner and every playerN_score - is
	# overwritten from the applied snapshot by the loop below.
	ws_data = {
		"type": "move", "id": id, "created": created, "member": sender, "name": name,
		"body": body, "event": "play:" + str(score),
		"score": score, "player_number": player_number,
		"bag_count": bag_count,
	}
	# Skip commit-hook conversion: matches action_move — shared (games, update) shape and per-move score delta isn't in the row.
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", game["id"], mochi.app.label("notifications.title.move"), mochi.app.label("notifications.body.played_move", name=name, move=body), "/words/" + game["id"], event_id="move:" + id, name=name)

def event_pass(e):
	game = game_event(GAME, e)
	if not game:
		return
	sender = e.header("from")

	player_number = get_player_number(game, sender)
	name = get_player_name(game, player_number)
	# Our own label: the row renders from the marker, and the wire body was
	# the actor's language.
	body = mochi.app.label("notifications.body.passed", name=name)
	if not event_turn_bound(e, game, player_number, True):
		return

	now = mochi.time.now()
	state = game_apply(GAME, e, game, now)
	if state == None:
		return

	created = event_created(e, now)
	if created == None:
		created = now

	marker = "pass:over" if state["status"] != "active" else "pass"
	# Our own id, as event_move's.
	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, marker, created)

	# Only the keys GAME_PUBLIC does not carry; the applied snapshot supplies
	# the rest below.
	ws_data = {
		"type": "move", "id": id, "created": now, "member": sender, "name": name,
		"body": body, "pass": True, "event": marker,
	}
	# Skip commit-hook conversion: matches action_pass — shared (games, update) shape and a pass flag the hook can't infer from row state.
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", game["id"], mochi.app.label("notifications.title.words"), mochi.app.label("notifications.body.passed", name=name), "/words/" + game["id"], event_id="pass:" + id, name=name)

def event_exchange(e):
	game = game_event(GAME, e)
	if not game:
		return
	sender = e.header("from")

	player_number = get_player_number(game, sender)
	name = get_player_name(game, player_number)
	# Our own label: the row renders from the marker, and the wire body was
	# the actor's language.
	body = mochi.app.label("notifications.body.exchanged_tiles", name=name)
	# An exchange never ends the game, so the turn always moves on.
	if not event_turn_bound(e, game, player_number, False):
		return

	bag = e.content("bag")

	# Tile count for the localised "exchanged N tiles" row. Additive wire
	# field: an old peer sends none and the row falls back to its body text.
	tiles = event_integer(e.content("tiles"), None)
	exchange_marker = ""
	if tiles != None and tiles >= 0 and tiles <= 7:
		exchange_marker = "exchange:" + str(tiles)

	now = mochi.time.now()
	state = game_apply(GAME, e, game, now)
	if state == None:
		return

	created = event_created(e, now)
	if created == None:
		created = now

	# Our own id, as event_move's.
	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, exchange_marker, created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	# Only the keys GAME_PUBLIC does not carry; the applied snapshot supplies
	# the rest below.
	ws_data = {
		"type": "move", "id": id, "created": now, "member": sender, "name": name,
		"body": body, "exchange": True, "event": exchange_marker,
		"bag_count": bag_count,
	}
	# Skip commit-hook conversion: matches action_exchange — shared (games, update) shape and an exchange flag the hook can't infer from row state.
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", game["id"], mochi.app.label("notifications.title.words"), mochi.app.label("notifications.body.exchanged_tiles", name=name), "/words/" + game["id"], event_id="exchange:" + id, name=name)

def event_sync(e):
	game_sync(GAME, e)

def event_message(e):
	chat_receive(GAME, e)

def event_resign(e):
	game = game_event(GAME, e)
	if not game:
		return
	sender = e.header("from")

	# A resignation is the sender's own: its status says so, and its winner is
	# another player. Words awards the highest remaining score, so "not the
	# sender" is the bind available.
	winner = e.content("winner")
	if e.content("status") != "resigned" or winner == sender or winner not in game_players(game):
		return

	# The winner is read from the applied snapshot.
	now = mochi.time.now()
	state = game_apply(GAME, e, game, now)
	if state == None:
		return

	id = mochi.uid()
	# The same shape action_resign stores: the event and its player, no prose.
	# The player is the verified sender and the name comes from our own row,
	# not from the payload's member and name.
	name = get_player_name(game, get_player_number(game, sender))
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, '', 'system', 'resign', ? )", id, game["id"], sender, name, now)

	# Skip commit-hook conversion: matches action_resign — payload carries an event marker and the winner from the games row, neither of which is on the messages row alone.
	ws_data = {"type": "system", "id": id, "event": "resign", "created": now, "member": sender, "name": name, "body": ""}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", game["id"], mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.opponent_resigned"), "/words/" + game["id"], event_id="resign:" + game["id"], name=name)
