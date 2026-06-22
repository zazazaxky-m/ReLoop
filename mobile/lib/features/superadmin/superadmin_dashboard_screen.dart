import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'superadmin_shell.dart';

class SuperadminDashboardScreen extends StatefulWidget {
  const SuperadminDashboardScreen({super.key});
  @override
  State<SuperadminDashboardScreen> createState() => _SuperadminDashboardScreenState();
}

class _SuperadminDashboardScreenState extends State<SuperadminDashboardScreen> {
  Map<String, dynamic> _data = {};
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final res = await context.read<ApiClient>().get('/api/mobile/overview');
      setState(() {
        _data = res.data as Map<String, dynamic>;
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SuperadminShell(
      title: 'Dashboard Superadmin',
      child: RefreshIndicator(onRefresh: _load, child: _buildBody()),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(padding: const EdgeInsets.all(16), children: const [
        SkeletonListTile(), SizedBox(height: 8), SkeletonListTile(),
      ]);
    }
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft),
        const SizedBox(height: 12),
        Text(_error!, style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }

    final machines = (_data['machines'] as List?)?.cast<dynamic>() ?? [];
    final campaignCount = (_data['campaignCount'] as num?)?.toInt() ?? 0;
    final depositCount = (_data['depositCount'] as num?)?.toInt() ?? 0;
    final partnershipCount = (_data['partnershipCount'] as num?)?.toInt() ?? 0;
    final fullCount = machines.where((m) => m['status'] == 'FULL').length;
    final attentionCount = machines.where((m) => ['OFFLINE', 'ERROR', 'MAINTENANCE'].contains(m['status'])).length;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Ringkasan Platform', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(flex: 2, child: MetricCard(label: 'Total Mesin', value: machines.length.toString(), icon: Icons.recycling, tone: MetricTone.blue)),
          const SizedBox(width: 12),
          Expanded(child: MetricCard(label: 'Mesin Penuh', value: fullCount.toString(), icon: Icons.inventory_2, tone: MetricTone.amber)),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: MetricCard(label: 'Perlu Perhatian', value: attentionCount.toString(), icon: Icons.warning_amber_rounded, tone: attentionCount > 0 ? MetricTone.amber : MetricTone.green)),
          const SizedBox(width: 12),
          Expanded(child: MetricCard(label: 'Campaign Aktif', value: campaignCount.toString(), icon: Icons.campaign_outlined, tone: MetricTone.teal)),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: MetricCard(label: 'Sesi Selesai', value: depositCount.toString(), icon: Icons.check_circle_outline, tone: MetricTone.green)),
          const SizedBox(width: 12),
          Expanded(child: MetricCard(label: 'Mitra Aktif', value: partnershipCount.toString(), icon: Icons.handshake_outlined, tone: MetricTone.teal)),
        ]),
        const SizedBox(height: 24),
        Text('Aksi Cepat', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.5,
          children: [
            _quickAction(Icons.business, 'Organisasi', 'Kelola organisasi mitra.', ReLoopColors.info, '/superadmin/organizations'),
            _quickAction(Icons.people, 'Pengguna', 'Kelola semua pengguna.', ReLoopColors.brand500, '/superadmin/users'),
            _quickAction(Icons.recycling, 'Mesin', 'Lihat semua mesin.', ReLoopColors.accent, '/superadmin/machines'),
            _quickAction(Icons.handshake, 'Kemitraan', 'Kelola kemitraan.', ReLoopColors.brand500, '/superadmin/partnerships'),
            _quickAction(Icons.account_balance_wallet, 'Redemption', 'Antrian redemption.', ReLoopColors.warning, '/superadmin/redemptions'),
            _quickAction(Icons.public, 'Wilayah', 'Kelola wilayah.', ReLoopColors.info, '/superadmin/regions'),
            _quickAction(Icons.security, 'Audit', 'Keamanan & audit.', ReLoopColors.accent, '/superadmin/audit'),
            _quickAction(Icons.settings, 'Konfigurasi', 'Pengaturan sistem.', ReLoopColors.brand500, '/superadmin/config'),
          ],
        ),
        const SizedBox(height: 80),
      ],
    );
  }

  Widget _quickAction(IconData icon, String title, String desc, Color color, String route) {
    return GestureDetector(
      onTap: () => context.push(route),
      child: ReLoopCard(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, color: color, size: 22),
              ),
              const SizedBox(height: 8),
              Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600), textAlign: TextAlign.center),
              const SizedBox(height: 2),
              Text(desc, style: const TextStyle(fontSize: 10, color: ReLoopColors.mutedSoft), textAlign: TextAlign.center, maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ),
    );
  }
}
