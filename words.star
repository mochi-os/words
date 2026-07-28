# Copyright © 2026 Mochisoft OÜ
# SPDX-License-Identifier: AGPL-3.0-only
# This file is part of Mochi, licensed under the GNU AGPL v3 with the
# Mochi Application Interface Exception - see license.txt and license-exception.md.

# Mochi Words (Scrabble-style word game)

# Trust model.
#
# This is a game between accepted participants, not between adversaries.
# The rules engine is words-engine.ts in the frontend, and the server takes
# its word for the state a move produces: it validates SHAPE - field
# present, right form, status in the known set, winner an actual player -
# and never legality. It checks claimed words against the dictionary
# and claimed tiles against the rack, but derives neither from the
# board transition, so a word left out of the claim skips the
# dictionary entirely.
#
# A participant who modifies their own client can therefore submit a state
# the rules would not have produced. That is accepted, not overlooked:
# making the server authoritative would mean a second rules engine in
# Starlark, which is not worth it for this audience. Reviews should not
# report it as a defect.
#
# What the server DOES enforce, and what changes here must preserve:
#
#   Participation  Only an accepted participant can reach a game. Creation
#                  is gated on friendship, and event_new requires both the
#                  recipient AND the sender to be listed players, so a
#                  friend cannot plant a game between other people.
#   Provenance     Inbound state is bound to a player of this game: a
#                  relayed snapshot's writer must be one, and a direct
#                  event's writer must be its authenticated sender.
#   Convergence    Ordering, deduplication and repair - see the concurrency
#                  block below. A tampering participant can corrupt their
#                  own game; they cannot desynchronise anyone else's.
#   Shape          Every stored field is validated, so a malformed or
#                  hostile value cannot crash a peer's client or wedge
#                  their game.
#
# The boundary is participation, not honesty.


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

def game_finish(game, scores, out):
	"""Standard Scrabble end-of-game adjustments and winner.

	scores maps each playing slot to its total before adjustments; out is
	the slot that emptied its rack, or 0 for a pass-out ending.

	Going out: every other player's leftover tiles come off their own
	score and their sum is added to the player who went out. Pass-out:
	each player's own leftovers come off their own score, nobody gains.
	Winner is the highest adjusted total; a tie goes to the higher score
	before adjustments, and a tie in both to the lowest slot. The rule
	must be deterministic in full, because the finishing host computes it
	once and every peer converges on the shipped result.

	Returns (adjusted, winner slot)."""
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
	"""Shuffle a string using Fisher-Yates.

	mochi.random.integer gives an unbiased draw directly; the old version
	built a big number out of alphanumeric characters and took a modulus,
	which was both convoluted and modulo-biased."""
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
		# Version tuple. A scalar counter each peer increments locally is not
		# a total order: with up to four independent writers, two peers can
		# commit different states at N+1 and reject each other forever.
		# Ordering is now (terminal, revision, writer, event) compared
		# lexicographically, so concurrent writes resolve identically on
		# every peer.
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

