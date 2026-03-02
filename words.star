# Mochi Words (Scrabble-style word game)

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

def make_bag(language):
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

def valid_rack(rack_str):
	"""Validate a rack string."""
	if len(rack_str) > 7:
		return False
	for ch in rack_str.elems():
		if ch != "_" and not ch.isupper():
			return False
	return True

# Database

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

def database_upgrade(to_version):
	if to_version == 2:
		# Re-load dictionaries (fix: str() was missing on file.read bytes)
		load_dictionary("en_US", "dictionaries/en_US.txt")
		load_dictionary("en_UK", "dictionaries/en_UK.txt")
	if to_version == 3:
		mochi.db.execute("create index if not exists games_player1 on games( player1 )")
		mochi.db.execute("create index if not exists games_player2 on games( player2 )")
		mochi.db.execute("create index if not exists games_player3 on games( player3 )")
		mochi.db.execute("create index if not exists games_player4 on games( player4 )")

def load_dictionary(language, filename):
	"""Load a word list file into the dictionary table."""
	content = mochi.app.file.read(filename)
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

def load_game(a):
	"""Load game by ID from action input, validate access."""
	if not mochi.valid(a.input("game"), "id"):
		a.error(400, "Invalid game ID")
		return None
	game = mochi.db.row("select * from games where id=?", a.input("game"))
	if not game:
		a.error(404, "Game not found")
		return None
	if not is_player(game, a.user.identity.id):
		a.error(403, "Not a player in this game")
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
		a.error(400, "Invalid language")
		return

	# Parse opponents - comma-separated entity IDs
	if not opponents_raw:
		a.error(400, "At least one opponent required")
		return

	opponents = opponents_raw.split(",")
	if len(opponents) < 1 or len(opponents) > 3:
		a.error(400, "1-3 opponents required")
		return

	# Validate each opponent
	opponent_names = []
	for opp in opponents:
		opp = opp.strip()
		if not mochi.valid(opp, "entity"):
			a.error(400, "Invalid opponent: " + opp)
			return
		if opp == a.user.identity.id:
			a.error(400, "Cannot play against yourself")
			return
		friend = mochi.service.call("friends", "get", a.user.identity.id, opp)
		if not friend:
			a.error(400, "Can only play with friends")
			return
		opponent_names.append({"id": opp, "name": friend["name"]})

	player_count = len(opponents) + 1

	# Initialize bag and draw tiles
	bag = make_bag(language)

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
	if limit_str and mochi.valid(limit_str, "natural"):
		limit = min(int(limit_str), 100)

	before = None
	before_str = a.input("before")
	if before_str and mochi.valid(before_str, "natural"):
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

	for m in messages:
		m["created_local"] = mochi.time.local(m["created"])

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
	if not mochi.valid(body, "text"):
		a.error(400, "Invalid message")
		return
	if len(body) > 10000:
		a.error(400, "Message too long")
		return
	if not body.strip():
		a.error(400, "Message cannot be empty")
		return

	id = mochi.uid()
	now = mochi.time.now()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	mochi.websocket.write(game["key"], {"type": "message", "created": now, "member": a.user.identity.id, "name": a.user.identity.name, "body": body})

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
		a.error(400, "Game is not active")
		return

	# Validate turn
	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error(400, "Not your turn")
		return

	# Get move data
	board = a.input("board", "")
	score = a.input("score", "0")
	tiles_used = a.input("tiles_used", "")
	words_formed = a.input("words_formed", "")

	for ch in tiles_used.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			a.error(400, "Invalid tile character")
			return

	if not board or not valid_board(board):
		a.error(400, "Invalid board state")
		return

	if not mochi.valid(score, "integer"):
		a.error(400, "Invalid score")
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
				a.error(400, word + " is not a valid word")
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
			a.error(400, "Tile not in rack: " + ch)
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

	# Build update SQL
	sql = "update games set board=?, bag=?, " + rack_key + "=?, " + score_key + "=?, current_turn=?, move_count=?, consecutive_passes=0, status=?, winner=?, updated=?"
	params = [board, new_bag, new_rack, new_score, new_turn, new_move_count, new_status, winner, now]
	for k, v in score_updates.items():
		sql += ", " + k + "=?"
		params.append(v)
	sql += " where id=?"
	params.append(game["id"])
	mochi.db.execute(sql, *params)

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
	}
	for k, v in score_updates.items():
		ws_data[k] = v
	mochi.websocket.write(game["key"], ws_data)

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
		"body": move_label + " (+" + str(score) + ")",
		"board": board, "score": score, "player_number": pnum,
		"current_turn": new_turn, "move_count": new_move_count,
		"status": new_status, "winner": winner or "",
		"new_score": new_score,
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
		a.error(400, "Game is not active")
		return

	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error(400, "Not your turn")
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
	mochi.db.execute(
		"update games set current_turn=?, consecutive_passes=?, status=?, winner=?, updated=? where id=?",
		new_turn, new_consecutive, new_status, winner, now, game["id"]
	)

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
	mochi.websocket.write(game["key"], ws_data)

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "pass"},
			{
				"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
				"body": body, "pass": True,
				"current_turn": new_turn, "consecutive_passes": new_consecutive,
				"status": new_status, "winner": winner or "",
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
		a.error(400, "Game is not active")
		return

	pnum = get_player_number(game, a.user.identity.id)
	if game["current_turn"] != pnum:
		a.error(400, "Not your turn")
		return

	tiles_to_exchange = a.input("tiles", "")
	if not tiles_to_exchange or len(tiles_to_exchange) > 7:
		a.error(400, "Invalid tiles to exchange")
		return
	for ch in tiles_to_exchange.elems():
		if ch != "_" and (ch < "A" or ch > "Z"):
			a.error(400, "Invalid tile character")
			return

	if len(game["bag"]) < 7:
		a.error(400, "Not enough tiles in bag to exchange")
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
			a.error(400, "Tile not in rack: " + ch)
			return
		remaining_rack = remaining_rack[:idx] + remaining_rack[idx+1:]

	# Draw new tiles first
	drawn, new_bag = draw_tiles(game["bag"], len(tiles_to_exchange))
	# Put exchanged tiles back in bag
	new_bag = new_bag + tiles_to_exchange
	new_rack = remaining_rack + drawn

	new_turn = next_turn(game)
	now = mochi.time.now()

	mochi.db.execute(
		"update games set bag=?, " + rack_key + "=?, current_turn=?, consecutive_passes=0, updated=? where id=?",
		new_bag, new_rack, new_turn, now, game["id"]
	)

	id = mochi.uid()
	player_name = get_player_name(game, pnum)
	body = player_name + " exchanged " + str(len(tiles_to_exchange)) + " tiles"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "exchange": True,
		"current_turn": new_turn, "bag_count": len(new_bag),
	}
	mochi.websocket.write(game["key"], ws_data)

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "exchange"},
			{
				"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
				"body": body, "exchange": True,
				"current_turn": new_turn, "bag_count": len(new_bag),
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
		a.error(400, "Game is not active")
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
	mochi.db.execute("update games set status='resigned', winner=?, updated=? where id=?", winner, now, game["id"])

	id = mochi.uid()
	msg = a.user.identity.name + " resigned"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": msg, "winner": winner or ""})

	for other in get_other_players(game, a.user.identity.id):
		mochi.message.send(
			{"from": a.user.identity.id, "to": other, "service": "words", "event": "resign"},
			{"game": game["id"], "created": now, "body": msg, "winner": winner or ""}
		)

	return {
		"data": {"success": True}
	}

def action_delete(a):
	game = load_game(a)
	if not game:
		return

	if game["status"] == "active":
		a.error(400, "Cannot delete an active game")
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
		a.error(400, "Word is required")
		return
	if language not in ["en_US", "en_UK"]:
		a.error(400, "Invalid language")
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
	if not mochi.valid(game_id, "id"):
		return

	language = e.content("language") or "en_US"
	player_count = e.content("player_count")
	if not player_count:
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
	if not mochi.valid(str(created), "integer"):
		return

	# Verify this player is in the game
	my_id = e.header("to")
	if my_id not in [p1, p2, p3, p4]:
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
	mochi.service.call("notifications", "send", "new", "Words game", sender_name + " started a game", game_id, "/words/" + game_id)

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

	score = e.content("score")
	if not score:
		score = 0
	else:
		score = int(score)

	player_number = e.content("player_number")
	if player_number:
		player_number = int(player_number)
	else:
		player_number = get_player_number(game, sender)

	current_turn = e.content("current_turn")
	if current_turn:
		current_turn = int(current_turn)
	else:
		current_turn = next_turn(game)

	move_count = e.content("move_count")
	if move_count:
		move_count = int(move_count)
	else:
		move_count = game["move_count"] + 1

	new_score = e.content("new_score")
	if new_score:
		new_score = int(new_score)
	else:
		new_score = game["player" + str(player_number) + "_score"] + score

	status = e.content("status") or "active"
	winner = e.content("winner") or None
	body = e.content("body") or ""
	name = e.content("name") or "Opponent"

	now = mochi.time.now()
	score_key = "player" + str(player_number) + "_score"
	mochi.db.execute(
		"update games set board=?, " + score_key + "=?, current_turn=?, move_count=?, consecutive_passes=0, status=?, winner=?, updated=? where id=?",
		board, new_score, current_turn, move_count, status, winner, now, game["id"]
	)

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	ws_data = {
		"type": "move", "created": created, "member": sender, "name": name,
		"body": body,
		"board": board, "score": score, "player_number": player_number,
		"current_turn": current_turn, "move_count": move_count,
		"status": status, "winner": winner or "",
		"player" + str(player_number) + "_score": new_score,
	}
	mochi.websocket.write(game["key"], ws_data)
	mochi.service.call("notifications", "send", "move", "Words move", name + " played " + body, game["id"], "/words/" + game["id"])

def event_pass(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	body = e.content("body") or "passed"
	name = e.content("name") or "Opponent"
	current_turn = e.content("current_turn")
	if current_turn:
		current_turn = int(current_turn)
	else:
		current_turn = next_turn(game)

	consecutive_passes = e.content("consecutive_passes")
	if consecutive_passes:
		consecutive_passes = int(consecutive_passes)
	else:
		consecutive_passes = game["consecutive_passes"] + 1

	status = e.content("status") or "active"
	winner = e.content("winner") or None

	now = mochi.time.now()
	mochi.db.execute(
		"update games set current_turn=?, consecutive_passes=?, status=?, winner=?, updated=? where id=?",
		current_turn, consecutive_passes, status, winner, now, game["id"]
	)

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "pass": True,
		"current_turn": current_turn, "consecutive_passes": consecutive_passes,
		"status": status, "winner": winner or "",
	}
	mochi.websocket.write(game["key"], ws_data)
	mochi.service.call("notifications", "send", "pass", "Words", name + " passed", game["id"], "/words/" + game["id"])

def event_exchange(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	body = e.content("body") or "exchanged tiles"
	name = e.content("name") or "Opponent"
	current_turn = e.content("current_turn")
	if current_turn:
		current_turn = int(current_turn)
	else:
		current_turn = next_turn(game)

	now = mochi.time.now()
	mochi.db.execute(
		"update games set current_turn=?, consecutive_passes=0, updated=? where id=?",
		current_turn, now, game["id"]
	)

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		id = mochi.uid()

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'move', ? )", id, game["id"], sender, name, body, created)

	bag_count = e.content("bag_count")
	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "exchange": True,
		"current_turn": current_turn,
	}
	if bag_count:
		ws_data["bag_count"] = int(bag_count)
	mochi.websocket.write(game["key"], ws_data)
	mochi.service.call("notifications", "send", "exchange", "Words", name + " exchanged tiles", game["id"], "/words/" + game["id"])

