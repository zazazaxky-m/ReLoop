import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class BiometricAuthResult {
  final bool authenticated;
  final String? errorMessage;

  const BiometricAuthResult({
    required this.authenticated,
    this.errorMessage,
  });
}

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

  String _mapAuthError(String code) {
    switch (code) {
      case auth_error.passcodeNotSet:
        return 'Kunci layar perangkat belum diatur. Aktifkan PIN, pola, atau sandi terlebih dahulu.';
      case auth_error.notEnrolled:
        return 'Belum ada biometrik yang terdaftar di perangkat ini.';
      case auth_error.notAvailable:
        return 'Biometrik tidak tersedia di perangkat ini.';
      case auth_error.otherOperatingSystem:
        return 'Perangkat ini tidak mendukung autentikasi biometrik.';
      case auth_error.lockedOut:
        return 'Biometrik dikunci sementara karena terlalu banyak percobaan. Coba lagi sebentar lagi.';
      case auth_error.permanentlyLockedOut:
        return 'Biometrik dikunci. Buka kunci perangkat Anda terlebih dahulu lalu coba lagi.';
      case auth_error.biometricOnlyNotSupported:
        return 'Mode biometrik saja tidak didukung di perangkat ini.';
      default:
        return 'Autentikasi biometrik tidak dapat digunakan saat ini.';
    }
  }

  Future<BiometricAuthResult> authenticateWithResult({String? reason}) async {
    try {
      final typeName = await getBiometricTypeName();
      final authenticated = await _auth.authenticate(
        localizedReason: reason ?? 'Gunakan $typeName untuk melanjutkan',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: true,
        ),
      );
      return BiometricAuthResult(authenticated: authenticated);
    } on PlatformException catch (e) {
      return BiometricAuthResult(
        authenticated: false,
        errorMessage: _mapAuthError(e.code),
      );
    } catch (_) {
      return const BiometricAuthResult(
        authenticated: false,
        errorMessage: 'Autentikasi biometrik tidak dapat digunakan saat ini.',
      );
    }
  }

  Future<bool> authenticate({String? reason}) async {
    final result = await authenticateWithResult(reason: reason);
    return result.authenticated;
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
