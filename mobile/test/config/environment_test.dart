import 'package:flutter_dotenv/flutter_dotenv.dart';
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

    test('isTest flag', () {
      Environment.current = BuildEnvironment.test;
      expect(Environment.isTest, isTrue);
      Environment.current = BuildEnvironment.development;
      expect(Environment.isTest, isFalse);
    });

    test('apiBaseUrl falls back when dotenv empty', () {
      dotenv.testLoad(fileInput: '');
      expect(Environment.apiBaseUrl, 'http://localhost:3000');
    });

    test('apiBaseUrl reads dotenv value', () {
      dotenv.testLoad(fileInput: 'API_BASE_URL=https://api.example.com');
      expect(Environment.apiBaseUrl, 'https://api.example.com');
    });

    test('envVars and instance get', () {
      dotenv.testLoad(fileInput: 'FOO=bar\nAPI_BASE_URL=https://x.test');
      expect(Environment.envVars['FOO'], 'bar');
      expect(Environment().get('FOO'), 'bar');
      expect(Environment().get('MISSING'), isNull);
    });

    test('load switches current and loads matching file', () async {
      await Environment.load(BuildEnvironment.test);
      expect(Environment.current, BuildEnvironment.test);
      expect(Environment.isTest, isTrue);

      await Environment.load(BuildEnvironment.development);
      expect(Environment.current, BuildEnvironment.development);

      await Environment.load(BuildEnvironment.staging);
      expect(Environment.current, BuildEnvironment.staging);

      await Environment.load(BuildEnvironment.production);
      expect(Environment.current, BuildEnvironment.production);

      await Environment.load(BuildEnvironment.development);
    });
  });

  group('BuildEnvironment', () {
    test('has all expected values', () {
      expect(BuildEnvironment.values.length, 4);
      expect(BuildEnvironment.values, contains(BuildEnvironment.development));
      expect(BuildEnvironment.values, contains(BuildEnvironment.staging));
      expect(BuildEnvironment.values, contains(BuildEnvironment.production));
      expect(BuildEnvironment.values, contains(BuildEnvironment.test));
    });

    test('parse accepts known values', () {
      expect(parseBuildEnvironment('development'), BuildEnvironment.development);
      expect(parseBuildEnvironment('staging'), BuildEnvironment.staging);
      expect(parseBuildEnvironment('production'), BuildEnvironment.production);
      expect(parseBuildEnvironment('test'), BuildEnvironment.test);
    });

    test('parse rejects unknown values', () {
      expect(() => parseBuildEnvironment('prod'), throwsArgumentError);
    });
  });
}
