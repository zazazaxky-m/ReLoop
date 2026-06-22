import 'package:local_auth/local_auth.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class BiometricService {
  static final BiometricService _instance = BiometricService._();
  factory BiometricService() => _instance;
  BiometricService._();

  final LocalAuthentication _auth = LocalAuthentication();
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  static const _keyEnabled = 'biometric_enabled';
  static const _keyCredentials = 'biometric_credentials';

  Future<bool> get isBiometricAvailable async {
    try {
      return await _auth.canCheckBiometrics &&
          await _auth.isDeviceSupported();
    } catch (_) {
      return false;
    }
  }

  Future<List<BiometricType>> get availableBiometrics async {
    try {
      return await _auth.getAvailableBiometrics();
    } catch (_) {
      return [];
    }
  }

  String get biometricLabel => 'Biometric';

  Future<String> getBiometricTypeName() async {
    final types = await availableBiometrics;
    if (types.contains(BiometricType.face)) return 'Face ID';
    if (types.contains(BiometricType.iris)) return 'Iris';
    if (types.contains(BiometricType.fingerprint)) return 'Fingerprint';
    return 'Biometric';
  }

  Future<bool> get isEnabled async {
    final value = await _storage.read(key: _keyEnabled);
    return value == 'true';
  }

  Future<void> setEnabled(bool value) async {
    await _storage.write(key: _keyEnabled, value: value.toString());
    if (!value) {
      await _storage.delete(key: _keyCredentials);
    }
  }

  Future<bool> authenticate({String? reason}) async {
    try {
      final typeName = await getBiometricTypeName();
      return await _auth.authenticate(
        localizedReason: reason ?? 'Gunakan $typeName untuk melanjutkan',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
    } catch (_) {
      return false;
    }
  }

  Future<void> saveCredentials(String email, String password) async {
    await _storage.write(key: _keyCredentials, value: '$email|$password');
  }

  Future<({String email, String password})?> getCredentials() async {
    final value = await _storage.read(key: _keyCredentials);
    if (value == null) return null;
    final parts = value.split('|');
    if (parts.length != 2) return null;
    return (email: parts[0], password: parts[1]);
  }

  Future<void> clearCredentials() async {
    await _storage.delete(key: _keyCredentials);
  }
}
