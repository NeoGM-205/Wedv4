package vn.giatoc.namehub;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.NumberPicker;
import android.widget.TextView;
import android.widget.Toast;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private static final int REQ_PERMISSIONS = 1001;
    private static final int REQ_OVERLAY = 1002;
    private static final int REQ_FILE = 1003;

    private WebView webView;
    private Button nativeVoiceButton;
    private ValueCallback<Uri[]> fileCallback;
    private boolean openVoiceAfterPermission = false;
    private boolean openVoiceAfterOverlay = false;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final VoiceApi voiceApi = new VoiceApi();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        configureWebView();
        webView.loadUrl(BuildConfig.HUB_BASE_URL);
    }

    private void buildUi() {
        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        nativeVoiceButton = new Button(this);
        nativeVoiceButton.setText("🎙️ Voice nền");
        nativeVoiceButton.setTextColor(Color.WHITE);
        nativeVoiceButton.setTextSize(14);
        nativeVoiceButton.setAllCaps(false);
        nativeVoiceButton.setBackgroundColor(Color.rgb(30, 70, 190));
        int pad = dp(12);
        nativeVoiceButton.setPadding(pad, dp(8), pad, dp(8));
        nativeVoiceButton.setOnClickListener(v -> prepareNativeVoice());

        FrameLayout.LayoutParams voiceLp = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.END | Gravity.BOTTOM);
        voiceLp.setMargins(dp(12), dp(12), dp(12), dp(18));
        root.addView(nativeVoiceButton, voiceLp);
        setContentView(root);
    }

    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " GiaTocNameHubNative/1.10.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookies.setAcceptThirdPartyCookies(webView, false);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                Uri home = Uri.parse(BuildConfig.HUB_BASE_URL);
                if (host != null && host.equalsIgnoreCase(home.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException ignored) {}
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean audio = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) audio = true;
                    }
                    if (audio && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        request.deny();
                    }
                });
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = filePathCallback;
                Intent intent = fileChooserParams.createIntent();
                try { startActivityForResult(intent, REQ_FILE); }
                catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "Không tìm thấy trình chọn file.", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });
    }

    private void prepareNativeVoice() {
        if (VoiceForegroundService.isRunning()) {
            showRunningVoiceDialog();
            return;
        }
        if (!hasRuntimePermissions()) {
            openVoiceAfterPermission = true;
            requestRuntimePermissions();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            openVoiceAfterOverlay = true;
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                startActivityForResult(intent, REQ_OVERLAY);
                Toast.makeText(this, "Bật 'Hiển thị trên ứng dụng khác' để có bong bóng Voice.", Toast.LENGTH_LONG).show();
                return;
            } catch (Exception ignored) {
                openVoiceAfterOverlay = false;
            }
        }
        showVoiceRoomPicker();
    }

    private boolean hasRuntimePermissions() {
        // RECORD_AUDIO là quyền bắt buộc. POST_NOTIFICATIONS được xin để hiện điều khiển rõ hơn,
        // nhưng người dùng từ chối thông báo vẫn có thể dùng Foreground Service + bong bóng nổi.
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestRuntimePermissions() {
        if (Build.VERSION.SDK_INT >= 33) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS}, REQ_PERMISSIONS);
        } else {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERMISSIONS);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERMISSIONS && openVoiceAfterPermission) {
            openVoiceAfterPermission = false;
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                new Handler(getMainLooper()).postDelayed(this::prepareNativeVoice, 150);
            } else {
                Toast.makeText(this, "Voice nền cần quyền Microphone.", Toast.LENGTH_LONG).show();
            }
        }
    }

    private void showVoiceRoomPicker() {
        String cookie = CookieManager.getInstance().getCookie(BuildConfig.HUB_BASE_URL);
        if (cookie == null || cookie.trim().isEmpty()) {
            Toast.makeText(this, "Hãy đăng nhập GiaTộc ┊Name Hub trước.", Toast.LENGTH_LONG).show();
            return;
        }
        nativeVoiceButton.setEnabled(false);
        nativeVoiceButton.setText("Đang tải phòng...");
        io.execute(() -> {
            try {
                List<VoiceApi.Room> rooms = voiceApi.fetchRooms(cookie);
                runOnUiThread(() -> {
                    nativeVoiceButton.setEnabled(true);
                    nativeVoiceButton.setText("🎙️ Voice nền");
                    presentRooms(cookie, rooms);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    nativeVoiceButton.setEnabled(true);
                    nativeVoiceButton.setText("🎙️ Voice nền");
                    Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void presentRooms(String cookie, List<VoiceApi.Room> rooms) {
        String[] labels = new String[rooms.size()];
        for (int i = 0; i < rooms.size(); i++) labels[i] = rooms.get(i).label();

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("🎙️ Phòng Voice nền")
                .setMessage(rooms.isEmpty() ? "Chưa có phòng. Bạn có thể tạo phòng mới." : "Chọn phòng để giữ mic khi chuyển sang game.")
                .setNegativeButton("Đóng", null)
                .setNeutralButton("＋ Tạo phòng", (d, w) -> showCreateRoomDialog(cookie));
        if (!rooms.isEmpty()) {
            b.setItems(labels, (dialog, which) -> {
                VoiceApi.Room room = rooms.get(which);
                if (room.participants >= room.maxParticipants) {
                    Toast.makeText(this, "Phòng đã đầy.", Toast.LENGTH_SHORT).show();
                    return;
                }
                if (room.locked) promptRoomPin(cookie, room);
                else startNativeVoice(cookie, room.id, room.name, "");
            });
        }
        b.show();
    }

    private void promptRoomPin(String cookie, VoiceApi.Room room) {
        EditText input = new EditText(this);
        input.setHint("Mã phòng");
        input.setSingleLine(true);
        int p = dp(18);
        FrameLayout frame = new FrameLayout(this);
        frame.setPadding(p, dp(4), p, 0);
        frame.addView(input, new FrameLayout.LayoutParams(-1, -2));
        new AlertDialog.Builder(this)
                .setTitle("🔒 " + room.name)
                .setView(frame)
                .setPositiveButton("Tham gia", (d, w) -> startNativeVoice(cookie, room.id, room.name, input.getText().toString().trim()))
                .setNegativeButton("Hủy", null)
                .show();
    }

    private void showCreateRoomDialog(String cookie) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int p = dp(18);
        box.setPadding(p, dp(8), p, 0);
        EditText name = new EditText(this); name.setHint("Tên phòng"); box.addView(name);
        EditText game = new EditText(this); game.setHint("Game, ví dụ Minecraft"); box.addView(game);
        EditText pin = new EditText(this); pin.setHint("Mã phòng (để trống = công khai)"); box.addView(pin);
        TextView maxLabel = new TextView(this); maxLabel.setText("Số người tối đa"); maxLabel.setPadding(0, dp(8), 0, 0); box.addView(maxLabel);
        NumberPicker max = new NumberPicker(this); max.setMinValue(2); max.setMaxValue(8); max.setValue(6); box.addView(max);

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("＋ Tạo phòng Voice")
                .setView(box)
                .setPositiveButton("Tạo và tham gia", null)
                .setNegativeButton("Hủy", null)
                .create();
        dialog.setOnShowListener(x -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String n = name.getText().toString().trim();
            if (n.isEmpty()) { name.setError("Nhập tên phòng"); return; }
            if (!pin.getText().toString().trim().isEmpty() && pin.getText().toString().trim().length() < 4) {
                pin.setError("Ít nhất 4 ký tự"); return;
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(false);
            io.execute(() -> {
                try {
                    String roomId = voiceApi.createRoom(cookie, n, game.getText().toString().trim(), max.getValue(), pin.getText().toString().trim());
                    runOnUiThread(() -> {
                        dialog.dismiss();
                        startNativeVoice(cookie, roomId, n, pin.getText().toString().trim());
                    });
                } catch (Exception e) {
                    runOnUiThread(() -> {
                        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setEnabled(true);
                        Toast.makeText(this, e.getMessage(), Toast.LENGTH_LONG).show();
                    });
                }
            });
        }));
        dialog.show();
    }

    private void startNativeVoice(String cookie, String roomId, String roomName, String pin) {
        // Nếu trang web đang ở voice WebRTC thì rời trước, tránh cùng một tài khoản vào phòng 2 lần.
        webView.evaluateJavascript(
                "(async()=>{try{if(typeof leaveVoiceRoom==='function')await leaveVoiceRoom(true)}catch(e){}return 'ok'})()",
                value -> new Handler(getMainLooper()).postDelayed(() -> {
                    Intent i = VoiceForegroundService.startIntent(this, roomId, roomName, pin, cookie);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(i); else startService(i);
                    Toast.makeText(this, "Đang mở Voice nền. Bạn có thể chuyển sang game.", Toast.LENGTH_LONG).show();
                    nativeVoiceButton.setText("🎙️ Voice đang chạy");
                }, 450)
        );
    }

    private void showRunningVoiceDialog() {
        new AlertDialog.Builder(this)
                .setTitle("🎙️ Voice nền đang chạy")
                .setMessage(VoiceForegroundService.getStatusText())
                .setPositiveButton(VoiceForegroundService.isMuted() ? "Bật mic" : "Tắt mic", (d, w) -> sendVoiceAction(VoiceForegroundService.ACTION_TOGGLE_MUTE))
                .setNeutralButton(VoiceForegroundService.isDeafened() ? "Bật nghe" : "Tắt nghe", (d, w) -> sendVoiceAction(VoiceForegroundService.ACTION_TOGGLE_DEAFEN))
                .setNegativeButton("Rời phòng", (d, w) -> sendVoiceAction(VoiceForegroundService.ACTION_LEAVE))
                .show();
    }

    private void sendVoiceAction(String action) {
        Intent i = new Intent(this, VoiceForegroundService.class).setAction(action);
        startService(i);
        new Handler(getMainLooper()).postDelayed(this::updateVoiceButton, 250);
    }

    private void updateVoiceButton() {
        nativeVoiceButton.setText(VoiceForegroundService.isRunning() ? "🎙️ Voice đang chạy" : "🎙️ Voice nền");
    }

    @Override
    protected void onResume() {
        super.onResume();
        updateVoiceButton();
        if (openVoiceAfterOverlay) {
            openVoiceAfterOverlay = false;
            new Handler(getMainLooper()).postDelayed(this::showVoiceRoomPicker, 250);
        }
    }

    public void openBatterySettings() {
        try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
        catch (Exception ignored) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    result = new Uri[count];
                    for (int i = 0; i < count; i++) result[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    protected void onDestroy() {
        io.shutdownNow();
        super.onDestroy();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
