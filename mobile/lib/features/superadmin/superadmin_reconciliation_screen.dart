import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../services/offline_service.dart';
import '../../shared/format.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

/// SUPERADMIN financial reconciliation, mirroring the web page
/// `/dashboard/superadmin/reconciliation`. Reads `/api/reports/reconciliation`
/// which returns `{ report: ReconciliationReport }`.
class SuperadminReconciliationScreen extends StatefulWidget {
  const SuperadminReconciliationScreen({super.key});

  @override
  State<SuperadminReconciliationScreen> createState() =>
      _SuperadminReconciliationScreenState();
}

class _SuperadminReconciliationScreenState
    extends State<SuperadminReconciliationScreen> {
  static const _cacheKey = 'reconciliation';

  Map<String, dynamic>? _report;
  bool _loading = true;
  bool _isOffline = false;
  String? _error;

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
          await context.read<ApiClient>().get('/api/reports/reconciliation');
      final data = response.data;
      final report = data is Map<String, dynamic>
          ? data['report'] as Map<String, dynamic>?
          : null;
      if (report == null) {
        throw Exception('Format rekonsiliasi tidak valid');
      }
      await OfflineService().cache(_cacheKey, report);
      if (mounted) {
        setState(() {
          _report = report;
          _loading = false;
          _isOffline = false;
        });
      }
    } catch (error) {
      final cached = OfflineService().get(_cacheKey);
      if (cached is Map<String, dynamic>) {
        if (mounted) {
          setState(() {
            _report = cached;
            _loading = false;
            _isOffline = true;
            _error = null;
          });
        }
        return;
      }
      if (mounted) {
        setState(() {
          _error = ApiClient.getErrorMessage(error);
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AdminShell(
      title: 'Rekonsiliasi Keuangan',
      child: RefreshIndicator(onRefresh: _load, child: _body()),
    );
  }

  Widget _body() {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.all(16),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
          SizedBox(height: 8),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }

    final report = _report!;
    int money(String key) => (report[key] as num?)?.round() ?? 0;

    final redeemedDiscrepancy = money('redeemedDiscrepancy');
    final reservedDiscrepancy = money('reservedDiscrepancy');
    final hasDiscrepancy = report['hasDiscrepancy'] as bool? ?? false;
    final organizations =
        (report['organizations'] as List?)?.cast<Map<String, dynamic>>() ??
            const [];
    final generatedAt = report['generatedAt'] as String?;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 110),
      children: [
        Text(
          'Liabilitas poin per organisasi dan pencocokan pembayaran '
          '(ledger REDEEM vs pencairan) di seluruh platform.',
          style: TextStyle(fontSize: 12.5, color: context.reloopMuted, height: 1.4),
        ),
        if (_isOffline) ...[
          const SizedBox(height: 12),
          _OfflineBanner(),
        ],
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Total liabilitas',
                value: formatRupiah(money('totalOutstanding')),
                hint: 'Spendable saat ini',
                icon: Icons.account_balance_wallet_outlined,
                tone: MetricTone.teal,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Menunggu review',
                value: formatRupiah(money('totalEarnPending')),
                hint: 'Pending',
                icon: Icons.hourglass_bottom_outlined,
                tone: MetricTone.amber,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: MetricCard(
                label: 'Dicairkan (ledger)',
                value: formatRupiah(money('ledgerRedeemed')),
                hint: 'REDEEM terbayar',
                icon: Icons.payments_outlined,
                tone: MetricTone.slate,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: MetricCard(
                label: 'Selisih',
                value: formatRupiah(redeemedDiscrepancy + reservedDiscrepancy),
                hint: 'Rekonsiliasi',
                icon: Icons.rule_folder_outlined,
                tone: hasDiscrepancy ? MetricTone.amber : MetricTone.teal,
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        _DiscrepancyBanner(hasDiscrepancy: hasDiscrepancy),
        const SizedBox(height: 20),
        _SectionTitle('Pencocokan pembayaran (global)'),
        const SizedBox(height: 12),
        ReLoopCard(
          padding: const EdgeInsets.all(4),
          child: Column(
            children: [
              _MatchHeaderRow(),
              _MatchRow(
                label: 'Sudah dibayar (SUCCESS)',
                ledger: money('ledgerRedeemed'),
                payout: money('redemptionSuccessTotal'),
                diff: redeemedDiscrepancy,
              ),
              Divider(height: 1, color: context.reloopBorder),
              _MatchRow(
                label: 'Dalam proses (reserved)',
                ledger: money('ledgerReserved'),
                payout: money('redemptionInFlightTotal'),
                diff: reservedDiscrepancy,
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        _SectionTitle('Liabilitas per organisasi'),
        const SizedBox(height: 12),
        if (organizations.isEmpty)
          ReLoopCard(
            padding: const EdgeInsets.symmetric(vertical: 28),
            child: Center(
              child: Text(
                'Belum ada data ledger.',
                style: TextStyle(color: context.reloopMuted, fontSize: 13),
              ),
            ),
          )
        else
          ...organizations.map((org) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _OrgLiabilityCard(org: org),
              )),
        if (generatedAt != null) ...[
          const SizedBox(height: 12),
          Text(
            'Dihasilkan ${formatDateTimeIso(generatedAt)}.',
            style: TextStyle(fontSize: 11, color: context.reloopMutedSoft),
          ),
        ],
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.title);
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

class _DiscrepancyBanner extends StatelessWidget {
  const _DiscrepancyBanner({required this.hasDiscrepancy});
  final bool hasDiscrepancy;

  @override
  Widget build(BuildContext context) {
    final warn = hasDiscrepancy;
    final bg = warn
        ? ReLoopColors.warning.withValues(alpha: .1)
        : context.reloopBrandSoft;
    final borderColor = warn
        ? ReLoopColors.warning.withValues(alpha: .4)
        : context.reloopBorder;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            warn ? Icons.warning_amber_rounded : Icons.verified_outlined,
            size: 20,
            color: warn ? ReLoopColors.warning : ReLoopColors.brand600,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  warn
                      ? 'Selisih rekonsiliasi terdeteksi'
                      : 'Ledger cocok dengan pencairan',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                    color: warn
                        ? ReLoopColors.warning
                        : context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  warn
                      ? 'Ledger REDEEM dan catatan pencairan tidak cocok. '
                          'Periksa entri yang belum tersettle atau pencairan '
                          'yang belum tercatat di ledger.'
                      : 'Tidak ada selisih antara ledger pembayaran dan '
                          'catatan pencairan.',
                  style: TextStyle(fontSize: 11.5, color: context.reloopMuted, height: 1.35),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MatchHeaderRow extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontSize: 10.5,
      fontWeight: FontWeight.w700,
      letterSpacing: .3,
      color: context.reloopMutedSoft,
    );
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
      child: Row(
        children: [
          Expanded(flex: 4, child: Text('METRIK', style: style)),
          Expanded(
            flex: 3,
            child: Text('LEDGER', style: style, textAlign: TextAlign.right),
          ),
          Expanded(
            flex: 3,
            child: Text('SELISIH', style: style, textAlign: TextAlign.right),
          ),
        ],
      ),
    );
  }
}

class _MatchRow extends StatelessWidget {
  const _MatchRow({
    required this.label,
    required this.ledger,
    required this.payout,
    required this.diff,
  });

  final String label;
  final int ledger;
  final int payout;
  final int diff;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 4,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12.5,
                    fontWeight: FontWeight.w600,
                    color: context.reloopForeground,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Pencairan ${formatRupiah(payout)}',
                  style: TextStyle(fontSize: 11, color: context.reloopMutedSoft),
                ),
              ],
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              formatRupiah(ledger),
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 12.5,
                color: context.reloopForeground,
              ),
            ),
          ),
          Expanded(
            flex: 3,
            child: Text(
              formatRupiah(diff),
              textAlign: TextAlign.right,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w700,
                color: diff == 0 ? context.reloopMuted : ReLoopColors.danger,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _OrgLiabilityCard extends StatelessWidget {
  const _OrgLiabilityCard({required this.org});
  final Map<String, dynamic> org;

  @override
  Widget build(BuildContext context) {
    int money(String key) => (org[key] as num?)?.round() ?? 0;
    final name = org['organizationName'] as String? ?? 'Tanpa organisasi';
    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: context.reloopForeground,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                formatRupiah(money('outstanding')),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: context.reloopBrandText,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              _MiniStat(label: 'Tersedia', value: formatRupiah(money('earnAvailable'))),
              _MiniStat(label: 'Pending', value: formatRupiah(money('earnPending'))),
              _MiniStat(label: 'Penyesuaian', value: formatRupiah(money('adjustments'))),
            ],
          ),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 10.5, color: context.reloopMutedSoft),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: context.reloopForeground,
            ),
          ),
        ],
      ),
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: ReLoopColors.warning.withValues(alpha: .1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: ReLoopColors.warning.withValues(alpha: .35)),
      ),
      child: Row(
        children: [
          Icon(Icons.cloud_off_rounded, size: 16, color: ReLoopColors.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Menampilkan data tersimpan (offline).',
              style: TextStyle(fontSize: 12, color: context.reloopMuted),
            ),
          ),
        ],
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
        Icon(Icons.cloud_off_rounded, size: 48, color: context.reloopMutedSoft),
        const SizedBox(height: 12),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(color: context.reloopMuted),
        ),
        const SizedBox(height: 8),
        Center(
          child: TextButton(onPressed: onRetry, child: const Text('Coba lagi')),
        ),
      ],
    );
  }
}
