import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

class SuperadminDashboardScreen extends StatefulWidget {
  const SuperadminDashboardScreen({super.key});

  @override
  State<SuperadminDashboardScreen> createState() =>
      _SuperadminDashboardScreenState();
}

class _SuperadminDashboardScreenState extends State<SuperadminDashboardScreen> {
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final response = await context.read<ApiClient>().get(
        '/api/mobile/overview',
      );
      if (mounted) {
        setState(() => _data = response.data as Map<String, dynamic>);
      }
    } catch (error) {
      if (mounted) setState(() => _error = ApiClient.getErrorMessage(error));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Dashboard Superadmin',
      child: RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    if (_data == null && _error == null) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [SkeletonDashboard()],
      );
    }
    if (_error != null) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 120),
          Icon(
            Icons.cloud_off_rounded,
            size: 48,
            color: context.reloopMutedSoft,
          ),
          const SizedBox(height: 12),
          Text(_error!, textAlign: TextAlign.center),
          TextButton(onPressed: _load, child: Text('Coba lagi')),
        ],
      );
    }

    final data = _data!;
    final security =
        data['securitySummary'] as Map<String, dynamic>? ?? const {};

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 110),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 18),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 5,
          crossAxisSpacing: 10,
          childAspectRatio: 1.45,
          children: [
            MetricCard(
              label: 'Organisasi',
              value: '${data['organizationCount'] ?? 0}',
              icon: Icons.business_outlined,
              tone: MetricTone.green,
            ),
            MetricCard(
              label: 'Mesin',
              value: '${data['machineCount'] ?? 0}',
              icon: Icons.recycling_rounded,
              tone: MetricTone.teal,
            ),
            MetricCard(
              label: 'Pengguna',
              value: '${data['userCount'] ?? 0}',
              icon: Icons.people_outline,
              tone: MetricTone.blue,
            ),
            MetricCard(
              label: 'Alert 24 jam',
              value: '${security['alerts24h'] ?? 0}',
              icon: Icons.shield_outlined,
              tone: MetricTone.amber,
            ),
          ],
        ),
        const SizedBox(height: 22),
        Text(
          'Pusat kendali ReLoop',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
            letterSpacing: -.2,
          ),
        ),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 0,
          crossAxisSpacing: 8,
          childAspectRatio: .78,
          children: [
            QuickAction(
              icon: Icons.people_outline,
              title: 'Pengguna',
              description: 'Akun & role',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/superadmin/users'),
            ),
            QuickAction(
              icon: Icons.handshake_outlined,
              title: 'Kemitraan',
              description: 'Approval mitra',
              tone: QuickActionTone.green,
              onTap: () => context.push('/superadmin/partnerships'),
            ),
            QuickAction(
              icon: Icons.account_balance_wallet_outlined,
              title: 'Redemption',
              description: 'Pencairan',
              tone: QuickActionTone.amber,
              onTap: () => context.push('/superadmin/redemptions'),
            ),
            QuickAction(
              icon: Icons.public_outlined,
              title: 'Wilayah',
              description: 'Struktur area',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/superadmin/regions'),
            ),
            QuickAction(
              icon: Icons.delete_outline,
              title: 'Jenis & Tarif',
              description: 'Sampah & poin',
              onTap: () => context.push('/superadmin/waste-types'),
            ),
            QuickAction(
              icon: Icons.settings_outlined,
              title: 'Konfigurasi',
              description: 'Atur slider',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/superadmin/config'),
            ),
            QuickAction(
              icon: Icons.history_rounded,
              title: 'Audit',
              description: 'Jejak aktivitas',
              tone: QuickActionTone.teal,
              onTap: () => context.push('/superadmin/audit'),
            ),
            QuickAction(
              icon: Icons.description_outlined,
              title: 'Laporan',
              description: 'Ekspor global',
              tone: QuickActionTone.amber,
              onTap: () => context.push('/superadmin/reports'),
            ),
          ],
        ),
      ],
    );
  }
}
