import 'package:flutter/material.dart';

class ReLoopColors {
  ReLoopColors._();

  // Surfaces
  static const background = Color(0xFFF3F7F5);
  static const surface = Color(0xFFFFFFFF);
  static const foreground = Color(0xFF14211A);
  static const muted = Color(0xFF5F6F66);
  static const mutedSoft = Color(0xFF8B9A91);
  static const border = Color(0xFFDCE6DF);

  // Brand green scale
  static const brand50 = Color(0xFFECFDF5);
  static const brand100 = Color(0xFFDCFCE7);
  static const brand200 = Color(0xFFBBF7D0);
  static const brand300 = Color(0xFF86EFAC);
  static const brand400 = Color(0xFF4ADE80);
  static const brand500 = Color(0xFF16A34A);
  static const brand600 = Color(0xFF15803D);
  static const brand700 = Color(0xFF14532D);
  static const brand800 = Color(0xFF134E2A);
  static const brand900 = Color(0xFF0F3D21);

  // Accent
  static const accent = Color(0xFF65A30D);

  // Surfaces (dark)
  static const backgroundDark = Color(0xFF0F1A14);
  static const surfaceDark = Color(0xFF1A2A22);
  static const foregroundDark = Color(0xFFF3F7F5);
  static const mutedDark = Color(0xFF8B9A91);
  static const mutedSoftDark = Color(0xFF5F6F66);
  static const borderDark = Color(0xFF2A3A32);


  // Mint helpers
  static const mint = Color(0xFFDCFCE7);
  static const mintSoft = Color(0xFFECFDF5);

  // Status
  static const statusOnline = Color(0xFF16A34A);
  static const statusFull = Color(0xFFD97706);
  static const statusMaintenance = Color(0xFF2563EB);
  static const statusError = Color(0xFFDC2626);
  static const statusOffline = Color(0xFF64748B);

  // Semantic
  static const success = Color(0xFF16A34A);
  static const warning = Color(0xFFD97706);
  static const danger = Color(0xFFDC2626);
  static const info = Color(0xFF2563EB);
  static const neutral = Color(0xFF64748B);

  // Tone background/text/border maps for badges
  static const Map<String, ToneColors> tones = {
    'success': ToneColors(
      bg: Color(0xFFECFDF5),
      text: Color(0xFF14532D),
      border: Color(0xFFBBF7D0),
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
      bg: Color(0xFFDCFCE7),
      text: Color(0xFF14532D),
      border: Color(0xFF86EFAC),
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
