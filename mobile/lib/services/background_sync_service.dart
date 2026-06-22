import 'dart:async';
import '../core/api_client.dart';
import 'offline_service.dart';

class BackgroundSyncService {
  static final BackgroundSyncService _instance = BackgroundSyncService._();
  factory BackgroundSyncService() => _instance;
  BackgroundSyncService._();

  Timer? _timer;
  bool _isRunning = false;

  void start(ApiClient api, {Duration interval = const Duration(minutes: 15)}) {
    if (_isRunning) return;
    _isRunning = true;
    _syncDashboard(api);
    _timer = Timer.periodic(interval, (_) => _syncDashboard(api));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _isRunning = false;
  }

  Future<void> _syncDashboard(ApiClient api) async {
    try {
      final response = await api.get('/api/user/dashboard');
      await OfflineService().cache('dashboard', response.data);
    } catch (_) {}
  }

  Future<void> syncWallet(ApiClient api) async {
    try {
      final response = await api.get('/api/wallet');
      await OfflineService().cache('wallet', response.data);
    } catch (_) {}
  }
}
