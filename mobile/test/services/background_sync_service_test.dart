import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:reloop_mobile/services/background_sync_service.dart';
import 'package:reloop_mobile/services/offline_service.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:dio/dio.dart';
import '../helpers/mocks.dart';

void main() {
  group('BackgroundSyncService', () {
    late BackgroundSyncService syncService;
    late MockApiClient mockApiClient;
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('hive_test_sync');
      Hive.init(tempDir.path);
      await OfflineService().init();
      
      mockApiClient = MockApiClient();
      syncService = BackgroundSyncService();
    });

    tearDown(() async {
      syncService.stop();
      await OfflineService().clear();
      await Hive.close();
      if (tempDir.existsSync()) tempDir.deleteSync(recursive: true);
    });

    test('start triggers syncDashboard and caches result', () async {
      when(() => mockApiClient.get('/api/user/dashboard'))
          .thenAnswer((_) async => Response(requestOptions: RequestOptions(path: ''), data: {'status': 'ok'}));
      
      syncService.start(mockApiClient, interval: const Duration(hours: 1));
      
      // Delay to let the async syncDashboard complete
      await Future.delayed(const Duration(milliseconds: 100));
      
      verify(() => mockApiClient.get('/api/user/dashboard')).called(1);
      
      final cached = OfflineService().get('dashboard');
      expect(cached, equals({'status': 'ok'}));
    });

    test('syncWallet caches result', () async {
      when(() => mockApiClient.get('/api/wallet'))
          .thenAnswer((_) async => Response(requestOptions: RequestOptions(path: ''), data: {'balance': 50000}));
      
      await syncService.syncWallet(mockApiClient);
      
      verify(() => mockApiClient.get('/api/wallet')).called(1);
      
      final cached = OfflineService().get('wallet');
      expect(cached, equals({'balance': 50000}));
    });
  });
}
