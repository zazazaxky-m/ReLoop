import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../theme/colors.dart';

/// Bell icon with an unread badge for dashboard headers. Fetches the unread
/// count once on mount and again whenever the widget is rebuilt after
/// returning from the notifications screen. Kept best-effort: any failure
/// simply hides the badge instead of surfacing an error.
class NotificationBell extends StatefulWidget {
  const NotificationBell({super.key});

  @override
  State<NotificationBell> createState() => _NotificationBellState();
}

class _NotificationBellState extends State<NotificationBell> {
  int _unread = 0;

  @override
  void initState() {
    super.initState();
    _loadCount();
  }

  Future<void> _loadCount() async {
    try {
      final response =
          await context.read<ApiClient>().get('/api/notifications');
      final data = response.data;
      final count = data is Map<String, dynamic> ? data['unreadCount'] : null;
      if (mounted && count is int) {
        setState(() => _unread = count);
      }
    } catch (_) {
      // Best-effort; keep the last known count.
    }
  }

  Future<void> _open() async {
    await context.push('/notifications');
    if (mounted) _loadCount();
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: _open,
      borderRadius: BorderRadius.circular(14),
      child: SizedBox(
        width: 42,
        height: 42,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(Icons.notifications_none_rounded,
                size: 24, color: context.reloopForeground),
            if (_unread > 0)
              Positioned(
                top: 6,
                right: 6,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEF4444),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    _unread > 9 ? '9+' : '$_unread',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 9.5,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
