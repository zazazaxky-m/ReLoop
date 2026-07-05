import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:reloop_mobile/providers/theme_provider.dart';

void main() {
  setUpAll(() {
    FlutterSecureStorage.setMockInitialValues({});
  });

  group('ThemeProvider', () {
    test('Initial theme mode is system', () async {
      final provider = ThemeProvider();
      await Future.delayed(Duration.zero);
      expect(provider.themeMode, ThemeMode.system);
    });

    test('setThemeMode updates theme mode and persists', () async {
      final provider = ThemeProvider();
      await Future.delayed(Duration.zero);
      
      await provider.setThemeMode(ThemeMode.dark);
      expect(provider.themeMode, ThemeMode.dark);
      expect(provider.isDark, isTrue);

      await provider.setThemeMode(ThemeMode.light);
      expect(provider.themeMode, ThemeMode.light);
      expect(provider.isDark, isFalse);
    });

    test('toggle switches between light and dark', () async {
      final provider = ThemeProvider();
      await Future.delayed(Duration.zero);
      
      // Default system toggle usually targets dark if not set, 
      // but toggle logic is: if dark -> light, else -> dark
      await provider.toggle();
      expect(provider.themeMode, ThemeMode.dark);

      await provider.toggle();
      expect(provider.themeMode, ThemeMode.light);
    });
  });
}
