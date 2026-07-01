import 'package:flutter/material.dart';

class ReLoopColors {
  ReLoopColors._();

  // Surfaces
  static const background = Color(0xFFF5F7F5);
  static const surface = Color(0xFFFFFFFF);
  static const foreground = Color(0xFF172019);
  static const muted = Color(0xFF657069);
  static const mutedSoft = Color(0xFF929B95);
  static const border = Color(0xFFE5EAE6);

  // Brand green scale
  static const brand50 = Color(0xFFF0FAF3);
  static const brand100 = Color(0xFFDDF4E4);
  static const brand200 = Color(0xFFB8E7C7);
  static const brand300 = Color(0xFF83D59D);
  static const brand400 = Color(0xFF48BD70);
  static const brand500 = Color(0xFF16A34A);
  static const brand600 = Color(0xFF15803D);
  static const brand700 = Color(0xFF176333);
  static const brand800 = Color(0xFF164F2C);
  static const brand900 = Color(0xFF123F25);

  // Accent
  static const accent = Color(0xFF65A30D);

  // Surfaces (dark)
  static const backgroundDark = Color(0xFF111814);
  static const surfaceDark = Color(0xFF19221C);
  static const foregroundDark = Color(0xFFEAF2ED);
  static const mutedDark = Color(0xFFB4C0B8);
  static const mutedSoftDark = Color(0xFF849188);
  static const borderDark = Color(0xFF334138);

  // Mint helpers
  static const mint = Color(0xFFDDF4E4);
  static const mintSoft = Color(0xFFF0FAF3);

  // Status
  static const statusOnline = Color(0xFF249A4D);
  static const statusFull = Color(0xFFD97706);
  static const statusMaintenance = Color(0xFF2563EB);
  static const statusError = Color(0xFFDC2626);
  static const statusOffline = Color(0xFF64748B);

  // Semantic
  static const success = Color(0xFF249A4D);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const info = Color(0xFF2563EB);
  static const neutral = Color(0xFF64748B);

  // Tone background/text/border maps for badges
  static const Map<String, ToneColors> tones = {
    'success': ToneColors(
      bg: Color(0xFFF0FAF3),
      text: Color(0xFF176333),
      border: Color(0xFFB8E7C7),
    ),
    'warning': ToneColors(
      bg: Color(0xFFFFFBEB),
      text: Color(0xFF92400E),
      border: Color(0xFFFDE68A),
    ),
    'danger': ToneColors(
      bg: Color(0xFFFEF2F2),
      text: Color(0xFF991B1B),
      border: Color(0xFFFECACA),
    ),
    'info': ToneColors(
      bg: Color(0xFFEFF6FF),
      text: Color(0xFF1D4ED8),
      border: Color(0xFFBFDBFE),
    ),
    'neutral': ToneColors(
      bg: Color(0xFFF1F5F9),
      text: Color(0xFF475569),
      border: Color(0xFFE2E8F0),
    ),
    'brand': ToneColors(
      bg: Color(0xFFDDF4E4),
      text: Color(0xFF176333),
      border: Color(0xFF83D59D),
    ),
  };

  static const Map<String, ToneColors> tonesDark = {
    'success': ToneColors(
      bg: Color(0xFF0A2E18),
      text: Color(0xFF86EFAC),
      border: Color(0xFF14532D),
    ),
    'warning': ToneColors(
      bg: Color(0xFF3A2D17),
      text: Color(0xFFFCD34D),
      border: Color(0xFF713F12),
    ),
    'danger': ToneColors(
      bg: Color(0xFF2D1414),
      text: Color(0xFFFCA5A5),
      border: Color(0xFF4A1F1F),
    ),
    'info': ToneColors(
      bg: Color(0xFF172554),
      text: Color(0xFF93C5FD),
      border: Color(0xFF1E40AF),
    ),
    'neutral': ToneColors(
      bg: Color(0xFF1E293B),
      text: Color(0xFFCBD5E1),
      border: Color(0xFF334155),
    ),
    'brand': ToneColors(
      bg: Color(0xFF0A2E18),
      text: Color(0xFF86EFAC),
      border: Color(0xFF14532D),
    ),
  };
}

class ToneColors {
  final Color bg;
  final Color text;
  final Color border;
  const ToneColors({
    required this.bg,
    required this.text,
    required this.border,
  });
}

extension ReLoopThemeColors on BuildContext {
  bool get isDarkMode => Theme.of(this).brightness == Brightness.dark;

  Color get reloopBackground =>
      isDarkMode ? ReLoopColors.backgroundDark : ReLoopColors.background;
  Color get reloopSurface =>
      isDarkMode ? ReLoopColors.surfaceDark : ReLoopColors.surface;
  Color get reloopSurfaceRaised =>
      isDarkMode ? const Color(0xFF202A23) : ReLoopColors.surface;
  Color get reloopSurfaceSoft =>
      isDarkMode ? const Color(0xFF172019) : const Color(0xFFF8FAF9);
  Color get reloopForeground =>
      isDarkMode ? ReLoopColors.foregroundDark : ReLoopColors.foreground;
  Color get reloopMuted =>
      isDarkMode ? ReLoopColors.mutedDark : ReLoopColors.muted;
  Color get reloopMutedSoft =>
      isDarkMode ? ReLoopColors.mutedSoftDark : ReLoopColors.mutedSoft;
  Color get reloopBorder =>
      isDarkMode ? ReLoopColors.borderDark : ReLoopColors.border;
  Color get reloopBrandSoft =>
      isDarkMode ? const Color(0xFF183B27) : ReLoopColors.brand50;
  Color get reloopBrandSoftStrong =>
      isDarkMode ? const Color(0xFF205232) : ReLoopColors.brand100;
  Color get reloopBrandText =>
      isDarkMode ? ReLoopColors.brand300 : ReLoopColors.brand700;

  ToneColors reloopTone(String tone) {
    return isDarkMode
        ? ReLoopColors.tonesDark[tone] ?? ReLoopColors.tonesDark['neutral']!
        : ReLoopColors.tones[tone] ?? ReLoopColors.tones['neutral']!;
  }
}