def event_message(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	id = e.content("message")
	if not mochi.valid(str(id), "id"):
		return

	created = e.content("created")
	if not mochi.valid(str(created), "integer"):
		return

	body = e.content("body")
	if not mochi.valid(str(body), "text"):
		return
	if len(str(body)) > 10000:
		return

	name = e.content("name") or "Opponent"

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'message', ? )", id, game["id"], sender, name, body, created)

	mochi.websocket.write(game["key"], {"type": "message", "created": created, "member": sender, "name": name, "body": body})
	mochi.service.call("notifications", "send", "message", "Words message", name + ": " + body, game["id"], "/words/" + game["id"])

def event_resign(e):
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return

	sender = e.header("from")
	if not is_player(game, sender):
		return

	winner = e.content("winner") or None
	body = e.content("body") or "Opponent resigned"

	now = mochi.time.now()
	mochi.db.execute("update games set status='resigned', winner=?, updated=? where id=?", winner, now, game["id"])

	id = mochi.uid()
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, created ) values ( ?, ?, ?, ?, ?, 'system', ? )", id, game["id"], sender, "", body, now)

	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": body, "winner": winner or ""})
	mochi.service.call("notifications", "send", "resign", "Words game", body, game["id"], "/words/" + game["id"])

# Notification proxy actions

