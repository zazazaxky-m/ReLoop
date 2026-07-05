import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/services/crashlytics_service.dart';

void main() {
  group('CrashlyticsService', () {
    late CrashlyticsService crashlyticsService;

    setUp(() {
      crashlyticsService = CrashlyticsService();
      crashlyticsService.initialize();
    });

    test('methods complete without error when crashlytics is not available', () async {
      await expectLater(crashlyticsService.log('test'), completes);
      await expectLater(crashlyticsService.recordError(exception: Exception('test')), completes);
      await expectLater(crashlyticsService.setUserIdentifier('id123'), completes);
      await expectLater(crashlyticsService.setCustomKey('key', 'val'), completes);
      await expectLater(crashlyticsService.setUserEmail('test@reloop.id'), completes);
      await expectLater(crashlyticsService.setUserRole('user'), completes);
    });
  });
}
