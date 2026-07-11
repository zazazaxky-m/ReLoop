import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/services/analytics_service.dart';

void main() {
  group('AnalyticsService', () {
    late AnalyticsService analyticsService;

    setUp(() {
      analyticsService = AnalyticsService();
      // initialize will fail gracefully in test env
      analyticsService.initialize();
    });

    test('isAvailable is false when firebase is not initialized', () {
      expect(analyticsService.isAvailable, isFalse);
    });

    test('methods complete without error when analytics is not available', () async {
      await expectLater(analyticsService.logScreenView(screenName: 'test'), completes);
      await expectLater(analyticsService.trackScan('M1'), completes);
      await expectLater(analyticsService.trackScan('M1', resumed: true), completes);
      await expectLater(analyticsService.trackRedemption(100, 'bank'), completes);
      await expectLater(analyticsService.trackCampaignView('C1'), completes);
      await expectLater(analyticsService.trackTrashBagSubmit('plastic'), completes);
      await expectLater(analyticsService.trackTrashBagIssue('organic'), completes);
      await expectLater(analyticsService.trackPickupAction('completed'), completes);
      await expectLater(analyticsService.logLogin(), completes);
      await expectLater(analyticsService.logSignUp(), completes);
      await expectLater(
        analyticsService.logEvent(name: 'custom', parameters: {'a': 1}),
        completes,
      );
      await expectLater(analyticsService.setUserId('u1'), completes);
      await expectLater(
        analyticsService.setUserProperties({'role': 'USER', 'org': null}),
        completes,
      );
    });
  });
}
