import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:reloop_mobile/services/biometric_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('BiometricService', () {
    late BiometricService biometricService;

    setUp(() {
      FlutterSecureStorage.setMockInitialValues({});
      biometricService = BiometricService();
    });

    test('isBiometricAvailable gracefully handles missing channel', () async {
      final isAvailable = await biometricService.isBiometricAvailable;
      expect(isAvailable, isFalse);
    });

    test('isEnabled is false by default', () async {
      final isEnabled = await biometricService.isEnabled;
      expect(isEnabled, isFalse);
    });

    test('setEnabled changes the state and clears credentials if false', () async {
      await biometricService.saveCredentials('test@reloop.id', 'password123');
      await biometricService.setEnabled(true);
      expect(await biometricService.isEnabled, isTrue);

      await biometricService.setEnabled(false);
      expect(await biometricService.isEnabled, isFalse);
      
      final creds = await biometricService.getCredentials();
      expect(creds, isNull);
    });

    test('save and get credentials', () async {
      await biometricService.saveCredentials('test@reloop.id', 'password123');
      final creds = await biometricService.getCredentials();
      expect(creds, isNotNull);
      expect(creds!.email, equals('test@reloop.id'));
      expect(creds.password, equals('password123'));
    });

    test('clearCredentials removes the saved data', () async {
      await biometricService.saveCredentials('test@reloop.id', 'password123');
      await biometricService.clearCredentials();
      final creds = await biometricService.getCredentials();
      expect(creds, isNull);
    });

    test('availableBiometrics returns empty without plugin', () async {
      final types = await biometricService.availableBiometrics;
      expect(types, isEmpty);
    });

    test('getBiometricTypeName defaults to Biometric', () async {
      expect(await biometricService.getBiometricTypeName(), 'Biometric');
      expect(biometricService.biometricLabel, 'Biometric');
    });

    test('authenticate returns false without plugin', () async {
      expect(await biometricService.authenticate(reason: 'Tes'), isFalse);
    });

    test('getCredentials returns null for malformed value', () async {
      FlutterSecureStorage.setMockInitialValues({
        'biometric_credentials': 'only-one-part',
      });
      final creds = await biometricService.getCredentials();
      expect(creds, isNull);
    });
  });
}
