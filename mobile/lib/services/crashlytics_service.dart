import 'package:firebase_crashlytics/firebase_crashlytics.dart';
import 'package:flutter/foundation.dart';
import '../config/environment.dart';

class CrashlyticsService {
  static final CrashlyticsService _instance = CrashlyticsService._();
  factory CrashlyticsService() => _instance;
  CrashlyticsService._();

  FirebaseCrashlytics? _crashlytics;

  bool _enabled = false;

  void initialize() {
    if (Environment.isDevelopment) return;
    try {
      _crashlytics = FirebaseCrashlytics.instance;
      _enabled = true;

      FlutterError.onError = (details) {
        _crashlytics?.recordFlutterFatalError(details);
      };

      PlatformDispatcher.instance.onError = (exception, stack) {
        _crashlytics?.recordError(exception, stack, fatal: true);
        return true;
      };
    } catch (_) {
      debugPrint('Crashlytics not available');
    }
  }

  Future<void> setUserIdentifier(String id) async {
    if (!_enabled) return;
    await _crashlytics?.setUserIdentifier(id);
  }

  Future<void> log(String message) async {
    if (!_enabled) return;
    await _crashlytics?.log(message);
  }

  Future<void> recordError({
    required dynamic exception,
    StackTrace? stack,
    bool fatal = false,
  }) async {
    if (!_enabled) return;
    await _crashlytics?.recordError(exception, stack, fatal: fatal);
  }

  Future<void> setCustomKey(String key, Object value) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey(key, value);
  }

  Future<void> setUserEmail(String email) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey('email', email);
  }

  Future<void> setUserRole(String role) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey('role', role);
  }
}
