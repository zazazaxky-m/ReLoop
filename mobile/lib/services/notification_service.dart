import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter/foundation.dart';
import '../core/api_client.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._();
  factory NotificationService() => _instance;
  NotificationService._();

  FirebaseMessaging? _fcm;
  final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

  String? _deviceToken;
  String? get deviceToken => _deviceToken;

  void Function(String route, Map<String, String>? params)? onNotificationTap;

  Future<void> initialize() async {
    try {
      _fcm = FirebaseMessaging.instance;
    } catch (_) {
      return;
    }
    await _initLocalNotifications();
    await _requestPermission();
    await _getToken();
    _setupHandlers();
  }

  Future<void> _initLocalNotifications() async {
    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: true,
      requestBadgePermission: true,
      requestSoundPermission: true,
    );
    await _local.initialize(
      const InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
      ),
      onDidReceiveNotificationResponse: (response) {
        _handleTap(response.payload);
      },
    );
  }

  Future<void> _requestPermission() async {
    final settings = await _fcm!.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized) {
      debugPrint('Notification permission not granted');
    }
  }

  Future<void> _getToken() async {
    _deviceToken = await _fcm!.getToken();
    debugPrint('FCM Token: $_deviceToken');
    _fcm!.onTokenRefresh.listen((token) {
      _deviceToken = token;
      _registerDeviceToken();
    });
  }

  void _setupHandlers() {
    FirebaseMessaging.onMessage.listen(_showLocalNotification);

    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      _handleTap(jsonEncode(message.data));
    });

    FirebaseMessaging.onBackgroundMessage(_backgroundHandler);
  }

  @pragma('vm:entry-point')
  static Future<void> _backgroundHandler(RemoteMessage message) async {
    debugPrint('Background message: ${message.notification?.title}');
  }

  Future<void> _showLocalNotification(RemoteMessage message) async {
    final notification = message.notification;
    if (notification == null) return;

    final androidDetails = AndroidNotificationDetails(
      'reloop_default',
      'ReLoop Notifications',
      channelDescription: 'Notifikasi ReLoop',
      importance: Importance.high,
      priority: Priority.high,
      icon: '@mipmap/ic_launcher',
    );

    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    await _local.show(
      notification.hashCode,
      notification.title,
      notification.body,
      NotificationDetails(android: androidDetails, iOS: iosDetails),
      payload: jsonEncode(message.data),
    );
  }

  void _handleTap(String? payload) {
    if (payload == null) return;
    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final route = data['route'] as String?;
      final params = (data['params'] as Map<String, dynamic>?)
          ?.map((k, v) => MapEntry(k, v.toString()));
      if (route != null && onNotificationTap != null) {
        onNotificationTap!(route, params);
      }
    } catch (_) {}
  }

  Future<void> registerDeviceToken() async {
    if (_deviceToken == null) return;
    await _registerDeviceToken();
  }

  Future<void> _registerDeviceToken() async {
    if (_deviceToken == null) return;
    debugPrint(
      'Skipping device token registration because `/api/devices/register` '
      'is not available on the current backend.',
    );
  }

  void setApiClient(ApiClient api) {
    ApiClient.dioForNotification = api.dio;
  }

  Future<void> unregisterDeviceToken() async {
    if (_deviceToken == null) return;
    debugPrint(
      'Skipping device token unregister because `/api/devices/unregister` '
      'is not available on the current backend.',
    );
  }
}
