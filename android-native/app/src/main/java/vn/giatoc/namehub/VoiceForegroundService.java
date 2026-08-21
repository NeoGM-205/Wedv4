package vn.giatoc.namehub;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

public class VoiceForegroundService extends Service {
    public static final String ACTION_START = "vn.giatoc.namehub.voice.START";
    public static final String ACTION_TOGGLE_MUTE = "vn.giatoc.namehub.voice.TOGGLE_MUTE";
    public static final String ACTION_TOGGLE_DEAFEN = "vn.giatoc.namehub.voice.TOGGLE_DEAFEN";
    public static final String ACTION_LEAVE = "vn.giatoc.namehub.voice.LEAVE";

    private static final String EXTRA_ROOM_ID = "room_id";
    private static final String EXTRA_ROOM_NAME = "room_name";
    private static final String EXTRA_PIN = "pin";
    private static final String EXTRA_COOKIE = "cookie";
    private static final String CHANNEL_ID = "voice_background";
    private static final int NOTIFICATION_ID = 9201;
    private static final int SAMPLE_RATE = 16000;
    private static final int FRAME_BYTES = 2048; // 1024 mẫu PCM16 ~= 64 ms
    private static final String TAG = "GiaTocVoice";

    private static volatile boolean running = false;
    private static volatile boolean mutedState = false;
    private static volatile boolean deafenedState = false;
    private static volatile String statusText = "Chưa kết nối";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean audioRunning = new AtomicBoolean(false);
    private final ArrayBlockingQueue<byte[]> playbackQueue = new ArrayBlockingQueue<>(48);

    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build();

    private String roomId = "";
    private String roomName = "Phòng Voice";
    private String pin = "";
    private String cookie = "";
    private volatile boolean manualStop = false;
    private volatile boolean joined = false;
    private int reconnectAttempt = 0;

    private WebSocket ws;
    private AudioRecord audioRecord;
    private AudioTrack audioTrack;
    private Thread captureThread;
    private Thread playbackThread;
    private AudioManager audioManager;
    private int oldAudioMode = AudioManager.MODE_NORMAL;
    private PowerManager.WakeLock wakeLock;
    private NoiseSuppressor noiseSuppressor;
    private AcousticEchoCanceler echoCanceler;
    private AutomaticGainControl gainControl;
    private OverlayBubbleController bubble;

    public static Intent startIntent(Context context, String roomId, String roomName, String pin, String cookie) {
        return new Intent(context, VoiceForegroundService.class)
                .setAction(ACTION_START)
                .putExtra(EXTRA_ROOM_ID, roomId)
                .putExtra(EXTRA_ROOM_NAME, roomName)
                .putExtra(EXTRA_PIN, pin)
                .putExtra(EXTRA_COOKIE, cookie);
    }