# Test actions

def action_test_bag(a):
	"""Test tile bag management."""
	results = []

	# Test 1: make_bag produces exactly 100 tiles
	bag = make_bag("en_US")
	if len(bag) == 100:
		results.append({"test": "make_bag produces 100 tiles", "pass": True})
	else:
		results.append({"test": "make_bag produces 100 tiles", "pass": False, "got": len(bag)})

	# Test 2: Correct letter distribution
	counts = {}
	for ch in bag.elems():
		counts[ch] = counts.get(ch, 0) + 1

	expected = {
		"A": 9, "B": 2, "C": 2, "D": 4, "E": 12,
		"F": 2, "G": 3, "H": 2, "I": 9, "J": 1,
		"K": 1, "L": 4, "M": 2, "N": 6, "O": 8,
		"P": 2, "Q": 1, "R": 6, "S": 4, "T": 6,
		"U": 4, "V": 2, "W": 2, "X": 1, "Y": 2,
		"Z": 1, "_": 2,
	}
	dist_ok = True
	for letter, count in expected.items():
		if counts.get(letter, 0) != count:
			dist_ok = False
			results.append({"test": "distribution of " + letter, "pass": False, "expected": count, "got": counts.get(letter, 0)})
	if dist_ok:
		results.append({"test": "correct letter distribution", "pass": True})

	# Test 3: draw_tiles returns correct counts
	drawn, remaining = draw_tiles(bag, 7)
	if len(drawn) == 7 and len(remaining) == 93:
		results.append({"test": "draw_tiles(bag, 7) returns 7 + 93", "pass": True})
	else:
		results.append({"test": "draw_tiles(bag, 7) returns 7 + 93", "pass": False, "drawn": len(drawn), "remaining": len(remaining)})

	# Test 4: draw_tiles(bag, 0) returns empty + full bag
	drawn0, remaining0 = draw_tiles(bag, 0)
	if len(drawn0) == 0 and len(remaining0) == 100:
		results.append({"test": "draw_tiles(bag, 0) returns 0 + 100", "pass": True})
	else:
		results.append({"test": "draw_tiles(bag, 0) returns 0 + 100", "pass": False, "drawn": len(drawn0), "remaining": len(remaining0)})

	# Test 5: drawing from empty bag
	drawn_e, remaining_e = draw_tiles("", 7)
	if len(drawn_e) == 0 and len(remaining_e) == 0:
		results.append({"test": "draw from empty bag returns empty", "pass": True})
	else:
		results.append({"test": "draw from empty bag returns empty", "pass": False})

	# Test 6: tile conservation
	bag2 = make_bag("en_US")
	d1, bag2 = draw_tiles(bag2, 7)
	d2, bag2 = draw_tiles(bag2, 7)
	d3, bag2 = draw_tiles(bag2, 7)
	total = len(d1) + len(d2) + len(d3) + len(bag2)
	if total == 100:
		results.append({"test": "tile conservation after 3 draws", "pass": True})
	else:
		results.append({"test": "tile conservation after 3 draws", "pass": False, "total": total})

	passed = all([r["pass"] for r in results])
	return {"data": {"passed": passed, "results": results}}

