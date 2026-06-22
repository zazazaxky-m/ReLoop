import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeProvider extends ChangeNotifier {
  static const _key = 'theme_mode';

  ThemeMode _themeMode = ThemeMode.system;
  ThemeMode get themeMode => _themeMode;

  bool _loaded = false;
  bool get isLoaded => _loaded;

  bool get isDark => _themeMode == ThemeMode.dark;
  bool get isLight => _themeMode == ThemeMode.light;
  bool get isSystem => _themeMode == ThemeMode.system;

  ThemeProvider() {
    _loadTheme();
  }

  Future<void> _loadTheme() async {
    try {
      const secureStorage = FlutterSecureStorage();
      final value = await secureStorage.read(key: _key);
      if (value != null) {
        _themeMode = _parseThemeMode(value);
      }
    } catch (_) {
      try {
        final prefs = await SharedPreferences.getInstance();
        final value = prefs.getString(_key);
        if (value != null) {
          _themeMode = _parseThemeMode(value);
        }
      } catch (_) {}
    }
    _loaded = true;
    notifyListeners();
  }

  ThemeMode _parseThemeMode(String value) {
    return ThemeMode.values.firstWhere(
      (m) => m.name == value,
      orElse: () => ThemeMode.system,
    );
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    notifyListeners();

    try {
      const secureStorage = FlutterSecureStorage();
      await secureStorage.write(key: _key, value: mode.name);
    } catch (_) {}

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_key, mode.name);
    } catch (_) {}
  }

  Future<void> toggle() async {
    final next = _themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    await setThemeMode(next);
  }
}
