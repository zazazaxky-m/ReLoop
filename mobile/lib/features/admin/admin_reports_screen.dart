import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../core/api_client.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import 'admin_shell.dart';

class AdminReportsScreen extends StatefulWidget {
  const AdminReportsScreen({super.key});
  @override
  State<AdminReportsScreen> createState() => _AdminReportsScreenState();
}

class _AdminReportsScreenState extends State<AdminReportsScreen> {
  int _depositCount = 0;
  int _pickupCount = 0;
  int _rewardTotal = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSummary();
  }

  Future<void> _loadSummary() async {
    setState(() { _isLoading = true; });
    try {
      final api = context.read<ApiClient>();
      
      // Load overview metrics
      final res = await api.get('/api/mobile/overview');
      final data = res.data as Map<String, dynamic>;
      
      // Fetch rewards to compute aggregate total
      final resRewards = await api.get('/api/reports', queryParameters: {'type': 'rewards'});
      final csvData = resRewards.data.toString();
      
      int computedReward = 0;
      final lines = csvData.split('\n');
      for (var i = 1; i < lines.length; i++) {
        final line = lines[i].trim();
        if (line.isEmpty) continue;
        final parts = line.split(',');
        if (parts.length >= 4) {
          final type = parts[2].replaceAll('"', '').trim();
          final amountStr = parts[3].replaceAll('"', '').trim();
          if (type == 'EARN') {
            computedReward += int.tryParse(amountStr) ?? 0;
          }
        }
      }

      setState(() {
        _depositCount = (data['depositCount'] as num?)?.toInt() ?? 0;
        _pickupCount = data['pickups'] is List ? (data['pickups'] as List).length : 0;
        _rewardTotal = computedReward;
        _isLoading = false;
      });
    } catch (_) {
      setState(() { _isLoading = false; });
    }
  }

  Future<void> _download(String type, String filename) async {
    try {
      final api = context.read<ApiClient>();
      final res = await api.get('/api/reports', queryParameters: {'type': type});
      final csv = res.data.toString();

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsString(csv);

      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'text/csv')],
        subject: filename,
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Gagal: ${e.toString()}'), backgroundColor: ReLoopColors.danger),
        );
      }
    }
  }

  String _formatRupiah(int amount) {
    return amount.toString().replaceAllMapped(
      RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]}.',
    );
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Laporan',
      child: _isLoading
          ? ListView(padding: const EdgeInsets.all(16), children: const [SkeletonListTile(), SizedBox(height: 8), SkeletonListTile()])
          : ListView(padding: const EdgeInsets.all(16), children: [
        // Summary metrics
        Row(children: [
          Expanded(child: MetricCard(label: 'Item Diterima', value: _depositCount.toString(), icon: Icons.inventory_2, tone: MetricTone.green)),
          const SizedBox(width: 12),
          Expanded(child: MetricCard(label: 'Pickup Selesai', value: _pickupCount.toString(), icon: Icons.local_shipping, tone: MetricTone.blue)),
        ]),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: MetricCard(label: 'Reward Diterbitkan', value: 'Rp ${_formatRupiah(_rewardTotal)}', icon: Icons.paid_outlined, tone: MetricTone.amber)),
        ]),
        const SizedBox(height: 20),
        Text('Unduh Laporan CSV', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: context.reloopForeground)),
        const SizedBox(height: 12),
        _reportCard(context, 'Laporan Deposit', 'Data deposit per mesin, jenis sampah, dan user.', Icons.inventory_2, 'deposits', 'laporan-deposit.csv'),
        const SizedBox(height: 8),
        _reportCard(context, 'Laporan Reward', 'Riwayat reward (earn, redeem, penalty, adjustment).', Icons.paid_outlined, 'rewards', 'laporan-reward.csv'),
        const SizedBox(height: 8),
        _reportCard(context, 'Laporan Pickup', 'Riwayat pickup per mesin, status, dan pengepul.', Icons.local_shipping, 'pickups', 'laporan-pickup.csv'),
        const SizedBox(height: 16),
        _infoBox(context),
        const SizedBox(height: 80),
      ]),
    );
  }

  Widget _reportCard(BuildContext context, String title, String desc, IconData icon, String type, String filename) {
    return ReLoopCard(
      child: ListTile(
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(color: context.reloopBrandSoft, borderRadius: BorderRadius.circular(10)),
          child: Icon(icon, color: context.reloopBrandText, size: 22),
        ),
        title: Text(
          title,
          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14, color: context.reloopForeground),
        ),
        subtitle: Text(
          desc,
          style: TextStyle(fontSize: 12, color: context.reloopMutedSoft),
        ),
        trailing: Icon(Icons.download, color: context.reloopBrandText),
        onTap: () => _download(type, filename),
      ),
    );
  }

  Widget _infoBox(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.reloopBrandSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.reloopBrandText.withValues(alpha: 0.18)),
      ),
      child: Row(children: [
        Icon(Icons.info_outline, size: 18, color: context.reloopBrandText),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            'Laporan CSV disimpan ke folder sementara dan dapat dibagikan langsung. Data dibatasi 5000 baris per laporan.',
            style: TextStyle(fontSize: 12, color: context.reloopBrandText),
          ),
        ),
      ]),
    );
  }
}
