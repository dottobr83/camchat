-record(room, {room_id, user_list}).
-define(ROOM_ID_POS, 2).
-define(USER_LIST_POS, 3).
-record(user, {connection_id, room_id, user_id, username}).
-define(CONNECTION_ID_POS, 2).
-define(USERNAME_POS, 5).
