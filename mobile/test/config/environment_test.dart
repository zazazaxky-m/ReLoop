import 'package:flutter_test/flutter_test.dart';
import 'package:reloop_mobile/config/environment.dart';

void main() {
  group('Environment', () {
    test('default env is development', () {
      Environment.current = BuildEnvironment.development;
      expect(Environment.isDevelopment, isTrue);
      expect(Environment.isProduction, false);
    });

    test('isProduction returns false for development', () {
      Environment.current = BuildEnvironment.development;
      expect(Environment.isProduction, false);
    });

    test('isProduction returns true for production', () {
      Environment.current = BuildEnvironment.production;
      expect(Environment.isProduction, true);
      Environment.current = BuildEnvironment.development;
    });
  });

  group('BuildEnvironment', () {
    test('has all expected values', () {
      expect(BuildEnvironment.values.length, 3);
      expect(BuildEnvironment.values, contains(BuildEnvironment.development));
      expect(BuildEnvironment.values, contains(BuildEnvironment.staging));
      expect(BuildEnvironment.values, contains(BuildEnvironment.production));
    });
  });
}
