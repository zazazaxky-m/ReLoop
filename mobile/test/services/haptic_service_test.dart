import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/services/haptic_service.dart';
import 'package:flutter/widgets.dart';

void main() {
  setUpAll(() {
    WidgetsFlutterBinding.ensureInitialized();
  });

  group('HapticService', () {
    test('singleton returns same instance', () {
      final a = HapticService();
      final b = HapticService();
      expect(identical(a, b), isTrue);
    });

    test('light does not throw', () {
      expect(() => HapticService().light(), returnsNormally);
    });

    test('medium does not throw', () {
      expect(() => HapticService().medium(), returnsNormally);
    });

    test('heavy does not throw', () {
      expect(() => HapticService().heavy(), returnsNormally);
    });

    test('selection does not throw', () {
      expect(() => HapticService().selection(), returnsNormally);
    });

    test('success does not throw', () async {
      HapticService().success();
      await Future.delayed(const Duration(milliseconds: 200));
    });

    test('error does not throw', () {
      expect(() => HapticService().error(), returnsNormally);
    });
  });
}
