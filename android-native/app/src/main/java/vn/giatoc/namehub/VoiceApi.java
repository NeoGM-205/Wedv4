package vn.giatoc.namehub;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

final class VoiceApi {
    static final MediaType JSON = MediaType.get("application/json; charset=utf-8");
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .build();

    static final class Room {
        final String id;
        final String name;
        final String game;
        final int participants;
        final int maxParticipants;
        final boolean locked;
        final String ownerUsername;

        Room(String id, String name, String game, int participants, int maxParticipants,
             boolean locked, String ownerUsername) {
            this.id = id;
            this.name = name;
            this.game = game;
            this.participants = participants;
            this.maxParticipants = maxParticipants;
            this.locked = locked;
            this.ownerUsername = ownerUsername;
        }

        String label() {
            return (locked ? "🔒 " : "🌐 ") + name + "\n" + game + " • " + participants + "/" + maxParticipants + " người";
        }
    }

    List<Room> fetchRooms(String cookie) throws Exception {
        Request req = new Request.Builder()
                .url(BuildConfig.HUB_BASE_URL + "/api/voice/rooms")
                .header("Cookie", cookie == null ? "" : cookie)
                .header("Accept", "application/json")
                .get()
                .build();
        try (Response res = client.newCall(req).execute()) {
            String body = res.body() != null ? res.body().string() : "";
            if (res.code() == 401) throw new IOException("Bạn chưa đăng nhập vào Hub.");
            if (!res.isSuccessful()) throw new IOException(readError(body, "Không tải được phòng voice."));
            JSONObject root = new JSONObject(body);
            JSONArray arr = root.optJSONArray("rooms");
            List<Room> out = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject r = arr.getJSONObject(i);
                    out.add(new Room(
                            r.optString("id"), r.optString("name", "Phòng voice"),
                            r.optString("game", "Chơi game cùng"), r.optInt("participants"),
                            r.optInt("maxParticipants", 6), r.optBoolean("locked"),
                            r.optString("ownerUsername")
                    ));
                }
            }
            return out;
        }
    }

    String createRoom(String cookie, String name, String game, int maxParticipants, String pin) throws Exception {
        JSONObject body = new JSONObject();
        body.put("name", name);
        body.put("game", game);
        body.put("maxParticipants", maxParticipants);
        body.put("pin", pin == null ? "" : pin);
        Request req = new Request.Builder()
                .url(BuildConfig.HUB_BASE_URL + "/api/voice/rooms")
                .header("Cookie", cookie == null ? "" : cookie)
                .post(RequestBody.create(body.toString(), JSON))
                .build();
        try (Response res = client.newCall(req).execute()) {
            String text = res.body() != null ? res.body().string() : "";
            if (!res.isSuccessful()) throw new IOException(readError(text, "Không tạo được phòng voice."));
            return new JSONObject(text).getJSONObject("room").getString("id");
        }
    }

    private String readError(String text, String fallback) {
        try { return new JSONObject(text).optString("error", fallback); }
        catch (Exception ignored) { return fallback; }
    }
}
