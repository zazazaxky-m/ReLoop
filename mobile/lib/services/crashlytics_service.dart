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
    // Firebase Crashlytics requires a native app; unit tests stay on the
    // disabled path above. Production wiring is verified in device builds.
    // coverage:ignore-start
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
    // coverage:ignore-end
  }

  Future<void> setUserIdentifier(String id) async {
    if (!_enabled) return;
    await _crashlytics?.setUserIdentifier(id); // coverage:ignore-line
  }

  Future<void> log(String message) async {
    if (!_enabled) return;
    await _crashlytics?.log(message); // coverage:ignore-line
  }

  Future<void> recordError({
    required dynamic exception,
    StackTrace? stack,
    bool fatal = false,
  }) async {
    if (!_enabled) return;
    await _crashlytics?.recordError(exception, stack, fatal: fatal); // coverage:ignore-line
  }

  Future<void> setCustomKey(String key, Object value) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey(key, value); // coverage:ignore-line
  }

  Future<void> setUserEmail(String email) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey('email', email); // coverage:ignore-line
  }

  Future<void> setUserRole(String role) async {
    if (!_enabled) return;
    await _crashlytics?.setCustomKey('role', role); // coverage:ignore-line
  }
}