# Concurrency and convergence.
#
# Two problems, one mechanism.
#
# Locally, nothing serialises HTTP actions for a (user, app): core's
# per-worker guarantee (protocol2_worker.go) covers inbound P2P frames
# only. Two HTTP actions, or an HTTP action and an inbound event, can
# read the same row and write over each other.
#
# Between peers, there is no coordinator. A scalar counter that each peer
# increments from its own state is NOT a total order - both peers can
# commit a different state at N+1 (two players offering a draw at the
# same moment, or resigning), and a strictly-greater test then makes each
# reject the other permanently.
#
# Ordering is therefore the tuple (terminal, revision, writer, event),
# compared lexicographically:
#
#   revision  the logical counter, and it leads. An earlier version put
#             terminal first, which made EVERY terminal state outrank every
#             non-terminal one at any counter: a player resigning from a
#             stale revision-4 view then rewound peers at revision 30 to
#             revision-4 boards, racks and scores. Causality first.
#   terminal  1 when the status ends the game, else 0. Second, so it decides
#             only genuine same-counter conflicts - a resignation racing a
#             move at the same revision survives on both peers - without
#             letting an ancient terminal defeat newer state. A resignation
#             made against a state that no longer exists is discarded, and
#             the player reissues it once caught up.
#
# The snapshot carries every rack. That costs nothing here: replicating
# all racks to all participants is already an accepted property of this
# app, and it is what makes a lagging peer able to value an opponent's
# leftover tiles correctly at game end.
#   writer    the entity that produced the state. Breaks ties between
#             peers at the same counter, identically on both sides.
#   event     a per-write uid. Only reachable if one writer produced two
#             states at the same counter, which the local CAS prevents;
#             carried so the order is total without relying on that.
#
# Every event carries a COMPLETE snapshot of the shared columns, not a
# delta. A delta would make "revision already passed" mean the state was
# passed, which is false: applying a higher auxiliary event (a resign)
# would advance the counter while omitting a board carried only by a
# lower one, and that lower event is then rejected for good - core acks
# any handler that returns cleanly (protocol2_worker.go), so nothing
# retries it.

#
# Protocol invariants. These are the properties the code above is meant to
# hold; anything added here should be tested against them, not just against a
# final database row.
#
#   1. Every applied event carries one complete, validated state.
#   2. Every replica deterministically retains the maximum version.
#   3. A rejected sender eventually learns the dominating version (event_sync).
#   4. Browser state eventually equals its local canonical row.
#   5. History divergence is permitted and is NOT a bug.
#
# On (5): the games row is canonical. The messages table is an activity feed,
# not an authoritative ledger of moves and events - under concurrent writes
# each peer keeps its own losing action, so two peers can legitimately show
# different system messages for the same game. Do not write code that
# reconstructs game state from message history; it cannot.

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

def event_created(e, now):
	"""Peer-supplied message timestamp, clamped to our clock.

	A stamp far from now would pin the message out of order forever and
	distort the created-keyed pagination cursor, so anything more than a
	day behind or five minutes ahead is replaced with our own time.
	Returns None when the field is absent or malformed."""
	created = e.content("created")
	if not mochi.text.valid(str(created), "integer"):
		return None
	created = int(created)
	if created < now - 86400 or created > now + 300:
		return now
	return created

def game_terminal(status):
	return 1 if status in GAME_TERMINAL else 0

def game_state(game, changes):
	"""Complete shared state: the row we read with changes applied.

	None becomes "" so a nullable column survives the round trip through
	an event; 0 and False are preserved, which `or ""` would not."""
	state = {}
	for column in GAME_COLUMNS:
		value = game[column]
		state[column] = "" if value == None else value
	for key, value in changes.items():
		state[key] = "" if value == None else value
	return state

def game_snapshot_valid(game, state):
	"""Validate a complete inbound snapshot before it can replace our row.

	Broader than the other games: a snapshot arriving on any event type
	can replace the board, the bag, every rack and every score, and none
	of those handlers validate those fields themselves."""
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

def game_write(game, changes, writer, now):
	"""Apply a local change, guarding on the exact tuple we read.

	Returns the complete new state to ship to the opponent, or None when
	another writer got there first - in which case the caller must
	abandon the change entirely, emitting no message, no websocket
	payload and no P2P event."""
	state = game_state(game, changes)
	sets = []
	params = []
	for column in GAME_COLUMNS:
		sets.append(column + "=?")
		params.append(state[column])
	revision = game["revision"] + 1
	event = mochi.uid()
	sql = "update games set " + ", ".join(sets) + ", revision=?, writer=?, event=?, updated=? where id=? and revision=? and writer=? and event=?"
	params.extend([revision, writer, event, now, game["id"], game["revision"], game["writer"] or "", game["event"] or ""])
	if mochi.db.execute(sql, *params) == 0:
		return None
	state["revision"] = revision
	state["writer"] = writer
	state["event"] = event
	state["snapshot"] = 1
	return state