    public static boolean isRunning() { return running; }
    public static boolean isMuted() { return mutedState; }
    public static boolean isDeafened() { return deafenedState; }
    public static String getStatusText() { return statusText; }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);
        setupBubble();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_TOGGLE_MUTE.equals(action)) {
            setMuted(!mutedState);
            return START_NOT_STICKY;
        }
        if (ACTION_TOGGLE_DEAFEN.equals(action)) {
            setDeafened(!deafenedState);
            return START_NOT_STICKY;
        }
        if (ACTION_LEAVE.equals(action)) {
            stopVoice("Đã rời phòng");
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            roomId = safe(intent.getStringExtra(EXTRA_ROOM_ID));
            roomName = safeName(intent.getStringExtra(EXTRA_ROOM_NAME));
            pin = safe(intent.getStringExtra(EXTRA_PIN));
            cookie = safe(intent.getStringExtra(EXTRA_COOKIE));
            manualStop = false;
            joined = false;
            mutedState = false;
            deafenedState = false;
            running = true;
            statusText = "Đang mở Voice nền...";
            startAsForeground();
            acquireWakeLock();
            bubble.show();
            bubble.updateState(mutedState, deafenedState);
            bubble.updateStatus("🟡 " + roomName + " • đang nối...");
            connectWithFreshToken();
        }
        // Không START_STICKY: Android 14+ không nên tự khởi tạo lại micro FGS từ nền sau khi process bị giết.
        return START_NOT_STICKY;
    }

    private void startAsForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void connectWithFreshToken() {
        if (manualStop || roomId.isEmpty()) return;
        updateStatus("🟡 Đang xác thực Voice...");
        Request req = new Request.Builder()
                .url(BuildConfig.HUB_BASE_URL + "/api/voice/token")
                .header("Cookie", cookie)
                .post(RequestBody.create("{}", MediaType.get("application/json; charset=utf-8")))
                .build();
        client.newCall(req).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(okhttp3.Call call, java.io.IOException e) {
                scheduleReconnect("Không lấy được token");
            }

            @Override
            public void onResponse(okhttp3.Call call, Response response) {
                try (Response res = response) {
                    String body = res.body() != null ? res.body().string() : "";
                    if (!res.isSuccessful()) {
                        if (res.code() == 401) {
                            main.post(() -> stopVoice("Phiên đăng nhập đã hết hạn. Mở Hub và đăng nhập lại."));
                        } else {
                            scheduleReconnect("Máy chủ từ chối Voice");
                        }
                        return;
                    }
                    String token = new JSONObject(body).optString("token");
                    if (token.isEmpty()) { scheduleReconnect("Token Voice không hợp lệ"); return; }
                    openSocket(token);
                } catch (Exception e) {
                    scheduleReconnect("Lỗi token Voice");
                }
            }
        });
    }

    private void openSocket(String token) {
        if (manualStop) return;
        closeSocket();
        String wsBase = BuildConfig.HUB_BASE_URL.replaceFirst("^https://", "wss://").replaceFirst("^http://", "ws://");
        Request req = new Request.Builder().url(wsBase + "/voice-signal?token=" + UriCodec.encode(token)).build();
        ws = client.newWebSocket(req, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                updateStatus("🟡 Đã nối máy chủ • đang vào phòng...");
            }

            @Override
            public void onMessage(WebSocket webSocket, String text) {
                handleJsonMessage(webSocket, text);
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                handleRelayAudio(bytes);
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                if (!manualStop) scheduleReconnect("Mất kết nối Voice");
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                if (!manualStop) scheduleReconnect("Voice đã ngắt");
            }
        });
    }

    private void handleJsonMessage(WebSocket socket, String text) {
        try {
            JSONObject msg = new JSONObject(text);
            String type = msg.optString("type");
            if ("ready".equals(type)) {
                JSONObject join = new JSONObject();
                join.put("type", "join");
                join.put("roomId", roomId);
                join.put("pin", pin);
                socket.send(join.toString());
                return;
            }
            if ("joined".equals(type)) {
                JSONObject room = msg.optJSONObject("room");
                if (room != null) roomName = room.optString("name", roomName);
                joined = true;
                reconnectAttempt = 0;
                updateStatus("🟢 " + roomName + " • Mic nền đang hoạt động");
                main.post(() -> {
                    startAudio();
                    bubble.updateStatus("🟢 " + roomName);
                    refreshNotification();
                });
                return;
            }
            if ("room-closed".equals(type)) {
                main.post(() -> stopVoice("Phòng Voice đã được đóng."));
                return;
            }
            if ("error".equals(type)) {
                String message = msg.optString("message", "Không thể vào phòng Voice");
                main.post(() -> stopVoice(message));
            }
        } catch (Exception ignored) {
        }
    }

    private void handleRelayAudio(ByteString bytes) {
        if (deafenedState) return;
        byte[] packet = bytes.toByteArray();
        if (packet.length <= 36) return;
        byte[] pcm = Arrays.copyOfRange(packet, 36, packet.length);
        if ((pcm.length & 1) == 1) pcm = Arrays.copyOf(pcm, pcm.length - 1);
        if (pcm.length == 0) return;
        if (!playbackQueue.offer(pcm)) {
            playbackQueue.poll();
            playbackQueue.offer(pcm);
        }
    }

    private synchronized void startAudio() {
        if (audioRunning.get()) return;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            stopVoice("Không có quyền Microphone.");
            return;
        }
        try {
            oldAudioMode = audioManager.getMode();
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

            int inMin = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int inBuffer = Math.max(FRAME_BYTES * 4, Math.max(inMin, FRAME_BYTES));
            AudioFormat recordFormat = new AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                    .build();
            audioRecord = new AudioRecord.Builder()
                    .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(recordFormat)
                    .setBufferSizeInBytes(inBuffer)
                    .build();
            if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("AudioRecord chưa sẵn sàng");

            enableAudioEffects(audioRecord.getAudioSessionId());

            int outMin = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int outBuffer = Math.max(FRAME_BYTES * 6, Math.max(outMin, FRAME_BYTES));
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
            AudioFormat outFormat = new AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build();
            audioTrack = new AudioTrack.Builder()
                    .setAudioAttributes(attrs)
                    .setAudioFormat(outFormat)
                    .setBufferSizeInBytes(outBuffer)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();

            audioRunning.set(true);
            audioTrack.play();
            audioRecord.startRecording();
            startCaptureThread();
            startPlaybackThread();
        } catch (Exception e) {
            Log.e(TAG, "startAudio", e);
            stopVoice("Không mở được Microphone: " + e.getMessage());
        }
    }

    private void enableAudioEffects(int sessionId) {
        try {
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(sessionId);
                if (noiseSuppressor != null) noiseSuppressor.setEnabled(true);
            }
        } catch (Exception ignored) {}
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(sessionId);
                if (echoCanceler != null) echoCanceler.setEnabled(true);
            }
        } catch (Exception ignored) {}
        try {
            if (AutomaticGainControl.isAvailable()) {
                gainControl = AutomaticGainControl.create(sessionId);
                if (gainControl != null) gainControl.setEnabled(true);
            }
        } catch (Exception ignored) {}
    }

    private void startCaptureThread() {
        captureThread = new Thread(() -> {
            byte[] frame = new byte[FRAME_BYTES];
            while (audioRunning.get() && !manualStop) {
                try {
                    int n = audioRecord.read(frame, 0, frame.length, AudioRecord.READ_BLOCKING);
                    if (n > 32 && n <= 4096 && !mutedState && joined) {
                        WebSocket socket = ws;
                        if (socket != null) socket.send(ByteString.of(frame, 0, n));
                    }
                } catch (Exception e) {
                    if (audioRunning.get()) Log.w(TAG, "capture", e);
                    break;
                }
            }
        }, "GiaToc-Voice-Capture");
        captureThread.setPriority(Thread.MAX_PRIORITY);
        captureThread.start();
    }

    private void startPlaybackThread() {
        playbackThread = new Thread(() -> {
            while (audioRunning.get() && !manualStop) {
                try {
                    byte[] pcm = playbackQueue.poll(500, TimeUnit.MILLISECONDS);
                    if (pcm == null || deafenedState) continue;
                    AudioTrack track = audioTrack;
                    if (track != null && track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                        track.write(pcm, 0, pcm.length, AudioTrack.WRITE_BLOCKING);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                } catch (Exception e) {
                    if (audioRunning.get()) Log.w(TAG, "playback", e);
                }
            }
        }, "GiaToc-Voice-Playback");
        playbackThread.setPriority(Thread.MAX_PRIORITY - 1);
        playbackThread.start();
    }

    private void setMuted(boolean muted) {
        mutedState = muted;
        sendState();
        bubble.updateState(mutedState, deafenedState);
        updateStatus((muted ? "🔇 Mic tắt • " : "🎙️ Mic bật • ") + roomName);
        refreshNotification();
    }

    private void setDeafened(boolean deafened) {
        deafenedState = deafened;
        if (deafened) playbackQueue.clear();
        sendState();
        bubble.updateState(mutedState, deafenedState);
        updateStatus((deafened ? "🔕 Đã tắt nghe • " : "🔊 Đang nghe • ") + roomName);
        refreshNotification();
    }

    private void sendState() {
        try {
            WebSocket socket = ws;
            if (socket == null) return;
            JSONObject o = new JSONObject();
            o.put("type", "state");
            o.put("muted", mutedState);
            o.put("deafened", deafenedState);
            socket.send(o.toString());
        } catch (Exception ignored) {}
    }

    private synchronized void stopAudio() {
        audioRunning.set(false);
        playbackQueue.clear();
        if (captureThread != null) captureThread.interrupt();
        if (playbackThread != null) playbackThread.interrupt();
        captureThread = null;
        playbackThread = null;

        try { if (audioRecord != null && audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) audioRecord.stop(); } catch (Exception ignored) {}
        try { if (audioTrack != null && audioTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) audioTrack.stop(); } catch (Exception ignored) {}
        try { if (audioRecord != null) audioRecord.release(); } catch (Exception ignored) {}
        try { if (audioTrack != null) audioTrack.release(); } catch (Exception ignored) {}
        audioRecord = null;
        audioTrack = null;

        try { if (noiseSuppressor != null) noiseSuppressor.release(); } catch (Exception ignored) {}
        try { if (echoCanceler != null) echoCanceler.release(); } catch (Exception ignored) {}
        try { if (gainControl != null) gainControl.release(); } catch (Exception ignored) {}
        noiseSuppressor = null; echoCanceler = null; gainControl = null;
        try { audioManager.setMode(oldAudioMode); } catch (Exception ignored) {}
    }

    private void scheduleReconnect(String reason) {
        if (manualStop || !running) return;
        joined = false;
        stopAudio();
        closeSocket();
        long delay = Math.min(15000L, 1200L * (long) Math.pow(1.7, Math.min(6, reconnectAttempt++)));
        updateStatus("🟠 " + reason + " • tự nối lại...");
        main.removeCallbacks(reconnectRunnable);
        main.postDelayed(reconnectRunnable, delay);
    }

    private final Runnable reconnectRunnable = this::connectWithFreshToken;

    private synchronized void closeSocket() {
        WebSocket socket = ws;
        ws = null;
        if (socket != null) {
            try {
                if (joined) socket.send("{\"type\":\"leave\"}");
                socket.close(1000, "leave");
            } catch (Exception ignored) {}
        }
        joined = false;
    }

    private void stopVoice(String finalMessage) {
        if (manualStop && !running) return;
        manualStop = true;
        running = false;
        joined = false;
        statusText = finalMessage;
        main.removeCallbacks(reconnectRunnable);
        stopAudio();
        closeSocket();
        bubble.hide();
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void updateStatus(String text) {
        statusText = text;
        main.post(() -> {
            if (bubble != null) bubble.updateStatus(text);
            refreshNotification();
        });
    }

    private void setupBubble() {
        bubble = new OverlayBubbleController(this, new OverlayBubbleController.Actions() {
            @Override public void onToggleMute() { setMuted(!mutedState); }
            @Override public void onToggleDeafen() { setDeafened(!deafenedState); }
            @Override public void onLeave() { stopVoice("Đã rời phòng"); }
            @Override public void onOpenApp() {
                Intent i = new Intent(VoiceForegroundService.this, MainActivity.class)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(i);
            }
        });
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent mutePi = servicePending(ACTION_TOGGLE_MUTE, 2);
        PendingIntent deafenPi = servicePending(ACTION_TOGGLE_DEAFEN, 3);
        PendingIntent leavePi = servicePending(ACTION_LEAVE, 4);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        b.setSmallIcon(vn.giatoc.namehub.R.drawable.ic_mic)
                .setContentTitle("GiaTộc ┊Name • " + roomName)
                .setContentText(statusText)
                .setContentIntent(openPi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .addAction(new Notification.Action.Builder(0, mutedState ? "Bật mic" : "Tắt mic", mutePi).build())
                .addAction(new Notification.Action.Builder(0, deafenedState ? "Bật nghe" : "Tắt nghe", deafenPi).build())
                .addAction(new Notification.Action.Builder(0, "Rời phòng", leavePi).build());
        return b.build();
    }

    private PendingIntent servicePending(String action, int requestCode) {
        Intent i = new Intent(this, VoiceForegroundService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void refreshNotification() {
        if (!running) return;
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.notify(NOTIFICATION_ID, buildNotification());
        } catch (Exception ignored) {}
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Voice nền",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Giữ cuộc trò chuyện Voice khi bạn chuyển sang game khác.");
            ch.setSound(null, null);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.createNotificationChannel(ch);
        }
    }

    private void acquireWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GiaTocNameHub:Voice");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(8L * 60L * 60L * 1000L);
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        if (running || !manualStop) {
            manualStop = true;
            running = false;
            stopAudio();
            closeSocket();
            if (bubble != null) bubble.hide();
            releaseWakeLock();
        }
        client.dispatcher().executorService().shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private String safe(String s) { return s == null ? "" : s.trim(); }
    private String safeName(String s) { String x = safe(s); return x.isEmpty() ? "Phòng Voice" : x; }

    // Tránh thêm dependency chỉ để encode query param.
    private static final class UriCodec {
        static String encode(String value) {
            try { return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8.name()); }
            catch (Exception e) { return value; }
        }
    }
}
