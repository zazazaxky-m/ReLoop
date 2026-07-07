import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/format.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';

class AppNotification {
  AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.data,
  });

  final String id;
  final String type;
  final String title;
  final String body;
  final DateTime createdAt;
  DateTime? readAt;
  final Map<String, dynamic>? data;

  bool get isRead => readAt != null;

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: json['id'] as String,
      type: (json['type'] ?? '') as String,
      title: (json['title'] ?? '') as String,
      body: (json['body'] ?? '') as String,
      createdAt:
          DateTime.tryParse((json['createdAt'] ?? '') as String)?.toLocal() ??
              DateTime.now(),
      readAt: json['readAt'] == null
          ? null
          : DateTime.tryParse(json['readAt'] as String)?.toLocal(),
      data: json['dataJson'] is Map<String, dynamic>
          ? json['dataJson'] as Map<String, dynamic>
          : (json['data'] is Map<String, dynamic>
              ? json['data'] as Map<String, dynamic>
              : null),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  List<AppNotification> _items = [];
  bool _loading = true;
  String? _error;

  int get _unreadCount => _items.where((n) => !n.isRead).length;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final response =
          await context.read<ApiClient>().get('/api/notifications');
      final data = response.data;
      final list = (data is Map<String, dynamic> ? data['notifications'] : null);
      final items = <AppNotification>[];
      if (list is List) {
        for (final row in list) {
          if (row is Map<String, dynamic>) {
            items.add(AppNotification.fromJson(row));
          }
        }
      }
      if (mounted) {
        setState(() {
          _items = items;
          _loading = false;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = ApiClient.getErrorMessage(error);
          _loading = false;
        });
      }
    }
  }

  Future<void> _markRead(List<String>? ids) async {
    // Optimistic update — the next reload reconciles either way.
    setState(() {
      for (final n in _items) {
        if (ids == null || ids.contains(n.id)) {
          n.readAt ??= DateTime.now();
        }
      }
    });
    try {
      // Omit `ids` entirely when marking all read; the server schema treats a
      // missing field as "all unread" and rejects an explicit null.
      await context
          .read<ApiClient>()
          .patch('/api/notifications', data: ids == null ? {} : {'ids': ids});
    } catch (_) {
      // Best-effort; server state will win on the next load.
    }
  }

  void _onTap(AppNotification n) {
    if (!n.isRead) _markRead([n.id]);
    final route = n.data?['route'];
    if (route is String && route.isNotEmpty) {
      context.push(route);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifikasi'),
        actions: [
          if (_unreadCount > 0)
            TextButton(
              onPressed: () => _markRead(null),
              child: const Text('Tandai semua'),
            ),
        ],
      ),
      body: RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    if (_loading) return const SkeletonDashboard();
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 140),
          Icon(Icons.cloud_off_rounded, size: 48, color: context.reloopMutedSoft),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center),
          TextButton(onPressed: _load, child: const Text('Coba lagi')),
        ],
      );
    }
    if (_items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 140),
          Icon(Icons.notifications_none_rounded,
              size: 48, color: context.reloopMutedSoft),
          const SizedBox(height: 12),
          Text('Belum ada notifikasi.',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.reloopMuted)),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      itemCount: _items.length,
      itemBuilder: (context, index) => _NotificationTile(
        notification: _items[index],
        onTap: () => _onTap(_items[index]),
      ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.notification, required this.onTap});

  final AppNotification notification;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = !notification.isRead;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: ReLoopCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                color: context.reloopBrandSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_iconFor(notification.type),
                  size: 20, color: context.reloopBrandText),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          notification.title,
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight:
                                unread ? FontWeight.w800 : FontWeight.w600,
                            color: context.reloopForeground,
                          ),
                        ),
                      ),
                      if (unread)
                        Container(
                          width: 8,
                          height: 8,
                          margin: const EdgeInsets.only(left: 6, top: 4),
                          decoration: BoxDecoration(
                            color: ReLoopColors.brand600,
                            shape: BoxShape.circle,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    notification.body,
                    style: TextStyle(fontSize: 12.5, color: context.reloopMuted),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    formatRelativeTime(notification.createdAt),
                    style:
                        TextStyle(fontSize: 11, color: context.reloopMutedSoft),
                  ),
                ],
              ),
            ),
          ],
        ),
        ),
      ),
    );
  }

  IconData _iconFor(String type) {
    switch (type) {
      case 'PICKUP_ASSIGNED':
        return Icons.local_shipping_outlined;
      case 'REDEMPTION_STATUS':
        return Icons.payments_outlined;
      case 'MACHINE_FULL':
        return Icons.delete_outline_rounded;
      case 'MACHINE_FRAUD':
        return Icons.gpp_maybe_outlined;
      default:
        return Icons.notifications_none_rounded;
    }
  }
}
