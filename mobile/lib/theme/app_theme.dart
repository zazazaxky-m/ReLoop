import 'package:flutter/material.dart';
import 'colors.dart';

class AppTheme {
  AppTheme._();

  static ThemeData get dark {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: ReLoopColors.brand500,
      primary: ReLoopColors.brand400,
      onPrimary: ReLoopColors.brand900,
      surface: ReLoopColors.surfaceDark,
      onSurface: ReLoopColors.foregroundDark,
      error: ReLoopColors.danger,
      outline: ReLoopColors.borderDark,
      surfaceContainerHighest: ReLoopColors.backgroundDark,
      brightness: Brightness.dark,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: ReLoopColors.backgroundDark,
      fontFamily: null,
      textTheme: const TextTheme(
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: ReLoopColors.foregroundDark),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: ReLoopColors.foregroundDark),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: ReLoopColors.foregroundDark),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: ReLoopColors.foregroundDark),
        titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: ReLoopColors.foregroundDark),
        bodyLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.normal, color: ReLoopColors.foregroundDark),
        bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.normal, color: ReLoopColors.mutedDark),
        bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.normal, color: ReLoopColors.mutedSoftDark),
        labelLarge: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: ReLoopColors.mutedDark),
        labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: ReLoopColors.mutedSoftDark),
      ),
      brightness: Brightness.dark,
      appBarTheme: const AppBarTheme(
        backgroundColor: ReLoopColors.surfaceDark,
        foregroundColor: ReLoopColors.foregroundDark,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: ReLoopColors.foregroundDark,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: ReLoopColors.surfaceDark,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: ReLoopColors.borderDark),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ReLoopColors.surfaceDark,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.borderDark),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.borderDark),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.brand500, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.danger),
        ),
        labelStyle: const TextStyle(color: ReLoopColors.mutedDark),
        hintStyle: const TextStyle(color: ReLoopColors.mutedSoftDark),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ReLoopColors.brand600,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ReLoopColors.foregroundDark,
          side: const BorderSide(color: ReLoopColors.borderDark),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: ReLoopColors.surfaceDark,
        selectedItemColor: ReLoopColors.brand400,
        unselectedItemColor: ReLoopColors.mutedSoftDark,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: ReLoopColors.surfaceDark,
        indicatorColor: ReLoopColors.brand700.withValues(alpha: 0.3),
        surfaceTintColor: Colors.transparent,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        height: 70,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: ReLoopColors.brand400,
            );
          }
          return const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: ReLoopColors.mutedSoftDark,
          );
        }),
      ),
      dividerTheme: const DividerThemeData(
        color: ReLoopColors.borderDark,
        thickness: 1,
      ),
    );
  }

  static ThemeData get light {
    final colorScheme = ColorScheme.fromSeed(
      seedColor: ReLoopColors.brand500,
      primary: ReLoopColors.brand600,
      onPrimary: Colors.white,
      surface: ReLoopColors.surface,
      onSurface: ReLoopColors.foreground,
      error: ReLoopColors.danger,
      outline: ReLoopColors.border,
      surfaceContainerHighest: ReLoopColors.background,
    );

    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: ReLoopColors.background,
      fontFamily: null,
      textTheme: const TextTheme(
        headlineLarge: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: ReLoopColors.foreground),
        headlineMedium: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: ReLoopColors.foreground),
        titleLarge: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: ReLoopColors.foreground),
        titleMedium: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: ReLoopColors.foreground),
        titleSmall: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: ReLoopColors.foreground),
        bodyLarge: TextStyle(fontSize: 14, fontWeight: FontWeight.normal, color: ReLoopColors.foreground),
        bodyMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.normal, color: ReLoopColors.muted),
        bodySmall: TextStyle(fontSize: 12, fontWeight: FontWeight.normal, color: ReLoopColors.mutedSoft),
        labelLarge: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: ReLoopColors.muted),
        labelSmall: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: ReLoopColors.mutedSoft),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: ReLoopColors.surface,
        foregroundColor: ReLoopColors.foreground,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: TextStyle(
          color: ReLoopColors.foreground,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: ReLoopColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: ReLoopColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ReLoopColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.brand500, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: ReLoopColors.danger),
        ),
        labelStyle: const TextStyle(color: ReLoopColors.muted),
        hintStyle: const TextStyle(color: ReLoopColors.mutedSoft),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ReLoopColors.brand600,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          textStyle: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ReLoopColors.foreground,
          side: const BorderSide(color: ReLoopColors.border),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: ReLoopColors.surface,
        selectedItemColor: ReLoopColors.brand600,
        unselectedItemColor: ReLoopColors.mutedSoft,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: ReLoopColors.surface,
        indicatorColor: ReLoopColors.brand50,
        surfaceTintColor: Colors.transparent,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        height: 70,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: ReLoopColors.brand600,
            );
          }
          return const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: ReLoopColors.mutedSoft,
          );
        }),
      ),
      dividerTheme: const DividerThemeData(
        color: ReLoopColors.border,
        thickness: 1,
      ),
    );
  }
}
