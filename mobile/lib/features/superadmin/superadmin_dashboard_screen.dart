import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/api_client.dart';
import '../../core/auth_provider.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/promo_carousel.dart';
import '../../shared/widgets/quick_action.dart';
import '../../shared/widgets/reloop_card.dart';
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
  final _money = NumberFormat.currency(
    symbol: 'Rp',
    decimalDigits: 0,
    locale: 'id_ID',
  );

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
      return _ErrorState(message: _error!, onRetry: _load);
    }

    final data = _data!;
    final security =
        data['securitySummary'] as Map<String, dynamic>? ?? const {};
    final auth = context.watch<AuthProvider>();
    final firstName =
        (auth.user?.name ?? 'Superadmin').split(' ').first;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 110),
      children: [
        const PromoCarousel(),
        const SizedBox(height: 16),
        _SuperadminSummaryCard(
          organizationCount:
              (data['organizationCount'] as num?)?.toInt() ?? 0,
          machineCount: (data['machineCount'] as num?)?.toInt() ?? 0,
          userCount: (data['userCount'] as num?)?.toInt() ?? 0,
          rewardAvailable:
              (data['rewardAvailable'] as num?)?.toInt() ?? 0,
          alerts24h: (security['alerts24h'] as num?)?.toInt() ?? 0,
          firstName: firstName,
        ),
        const SizedBox(height: 22),
        const _SectionTitle(title: 'Layanan ReLoop'),
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
              icon: Icons.recycling_outlined,
              title: 'Mesin',
              description: 'Semua unit',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/superadmin/machines'),
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
            QuickAction(
              icon: Icons.settings_outlined,
              title: 'Konfigurasi',
              description: 'Atur slider',
              tone: QuickActionTone.blue,
              onTap: () => context.push('/superadmin/config'),
            ),
            QuickAction(
              icon: Icons.shield_outlined,
              title: 'Keamanan',
              description: 'Log fraud',
              tone: QuickActionTone.amber,
              onTap: () => context.push('/superadmin/security'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        const _SectionTitle(title: 'Operasional'),
        const SizedBox(height: 12),
        GridView.count(
          crossAxisCount: 3,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.15,
          children: [
            MetricCard(
              label: 'Item diterima',
              value: '${data['depositCount'] ?? 0}',
              tone: MetricTone.teal,
              icon: Icons.inventory_2_outlined,
            ),
            MetricCard(
              label: 'Mitra pending',
              value: '${data['pendingPartners'] ?? 0}',
              tone: MetricTone.amber,
              icon: Icons.handshake_outlined,
            ),
            MetricCard(
              label: 'Min. pencairan',
              value: _money.format(data['minRedemption'] ?? 0),
              tone: MetricTone.slate,
              icon: Icons.payments_outlined,
            ),
          ],
        ),
        const SizedBox(height: 24),
        const _SectionTitle(title: 'Ekspor Laporan'),
        const SizedBox(height: 12),
        _EksporLaporanCard(onDownload: _downloadCsv),
      ],
    );
  }

  Future<void> _downloadCsv(String type) async {
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);
    try {
      final response = await api.dio.get<ResponseBody>(
        '/api/reports',
        queryParameters: {'type': type},
        options: Options(responseType: ResponseType.stream),
      );
      final stream = response.data!.stream;
      final bytes = await stream.fold<List<int>>(
        <int>[],
        (acc, chunk) => acc..addAll(chunk),
      );
      final dir = await getTemporaryDirectory();
      final file = File(
        '${dir.path}/$type-${DateTime.now().millisecondsSinceEpoch}.csv',
      );
      await file.writeAsBytes(bytes);
      await Share.shareXFiles(
        [XFile(file.path, mimeType: 'text/csv')],
        subject: 'ReLoop $type CSV',
      );
    } catch (error) {
      if (!mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text(ApiClient.getErrorMessage(error))),
      );
    }
  }
}

class _SuperadminSummaryCard extends StatelessWidget {
  const _SuperadminSummaryCard({
    required this.organizationCount,
    required this.machineCount,
    required this.userCount,
    required this.rewardAvailable,
    required this.alerts24h,
    required this.firstName,
  });

  final int organizationCount;
  final int machineCount;
  final int userCount;
  final int rewardAvailable;
  final int alerts24h;
  final String firstName;

