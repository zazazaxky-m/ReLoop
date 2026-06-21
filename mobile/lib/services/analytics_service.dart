import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter/foundation.dart';

class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._();
  factory AnalyticsService() => _instance;
  AnalyticsService._();

  FirebaseAnalytics? _analytics;

  bool get isAvailable => _analytics != null;

  void initialize() {
    try {
      _analytics = FirebaseAnalytics.instance;
    } catch (_) {
      debugPrint('Analytics not available');
    }
  }

  Future<void> logScreenView({required String screenName}) async {
    await _analytics?.logScreenView(screenName: screenName);
  }

  Future<void> logLogin({String method = 'email'}) async {
    await _analytics?.logLogin(loginMethod: method);
  }

  Future<void> logSignUp({String method = 'email'}) async {
    await _analytics?.logSignUp(signUpMethod: method);
  }

  Future<void> logEvent({
    required String name,
    Map<String, Object>? parameters,
  }) async {
    await _analytics?.logEvent(name: name, parameters: parameters);
  }

  Future<void> setUserProperties(Map<String, String?> properties) async {
    for (final entry in properties.entries) {
      await _analytics?.setUserProperty(
        name: entry.key,
        value: entry.value,
      );
    }
  }

  Future<void> setUserId(String? id) async {
    await _analytics?.setUserId(id: id);
  }

  Future<void> trackScan(String machineCode, {bool resumed = false}) {
    return logEvent(
      name: 'scan_machine',
      parameters: {
        'machine_code': machineCode,
        'resumed': resumed,
      },
    );
  }

  Future<void> trackRedemption(int amount, String provider) {
    return logEvent(
      name: 'request_redemption',
      parameters: {
        'amount': amount,
        'provider': provider,
      },
    );
  }

  Future<void> trackCampaignView(String campaignId) {
    return logEvent(
      name: 'view_campaign',
      parameters: {'campaign_id': campaignId},
    );
  }

  Future<void> trackTrashBagSubmit(String wasteType) {
    return logEvent(
      name: 'submit_trash_bag',
      parameters: {'waste_type': wasteType},
    );
  }

  Future<void> trackPickupAction(String status) {
    return logEvent(
      name: 'pickup_action',
      parameters: {'status': status},
    );
  }
}
