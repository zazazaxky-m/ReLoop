import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';

class OfflineService {
  static final OfflineService _instance = OfflineService._();
  factory OfflineService() => _instance;
  OfflineService._();

  static const _boxName = 'offline_cache';
  Box? _box;

  Future<void> init() async {
    _box = await Hive.openBox(_boxName);
  }

  Future<void> cache(String key, dynamic data) async {
    final json = jsonEncode(data);
    await _box?.put(key, {'data': json, 'timestamp': DateTime.now().toIso8601String()});
  }

  dynamic get(String key) {
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