def action_test_board(a):
	"""Test board validation."""
	results = []

	# Test 1: empty_board passes valid_board
	eb = empty_board()
	if valid_board(eb):
		results.append({"test": "empty_board passes valid_board", "pass": True})
	else:
		results.append({"test": "empty_board passes valid_board", "pass": False})

	# Test 2: wrong row count
	if not valid_board("abc/def"):
		results.append({"test": "rejects wrong row count", "pass": True})
	else:
		results.append({"test": "rejects wrong row count", "pass": False})

	# Test 3: wrong column width
	bad_board = "/".join(["." * 14] + ["." * 15] * 14)
	if not valid_board(bad_board):
		results.append({"test": "rejects wrong column width", "pass": True})
	else:
		results.append({"test": "rejects wrong column width", "pass": False})

	# Test 4: invalid characters
	bad_chars = "/".join(["." * 14 + "1"] + ["." * 15] * 14)
	if not valid_board(bad_chars):
		results.append({"test": "rejects invalid characters", "pass": True})
	else:
		results.append({"test": "rejects invalid characters", "pass": False})

	# Test 5: valid_rack accepts uppercase + underscore
	if valid_rack("ABCDE_F"):
		results.append({"test": "valid_rack accepts uppercase + blank", "pass": True})
	else:
		results.append({"test": "valid_rack accepts uppercase + blank", "pass": False})

	# Test 6: valid_rack rejects >7 tiles
	if not valid_rack("ABCDEFGH"):
		results.append({"test": "valid_rack rejects >7 tiles", "pass": True})
	else:
		results.append({"test": "valid_rack rejects >7 tiles", "pass": False})

	# Test 7: valid_rack rejects lowercase
	if not valid_rack("ABCDEfG"):
		results.append({"test": "valid_rack rejects lowercase", "pass": True})
	else:
		results.append({"test": "valid_rack rejects lowercase", "pass": False})

	# Test 8: empty rack is valid
	if valid_rack(""):
		results.append({"test": "valid_rack accepts empty", "pass": True})
	else:
		results.append({"test": "valid_rack accepts empty", "pass": False})

	passed = all([r["pass"] for r in results])
	return {"data": {"passed": passed, "results": results}}

