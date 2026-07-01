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
  int _depositItemAccepted = 0;
  int _depositItemCount = 0;
  int _pickupCompleted = 0;
  int _pickupCount = 0;
  int _rewardTotal = 0;
  int _userCount = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSummary();
  }

  Future<void> _loadSummary() async {
    setState(() {
      _isLoading = true;
    });
    try {
      final api = context.read<ApiClient>();

      // Use the dedicated mobile reports endpoint so the metrics match the
      // values shown on the web admin Reports page.
      final res = await api.get('/api/mobile/reports');
      final data = res.data as Map<String, dynamic>;

      // Compute total reward issued from the rewards CSV (the same source
      // the web dashboard uses for the aggregate card).
      final resRewards = await api.get(
        '/api/reports',
        queryParameters: {'type': 'rewards'},
      );
      final csvData = resRewards.data.toString();

      int computedReward = 0;
      final lines = csvData.split('\n');
      for (var i = 1; i < lines.length; i++) {
        final line = lines[i].trim();
        if (line.isEmpty) continue;
        final cells = _parseCsvLine(line);
        if (cells.length >= 4) {
          final type = cells[2].trim();
          final amountStr = cells[3].trim();
          if (type == 'EARN') {
            computedReward += int.tryParse(amountStr) ?? 0;
          }
        }
      }

      setState(() {
        _depositItemAccepted =
            (data['depositItemAccepted'] as num?)?.toInt() ?? 0;
        _depositItemCount = (data['depositItemCount'] as num?)?.toInt() ?? 0;
        _pickupCompleted = (data['pickupCompleted'] as num?)?.toInt() ?? 0;
        _pickupCount = (data['pickupCount'] as num?)?.toInt() ?? 0;
        _rewardTotal = computedReward;
        _userCount = (data['userCount'] as num?)?.toInt() ?? 0;
        _isLoading = false;
      });
    } catch (_) {
      setState(() {
        _isLoading = false;
      });
    }
  }

  // Minimal CSV line parser that respects quoted fields with commas.
  List<String> _parseCsvLine(String line) {
    final out = <String>[];
    final buf = StringBuffer();
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      final ch = line[i];
      if (ch == '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
          buf.write('"');
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch == ',' && !inQuotes) {
        out.add(buf.toString());
        buf.clear();
      } else {
        buf.write(ch);
      }
    }
    out.add(buf.toString());
    return out;
  }

  Future<void> _download(String type, String filename) async {
    try {
      final api = context.read<ApiClient>();
      final res = await api.get(
        '/api/reports',
        queryParameters: {'type': type},
      );
      final csv = res.data.toString();

      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/$filename');
      await file.writeAsString(csv);

      await Share.shareXFiles([
        XFile(file.path, mimeType: 'text/csv'),
      ], subject: filename);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(e)),
            backgroundColor: ReLoopColors.danger,
          ),
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
          ? ListView(
              padding: const EdgeInsets.all(16),
              children: const [
                SkeletonListTile(),
                SizedBox(height: 8),
                SkeletonListTile(),
              ],
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Summary metrics — sourced from /api/mobile/reports so the numbers
                // match the web admin Reports page (Pickup Selesai = status COMPLETED,
                // Item Diterima = deposit item status ACCEPTED).
                Row(
                  children: [
                    Expanded(
                      child: MetricCard(
                        label: 'Item Diterima',
                        value: _depositItemAccepted.toString(),
                        icon: Icons.inventory_2,
                        tone: MetricTone.green,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: MetricCard(
                        label: 'Pickup Selesai',
                        value: _pickupCompleted.toString(),
                        icon: Icons.local_shipping,
                        tone: MetricTone.blue,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: MetricCard(
                        label: 'Total Item Deposit',
                        value: _depositItemCount.toString(),
                        icon: Icons.assessment,
                        tone: MetricTone.teal,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: MetricCard(
                        label: 'Total Pickup',
                        value: _pickupCount.toString(),
                        icon: Icons.assignment_turned_in,
                        tone: MetricTone.teal,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: MetricCard(
                        label: 'Reward Diterbitkan',
                        value: 'Rp ${_formatRupiah(_rewardTotal)}',
                        icon: Icons.paid_outlined,
                        tone: MetricTone.amber,
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: MetricCard(
                        label: 'Pengguna Terdaftar',
                        value: _userCount.toString(),
                        icon: Icons.people,
                        tone: MetricTone.blue,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 20),
                Text(
                  'Unduh Laporan CSV',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 12),
                _reportCard(
                  'Laporan Deposit',
                  'Data deposit per mesin, jenis sampah, dan user.',
                  Icons.inventory_2,
                  'deposits',
                  'laporan-deposit.csv',
                ),
                const SizedBox(height: 8),
                _reportCard(
                  'Laporan Reward',
                  'Riwayat reward (earn, redeem, penalty, adjustment).',
                  Icons.paid_outlined,
                  'rewards',
                  'laporan-reward.csv',
                ),
                const SizedBox(height: 8),
                _reportCard(
                  'Laporan Pickup',
                  'Riwayat pickup per mesin, status, dan pengepul.',
                  Icons.local_shipping,
                  'pickups',
                  'laporan-pickup.csv',
                ),
                const SizedBox(height: 16),
                _infoBox(),
                const SizedBox(height: 80),
              ],
            ),
    );
  }

  Widget _reportCard(
    String title,
    String desc,
    IconData icon,
    String type,
    String filename,
  ) {
    return ReLoopCard(
      child: ListTile(
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: ReLoopColors.brand50,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, color: ReLoopColors.brand600, size: 22),
        ),
        title: Text(
          title,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: 14,
            color: context.reloopForeground,
          ),
        ),
        subtitle: Text(
          desc,
          style: TextStyle(fontSize: 12, color: context.reloopMutedSoft),
        ),
        trailing: const Icon(Icons.download, color: ReLoopColors.brand500),
        onTap: () => _download(type, filename),
      ),
    );
  }

  Widget _infoBox() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ReLoopColors.brand50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: const Row(
        children: [
          Icon(Icons.info_outline, size: 18, color: ReLoopColors.brand600),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'Laporan CSV disimpan ke folder sementara dan dapat dibagikan langsung. Data dibatasi 5000 baris per laporan.',
              style: TextStyle(fontSize: 12, color: ReLoopColors.brand700),
            ),
          ),
        ],
      ),
    );
  }
}
