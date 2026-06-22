import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../core/api_client.dart';
import '../core/models.dart';
import '../services/notification_service.dart';
import '../services/analytics_service.dart';
import '../services/crashlytics_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiClient _api;
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  CurrentUser? _user;
  bool _isLoading = false;
  String? _error;

  AuthProvider(this._api);

  CurrentUser? get user => _user;
  bool get isAuthenticated => _user != null;
  bool get isLoading => _isLoading;
  String? get error => _error;

  bool hasRole(AppRole role) => _user?.role == role;
  bool hasAnyRole(List<AppRole> roles) => _user != null && roles.contains(_user!.role);

  Future<CurrentUser?> checkSession() async {
    _isLoading = true;
    notifyListeners();

    try {
      final response = await _api.get('/api/auth/me');
      final data = response.data as Map<String, dynamic>;
      _user = CurrentUser.fromJson(data['user'] as Map<String, dynamic>);
      _error = null;
      return _user;
    } catch (e) {
      _user = null;
      return null;
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<bool> login(String email, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _api.post('/api/auth/login', data: {
        'email': email,
        'password': password,
      });
      final data = response.data as Map<String, dynamic>;
      if (data['user'] != null) {
        final userData = data['user'] as Map<String, dynamic>;
        _user = CurrentUser.fromJson(userData);
        final analytics = AnalyticsService();
        analytics.setUserId(_user!.id);
        analytics.setUserProperties({
          'role': _user!.role.apiValue,
          'organization': _user!.organizationName,
        });
        final crashlytics = CrashlyticsService();
        crashlytics.setUserIdentifier(_user!.id);
        crashlytics.setUserEmail(_user!.email);
        crashlytics.setUserRole(_user!.role.apiValue);
      }
      _registerDeviceToken();
      _isLoading = false;
      notifyListeners();
      return true;
    } on DioException catch (e) {
      _error = ApiClient.getErrorMessage(e);
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Terjadi kesalahan. Coba lagi.';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<bool> register(String name, String email, String password, String phone) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      final response = await _api.post('/api/auth/register', data: {
        'name': name,
        'email': email,
        'password': password,
        'phone': phone,
      });
      final data = response.data as Map<String, dynamic>;
      _user = CurrentUser.fromJson(data['user'] as Map<String, dynamic>);
      await _storage.write(key: 'user_email', value: email);
      AnalyticsService().logLogin();
      _registerDeviceToken();
      _isLoading = false;
      notifyListeners();
      return true;
    } on DioException catch (e) {
      _error = ApiClient.getErrorMessage(e);
      _isLoading = false;
      notifyListeners();
      return false;
    } catch (e) {
      _error = 'Terjadi kesalahan. Coba lagi.';
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    try {
      await _api.post('/api/auth/logout');
    } catch (_) {}
    try {
      await NotificationService().unregisterDeviceToken();
    } catch (_) {}
    await _api.clearCookies();
    await _storage.deleteAll();
    _user = null;
    _error = null;
    notifyListeners();
  }

  void _registerDeviceToken() {
    NotificationService().registerDeviceToken();
  }

  String get dashboardRoute {
    if (_user == null) return '/login';
    switch (_user!.role) {
      case AppRole.USER:
        return '/dashboard';
      case AppRole.PENGEPUL:
        return '/pengepul/dashboard';
      case AppRole.ADMIN:
        return '/admin';
      case AppRole.SUPERADMIN:
        return '/superadmin';
    }
  }
}