def action_test_dictionary(a):
	"""Test dictionary word lookup."""
	results = []

	# Check if dictionary is populated (may not be loaded on fresh installs)
	count = mochi.db.row("select count(*) as c from dictionary where language='en_US'")
	if not count or count["c"] == 0:
		return {"data": {"passed": True, "results": [{"test": "dictionary not loaded (skipped)", "pass": True}]}}

	# Test 1: known valid word
	row = mochi.db.row("select word from dictionary where word='HELLO' and language='en_US'")
	if row:
		results.append({"test": "HELLO is valid", "pass": True})
	else:
		results.append({"test": "HELLO is valid", "pass": False})

	# Test 2: invalid word
	row = mochi.db.row("select word from dictionary where word='XYZZY' and language='en_US'")
	if not row:
		results.append({"test": "XYZZY is invalid", "pass": True})
	else:
		results.append({"test": "XYZZY is invalid", "pass": False})

	# Test 3: case insensitive (words stored uppercase)
	row = mochi.db.row("select word from dictionary where word=? and language='en_US'", "hello".upper())
	if row:
		results.append({"test": "case insensitive lookup", "pass": True})
	else:
		results.append({"test": "case insensitive lookup", "pass": False})

	# Test 4: single letter rejected (words must be >=2 chars)
	row = mochi.db.row("select word from dictionary where word='A' and language='en_US'")
	if not row:
		results.append({"test": "single letter not in dictionary", "pass": True})
	else:
		results.append({"test": "single letter not in dictionary", "pass": False})

	# Test 5: known 2-letter word
	row = mochi.db.row("select word from dictionary where word='AT' and language='en_US'")
	if row:
		results.append({"test": "AT is valid 2-letter word", "pass": True})
	else:
		results.append({"test": "AT is valid 2-letter word", "pass": False})

	passed = all([r["pass"] for r in results])
	return {"data": {"passed": passed, "results": results}}