  @override
  Widget build(BuildContext context) {
    return ReLoopCard(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: context.reloopBrandSoftStrong,
                child: Text(
                  firstName.isEmpty ? 'S' : firstName[0].toUpperCase(),
                  style: TextStyle(
                    color: context.reloopBrandText,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Halo, $firstName',
                      style: TextStyle(
                        color: context.reloopForeground,
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -.3,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Pantau operasional, pengguna, organisasi, dan reward dalam satu ringkasan.',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: context.reloopMuted,
                        fontSize: 11.5,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _SummaryStat(
                  icon: Icons.business_outlined,
                  label: 'Organisasi',
                  value: '$organizationCount',
                  tone: QuickActionTone.green,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _SummaryStat(
                  icon: Icons.recycling_rounded,
                  label: 'Mesin',
                  value: '$machineCount',
                  tone: QuickActionTone.teal,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _SummaryStat(
                  icon: Icons.people_outline,
                  label: 'Pengguna',
                  value: '$userCount',
                  tone: QuickActionTone.blue,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: alerts24h > 0
                  ? ReLoopColors.warning.withValues(alpha: .1)
                  : context.reloopBrandSoft,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: alerts24h > 0
                    ? ReLoopColors.warning.withValues(alpha: .35)
                    : context.reloopBorder,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: alerts24h > 0
                        ? ReLoopColors.warning.withValues(alpha: .2)
                        : ReLoopColors.brand500,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    alerts24h > 0
                        ? Icons.warning_amber_rounded
                        : Icons.account_balance_wallet_outlined,
                    color: alerts24h > 0
                        ? ReLoopColors.warning
                        : Colors.white,
                    size: 18,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        alerts24h > 0
                            ? 'Peringatan Fraud & Vandalisme'
                            : 'Reward Tersedia',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 12.5,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        alerts24h > 0
                            ? '$alerts24h alert dalam 24 jam terakhir.'
                            : NumberFormat.currency(
                                symbol: 'Rp ',
                                decimalDigits: 0,
                                locale: 'id_ID',
                              ).format(rewardAvailable),
                        style: TextStyle(
                          fontSize: 11.5,
                          color: context.reloopMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                TextButton(
                  onPressed: () => context.push(
                    alerts24h > 0
                        ? '/superadmin/security'
                        : '/superadmin/redemptions',
                  ),
                  child: Text(
                    alerts24h > 0 ? 'Buka log' : 'Detail',
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({
    required this.icon,
    required this.label,
    required this.value,
    required this.tone,
  });

  final IconData icon;
  final String label;
  final String value;
  final QuickActionTone tone;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      QuickActionTone.green => ReLoopColors.brand600,
      QuickActionTone.blue => ReLoopColors.info,
      QuickActionTone.amber => ReLoopColors.warning,
      QuickActionTone.teal => ReLoopColors.accent,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
      decoration: BoxDecoration(
        color: context.reloopSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.reloopBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: color.withValues(alpha: .12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, color: color, size: 16),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: context.reloopForeground,
                  ),
                ),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10.5,
                    color: context.reloopMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: TextStyle(
        color: context.reloopForeground,
        fontSize: 16,
        fontWeight: FontWeight.w800,
        letterSpacing: -.2,
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
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
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(onPressed: onRetry, child: Text('Coba lagi')),
        ),
      ],
    );
  }
}

class _EksporLaporanCard extends StatelessWidget {
  const _EksporLaporanCard({required this.onDownload});
  final ValueChanged<String> onDownload;

  @override
  Widget build(BuildContext context) {
    final reports = const [
      _ReportItem(type: 'deposits', label: 'Deposit', icon: Icons.inventory_2_outlined),
      _ReportItem(type: 'rewards', label: 'Reward', icon: Icons.account_balance_wallet_outlined),
      _ReportItem(type: 'pickups', label: 'Pickup', icon: Icons.local_shipping_outlined),
    ];
    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Data seluruh organisasi akan diekspor ke file CSV.',
            style: TextStyle(
              fontSize: 11.5,
              color: context.reloopMuted,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              for (int i = 0; i < reports.length; i++) ...[
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: context.reloopBrandText,
                      side: BorderSide(
                        color: context.reloopBrandText.withValues(alpha: .4),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                    ),
                    onPressed: () => onDownload(reports[i].type),
                    icon: Icon(reports[i].icon, size: 16),
                    label: Text(
                      reports[i].label,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                if (i < reports.length - 1) const SizedBox(width: 8),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _ReportItem {
  final String type;
  final String label;
  final IconData icon;
  const _ReportItem({
    required this.type,
    required this.label,
    required this.icon,
  });
}

