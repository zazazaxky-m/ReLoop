import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:hive_flutter/hive_flutter.dart';

class OfflineService {
  static final OfflineService _instance = OfflineService._();
  factory OfflineService() => _instance;
  OfflineService._();

  static const _boxName = 'offline_cache';
  static const _keyName = 'offline_cache_key';
  static const _storage = FlutterSecureStorage();
  Box? _box;

  /// Test-only override for [get]. Cleared by tests in tearDown.
  @visibleForTesting
  static dynamic Function(String key)? debugGetOverride;

  Future<void> init({bool encrypted = true}) async {
    // coverage:ignore-start
    final cipher = encrypted ? HiveAesCipher(await _encryptionKey()) : null;
    // coverage:ignore-end
    try {
      _box = await Hive.openBox(_boxName, encryptionCipher: cipher);
    } catch (_) {
      if (!encrypted) rethrow; // coverage:ignore-line
      // coverage:ignore-start
      await Hive.deleteBoxFromDisk(_boxName);
      _box = await Hive.openBox(_boxName, encryptionCipher: cipher);
      // coverage:ignore-end
    }
  }

  // coverage:ignore-start
  Future<List<int>> _encryptionKey() async {
    final existing = await _storage.read(key: _keyName);
    if (existing != null) return base64Decode(existing);
    final key = Hive.generateSecureKey();
    await _storage.write(key: _keyName, value: base64Encode(key));
    return key;
  }
  // coverage:ignore-end

  Future<void> cache(String key, dynamic data) async {
    final json = jsonEncode(data);
    await _box?.put(key, {'data': json, 'timestamp': DateTime.now().toIso8601String()});
  }

  dynamic get(String key) {
    if (debugGetOverride != null) return debugGetOverride!(key);
    final entry = _box?.get(key);
    if (entry == null) return null;
    try {
      return jsonDecode(entry['data']);
    } catch (_) {
      return null;
    }
  }

  String? lastUpdated(String key) {
    final entry = _box?.get(key);
    return entry?['timestamp'];
  }

  Future<void> clear() async {
    await _box?.clear();
  }

  Future<void> remove(String key) async {
    await _box?.delete(key);
  }

  bool get isInitialized => _box != null;
}