def game_apply(e, game, legacy, now, sync=False):
	"""Apply an inbound change if it outranks the row we hold.

	Peers on this version send a complete snapshot and the full tuple.
	A peer predating it sends neither, so the caller's `legacy` dict of
	partial changes is applied under a tuple of (terminal, our revision
	+ 1, "", "") - atomic against local writers exactly as before, but
	still a delta, so state can lag a legacy sender until both sides are
	upgraded."""
	if e.content("snapshot"):
		state = {}
		for column in GAME_COLUMNS:
			value = e.content(column)
			# A field absent from a snapshot is a truncated snapshot, not an
			# empty value: coercing it to "" would let a partial event clear
			# state the sender never meant to change.
			if value == None:
				return None
			state[column] = value
		if not game_snapshot_valid(game, state):
			return None
		revision = e.content("revision")
		if not mochi.text.valid(str(revision), "integer"):
			return None
		revision = int(revision)
		if revision < 0:
			return None
		# Ordering metadata, not game state, but the whole design rests on it
		# being well formed. writer must be the authenticated sender: it
		# decides every same-revision tie, so a peer naming someone else could
		# steer them all.
		writer = e.content("writer")
		if sync:
			# A relayed snapshot is forwarded by whichever peer held the
			# winning state, which is not necessarily the peer that wrote it -
			# that is the whole point of reconciliation. Bind the writer to the
			# game's players rather than to the relay, and never rewrite it:
			# the writer element decides conflicts, so changing it in transit
			# would change who wins.
			if writer not in game_players(game):
				return None
		elif writer != e.header("from"):
			return None
		event = e.content("event")
		if not event or not mochi.text.valid(str(event), "id"):
			return None
	elif sync:
		# A sync frame is a protocol control message with exactly one accepted
		# shape. Peers predating the feature never send one, so there is no
		# compatibility case - and the legacy branch would write an empty
		# writer, which game_reconcile refuses to relay, permanently disabling
		# this row's ability to repair itself.
		return None
	else:
		# Legacy delta path: a peer that predates snapshots. Logged so the
		# retirement decision is evidence rather than a guessed date - when
		# this line stops appearing across the fleet, every peer is
		# upgraded and this branch can go, at which point gameplay events
		# can require complete snapshots exactly as sync already does.
		mochi.log.debug("legacy delta event from %s (no snapshot)" % e.header("from"))
		state = {}
		for key, value in legacy.items():
			state[key] = "" if value == None else value
		if "status" not in state:
			state["status"] = game["status"]
		revision = game["revision"] + 1
		writer = ""
		event = ""

	sets = []
	params = []
	for column, value in state.items():
		sets.append(column + "=?")
		params.append(value)
	sql = ("update games set " + ", ".join(sets) +
		", revision=?, writer=?, event=?, updated=? where id=?" +
		" and (revision, case when status in ('finished','resigned') then 1 else 0 end, writer, event) < (?, ?, ?, ?)")
	params.extend([revision, writer, event, now, game["id"],
		revision, game_terminal(state["status"]), writer, event])
	if mochi.db.execute(sql, *params) == 0:
		# Our state dominates. Rejecting is only safe if the sender eventually
		# learns why, otherwise a peer that acted on a stale view sits on it
		# forever - core acks a handler that returns cleanly, so nothing else
		# tells them. Send our winning snapshot back. reconcile is False on
		# the sync path itself so this cannot ping-pong.
		if not sync:
			game_reconcile(e, game)
		return None
	return state

