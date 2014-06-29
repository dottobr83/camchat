-record(room, {room_id, user_list, default_stream = <<"camera">>, password = no_password}).
-define(ROOM_ID_POS, 2).
-define(USER_LIST_POS, 3).
-define(DEFAULT_STREAM_POS, 4).
-define(PASSWORD_POS, 5).
-record(user, {connection_id, room_id, user_id, username}).
-define(CONNECTION_ID_POS, 2).
-define(USERNAME_POS, 5).
