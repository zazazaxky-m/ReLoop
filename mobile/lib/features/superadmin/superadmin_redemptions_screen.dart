import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../core/api_client.dart';
import '../../shared/widgets/empty_state.dart';
import '../../shared/widgets/filter_chips.dart';
import '../../shared/widgets/metric_card.dart';
import '../../shared/widgets/reloop_card.dart';
import '../../shared/widgets/search_bar.dart';
import '../../shared/widgets/skeleton_loading.dart';
import '../../shared/widgets/status_badge.dart';
import '../../theme/colors.dart';
import '../admin/admin_shell.dart';

/// Layar khusus superadmin untuk mengelola antrian pencairan reward.
/// Menampilkan 3 metric (antrian, total dibayar, minimum) + daftar
/// redemption dengan info user, akun payout, dan aksi proses payout.
class SuperadminRedemptionsScreen extends StatefulWidget {
  const SuperadminRedemptionsScreen({super.key});

  @override
  State<SuperadminRedemptionsScreen> createState() =>
      _SuperadminRedemptionsScreenState();
}

class _SuperadminRedemptionsScreenState
    extends State<SuperadminRedemptionsScreen> {
  List<dynamic> _rows = [];
  int _minRedemption = 0;
  String? _error;
  String _query = '';
  String? _statusFilter;
  bool _loading = true;

  static const _statusOptions = [
    'REQUESTED',
    'APPROVED',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'REVERSED',
  ];

  static final _money = NumberFormat.currency(
    symbol: 'Rp ',
    decimalDigits: 0,
    locale: 'id_ID',
  );

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
      final api = context.read<ApiClient>();
      final res = await api.get('/api/redemptions?queue=1');
      Map<String, dynamic> configData = const {};
      try {
        final configRes = await api.get('/api/config');
        configData = (configRes.data['config'] as Map<String, dynamic>?) ?? {};
      } catch (_) {
        // Config tidak wajib, abaikan.
      }
      if (mounted) {
        setState(() {
          _rows = (res.data['redemptions'] as List?) ?? [];
          _minRedemption = int.tryParse(
                configData['minRedemption']?.toString() ?? '0',
              ) ??
              0;
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

  Future<void> _act(String id, String action) async {
    try {
      await context.read<ApiClient>().patch(
        '/api/redemptions/$id',
        data: {'action': action},
      );
      await _load();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Perubahan disimpan'),
            backgroundColor: ReLoopColors.success,
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ApiClient.getErrorMessage(error)),
            backgroundColor: ReLoopColors.danger,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final queueCount = _rows
        .where((r) => ['REQUESTED', 'APPROVED', 'PROCESSING']
            .contains(r['status']?.toString()))
        .length;
    final paidTotal = _rows
        .where((r) => r['status'] == 'SUCCESS')
        .fold<int>(0, (sum, r) {
      final amount = (r['amount'] as num?)?.toInt() ?? 0;
      return sum + amount;
    });
    final filtered = _rows.where((row) {
      final r = row as Map<String, dynamic>;
      if (_statusFilter != null && r['status'] != _statusFilter) return false;
      if (_query.isEmpty) return true;
      final q = _query.toLowerCase();
      final user = r['user']?['name']?.toString().toLowerCase() ?? '';
      final email = r['user']?['email']?.toString().toLowerCase() ?? '';
      final accId =
          r['payoutAccount']?['accountIdentifier']?.toString().toLowerCase() ??
              '';
      return user.contains(q) || email.contains(q) || accId.contains(q);
    }).toList();

    return AdminShell(
      title: 'Redemption',
      child: RefreshIndicator(
        onRefresh: _load,
        child: _body(filtered, queueCount, paidTotal),
      ),
    );
  }

  Widget _body(List<dynamic> rows, int queueCount, int paidTotal) {
    if (_loading) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 100),
        children: const [
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
          SizedBox(height: 10),
          SkeletonListTile(),
        ],
      );
    }
    if (_error != null) {
      return _ErrorState(message: _error!, onRetry: _load);
    }
    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
          sliver: SliverToBoxAdapter(
            child: Row(
              children: [
                Expanded(
                  child: MetricCard(
                    label: 'Antrian aktif',
                    value: '$queueCount',
                    icon: Icons.schedule_outlined,
                    tone: MetricTone.amber,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Total dibayar',
                    value: _money.format(paidTotal),
                    icon: Icons.account_balance_wallet_outlined,
                    tone: MetricTone.green,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: MetricCard(
                    label: 'Min. pencairan',
                    value: _money.format(_minRedemption),
                    icon: Icons.payments_outlined,
                    tone: MetricTone.slate,
                  ),
                ),
              ],
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopSearchBar(
              hintText: 'Cari redemption...',
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
        ),
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
          sliver: SliverToBoxAdapter(
            child: ReLoopFilterChips(
              label: 'Status',
              options: _statusOptions,
              selected: _statusFilter,
              onSelected: (v) => setState(() => _statusFilter = v),
            ),
          ),
        ),
        if (rows.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: EmptyState(
              icon: Icons.account_balance_wallet_outlined,
              title: 'Belum ada redemption',
              description: _query.isNotEmpty || _statusFilter != null
                  ? 'Coba ubah pencarian atau filter.'
                  : 'Belum ada permintaan pencairan.',
            ),
          )
        else
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
            sliver: SliverList.builder(
              itemCount: rows.length,
              itemBuilder: (context, index) {
                final raw = rows[index] as Map<String, dynamic>;
                return Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _RedemptionCard(
                    row: raw,
                    onAction: (action) => _act(raw['id'], action),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }
}

class _RedemptionCard extends StatelessWidget {
  const _RedemptionCard({required this.row, required this.onAction});
  final Map<String, dynamic> row;
  final ValueChanged<String> onAction;

  @override
  Widget build(BuildContext context) {
    final user = row['user'] as Map<String, dynamic>?;
    final payout = row['payoutAccount'] as Map<String, dynamic>?;
    final status = (row['status'] as String?) ?? 'REQUESTED';
    final amount = (row['amount'] as num?)?.toInt() ?? 0;
    final provider = row['provider']?.toString() ?? '-';

    return ReLoopCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: context.reloopBrandSoft,
                  borderRadius: BorderRadius.circular(11),
                ),
                child: Icon(
                  Icons.account_balance_wallet_outlined,
                  color: context.reloopBrandText,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      user?['name']?.toString() ?? 'Pengguna',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 13.5,
                      ),
                    ),
                    Text(
                      user?['email']?.toString() ?? '-',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: context.reloopMuted,
                      ),
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    _RedemptionCardScreen.money.format(amount),
                    style: const TextStyle(
                      fontWeight: FontWeight.w800,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 4),
                  StatusBadge(statusKey: status),
                ],
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: context.reloopSurface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: context.reloopBorder),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _InfoLine(
                  icon: Icons.account_balance_outlined,
                  label: 'Provider',
                  value: provider,
                ),
                if (payout != null) ...[
                  const SizedBox(height: 4),
                  _InfoLine(
                    icon: Icons.credit_card_outlined,
                    label: 'Akun',
                    value:
                        '${payout['accountIdentifier']?.toString() ?? '-'} (${payout['accountName']?.toString() ?? '-'})',
                  ),
                ],
                if (row['note'] != null) ...[
                  const SizedBox(height: 4),
                  _InfoLine(
                    icon: Icons.sticky_note_2_outlined,
                    label: 'Catatan',
                    value: row['note'].toString(),
                  ),
                ],
              ],
            ),
          ),
          if (_actionsFor(status).isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              alignment: WrapAlignment.end,
              children: [
                for (final action in _actionsFor(status))
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: action.danger
                          ? ReLoopColors.danger
                          : context.reloopBrandText,
                      side: BorderSide(
                        color: action.danger
                            ? ReLoopColors.danger.withValues(alpha: .5)
                            : context.reloopBrandText.withValues(alpha: .4),
                      ),
                      minimumSize: const Size(0, 32),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 4,
                      ),
                    ),
                    onPressed: () => onAction(action.value),
                    child: Text(
                      action.label,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  List<_RedemptionAction> _actionsFor(String status) {
    switch (status) {
      case 'REQUESTED':
        return const [
          _RedemptionAction('Setujui', 'approve', false),
          _RedemptionAction('Tolak', 'fail', true),
        ];
      case 'APPROVED':
        return const [_RedemptionAction('Proses', 'process', false)];
      case 'PROCESSING':
        return const [
          _RedemptionAction('Berhasil', 'success', false),
          _RedemptionAction('Gagal', 'fail', true),
        ];
      default:
        return const [];
    }
  }
}

class _RedemptionCardScreen {
  static final money = NumberFormat.currency(
    symbol: 'Rp ',
    decimalDigits: 0,
    locale: 'id_ID',
  );
}

class _RedemptionAction {
  final String label;
  final String value;
  final bool danger;
  const _RedemptionAction(this.label, this.value, this.danger);
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 13, color: context.reloopMutedSoft),
        const SizedBox(width: 5),
        Text(
          '$label: ',
          style: TextStyle(
            fontSize: 11.5,
            color: context.reloopMutedSoft,
            fontWeight: FontWeight.w600,
          ),
        ),
        Expanded(
          child: Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12),
          ),
        ),
      ],
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