def game_reconcile(e, game):
	"""Send our dominating state back to a peer whose event we rejected."""
	current = mochi.db.row("select * from games where id=?", game["id"])
	if not current:
		return
	state = game_state(current, {})
	state["revision"] = current["revision"]
	state["writer"] = current["writer"] or ""
	state["event"] = current["event"] or ""
	state["snapshot"] = 1
	state["game"] = current["id"]
	# Only a peer that already wrote the state we hold can be named as its
	# writer, so an empty writer means there is nothing authoritative to
	# reconcile with yet.
	if not state["writer"]:
		return
	mochi.message.send(
		{"from": e.header("to"), "to": e.header("from"), "service": "words", "event": "sync"},
		state
	)

def event_sync(e):
	"""Receive a peer's dominating state after they rejected one of ours."""
	game = mochi.db.row("select * from games where id=?", e.content("game"))
	if not game:
		return
	sender = e.header("from")
	if not is_player(game, sender):
		return
	# One accepted shape, no fallback: anything without a complete snapshot is
	# not a sync frame and must change nothing at all.
	if e.content("snapshot") != 1:
		return
	# sync=True: if OUR state dominates theirs we drop it rather than
	# answering, which is what terminates the exchange.
	state = game_apply(e, game, {}, mochi.time.now(), True)
	if state == None:
		return
	# A repaired row that no open client hears about breaks the invariant that
	# browser state eventually equals the canonical row: without this the peer
	# converges in the database while its browser still shows the state it was
	# repaired out of. type "state" carries no message - it is a cache signal.
	payload = {"type": "state"}
	for key in GAME_PUBLIC:
		payload[key] = state[key]
	mochi.websocket.write(game["key"], payload)

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

	# Cursor is "<created>:<id>". created alone is not unique - messages
	# sharing a second are common on a fast exchange - so a created-only
	# cursor silently dropped every row that shared the page boundary's
	# timestamp. The id breaks the tie and makes the order total.
	#
	# A bare number is still accepted: that is what an older client sends,
	# and it keeps the old behaviour for it rather than erroring.
	before_created = None
	before_id = ""
	before_str = a.input("before")
	if before_str:
		parts = str(before_str).split(":")
		if mochi.text.valid(parts[0], "integer"):
			before_created = int(parts[0])
		if len(parts) > 1:
			before_id = parts[1]

	# `!= None`, not truthiness: a created of 0 is a legitimate cursor and
	# the old falsy test read it as "no cursor" and restarted from the top.
	if before_created != None:
		if before_id:
			messages = mochi.db.rows("select * from messages where game=? and (created<? or (created=? and id<?)) order by created desc, id desc limit ?", game["id"], before_created, before_created, before_id, limit + 1)
		else:
			messages = mochi.db.rows("select * from messages where game=? and created<? order by created desc, id desc limit ?", game["id"], before_created, limit + 1)
	else:
		messages = mochi.db.rows("select * from messages where game=? order by created desc, id desc limit ?", game["id"], limit + 1)

	has_more = len(messages) > limit
	if has_more:
		messages = messages[:limit]

	messages = list(reversed(messages))

	next_cursor = None
	if has_more and len(messages) > 0:
		next_cursor = str(messages[0]["created"]) + ":" + str(messages[0]["id"])

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

	# Standard end-of-game scoring. The winner comes from the adjusted
	# totals, not from who went out: going out earns the rack bonus, but an
	# opponent far enough ahead still wins - the old unconditional
	# winner-is-the-mover converged the wrong answer to every peer.
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
	state = game_write(game, changes, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	# Insert move message
	id = mochi.uid()
	move_label = words_formed if words_formed else "played"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, move_label + " (+" + str(score) + ")", "play:" + str(score), now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
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

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
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

	# Standard pass-out scoring: each player's own leftover tiles come off
	# their own score, nobody gains, and the winner comes from the adjusted
	# totals. The old code compared raw scores, so the same leftover Q cost
	# ten points if someone went out and nothing if everyone passed.
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
	state = game_write(game, changes, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	id = mochi.uid()
	player_name = get_player_name(game, pnum)
	body = player_name + " passed"
	if game_over:
		body = body + " — game over"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, "pass:over" if game_over else "pass", now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "pass": True,
		"event": "pass:over" if game_over else "pass",
		"current_turn": new_turn, "consecutive_passes": new_consecutive,
		"status": new_status, "winner": winner or "",
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / exchange / resign and the payload carries a pass-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
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

	state = game_write(game, {"bag": new_bag, rack_key: new_rack,
		"current_turn": new_turn, "consecutive_passes": 0}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	id = mochi.uid()
	player_name = get_player_name(game, pnum)
	body = player_name + " exchanged " + str(len(tiles_to_exchange)) + " tiles"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, body, "exchange:" + str(len(tiles_to_exchange)), now)

	ws_data = {
		"type": "move", "created": now, "member": a.user.identity.id, "name": a.user.identity.name,
		"body": body, "exchange": True,
		"event": "exchange:" + str(len(tiles_to_exchange)),
		"current_turn": new_turn, "bag_count": len(new_bag),
	}
	# Skip commit-hook conversion: the (games, update) shape is shared with move / pass / resign and the payload carries an exchange-specific flag that the hook can't disambiguate from row state.
	mochi.websocket.write(game["key"], ws_data)

	p2p_data = {
		"game": game["id"], "message": id, "created": now, "name": a.user.identity.name,
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
	state = game_write(game, {"status": "resigned", "winner": winner}, a.user.identity.id, now)
	if state == None:
		a.error.label(409, "errors.game_state_changed")
		return


	id = mochi.uid()
	msg = a.user.identity.name + " resigned"
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', ?, ? )", id, game["id"], a.user.identity.id, a.user.identity.name, msg, "resign", now)

	# Skip commit-hook conversion: the resign payload carries an event marker and the winner (sourced from the games row), neither of which is on the messages row alone — and the games.update is shared with move / pass / exchange.
	mochi.websocket.write(game["key"], {"type": "system", "event": "resign", "created": now, "body": msg, "winner": winner or ""})

	resign_data = {"game": game["id"], "created": now, "body": msg}
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
	created = event_created(e, mochi.time.now())
	if created == None:
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

	# Validate every stored field. This is the creation entry beside the
	# snapshot path: game_snapshot_valid guards later state, but a row
	# planted here was stored raw - oversized boards and bags, 8-tile
	# racks, control characters in names, or a player_count above the
	# filled slots, which wedges the game when the turn reaches an empty
	# slot: the same wedge the duplicate check below exists to prevent.
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
	if move_count == None or move_count < 0 or move_count > 10000:
		return

	# The move_count gate that used to sit here has gone the same way as the
	# draw-offer clock gate: it was a second, independent ordering that ran
	# BEFORE the version tuple and could veto an event the tuple accepts. A
	# concurrent resignation carries the move_count it was made at, which is
	# lower than ours, so this dropped a terminal state outright. Staleness
	# is the tuple's job now.

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

	# A peer on this version sends a complete snapshot and game_apply uses
	# that; the dict below is the legacy path for a peer that predates it.
	now = mochi.time.now()
	score_key = "player" + str(player_number) + "_score"
	legacy = {"board": board, score_key: new_score, "current_turn": current_turn,
		"move_count": move_count, "consecutive_passes": 0, "status": status,
		"winner": winner}
	if bag != None:
		legacy["bag"] = bag
	# player_number is derived from the sender, so the column is
	# server-derived; the peer supplies only the tiles.
	rack = e.content("rack")
	if rack != None:
		if not valid_rack(rack):
			return
		legacy["player" + str(player_number) + "_rack"] = rack
	for k, v in penalties.items():
		legacy[k] = v
	state = game_apply(e, game, legacy, now)
	if state == None:
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = event_created(e, now)
	if created == None:
		created = now

	# The receiver stamps the marker from what it validated, not from any
	# sender text, so the row localises for this viewer whatever language the
	# acting host spoke.
	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, "play:" + str(score), created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	ws_data = {
		"type": "move", "created": created, "member": sender, "name": name,
		"body": body, "event": "play:" + str(score),
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
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
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
	if consecutive_passes == None or consecutive_passes < 0 or consecutive_passes > game["player_count"]:
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
	state = game_apply(e, game, {"current_turn": current_turn,
			"consecutive_passes": consecutive_passes, "status": status,
			"winner": winner}, now)
	if state == None:
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = event_created(e, now)
	if created == None:
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, "pass:over" if status != "active" else "pass", created)

	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "pass": True,
		"event": "pass:over" if status != "active" else "pass",
		"current_turn": current_turn, "consecutive_passes": consecutive_passes,
		"status": status, "winner": winner or "",
	}
	# Skip commit-hook conversion: matches action_pass — shared (games, update) shape and a pass flag the hook can't infer from row state.
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
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

	# Tile count for the localised "exchanged N tiles" row. Additive wire
	# field: an old peer sends none and the row falls back to its body text.
	tiles = event_integer(e.content("tiles"), None)
	exchange_marker = ""
	if tiles != None and tiles >= 0 and tiles <= 7:
		exchange_marker = "exchange:" + str(tiles)

	now = mochi.time.now()
	legacy = {"current_turn": current_turn, "consecutive_passes": 0}
	if bag != None:
		legacy["bag"] = bag
	# An exchange swaps tiles, so the sender's rack changes here too.
	rack = e.content("rack")
	if rack != None:
		sender_number = get_player_number(game, sender)
		if sender_number < 1 or not valid_rack(rack):
			return
		legacy["player" + str(sender_number) + "_rack"] = rack
	state = game_apply(e, game, legacy, now)
	if state == None:
		return

	id = e.content("message")
	if not mochi.text.valid(str(id), "id"):
		id = mochi.uid()

	created = event_created(e, now)
	if created == None:
		created = now

	mochi.db.execute("insert or ignore into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'move', ?, ? )", id, game["id"], sender, name, body, exchange_marker, created)

	bag_count = len(bag) if bag != None else len(game["bag"])
	ws_data = {
		"type": "move", "created": now, "member": sender, "name": name,
		"body": body, "exchange": True, "event": exchange_marker,
		"current_turn": current_turn, "bag_count": bag_count,
	}
	# Skip commit-hook conversion: matches action_exchange — shared (games, update) shape and an exchange flag the hook can't infer from row state.
	# A snapshot may have repaired more than this event's own subject - a pass
	# can carry a board and scores the peer never received - so send the
	# applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
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

	created = event_created(e, mochi.time.now())
	if created == None:
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
	state = game_apply(e, game, {"status": "resigned", "winner": winner}, now)
	if state == None:
		return

	id = mochi.uid()
	# Resolve the resigner's name from our own row rather than storing the
	# sender's prose, so the marker render has a name in the viewer's data.
	mochi.db.execute("insert into messages ( id, game, member, name, body, type, event, created ) values ( ?, ?, ?, ?, ?, 'system', ?, ? )", id, game["id"], sender, get_player_name(game, get_player_number(game, sender)), body, "resign", now)

	# Skip commit-hook conversion: matches action_resign — payload carries an event marker and the winner from the games row, neither of which is on the messages row alone.
	ws_data = {"type": "system", "event": "resign", "created": now, "body": body, "winner": winner or ""}
	# A snapshot may have repaired more than this event's own subject, so send
	# the applied state, minus the racks and bag the browser must not see.
	for key in GAME_PUBLIC:
		ws_data[key] = state[key]
	mochi.websocket.write(game["key"], ws_data)
	notify("activity", "", mochi.app.label("notifications.title.game"), mochi.app.label("notifications.body.opponent_resigned"), "/words/" + game["id"], event_id="resign:" + game["id"])
