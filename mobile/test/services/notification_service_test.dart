import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:reloop_mobile/core/api_client.dart';
import 'package:reloop_mobile/services/notification_service.dart';

class MockApiClient extends Mock implements ApiClient {}

void main() {
  group('NotificationService', () {
    late NotificationService notificationService;
    late MockApiClient mockApi;

    setUp(() {
      notificationService = NotificationService();
      mockApi = MockApiClient();
      when(() => mockApi.dio).thenReturn(Dio());
      notificationService.debugDeviceToken = null;
    });

    test('initialize fails gracefully when firebase is missing in tests', () async {
      await expectLater(notificationService.initialize(), completes);
    });

    test('deviceToken is initially null', () {
      expect(notificationService.deviceToken, isNull);
    });

    test('registerDeviceToken completes gracefully if token is null', () async {
      await expectLater(notificationService.registerDeviceToken(), completes);
    });

    test('unregisterDeviceToken completes gracefully if token is null', () async {
      await expectLater(notificationService.unregisterDeviceToken(), completes);
    });

    test('setApiClient assigns dioForNotification', () {
      notificationService.setApiClient(mockApi);
      expect(ApiClient.dioForNotification, same(mockApi.dio));
    });

    test('onNotificationTap can be assigned', () {
      String? route;
      notificationService.onNotificationTap = (r, _) => route = r;
      notificationService.onNotificationTap?.call('/wallet', null);
      expect(route, '/wallet');
    });

    test('debugHandleTap parses payload and invokes callback', () {
      String? route;
      Map<String, String>? params;
      notificationService.onNotificationTap = (r, p) {
        route = r;
        params = p;
      };
      notificationService.debugHandleTap(null);
      expect(route, isNull);
      notificationService.debugHandleTap('not-json');
      expect(route, isNull);
      notificationService.debugHandleTap('{"route":"/wallet","params":{"id":"1"}}');
      expect(route, '/wallet');
      expect(params?['id'], '1');
    });

    test('register and unregister with token hit API paths', () async {
      final dio = Dio();
      dio.httpClientAdapter = _OkAdapter();
      when(() => mockApi.dio).thenReturn(dio);
      ApiClient.dioForNotification = dio;
      notificationService.debugDeviceToken = 'tok';
      await notificationService.registerDeviceToken();
      await notificationService.unregisterDeviceToken();
    });
  });
}

class _OkAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future? cancelFuture,
  ) async {
    return ResponseBody.fromString('{}', 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}
