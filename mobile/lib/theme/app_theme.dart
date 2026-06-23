import 'package:flutter/material.dart';

import 'colors.dart';

class AppTheme {
  AppTheme._();

  static ThemeData get light => _build(Brightness.light);
  static ThemeData get dark => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final dark = brightness == Brightness.dark;
    final background = dark
        ? ReLoopColors.backgroundDark
        : ReLoopColors.background;
    final surface = dark ? ReLoopColors.surfaceDark : ReLoopColors.surface;
    final foreground = dark
        ? ReLoopColors.foregroundDark
        : ReLoopColors.foreground;
    final muted = dark ? ReLoopColors.mutedDark : ReLoopColors.muted;
    final border = dark ? ReLoopColors.borderDark : ReLoopColors.border;
    final scheme = ColorScheme.fromSeed(
      seedColor: ReLoopColors.brand500,
      brightness: brightness,
      primary: dark ? ReLoopColors.brand400 : ReLoopColors.brand600,
      surface: surface,
      surfaceContainerLowest: dark ? const Color(0xFF111814) : ReLoopColors.background,
      surfaceContainerLow: dark ? const Color(0xFF151D18) : const Color(0xFFF8FAF9),
      surfaceContainer: dark ? const Color(0xFF19221C) : ReLoopColors.surface,
      surfaceContainerHigh: dark ? const Color(0xFF202A23) : const Color(0xFFF1F5F2),
      onSurface: foreground,
      outline: border,
      outlineVariant: dark ? const Color(0xFF29362E) : const Color(0xFFEEF2EF),
      error: ReLoopColors.danger,
    );

    OutlineInputBorder inputBorder(Color color, [double width = 1]) {
      return OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: color, width: width),
      );
    }

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.standard,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        },
      ),
      textTheme: TextTheme(
        headlineLarge: TextStyle(
          fontSize: 28,
          height: 1.1,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.7,
          color: foreground,
        ),
        headlineMedium: TextStyle(
          fontSize: 22,
          height: 1.15,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.4,
          color: foreground,
        ),
        titleLarge: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
          color: foreground,
        ),
        titleMedium: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: foreground,
        ),
        bodyLarge: TextStyle(fontSize: 15, height: 1.45, color: foreground),
        bodyMedium: TextStyle(fontSize: 13, height: 1.4, color: muted),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: foreground,
        ),
      ),
      iconTheme: IconThemeData(color: dark ? ReLoopColors.mutedDark : ReLoopColors.muted),
      listTileTheme: ListTileThemeData(
        textColor: foreground,
        iconColor: muted,
        tileColor: Colors.transparent,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: surface,
        indicatorColor: dark ? const Color(0xFF205232) : ReLoopColors.brand100,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(color: muted, fontSize: 11, fontWeight: FontWeight.w600),
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surface.withValues(alpha: .94),
        foregroundColor: foreground,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: foreground,
          fontSize: 17,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.25,
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20),
          side: BorderSide(color: border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        border: inputBorder(border),
        enabledBorder: inputBorder(border),
        focusedBorder: inputBorder(ReLoopColors.brand500, 1.5),
        errorBorder: inputBorder(ReLoopColors.danger),
        focusedErrorBorder: inputBorder(ReLoopColors.danger, 1.5),
        labelStyle: TextStyle(color: muted),
        hintStyle: TextStyle(color: muted.withValues(alpha: .75)),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(48, 50),
          backgroundColor: ReLoopColors.brand600,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          minimumSize: const Size(48, 50),
          backgroundColor: ReLoopColors.brand600,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(44, 44),
          foregroundColor: foreground,
          side: BorderSide(color: border),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(13),
          ),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: dark
            ? ReLoopColors.brand900.withValues(alpha: .45)
            : ReLoopColors.brand50,
        side: BorderSide.none,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        labelStyle: TextStyle(
          color: dark ? ReLoopColors.brand300 : ReLoopColors.brand800,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
      dividerTheme: DividerThemeData(color: border, thickness: 1),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        showDragHandle: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: foreground,
        contentTextStyle: TextStyle(color: background),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}
