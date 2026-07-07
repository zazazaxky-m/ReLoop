import 'package:flutter/widgets.dart';

/// Central spacing and radius tokens so every screen shares one scale instead
/// of hardcoding arbitrary values. Use these instead of raw numbers.
class ReLoopSpacing {
  ReLoopSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  static const gap4 = SizedBox(height: xs, width: xs);
  static const gap8 = SizedBox(height: sm, width: sm);
  static const gap12 = SizedBox(height: md, width: md);
  static const gap16 = SizedBox(height: lg, width: lg);
  static const gap20 = SizedBox(height: xl, width: xl);
  static const gap24 = SizedBox(height: xxl, width: xxl);

  /// Standard horizontal screen padding.
  static const EdgeInsets screen = EdgeInsets.symmetric(horizontal: lg);
}

/// Corner radius scale. Keep the number of distinct radii small so the UI reads
/// as one cohesive system.
class ReLoopRadius {
  ReLoopRadius._();

  static const double sm = 10;
  static const double md = 14;
  static const double lg = 20;
  static const double xl = 28;
  static const double pill = 999;

  static const BorderRadius brSm = BorderRadius.all(Radius.circular(sm));
  static const BorderRadius brMd = BorderRadius.all(Radius.circular(md));
  static const BorderRadius brLg = BorderRadius.all(Radius.circular(lg));
  static const BorderRadius brXl = BorderRadius.all(Radius.circular(xl));
}

/// Accessibility minimums (Material / Apple HIG). Interactive targets should be
/// at least [minTouchTarget]; functional text should not go below [minTextSize].
class ReLoopA11y {
  ReLoopA11y._();

  static const double minTouchTarget = 48;
  static const double minTextSize = 12;
}
