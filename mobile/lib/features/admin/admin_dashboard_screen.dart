import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/status_badge.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  List<dynamic> _machines = [];
  List<dynamic> _pickups = [];
  int _campaignCount = 0;
  int _depositCount = 0;
  int _partnershipCount = 0;
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
      final data = res.data as Map<String, dynamic>;
      setState(() {
        _machines = (data['machines'] as List?)?.cast<dynamic>() ?? [];
        _pickups = (data['pickups'] as List?)?.cast<dynamic>() ?? [];
        _campaignCount = (data['campaignCount'] as num?)?.toInt() ?? 0;
        _depositCount = (data['depositCount'] as num?)?.toInt() ?? 0;
        _partnershipCount = (data['partnershipCount'] as num?)?.toInt() ?? 0;
        _isLoading = false;
      });
    } catch (e) {
      setState(() { _error = ApiClient.getErrorMessage(e); _isLoading = false; });
    }
  }

  int get _fullCount => _machines.where((m) => m['status'] == 'FULL').length;
  int get _attentionCount => _machines.where((m) => ['OFFLINE', 'ERROR', 'MAINTENANCE'].contains(m['status'])).length;

  @override
  Widget build(BuildContext context) {
    return AdminShell(title: 'Dashboard Admin', child: RefreshIndicator(onRefresh: _load, child: _buildBody()));
  }

  Widget _buildBody() {
    if (_isLoading) return ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()]);
    if (_error != null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.cloud_off, size: 48, color: ReLoopColors.mutedSoft), const SizedBox(height: 12),
        Text(_error ?? '', style: const TextStyle(color: ReLoopColors.muted)),
        TextButton(onPressed: _load, child: const Text('Coba Lagi')),
      ]));
    }
    return ListView(padding: const EdgeInsets.all(16), children: [
      Row(children: [
        Expanded(flex: 2, child: MetricCard(label: 'Total Mesin', value: _machines.length.toString(), icon: Icons.recycling, tone: MetricTone.blue)),
        const SizedBox(width: 12),
        Expanded(child: MetricCard(label: 'Mesin Penuh', value: _fullCount.toString(), icon: Icons.inventory_2, tone: MetricTone.amber)),
      ]),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: MetricCard(label: 'Perlu Perhatian', value: _attentionCount.toString(), icon: Icons.warning_amber_rounded, tone: _attentionCount > 0 ? MetricTone.amber : MetricTone.green)),
        const SizedBox(width: 12),
        Expanded(child: MetricCard(label: 'Campaign Aktif', value: _campaignCount.toString(), icon: Icons.campaign_outlined, tone: MetricTone.teal)),
      ]),
      const SizedBox(height: 12),
      Row(children: [
        Expanded(child: MetricCard(label: 'Sesi Selesai', value: _depositCount.toString(), icon: Icons.check_circle_outline, tone: MetricTone.green)),
        const SizedBox(width: 12),
        Expanded(child: MetricCard(label: 'Mitra Aktif', value: _partnershipCount.toString(), icon: Icons.handshake_outlined, tone: MetricTone.teal)),
      ]),
      const SizedBox(height: 20),
      GridView.count(
        crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.3,
        children: [
          QuickAction(icon: Icons.recycling, title: 'Mesin', description: 'Kelola mesin organisasi.', color: ReLoopColors.info, onTap: () => context.push('/admin/machines')),
          QuickAction(icon: Icons.local_shipping, title: 'Pickup', description: 'Atur tugas pengambilan.', color: ReLoopColors.warning, onTap: () => context.push('/admin/pickups')),
          QuickAction(icon: Icons.campaign_outlined, title: 'Campaign', description: 'Kelola program campaign.', color: ReLoopColors.accent, onTap: () => context.push('/admin/campaigns')),
          QuickAction(icon: Icons.handshake, title: 'Mitra', description: 'Kelola mitra pengepul.', color: ReLoopColors.brand500, onTap: () => context.push('/admin/partners')),
          QuickAction(icon: Icons.delete_outline, title: 'Jenis & Tarif', description: 'Atur jenis sampah & reward.', color: ReLoopColors.warning, onTap: () => context.push('/admin/waste-types')),
          QuickAction(icon: Icons.description_outlined, title: 'Laporan', description: 'Unduh laporan CSV.', color: ReLoopColors.accent, onTap: () => context.push('/admin/reports')),
        ],
      ),
      const SizedBox(height: 24),
      _buildSection('Status Mesin', _machines.isEmpty
          ? 'Belum ada mesin.'
          : null,
        children: _machines.take(5).map(_buildMachineTile).toList(),
      ),
      const SizedBox(height: 24),
      _buildSection('Pickup Aktif', _pickups.isEmpty
          ? 'Tidak ada pickup aktif.'
          : null,
        children: _pickups.take(5).map(_buildPickupTile).toList(),
      ),
      const SizedBox(height: 80),
    ]);
  }

  Widget _buildSection(String title, String? emptyText, {required List<Widget> children}) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      ReLoopCardHeader(
        child: ReLoopCardTitle(title: title),
      ),
      if (emptyText != null)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 24),
          child: Center(child: Text(emptyText, style: const TextStyle(color: ReLoopColors.mutedSoft, fontSize: 13))),
        )
      else
        ...children,
    ]);
  }

  Widget _buildMachineTile(dynamic m) {
    final fillLevel = (m['fillLevelPercent'] as num?)?.toInt() ?? 0;
    final fillColor = fillLevel >= 80 ? ReLoopColors.statusFull : fillLevel >= 50 ? ReLoopColors.statusFull.withValues(alpha: 0.7) : ReLoopColors.brand500;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: ReLoopCard(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text((m['name'] as String?) ?? 'Mesin', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: ReLoopColors.foreground)),
              if (m['machineCode'] != null) Text(m['machineCode'] as String, style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
            ])),
            const SizedBox(width: 8),
            Text('%', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fillColor)),
            const SizedBox(width: 8),
            StatusBadge(statusKey: (m['status'] as String?) ?? 'OFFLINE'),
          ]),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(3),
            child: LinearProgressIndicator(value: fillLevel / 100, minHeight: 4, backgroundColor: ReLoopColors.border, valueColor: AlwaysStoppedAnimation<Color>(fillColor)),
          ),
        ]),
      ),
    );
  }

  Widget _buildPickupTile(dynamic p) {
    final machine = p['machine'] as Map<String, dynamic>?;
    final status = (p['status'] as String?) ?? 'REQUESTED';
    final itemCount = (p['_count']?['items'] as num?)?.toInt() ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: ReLoopCard(
        child: Row(children: [
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(machine?['name'] as String? ?? 'Pickup #', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13, color: ReLoopColors.foreground)),
            if (p['notes'] != null)
              Text(p['notes'] as String, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft)),
          ])),
          if (itemCount > 0)
            Padding(padding: const EdgeInsets.only(right: 8), child: Text(' item', style: const TextStyle(fontSize: 11, color: ReLoopColors.mutedSoft))),
          StatusBadge(statusKey: status),
        ]),
      ),
    );
  }
}
