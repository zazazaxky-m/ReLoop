import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:reloop_mobile/services/offline_service.dart';

void main() {
  group('OfflineService', () {
    late OfflineService offlineService;
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('hive_test');
      Hive.init(tempDir.path);
      offlineService = OfflineService();
      await offlineService.init(encrypted: false);
      await offlineService.clear();
    });

    tearDown(() async {
      await offlineService.clear();
      await Hive.close();
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('isInitialized returns true after init', () {
      expect(offlineService.isInitialized, isTrue);
    });

    test('cache and get data', () async {
      final testData = {'id': 1, 'name': 'Test'};
      await offlineService.cache('test_key', testData);

      final result = offlineService.get('test_key');
      expect(result, equals(testData));
    });

    test('lastUpdated returns string timestamp', () async {
      await offlineService.cache('test_key', {'data': 'abc'});
      final timestamp = offlineService.lastUpdated('test_key');
      expect(timestamp, isNotNull);
      expect(DateTime.tryParse(timestamp!), isNotNull);
    });

    test('remove deletes the key', () async {
      await offlineService.cache('test_key', 'value');
      await offlineService.remove('test_key');
      final result = offlineService.get('test_key');
      expect(result, isNull);
    });

    test('get returns null for missing key', () {
      expect(offlineService.get('missing'), isNull);
      expect(offlineService.lastUpdated('missing'), isNull);
    });

    test('cache list and nested map', () async {
      await offlineService.cache('list', [1, 2, 3]);
      expect(offlineService.get('list'), [1, 2, 3]);

      await offlineService.cache('nested', {
        'a': {'b': true},
      });
      expect(offlineService.get('nested'), {
        'a': {'b': true},
      });
    });
  });
}