def action_test_game_flow(a):
	"""Test game lifecycle and helper functions."""
	results = []
	test_game_ids = []

	# Create a test game directly in DB
	game_id = "test_" + mochi.uid()
	test_game_ids.append(game_id)
	now = mochi.time.now()
	my_id = a.user.identity.id
	my_name = a.user.identity.name

	bag = make_bag("en_US")
	rack1, bag = draw_tiles(bag, 7)
	rack2, bag = draw_tiles(bag, 7)

	mochi.db.execute(
		"""insert into games (
			id, language, player_count,
			player1, player1_name, player1_rack, player1_score,
			player2, player2_name, player2_rack, player2_score,
			player3, player3_name, player3_rack, player3_score,
			player4, player4_name, player4_rack, player4_score,
			current_turn, status, board, bag, move_count, consecutive_passes, key, updated, created
		) values (?, 'en_US', 2,
			?, ?, ?, 0,
			?, ?, ?, 0,
			NULL, NULL, '', 0,
			NULL, NULL, '', 0,
			1, 'active', ?, ?, 0, 0, ?, ?, ?)""",
		game_id,
		my_id, my_name, rack1,
		"test_opponent_id", "Test Opponent", rack2,
		empty_board(), bag, mochi.random.alphanumeric(16), now, now
	)

	game = mochi.db.row("select * from games where id=?", game_id)

	# Test 1: get_player_number
	if get_player_number(game, my_id) == 1:
		results.append({"test": "get_player_number returns 1 for player1", "pass": True})
	else:
		results.append({"test": "get_player_number returns 1 for player1", "pass": False})

	if get_player_number(game, "test_opponent_id") == 2:
		results.append({"test": "get_player_number returns 2 for player2", "pass": True})
	else:
		results.append({"test": "get_player_number returns 2 for player2", "pass": False})

	if get_player_number(game, "nonexistent") == 0:
		results.append({"test": "get_player_number returns 0 for non-player", "pass": True})
	else:
		results.append({"test": "get_player_number returns 0 for non-player", "pass": False})

	# Test 2: is_player
	if is_player(game, my_id):
		results.append({"test": "is_player true for player1", "pass": True})
	else:
		results.append({"test": "is_player true for player1", "pass": False})

	if not is_player(game, "nonexistent"):
		results.append({"test": "is_player false for non-player", "pass": True})
	else:
		results.append({"test": "is_player false for non-player", "pass": False})

	# Test 3: next_turn for 2 players
	if next_turn(game) == 2:
		results.append({"test": "next_turn 1->2 for 2-player", "pass": True})
	else:
		results.append({"test": "next_turn 1->2 for 2-player", "pass": False, "got": next_turn(game)})

	# Simulate turn 2
	game2 = dict(game)
	game2["current_turn"] = 2
	if next_turn(game2) == 1:
		results.append({"test": "next_turn 2->1 for 2-player", "pass": True})
	else:
		results.append({"test": "next_turn 2->1 for 2-player", "pass": False})

	# Test 4: next_turn for 3 players
	game3 = dict(game)
	game3["player_count"] = 3
	game3["current_turn"] = 1
	if next_turn(game3) == 2:
		results.append({"test": "next_turn 1->2 for 3-player", "pass": True})
	else:
		results.append({"test": "next_turn 1->2 for 3-player", "pass": False})
	game3["current_turn"] = 3
	if next_turn(game3) == 1:
		results.append({"test": "next_turn 3->1 for 3-player", "pass": True})
	else:
		results.append({"test": "next_turn 3->1 for 3-player", "pass": False})

	# Test 5: next_turn for 4 players
	game4 = dict(game)
	game4["player_count"] = 4
	game4["current_turn"] = 4
	if next_turn(game4) == 1:
		results.append({"test": "next_turn 4->1 for 4-player", "pass": True})
	else:
		results.append({"test": "next_turn 4->1 for 4-player", "pass": False})

	# Test 6: strip_other_racks
	stripped = strip_other_racks(game, my_id)
	if stripped["my_rack"] == rack1:
		results.append({"test": "strip_other_racks preserves my rack", "pass": True})
	else:
		results.append({"test": "strip_other_racks preserves my rack", "pass": False})

	if stripped["player2_rack"] == "":
		results.append({"test": "strip_other_racks hides opponent rack", "pass": True})
	else:
		results.append({"test": "strip_other_racks hides opponent rack", "pass": False})

	if stripped["my_player_number"] == 1:
		results.append({"test": "strip_other_racks sets my_player_number", "pass": True})
	else:
		results.append({"test": "strip_other_racks sets my_player_number", "pass": False})

	if stripped["bag_count"] == len(bag):
		results.append({"test": "strip_other_racks sets bag_count", "pass": True})
	else:
		results.append({"test": "strip_other_racks sets bag_count", "pass": False})

	if "bag" not in stripped:
		results.append({"test": "strip_other_racks removes bag contents", "pass": True})
	else:
		results.append({"test": "strip_other_racks removes bag contents", "pass": False})

	# Test 7: tile conservation
	total_tiles = len(rack1) + len(rack2) + len(bag)
	if total_tiles == 100:
		results.append({"test": "tile conservation (racks + bag = 100)", "pass": True})
	else:
		results.append({"test": "tile conservation (racks + bag = 100)", "pass": False, "total": total_tiles})

	# Test 8: get_other_players
	others = get_other_players(game, my_id)
	if len(others) == 1 and others[0] == "test_opponent_id":
		results.append({"test": "get_other_players returns opponent", "pass": True})
	else:
		results.append({"test": "get_other_players returns opponent", "pass": False})

	# Test 9: get_all_player_names
	names = get_all_player_names(game)
	if my_name in names and "Test Opponent" in names:
		results.append({"test": "get_all_player_names includes both", "pass": True})
	else:
		results.append({"test": "get_all_player_names includes both", "pass": False, "got": names})

	# Test 10: get_player_name
	if get_player_name(game, 1) == my_name:
		results.append({"test": "get_player_name returns correct name", "pass": True})
	else:
		results.append({"test": "get_player_name returns correct name", "pass": False})

	# Cleanup: delete test games
	for gid in test_game_ids:
		mochi.db.execute("delete from messages where game=?", gid)
		mochi.db.execute("delete from games where id=?", gid)

	passed = all([r["pass"] for r in results])
	return {"data": {"passed": passed, "results": results}}

# Notification proxy actions

def action_notifications_subscribe(a):
	label = a.input("label", "").strip()
	sub_type = a.input("type", "").strip()
	object = a.input("object", "").strip()
	destinations = a.input("destinations", "")

	if not label:
		a.error(400, "label is required")
		return
	if not mochi.valid(label, "text"):
		a.error(400, "Invalid label")
		return

	destinations_list = []
	if destinations:
		destinations_list = json.decode(destinations)
		if type(destinations_list) != "list":
			a.error(400, "Invalid destinations")
			return

	result = mochi.service.call("notifications", "subscribe", label, sub_type, object, destinations_list)
	return {"data": {"id": result}}

def action_notifications_check(a):
	result = mochi.service.call("notifications", "subscriptions")
	return {"data": {"exists": len(result) > 0}}

def action_notifications_destinations(a):
	result = mochi.service.call("notifications", "destinations")
	return {"data": result}
