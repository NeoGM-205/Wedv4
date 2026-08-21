package vn.giatoc.namehub;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

final class OverlayBubbleController {
    interface Actions {
        void onToggleMute();
        void onToggleDeafen();
        void onLeave();
        void onOpenApp();
    }

    private final Context context;
    private final WindowManager wm;
    private final Actions actions;
    private WindowManager.LayoutParams params;
    private LinearLayout root;
    private TextView bubble;
    private LinearLayout panel;
    private TextView status;
    private Button muteBtn;
    private Button deafenBtn;
    private boolean muted;
    private boolean deafened;

    OverlayBubbleController(Context context, Actions actions) {
        this.context = context.getApplicationContext();
        this.actions = actions;
        this.wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    void show() {
        if (root != null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) return;

        root = new LinearLayout(context);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);

        bubble = new TextView(context);
        bubble.setText("🎙️");
        bubble.setTextSize(24);
        bubble.setGravity(Gravity.CENTER);
        bubble.setTextColor(Color.WHITE);
        bubble.setBackground(circle(Color.rgb(35, 83, 210)));
        root.addView(bubble, new LinearLayout.LayoutParams(dp(58), dp(58)));

        panel = new LinearLayout(context);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(10), dp(8), dp(10), dp(8));
        panel.setBackground(roundRect(Color.argb(238, 18, 24, 39), 16));
        panel.setVisibility(View.GONE);

        status = new TextView(context);
        status.setText("🎙️ Voice nền");
        status.setTextColor(Color.WHITE);
        status.setTextSize(13);
        status.setMaxWidth(dp(230));
        panel.addView(status, new LinearLayout.LayoutParams(dp(230), LinearLayout.LayoutParams.WRAP_CONTENT));

        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        muteBtn = smallButton("🔇 Mic");
        deafenBtn = smallButton("🔕 Nghe");
        Button openBtn = smallButton("🏠 Hub");
        Button leaveBtn = smallButton("✕ Rời");
        row.addView(muteBtn); row.addView(deafenBtn); row.addView(openBtn); row.addView(leaveBtn);
        panel.addView(row);
        root.addView(panel);

        muteBtn.setOnClickListener(v -> actions.onToggleMute());
        deafenBtn.setOnClickListener(v -> actions.onToggleDeafen());
        openBtn.setOnClickListener(v -> actions.onOpenApp());
        leaveBtn.setOnClickListener(v -> actions.onLeave());

        params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE |
                        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = dp(12);
        params.y = dp(180);

        installDragAndTap();
        try { wm.addView(root, params); }
        catch (Exception ignored) { root = null; }
    }

    private void installDragAndTap() {
        final float[] downRaw = new float[2];
        final int[] downPos = new int[2];
        final long[] downTime = new long[1];
        bubble.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downRaw[0] = event.getRawX(); downRaw[1] = event.getRawY();
                    downPos[0] = params.x; downPos[1] = params.y;
                    downTime[0] = System.currentTimeMillis();
                    return true;
                case MotionEvent.ACTION_MOVE:
                    params.x = downPos[0] + Math.round(event.getRawX() - downRaw[0]);
                    params.y = downPos[1] + Math.round(event.getRawY() - downRaw[1]);
                    try { wm.updateViewLayout(root, params); } catch (Exception ignored) {}
                    return true;
                case MotionEvent.ACTION_UP:
                    float dx = Math.abs(event.getRawX() - downRaw[0]);
                    float dy = Math.abs(event.getRawY() - downRaw[1]);
                    if (dx < dp(8) && dy < dp(8) && System.currentTimeMillis() - downTime[0] < 350) {
                        panel.setVisibility(panel.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
                        try { wm.updateViewLayout(root, params); } catch (Exception ignored) {}
                    }
                    return true;
                default:
                    return false;
            }
        });
    }

    void updateStatus(String text) {
        if (status != null) status.setText(text == null ? "🎙️ Voice nền" : text);
    }

    void updateState(boolean muted, boolean deafened) {
        this.muted = muted;
        this.deafened = deafened;
        if (muteBtn != null) muteBtn.setText(muted ? "🎤 Bật" : "🔇 Mic");
        if (deafenBtn != null) deafenBtn.setText(deafened ? "🔊 Nghe" : "🔕 Nghe");
        if (bubble != null) bubble.setText(muted ? "🔇" : "🎙️");
    }

    void hide() {
        if (root != null) {
            try { wm.removeView(root); } catch (Exception ignored) {}
        }
        root = null;
        bubble = null;
        panel = null;
        status = null;
        muteBtn = null;
        deafenBtn = null;
    }

    private Button smallButton(String text) {
        Button b = new Button(context);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextSize(11);
        b.setTextColor(Color.WHITE);
        b.setPadding(dp(5), 0, dp(5), 0);
        b.setMinWidth(0); b.setMinimumWidth(0);
        b.setMinHeight(dp(36)); b.setMinimumHeight(dp(36));
        b.setBackground(roundRect(Color.rgb(43, 56, 82), 10));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(38), 1f);
        lp.setMargins(dp(2), dp(6), dp(2), 0);
        b.setLayoutParams(lp);
        return b;
    }

    private GradientDrawable circle(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(color);
        d.setStroke(dp(2), Color.argb(180, 255, 255, 255));
        return d;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.RECTANGLE);
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private int dp(int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
