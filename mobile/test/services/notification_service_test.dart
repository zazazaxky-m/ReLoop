import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/services/notification_service.dart';

void main() {
  group('NotificationService', () {
    late NotificationService notificationService;

    setUp(() {
      notificationService = NotificationService();
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
  });
}
